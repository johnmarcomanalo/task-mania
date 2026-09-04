import type { Activity, ArchivePage, Board, Priority, RepeatRule, ScanResult, Source, Task, TaskFile } from './types'

const BASE = (import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000/api').replace(/\/$/, '')

export class ApiError extends Error {
  status: number
  errors: Record<string, string[]>

  constructor(status: number, message: string, errors: Record<string, string[]> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.errors = errors
  }
}

/** Who is signed in. `email` is null on the local Laravel setup, which has no login. */
export interface Me {
  email: string | null
  name: string | null
  board_slug: string
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the API.')
  }

  if (res.status === 204) return undefined as T

  // Cloudflare Access answers an expired session by redirecting the call to
  // its login page, which is HTML: treat that as signed out.
  const type = res.headers.get('content-type') ?? ''
  if (res.redirected || (res.ok && !type.includes('json'))) {
    throw new ApiError(401, 'Your session ended — reload to sign in again.')
  }

  const text = await res.text()
  let payload: any = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }

  if (!res.ok) {
    throw new ApiError(res.status, payload?.message ?? `Request failed (${res.status})`, payload?.errors ?? {})
  }

  return (payload?.data ?? payload) as T
}

export interface TaskInput {
  column_id?: number
  title?: string
  source?: string
  sender?: string | null
  due?: string | null
  priority?: Priority
  quote?: string | null
  attachments?: string | null
  tags?: string[]
  repeat?: RepeatRule | null
}

export interface BulkRow extends TaskInput {
  column_id: number
  title: string
}

export const api = {
  me: () => request<Me>('/me'),

  getBoard: (slug: string) => request<Board>(`/boards/${encodeURIComponent(slug)}`),

  archive: (slug: string, q: string, page: number) =>
    request<ArchivePage>(`/boards/${encodeURIComponent(slug)}/archive?q=${encodeURIComponent(q)}&page=${page}`),

  activity: (slug: string) => request<Activity[]>(`/boards/${encodeURIComponent(slug)}/activity`),

  createTask: (slug: string, body: TaskInput) =>
    request<Task>(`/boards/${encodeURIComponent(slug)}/tasks`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  bulkCreate: (slug: string, body: { screenshot_path?: string | null; source?: string; tasks: BulkRow[] }) =>
    request<Task[]>(`/boards/${encodeURIComponent(slug)}/tasks/bulk`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateTask: (id: number, body: TaskInput) =>
    request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  moveTask: (id: number, body: { column_id: number; position: number }) =>
    request<Task>(`/tasks/${id}/move`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteTask: (id: number) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),

  attach: (taskId: number, files: File[]) => {
    const form = new FormData()
    files.forEach((f) => form.append('files[]', f))
    return request<TaskFile[]>(`/tasks/${taskId}/files`, { method: 'POST', body: form })
  },

  detach: (fileId: number) => request<void>(`/task-files/${fileId}`, { method: 'DELETE' }),

  listSources: (slug: string) => request<Source[]>(`/boards/${encodeURIComponent(slug)}/sources`),

  createSource: (slug: string, name: string) =>
    request<Source>(`/boards/${encodeURIComponent(slug)}/sources`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  updateSource: (id: number, body: { name?: string; is_archived?: boolean }) =>
    request<Source>(`/sources/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  /**
   * Removes the source outright when nothing uses it. A name still on a task
   * is archived instead, and the reply says how many tasks kept it alive.
   */
  deleteSource: (id: number) =>
    request<{ archived: boolean; tasks_using: number }>(`/sources/${id}`, { method: 'DELETE' }),

  /** Upload a screenshot and get back the tasks Claude read out of it. */
  scan: (slug: string, image: File) => {
    const form = new FormData()
    form.append('image', image)
    return request<ScanResult>(`/boards/${encodeURIComponent(slug)}/scan`, {
      method: 'POST',
      body: form,
    })
  },
}
