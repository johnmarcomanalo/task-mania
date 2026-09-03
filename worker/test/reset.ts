import { env } from 'cloudflare:workers'
import { beforeEach } from 'vitest'
import type { Env } from '../src/env'

const e = env as unknown as Env

// The Cloudflare vitest plugin isolates storage per test FILE, not per
// individual test — every `it()` in a file shares the same D1/R2 state
// unless something resets it. Tests throughout this suite assume a fresh
// database and an empty bucket each time, so reset both here, once, for all
// of them.
beforeEach(async () => {
  await e.DB.prepare(`DELETE FROM users`).run()
  await e.DB.prepare(`DELETE FROM sqlite_sequence`).run()

  let cursor: string | undefined
  for (;;) {
    const listed = await e.FILES.list(cursor ? { cursor } : undefined)
    await Promise.all(listed.objects.map((o) => e.FILES.delete(o.key)))
    if (!listed.truncated) break
    cursor = listed.cursor
  }
})
