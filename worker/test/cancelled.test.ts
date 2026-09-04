import { describe, expect, it } from 'vitest'
import { todayIn } from '../src/dates'
import { nextDue } from '../src/recur'
import { boardIdOf, boardOf, columnOf, env, get, json, patch, post } from './helpers'

const today = () => todayIn('Asia/Manila')

const DAY = 86_400_000
function shift(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * DAY).toISOString().slice(0, 10)
}

async function tasksOf(slug: string) {
  return (await json(await get(`/api/boards/${slug}`))).data.tasks as Record<string, any>[]
}

/** A task planted directly with SQL, cancelled on a given date, for archive fixtures. */
async function seedCancelled(boardId: number, columnId: number, title: string, cancelledOn: string): Promise<number> {
  const at = '2026-01-01T00:00:00.000Z'
  const row = await env.DB
    .prepare(
      `INSERT INTO tasks (board_id, board_column_id, title, source, cancelled_on, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) RETURNING id`,
    )
    .bind(boardId, columnId, title, 'Manual', cancelledOn, at)
    .first<{ id: number }>()
  return row!.id
}

function expectedNext(due: string, rule: any = { freq: 'weekly', weekday: 4 }) {
  const base = due > today() ? due : today()
  return nextDue(rule, base)
}

describe('cancelled lane', () => {
  it('a new board has 7 columns, the last is Cancelled', async () => {
    const board = await boardOf()
    expect(board.columns).toHaveLength(7)
    expect(board.columns[6]).toMatchObject({ key: 'cancelled', name: 'Cancelled', is_done: false, is_cancelled: true })
    for (const c of board.columns.slice(0, 6)) expect(c.is_cancelled).toBe(false)
  })

  it('creating a task directly in Cancelled sets cancelled_on and logs the creation', async () => {
    const board = await boardOf()
    const res = await post(`/api/boards/${board.slug}/tasks`, { column_id: columnOf(board, 'cancelled'), title: 'Never mind' })
    expect(res.status).toBe(201)
    const task = (await json(res)).data
    expect(task.cancelled_on).toBe(today())
    expect(task.done_on).toBeNull()
    expect(task.history[0].text).toBe('Created in Cancelled')
  })

  it('moving Inbox into Cancelled sets cancelled_on, logs the move, and never touches the streak', async () => {
    const board = await boardOf()
    const created = await post(`/api/boards/${board.slug}/tasks`, { column_id: columnOf(board, 'inbox'), title: 'Nope' })
    const task = (await json(created)).data

    const res = await patch(`/api/tasks/${task.id}/move`, { column_id: columnOf(board, 'cancelled'), position: 0 })
    expect(res.status).toBe(200)
    const moved = (await json(res)).data
    expect(moved.cancelled_on).toBe(today())
    expect(moved.done_on).toBeNull()
    expect(moved.history[0].text).toBe('Moved: Inbox → Cancelled')

    const fresh = (await json(await get(`/api/boards/${board.slug}`))).data
    expect(fresh.streak.done_today).toBe(0)
    expect(fresh.tasks.map((t: any) => t.id)).toContain(task.id)
  })

  it('moving between Done and Cancelled swaps the dates and never spawns a second copy', async () => {
    const board = await boardOf()
    const created = await post(`/api/boards/${board.slug}/tasks`, { column_id: columnOf(board, 'inbox'), title: 'Weekly check' })
    const task = (await json(created)).data
    // The rule is added by a PATCH, not at creation, before the first move.
    await patch(`/api/tasks/${task.id}`, { repeat: { freq: 'weekly', weekday: 4 } })

    const cancelled = columnOf(board, 'cancelled')
    const done = columnOf(board, 'done')

    await patch(`/api/tasks/${task.id}/move`, { column_id: cancelled, position: 0 })
    expect(await tasksOf(board.slug)).toHaveLength(2) // the task itself + the spawned copy

    const toDone = (await json(await patch(`/api/tasks/${task.id}/move`, { column_id: done, position: 0 }))).data
    expect(toDone.done_on).toBe(today())
    expect(toDone.cancelled_on).toBeNull()
    expect(await tasksOf(board.slug)).toHaveLength(2)

    const backToCancelled = (await json(await patch(`/api/tasks/${task.id}/move`, { column_id: cancelled, position: 0 }))).data
    expect(backToCancelled.cancelled_on).toBe(today())
    expect(backToCancelled.done_on).toBeNull()
    expect(await tasksOf(board.slug)).toHaveLength(2)
  })

  it('a repeating task moved Inbox → Cancelled spawns its copy in To Do and moves the rule', async () => {
    const board = await boardOf()
    const created = await post(`/api/boards/${board.slug}/tasks`, {
      column_id: columnOf(board, 'inbox'), title: 'Weekly check', due: '2026-09-03',
      repeat: { freq: 'weekly', weekday: 4 },
    })
    const task = (await json(created)).data

    const res = await patch(`/api/tasks/${task.id}/move`, { column_id: columnOf(board, 'cancelled'), position: 0 })
    expect(res.status).toBe(200)
    const cancelledTask = (await json(res)).data
    expect(cancelledTask.repeat).toBeNull()
    expect(cancelledTask.history[0].text).toBe(`Completed; repeats every Thursday — next copy due ${expectedNext('2026-09-03')}`)

    const all = await tasksOf(board.slug)
    expect(all).toHaveLength(2)
    const copy = all.find((t) => t.id !== task.id)!
    expect(copy.column_key).toBe('todo')
    expect(copy.repeat).toEqual({ freq: 'weekly', weekday: 4 })
  })

  it('status change to Cancelled sets cancelled_on; back to To Do clears it', async () => {
    const board = await boardOf()
    const created = await post(`/api/boards/${board.slug}/tasks`, { column_id: columnOf(board, 'inbox'), title: 'Something' })
    const task = (await json(created)).data

    const cancelled = (await json(await patch(`/api/tasks/${task.id}`, { column_id: columnOf(board, 'cancelled') }))).data
    expect(cancelled.cancelled_on).toBe(today())
    expect(cancelled.done_on).toBeNull()

    const back = (await json(await patch(`/api/tasks/${task.id}`, { column_id: columnOf(board, 'todo') }))).data
    expect(back.cancelled_on).toBeNull()
  })

  it('archives a task cancelled more than 30 days ago; one cancelled exactly 30 days ago stays; restore clears cancelled_on', async () => {
    const board = await boardOf()
    const boardId = await boardIdOf(board.slug)
    const cancelled = columnOf(board, 'cancelled')
    const todo = columnOf(board, 'todo')
    const t = today()

    const keep = await seedCancelled(boardId, cancelled, 'Exactly 30 days ago', shift(t, -30))
    const old = await seedCancelled(boardId, cancelled, 'Just past 30 days', shift(t, -31))

    const fresh = (await json(await get(`/api/boards/${board.slug}`))).data
    expect(fresh.tasks.map((x: any) => x.id)).toEqual([keep])
    expect(fresh.archived_count).toBe(1)

    const archiveData = (await json(await get(`/api/boards/${board.slug}/archive`))).data
    expect(archiveData.tasks.map((x: any) => x.id)).toEqual([old])
    expect(archiveData.tasks[0].cancelled_on).toBe(shift(t, -31))

    const restore = await patch(`/api/tasks/${old}/move`, { column_id: todo, position: 0 })
    expect(restore.status).toBe(200)
    expect((await json(restore)).data.cancelled_on).toBeNull()

    const afterRestore = (await json(await get(`/api/boards/${board.slug}`))).data
    expect(afterRestore.archived_count).toBe(0)
  })
})
