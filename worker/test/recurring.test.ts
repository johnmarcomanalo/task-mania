import { describe, expect, it } from 'vitest'
import { todayIn } from '../src/dates'
import { nextDue } from '../src/recur'
import { ALICE, boardOf, columnOf, get, json, patch, post } from './helpers'

const today = () => todayIn('Asia/Manila')

async function make(body: Record<string, unknown>) {
  const board = await boardOf()
  const res = await post(`/api/boards/${board.slug}/tasks`, {
    column_id: columnOf(board, 'doing'), title: 'Weekly report', source: 'Email', sender: 'Boss',
    priority: 'high', quote: 'Every Thursday please', tags: ['report'],
    repeat: { freq: 'weekly', weekday: 4 }, ...body,
  })
  expect(res.status).toBe(201)
  return { board, task: (await json(res)).data }
}

async function tasksOf(slug: string) {
  return (await json(await get(`/api/boards/${slug}`))).data.tasks as Record<string, any>[]
}

describe('repeat on completion', () => {
  it('stores and returns the rule', async () => {
    const { task } = await make({})
    expect(task.repeat).toEqual({ freq: 'weekly', weekday: 4 })
  })

  it('moving into Done spawns the next copy in To Do and moves the rule', async () => {
    const { board, task } = await make({ due: '2026-09-03' })
    const res = await patch(`/api/tasks/${task.id}/move`, { column_id: columnOf(board, 'done'), position: 0 })
    expect(res.status).toBe(200)
    const done = (await json(res)).data
    expect(done.repeat).toBeNull()
    expect(done.history[0].text).toBe(`Completed; repeats every Thursday — next copy due ${expectedNext('2026-09-03')}`)

    const all = await tasksOf(board.slug)
    const copy = all.find((t) => t.id !== task.id)!
    expect(copy).toMatchObject({
      column_key: 'todo', title: 'Weekly report', source: 'Email', sender: 'Boss', priority: 'high',
      quote: 'Every Thursday please', tags: ['report'], due: expectedNext('2026-09-03'),
      repeat: { freq: 'weekly', weekday: 4 }, done_on: null, captured: today(),
    })
    const log = (await json(await get(`/api/boards/${board.slug}/activity`))).data
    expect(log.find((l: any) => l.task_id === copy.id).text).toBe(`Repeats every Thursday — next on ${copy.due}`)
  })

  it('changing Status to Done spawns too', async () => {
    const { board, task } = await make({ due: '2026-09-03', repeat: { freq: 'monthly', day: 15 } })
    await patch(`/api/tasks/${task.id}`, { column_id: columnOf(board, 'done') })
    const all = await tasksOf(board.slug)
    expect(all).toHaveLength(2)
    expect(all.find((t) => t.id !== task.id)!.due).toBe(expectedNext('2026-09-03', { freq: 'monthly', day: 15 }))
  })

  it('does not spawn when moving inside Done, or out of Done, or without a rule', async () => {
    const { board, task } = await make({ due: '2026-09-03' })
    await patch(`/api/tasks/${task.id}/move`, { column_id: columnOf(board, 'done'), position: 0 })
    expect(await tasksOf(board.slug)).toHaveLength(2)
    await patch(`/api/tasks/${task.id}/move`, { column_id: columnOf(board, 'done'), position: 0 })
    await patch(`/api/tasks/${task.id}/move`, { column_id: columnOf(board, 'todo'), position: 0 })
    expect(await tasksOf(board.slug)).toHaveLength(2)

    const plain = await make({ repeat: null, title: 'Once' })
    await patch(`/api/tasks/${plain.task.id}/move`, { column_id: columnOf(board, 'done'), position: 0 })
    expect(await tasksOf(board.slug)).toHaveLength(3)
  })

  it('uses today when the task has no due date or is overdue', async () => {
    const { board, task } = await make({ due: '' })
    await patch(`/api/tasks/${task.id}/move`, { column_id: columnOf(board, 'done'), position: 0 })
    const copy = (await tasksOf(board.slug)).find((t) => t.id !== task.id)!
    expect(copy.due).toBe(nextDue({ freq: 'weekly', weekday: 4 }, today()))

    const late = await make({ due: '2020-01-02', title: 'Late' })
    await patch(`/api/tasks/${late.task.id}/move`, { column_id: columnOf(board, 'done'), position: 0 })
    const lateCopy = (await tasksOf(board.slug)).find((t) => t.title === 'Late' && t.id !== late.task.id)!
    expect(lateCopy.due).toBe(nextDue({ freq: 'weekly', weekday: 4 }, today()))
  })

  it('the copy repeats again when completed', async () => {
    const { board, task } = await make({ due: '2026-09-03' })
    await patch(`/api/tasks/${task.id}/move`, { column_id: columnOf(board, 'done'), position: 0 })
    const copy = (await tasksOf(board.slug)).find((t) => t.id !== task.id)!
    await patch(`/api/tasks/${copy.id}/move`, { column_id: columnOf(board, 'done'), position: 0 })
    expect(await tasksOf(board.slug)).toHaveLength(3)
  })

  it('a PATCH that adds a rule and moves to Done in one go spawns from the new rule', async () => {
    const { board, task } = await make({ repeat: null })
    const res = await patch(`/api/tasks/${task.id}`, {
      column_id: columnOf(board, 'done'), repeat: { freq: 'weekly', weekday: 4 },
    })
    expect(res.status).toBe(200)
    const done = (await json(res)).data
    expect(done.repeat).toBeNull()

    const all = await tasksOf(board.slug)
    expect(all).toHaveLength(2)
    const copy = all.find((t) => t.id !== task.id)!
    expect(copy.column_key).toBe('todo')
    expect(copy.repeat).toEqual({ freq: 'weekly', weekday: 4 })
  })

  it('a PATCH that clears the rule and moves to Done in one go does not spawn', async () => {
    const { board, task } = await make({})
    const res = await patch(`/api/tasks/${task.id}`, { column_id: columnOf(board, 'done'), repeat: null })
    expect(res.status).toBe(200)
    expect((await json(res)).data.repeat).toBeNull()
    expect(await tasksOf(board.slug)).toHaveLength(1)
  })

  it('a PATCH that changes due and moves to Done in one go spawns from the new due date', async () => {
    const { board, task } = await make({ due: '2026-09-03' })
    await patch(`/api/tasks/${task.id}`, { column_id: columnOf(board, 'done'), due: '2026-10-01' })
    const copy = (await tasksOf(board.slug)).find((t) => t.id !== task.id)!
    expect(copy.due).toBe(expectedNext('2026-10-01'))
  })
})

function expectedNext(due: string, rule: any = { freq: 'weekly', weekday: 4 }) {
  const base = due > today() ? due : today()
  return nextDue(rule, base)
}
