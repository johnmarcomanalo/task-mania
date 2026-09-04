import { describe, expect, it } from 'vitest'
import { todayIn } from '../src/dates'
import { ALICE, BOB, boardIdOf, boardOf, columnOf, env, get, json, meOf, patch } from './helpers'

const today = () => todayIn('Asia/Manila')

const DAY = 86_400_000
function shift(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * DAY).toISOString().slice(0, 10)
}

interface SeedExtra { sender?: string; source?: string; quote?: string; tags?: string[] }

/** A done task planted directly with SQL, bypassing the API, for archive/streak fixtures. */
async function seedDone(boardId: number, columnId: number, title: string, doneOn: string, extra: SeedExtra = {}): Promise<number> {
  const at = '2026-01-01T00:00:00.000Z'
  const row = await env.DB
    .prepare(
      `INSERT INTO tasks (board_id, board_column_id, title, source, sender, quote, tags, done_on, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9) RETURNING id`,
    )
    .bind(
      boardId, columnId, title, extra.source ?? 'Manual', extra.sender ?? null, extra.quote ?? null,
      extra.tags ? JSON.stringify(extra.tags) : null, doneOn, at,
    )
    .first<{ id: number }>()
  return row!.id
}

async function archiveOf(slug: string, qs = ''): Promise<{ tasks: any[]; total: number; page: number; per_page: number }> {
  return (await json(await get(`/api/boards/${slug}/archive${qs}`))).data
}

describe('archive', () => {
  it('excludes tasks done more than 30 days ago from the board, and reports the count and features', async () => {
    const board = await boardOf()
    const boardId = await boardIdOf(board.slug)
    const done = columnOf(board, 'done')
    const t = today()

    const keep = await seedDone(boardId, done, 'Exactly 30 days ago', shift(t, -30))
    await seedDone(boardId, done, 'Just past 30 days', shift(t, -31))

    const fresh = (await json(await get(`/api/boards/${board.slug}`))).data
    expect(fresh.tasks.map((x: any) => x.id)).toEqual([keep])
    expect(fresh.archived_count).toBe(1)
    expect(fresh.features).toEqual({ repeat: true, archive: true })
  })

  it('lists archived tasks newest done_on first, with column_key and files but no history', async () => {
    const board = await boardOf()
    const boardId = await boardIdOf(board.slug)
    const done = columnOf(board, 'done')
    const t = today()

    const older = await seedDone(boardId, done, 'Older', shift(t, -40))
    const newer = await seedDone(boardId, done, 'Newer', shift(t, -35))

    const data = await archiveOf(board.slug)
    expect(data.tasks.map((x: any) => x.id)).toEqual([newer, older])
    expect(data.total).toBe(2)
    expect(data.page).toBe(1)
    expect(data.per_page).toBe(50)
    expect(data.tasks[0]).toMatchObject({ column_key: 'done', files: [] })
    expect(data.tasks[0].history).toBeUndefined()
  })

  it('search matches title, sender, source, quote and tags, case-insensitively', async () => {
    const board = await boardOf()
    const boardId = await boardIdOf(board.slug)
    const done = columnOf(board, 'done')
    const t = today()

    const byTitle = await seedDone(boardId, done, 'Renew the passport', shift(t, -40))
    const bySender = await seedDone(boardId, done, 'Something', shift(t, -41), { sender: 'Ms. Rivera' })
    const bySource = await seedDone(boardId, done, 'Something else', shift(t, -42), { source: 'Viber' })
    const byQuote = await seedDone(boardId, done, 'Third thing', shift(t, -43), { quote: 'please act soon' })
    const byTag = await seedDone(boardId, done, 'Fourth thing', shift(t, -44), { tags: ['Urgent'] })
    await seedDone(boardId, done, 'No match here', shift(t, -45))

    const search = async (term: string) => (await archiveOf(board.slug, `?q=${encodeURIComponent(term)}`)).tasks.map((x: any) => x.id)

    expect(await search('PASSPORT')).toEqual([byTitle])
    expect(await search('rivera')).toEqual([bySender])
    expect(await search('viber')).toEqual([bySource])
    expect(await search('ACT SOON')).toEqual([byQuote])
    expect(await search('urgent')).toEqual([byTag])
  })

  it('pages by 50', async () => {
    const board = await boardOf()
    const boardId = await boardIdOf(board.slug)
    const done = columnOf(board, 'done')
    const t = today()

    for (let i = 0; i < 55; i++) await seedDone(boardId, done, `Old ${i}`, shift(t, -(40 + i)))

    const page1 = await archiveOf(board.slug)
    expect(page1.tasks).toHaveLength(50)
    expect(page1.total).toBe(55)
    expect(page1.page).toBe(1)

    const page2 = await archiveOf(board.slug, '?page=2')
    expect(page2.tasks).toHaveLength(5)
    expect(page2.total).toBe(55)
    expect(page2.page).toBe(2)
  })

  it('restore: moving to todo clears done_on, returns the task to the board and decrements archived_count', async () => {
    const board = await boardOf()
    const boardId = await boardIdOf(board.slug)
    const done = columnOf(board, 'done')
    const todo = columnOf(board, 'todo')
    const id = await seedDone(boardId, done, 'Old task', shift(today(), -40))

    expect((await json(await get(`/api/boards/${board.slug}`))).data.archived_count).toBe(1)

    const res = await patch(`/api/tasks/${id}/move`, { column_id: todo, position: 0 })
    expect(res.status).toBe(200)
    expect((await json(res)).data.done_on).toBeNull()

    const fresh = (await json(await get(`/api/boards/${board.slug}`))).data
    expect(fresh.tasks.find((x: any) => x.id === id)).toMatchObject({ column_key: 'todo', done_on: null })
    expect(fresh.archived_count).toBe(0)
  })

  it('hides another user\'s archive behind a 404', async () => {
    const alice = await meOf(ALICE)
    const res = await get(`/api/boards/${alice.board_slug}/archive`, BOB)
    expect(res.status).toBe(404)
  })
})
