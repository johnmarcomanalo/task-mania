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
