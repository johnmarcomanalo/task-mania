import { describe, expect, it } from 'vitest'
import { todayIn } from '../src/dates'
import { streakOf } from '../src/hygiene'
import { boardIdOf, boardOf, columnOf, env, get, json } from './helpers'

const today = () => todayIn('Asia/Manila')

const DAY = 86_400_000
function shift(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * DAY).toISOString().slice(0, 10)
}

/** `n` done tasks planted directly with SQL on the given day, for streak fixtures. */
async function seedDone(boardId: number, columnId: number, title: string, doneOn: string, n = 1): Promise<void> {
  const at = '2026-01-01T00:00:00.000Z'
  for (let i = 0; i < n; i++) {
    await env.DB
      .prepare(
        `INSERT INTO tasks (board_id, board_column_id, title, source, done_on, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'Manual', ?4, ?5, ?5)`,
      )
      .bind(boardId, columnId, `${title} ${i}`, doneOn, at)
      .run()
  }
}

describe('server streak', () => {
  it('matches the client algorithm over a seeded week, including archived tasks', async () => {
    const board = await boardOf()
    const boardId = await boardIdOf(board.slug)
    const done = columnOf(board, 'done')
    const t = today()

    await seedDone(boardId, done, 'Today', t, 2)
    await seedDone(boardId, done, 'Yesterday', shift(t, -1), 1)
    // Nothing 2 days ago.
    await seedDone(boardId, done, 'Long gone', shift(t, -40), 3)

    const streak = await streakOf(env.DB, boardId, t)
    expect(streak.streak).toBe(2)
    expect(streak.done_today).toBe(2)
    expect(streak.week.map((w) => w.label)).toEqual([6, 5, 4, 3, 2, 1, 0].map((n) => shift(t, -n)))
    expect(streak.week.map((w) => w.count)).toEqual([0, 0, 0, 0, 0, 1, 2])
  })

  it('is zero on a board with nothing done', async () => {
    const board = await boardOf()
    const boardId = await boardIdOf(board.slug)

    const streak = await streakOf(env.DB, boardId, today())
    expect(streak.streak).toBe(0)
    expect(streak.done_today).toBe(0)
    expect(streak.week.every((w) => w.count === 0)).toBe(true)
  })

  it('counts from yesterday when nothing is done today — a gap only breaks after day 0', async () => {
    const board = await boardOf()
    const boardId = await boardIdOf(board.slug)
    const done = columnOf(board, 'done')
    const t = today()

    await seedDone(boardId, done, 'Yesterday', shift(t, -1), 1)
    await seedDone(boardId, done, 'Two days ago', shift(t, -2), 1)

    const streak = await streakOf(env.DB, boardId, t)
    expect(streak.streak).toBe(2)
    expect(streak.done_today).toBe(0)
  })

  it('rides along on the board payload, alongside features', async () => {
    const board = await boardOf()
    const boardId = await boardIdOf(board.slug)
    const done = columnOf(board, 'done')
    await seedDone(boardId, done, 'Today', today(), 1)

    const fresh = (await json(await get(`/api/boards/${board.slug}`))).data
    expect(fresh.streak).toEqual(await streakOf(env.DB, boardId, today()))
    expect(fresh.features).toEqual({ repeat: true, archive: true })
  })
})
