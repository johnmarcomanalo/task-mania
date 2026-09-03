export interface ColumnRow {
  id: number; board_id: number; key: string; name: string; position: number; is_done: number
  created_at: string; updated_at: string
}
export interface SourceRow {
  id: number; board_id: number; name: string; position: number; is_archived: number
  created_at: string; updated_at: string
}
export interface TaskRow {
  id: number; board_id: number; board_column_id: number; title: string; source: string
  sender: string | null; due_date: string | null; priority: 'high' | 'normal' | 'low'
  quote: string | null; attachments_note: string | null; tags: string | null
  screenshot_path: string | null; captured_on: string | null; done_on: string | null
  position: number; created_at: string; updated_at: string
}
export interface FileRow {
  id: number; task_id: number; name: string; mime: string | null; size: number; path: string
  created_at: string; updated_at: string
}
export interface ActivityRow {
  id: number; board_id: number; task_id: number | null; text: string
  created_at: string; updated_at: string
}

export const storageUrl = (key: string) => `/storage/${key}`

export function columnJson(c: ColumnRow) {
  return { id: c.id, key: c.key, name: c.name, position: c.position, is_done: c.is_done === 1 }
}

/** task_count rides along only from the sources endpoint, which counts them. */
export function sourceJson(s: SourceRow, taskCount?: number) {
  const out: Record<string, unknown> = {
    id: s.id, name: s.name, position: s.position, is_archived: s.is_archived === 1,
  }
  if (taskCount !== undefined) out.task_count = taskCount
  return out
}

export function fileJson(f: FileRow) {
  return {
    id: f.id, name: f.name, mime: f.mime, size: f.size,
    url: storageUrl(f.path), is_image: (f.mime ?? '').startsWith('image/'),
  }
}

export function activityJson(a: ActivityRow) {
  return { id: a.id, task_id: a.task_id, text: a.text, at: a.created_at }
}

export function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.map(String) : []
  } catch {
    return []
  }
}

export function taskJson(t: TaskRow, extra: { columnKey: string; files: FileRow[]; history?: ActivityRow[] }) {
  return {
    id: t.id,
    column_id: t.board_column_id,
    column_key: extra.columnKey,
    title: t.title,
    source: t.source,
    sender: t.sender,
    due: t.due_date ?? '',
    priority: t.priority,
    quote: t.quote ?? '',
    attachments: t.attachments_note ?? '',
    tags: parseTags(t.tags),
    shot: t.screenshot_path ? storageUrl(t.screenshot_path) : null,
    captured: t.captured_on,
    done_on: t.done_on,
    position: t.position,
    files: extra.files.map(fileJson),
    // Present on single-task replies only, like Laravel's whenLoaded('activities').
    ...(extra.history ? { history: extra.history.map(activityJson) } : {}),
  }
}
