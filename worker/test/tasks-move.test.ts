import { describe, expect, it } from 'vitest'
import { todayIn } from '../src/dates'
import { ALICE, BOB, boardOf, columnOf, del, env, get, json, patch, post, type BoardJson } from './helpers'

const today = () => todayIn('Asia/Manila')

async function add(board: BoardJson, key: string, title: string, who = ALICE): Promise<number> {
  const res = await post(`/api/boards/${board.slug}/tasks`, { column_id: columnOf(board, key), title }, who)
  expect(res.status).toBe(201)
  return (await json(res)).data.id
}

/** Titles per column key, in position order, straight from the board payload. */
async function lanes(who = ALICE): Promise<Record<string, string[]>> {
  const board = await boardOf(who)
  const out: Record<string, string[]> = {}
  for (const c of board.columns) {
    out[c.key] = board.tasks
      .filter((t) => t.column_id === c.id)
      .sort((a, b) => (a.position as number) - (b.position as number))
      .map((t) => t.title as string)
  }
  return out
}

async function positions(who = ALICE): Promise<Record<string, number[]>> {
  const board = await boardOf(who)
  const out: Record<string, number[]> = {}
  for (const c of board.columns) {
    out[c.key] = board.tasks.filter((t) => t.column_id === c.id).map((t) => t.position as number).sort()
  }
  return out
}

describe('move', () => {
  it('closes the gap it leaves and opens one where it lands', async () => {
    const board = await boardOf()
    await add(board, 'inbox', 'A')
    const b = await add(board, 'inbox', 'B')
    await add(board, 'inbox', 'C')
    await add(board, 'todo', 'X')
    await add(board, 'todo', 'Y')

    const res = await patch(`/api/tasks/${b}/move`, { column_id: columnOf(board, 'todo'), position: 1 })
    expect(res.status).toBe(200)
    const moved = (await json(res)).data
    expect(moved.column_key).toBe('todo')
    expect(moved.position).toBe(1)
    expect(moved.history[0].text).toBe('Moved to To Do')

    expect(await lanes()).toMatchObject({ inbox: ['A', 'C'], todo: ['X', 'B', 'Y'] })
    expect(await positions()).toMatchObject({ inbox: [0, 1], todo: [0, 1, 2] })
  })

  it('reorders inside a column without logging a move', async () => {
    const board = await boardOf()
    await add(board, 'inbox', 'A')
    await add(board, 'inbox', 'B')
    const cId = await add(board, 'inbox', 'C')

    const moved = (await json(await patch(`/api/tasks/${cId}/move`, { column_id: columnOf(board, 'inbox'), position: 0 }))).data
    expect(moved.history).toHaveLength(1)
    expect(await lanes()).toMatchObject({ inbox: ['C', 'A', 'B'] })
  })

  it('sets done_on on the way into Done, keeps it there, clears it on the way out', async () => {
    const board = await boardOf()
    const id = await add(board, 'inbox', 'A')
    const done = columnOf(board, 'done')

    expect((await json(await patch(`/api/tasks/${id}/move`, { column_id: done, position: 0 }))).data.done_on).toBe(today())

    await env.DB.prepare(`UPDATE tasks SET done_on = '2026-01-01' WHERE id = ?1`).bind(id).run()
    expect((await json(await patch(`/api/tasks/${id}/move`, { column_id: done, position: 0 }))).data.done_on).toBe('2026-01-01')

    expect((await json(await patch(`/api/tasks/${id}/move`, { column_id: columnOf(board, 'wait'), position: 0 }))).data.done_on).toBeNull()
  })

  it('refuses a column from another board and hides other people\'s tasks', async () => {
    const board = await boardOf()
    const id = await add(board, 'inbox', 'A')
    const bob = await boardOf(BOB)
    expect((await patch(`/api/tasks/${id}/move`, { column_id: columnOf(bob, 'inbox'), position: 0 })).status).toBe(422)
    expect((await patch(`/api/tasks/${id}/move`, { column_id: columnOf(board, 'inbox'), position: 0 }, BOB)).status).toBe(404)
  })
})

