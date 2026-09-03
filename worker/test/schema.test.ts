import { describe, expect, it } from 'vitest'
import { env } from './helpers'

describe('schema', () => {
  it('creates the seven tables', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%'
        ORDER BY name`,
    ).all<{ name: string }>()

    expect(results.map((r) => r.name)).toEqual([
      'activities', 'board_columns', 'boards', 'sources', 'task_files', 'tasks', 'users',
    ])
  })

  it('enforces foreign keys', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO boards (user_id, name, slug, created_at, updated_at) VALUES (999, 'x', 'x', 't', 't')`,
      ).run(),
    ).rejects.toThrow()
  })

  it('compares source names case-insensitively', async () => {
    const t = '2026-01-01T00:00:00.000Z'
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO users (email, created_at, last_seen_at) VALUES ('a@x.io', ?1, ?1)`).bind(t),
      env.DB.prepare(`INSERT INTO boards (user_id, name, slug, created_at, updated_at) VALUES (1, 'B', 'b-1', ?1, ?1)`).bind(t),
      env.DB.prepare(`INSERT INTO sources (board_id, name, position, created_at, updated_at) VALUES (1, 'Viber', 0, ?1, ?1)`).bind(t),
    ])

    await expect(
      env.DB.prepare(`INSERT INTO sources (board_id, name, position, created_at, updated_at) VALUES (1, 'viber', 1, ?1, ?1)`).bind(t).run(),
    ).rejects.toThrow()
  })
})
