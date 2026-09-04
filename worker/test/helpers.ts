import { env as rawEnv } from 'cloudflare:workers'
import { createApp } from '../src/app'
import type { Env } from '../src/env'

export const env = rawEnv as unknown as Env
export const app = createApp()

export const ALICE = 'alice@example.com'
export const BOB = 'bob@example.com'

/** Call the app as `who` through the dev bypass (ACCESS_DEV_EMAIL is set in vitest.config.ts). */
export function call(path: string, init: RequestInit = {}, who = ALICE, e: Env = env) {
  const headers = new Headers(init.headers)
  headers.set('X-Dev-Email', who)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return app.request(path, { ...init, headers }, e)
}

export const get = (path: string, who?: string) => call(path, {}, who)
export const post = (path: string, body: unknown, who?: string) =>
  call(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) }, who)
export const patch = (path: string, body: unknown, who?: string) =>
  call(path, { method: 'PATCH', body: JSON.stringify(body) }, who)
export const del = (path: string, who?: string) => call(path, { method: 'DELETE' }, who)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const json = async <T = any>(res: Response): Promise<T> => (await res.json()) as T

export async function meOf(who = ALICE): Promise<{ email: string; name: string | null; board_slug: string }> {
  return (await json(await get('/api/me', who))).data
}

export interface BoardJson {
  id: number
  name: string
  slug: string
  description: string | null
  sources: { id: number; name: string; position: number; is_archived: boolean }[]
  priorities: string[]
  scan_enabled: boolean
  columns: { id: number; key: string; name: string; position: number; is_done: boolean; is_cancelled: boolean }[]
  tasks: Record<string, unknown>[]
  activity: { id: number; task_id: number | null; text: string; at: string; task_title: string | null }[]
}

export async function boardOf(who = ALICE): Promise<BoardJson> {
  const me = await meOf(who)
  return (await json(await get(`/api/boards/${me.board_slug}`, who))).data
}

export function columnOf(board: BoardJson, key: string): number {
  const column = board.columns.find((c) => c.key === key)
  if (!column) throw new Error(`no column ${key}`)
  return column.id
}

export async function boardIdOf(slug: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT id FROM boards WHERE slug = ?1`).bind(slug).first<{ id: number }>()
  if (!row) throw new Error(`no board ${slug}`)
  return row.id
}

/** A task row without going through the API, for tests about other resources. */
export async function seedTask(boardId: number, source: string, title = 'Follow up with the supplier'): Promise<number> {
  const column = await env.DB
    .prepare(`SELECT id FROM board_columns WHERE board_id = ?1 ORDER BY position LIMIT 1`)
    .bind(boardId)
    .first<{ id: number }>()
  const at = '2026-01-01T00:00:00.000Z'
  const row = await env.DB
    .prepare(
      `INSERT INTO tasks (board_id, board_column_id, title, source, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5) RETURNING id`,
    )
    .bind(boardId, column!.id, title, source, at)
    .first<{ id: number }>()
  return row!.id
}