describe('delete', () => {
  it('removes the task, its files and renumbers the column', async () => {
    const board = await boardOf()
    const a = await add(board, 'inbox', 'A')
    const b = await add(board, 'inbox', 'B')
    await add(board, 'inbox', 'C')

    await env.FILES.put('attachments/gone.bin', 'bytes', { customMetadata: { owner: '1', name: 'gone.bin' } })
    await env.DB
      .prepare(`INSERT INTO task_files (task_id, name, mime, size, path, created_at, updated_at) VALUES (?1, 'gone.bin', 'application/octet-stream', 5, 'attachments/gone.bin', 't', 't')`)
      .bind(b)
      .run()

    const res = await del(`/api/tasks/${b}`)
    expect(res.status).toBe(204)

    expect(await env.DB.prepare(`SELECT id FROM tasks WHERE id = ?1`).bind(b).first()).toBeNull()
    expect(await env.DB.prepare(`SELECT id FROM task_files WHERE task_id = ?1`).bind(b).first()).toBeNull()
    expect(await env.FILES.head('attachments/gone.bin')).toBeNull()
    expect(await lanes()).toMatchObject({ inbox: ['A', 'C'] })
    expect(await positions()).toMatchObject({ inbox: [0, 1] })

    const { data: log } = await json(await get(`/api/boards/${board.slug}/activity`))
    expect(log[0]).toMatchObject({ text: 'Deleted: B', task_id: null })
    // The task's older lines stay on the board log, detached from the task.
    expect(log.find((l: { text: string; task_id: number | null }) => l.text === 'Created in Inbox' && l.task_id === null)).toBeTruthy()
    expect(log.find((l: { task_id: number | null }) => l.task_id === a)).toBeTruthy()
  })

  it('hides other people\'s tasks', async () => {
    const board = await boardOf()
    const id = await add(board, 'inbox', 'A')
    expect((await del(`/api/tasks/${id}`, BOB)).status).toBe(404)
  })
})

describe('bulk create', () => {
  it('creates every row with the shared source and screenshot', async () => {
    const board = await boardOf()
    const res = await post(`/api/boards/${board.slug}/tasks/bulk`, {
      screenshot_path: 'screenshots/abc.png',
      source: 'Viber',
      tasks: [
        { column_id: columnOf(board, 'inbox'), title: 'One', sender: 'Ms. Rivera' },
        { column_id: columnOf(board, 'done'), title: 'Two', priority: 'high', tags: ['client'] },
      ],
    })
    expect(res.status).toBe(201)
    const { data } = await json(res)
    expect(data).toHaveLength(2)
    expect(data[0]).toMatchObject({
      title: 'One', source: 'Viber', sender: 'Ms. Rivera', shot: '/storage/screenshots/abc.png',
      column_key: 'inbox', position: 0, captured: today(), done_on: null,
    })
    expect(data[0].history[0].text).toBe('Captured from Viber (Ms. Rivera) — placed in Inbox')
    expect(data[1]).toMatchObject({ title: 'Two', priority: 'high', tags: ['client'], column_key: 'done', done_on: today() })
    expect(data[1].history[0].text).toBe('Captured from Viber — placed in Done')
  })

  it('defaults the source to Manual and validates rows by index', async () => {
    const board = await boardOf()
    const ok = await post(`/api/boards/${board.slug}/tasks/bulk`, {
      tasks: [{ column_id: columnOf(board, 'inbox'), title: 'One' }],
    })
    expect((await json(ok)).data[0].source).toBe('Manual')

    const bob = await boardOf(BOB)
    const bad = await post(`/api/boards/${board.slug}/tasks/bulk`, {
      tasks: [{ column_id: columnOf(bob, 'inbox'), title: 'One' }],
    })
    expect(bad.status).toBe(422)
    expect((await json(bad)).errors['tasks.0.column_id']).toEqual(['The selected tasks.0.column_id is invalid.'])

    const path = await post(`/api/boards/${board.slug}/tasks/bulk`, {
      screenshot_path: 'attachments/x.png',
      tasks: [{ column_id: columnOf(board, 'inbox'), title: 'One' }],
    })
    expect((await json(path)).errors.screenshot_path).toEqual(['The screenshot path is invalid.'])
  })
})
