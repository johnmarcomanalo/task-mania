import { describe, expect, it } from 'vitest'
import { ALICE, boardOf, columnOf, del, get, json, patch, post } from './helpers'

async function create(body: Record<string, unknown> = {}) {
  const board = await boardOf(ALICE)
  const res = await post(
    `/api/boards/${board.slug}/tasks`,
    { column_id: columnOf(board, 'inbox'), title: 'Send the quotation', ...body },
    ALICE,
  )
  expect(res.status).toBe(201)
  const task = (await json(res)).data
  return { board, task }
}

describe('activity lines', () => {
  it('names a title edit old → new', async () => {
    const { task } = await create()
    const patched = (await json(await patch(`/api/tasks/${task.id}`, { title: 'Send the revised quotation' }))).data
    expect(patched.history[0].text).toBe('Title: "Send the quotation" → "Send the revised quotation"')
  })

  it('cuts a title longer than 40 chars to 40 + an ellipsis, on whichever side is long', async () => {
    const long = 'A'.repeat(60)
    const { task } = await create({ title: long })
    const patched = (await json(await patch(`/api/tasks/${task.id}`, { title: 'Short title' }))).data
    expect(patched.history[0].text).toBe(`Title: "${'A'.repeat(40)}…" → "Short title"`)
  })

  it('logs priority, due date, sender, source and tags as old → new, newest first', async () => {
    const { task } = await create()
    const patched = (await json(await patch(`/api/tasks/${task.id}`, {
      priority: 'high', due: '2026-09-10', sender: 'Ms. Rivera', source: 'Email', tags: ['client'],
    }))).data
    expect(patched.history.map((h: { text: string }) => h.text)).toEqual([
      'Tags: — → client',
      'Source: Manual → Email',
      'Sender: — → Ms. Rivera',
      'Due date: — → 2026-09-10',
      'Priority: normal → high',
      'Created in Inbox',
    ])
  })

  it('shows — on the side that is empty, for a cleared due date and tag list', async () => {
    const { task } = await create()
    await patch(`/api/tasks/${task.id}`, { due: '2026-09-10', tags: ['client'] })
    const cleared = (await json(await patch(`/api/tasks/${task.id}`, { due: '', tags: [] }))).data
    expect(cleared.history.map((h: { text: string }) => h.text)).toEqual([
      'Tags: client → —',
      'Due date: 2026-09-10 → —',
      'Tags: — → client',
      'Due date: — → 2026-09-10',
      'Created in Inbox',
    ])
  })

  it('describes a repeat rule old → new, and — once cleared', async () => {
    const { task } = await create()
    const set = (await json(await patch(`/api/tasks/${task.id}`, { repeat: { freq: 'weekly', weekday: 4 } }))).data
    expect(set.history[0].text).toBe('Repeat: — → every Thursday')

    const cleared = (await json(await patch(`/api/tasks/${task.id}`, { repeat: null }))).data
    expect(cleared.history[0].text).toBe('Repeat: every Thursday → —')
  })

  it('logs a plain "Notes edited" for a quote change, naming the task in history', async () => {
    const { task } = await create()
    const patched = (await json(await patch(`/api/tasks/${task.id}`, { quote: 'x' }))).data
    expect(patched.history[0]).toMatchObject({ text: 'Notes edited', task_title: 'Send the quotation' })
  })

  it('logs a column-only move as Moved then Created, newest first', async () => {
    const { board, task } = await create()
    const patched = (await json(await patch(`/api/tasks/${task.id}`, { column_id: columnOf(board, 'done') }))).data
    expect(patched.history.map((h: { text: string }) => h.text)).toEqual(['Moved: Inbox → Done', 'Created in Inbox'])
  })

  it('spawns the next copy and logs both the rule change and the completion line when column and repeat change together', async () => {
    const { board, task } = await create()
    const patched = (await json(await patch(`/api/tasks/${task.id}`, {
      column_id: columnOf(board, 'cancelled'), repeat: { freq: 'weekly', weekday: 4 },
    }))).data
    expect(patched.repeat).toBeNull()

    const fresh = await boardOf(ALICE)
    const copy = fresh.tasks.find((t) => t.id !== task.id) as { column_key: string; repeat: unknown } | undefined
    expect(copy).toMatchObject({ column_key: 'todo', repeat: { freq: 'weekly', weekday: 4 } })

    const texts = patched.history.map((h: { text: string }) => h.text)
    expect(texts).toContain('Repeat: — → every Thursday')
    expect(texts.some((t: string) => t.startsWith('Completed; repeats every Thursday — next copy due'))).toBe(true)
  })

  describe('task_title', () => {
    it('carries the task title on board activity and the activity endpoint', async () => {
      const { board, task } = await create()
      await patch(`/api/tasks/${task.id}`, { quote: 'x' })

      const fresh = await boardOf(ALICE)
      expect(fresh.activity[0]).toMatchObject({ text: 'Notes edited', task_title: 'Send the quotation' })

      const log = (await json(await get(`/api/boards/${board.slug}/activity`))).data
      expect(log[0]).toMatchObject({ text: 'Notes edited', task_title: 'Send the quotation' })
      expect(log[1]).toMatchObject({ text: 'Created in Inbox', task_title: 'Send the quotation' })
    })

    it('is null on the Deleted line and on the task\'s older lines once the task is gone', async () => {
      const { board, task } = await create()
      await patch(`/api/tasks/${task.id}`, { quote: 'x' })
      expect((await del(`/api/tasks/${task.id}`)).status).toBe(204)

      const log = (await json(await get(`/api/boards/${board.slug}/activity`))).data
      expect(log[0]).toMatchObject({ text: 'Deleted: Send the quotation', task_title: null })
      expect(log.find((l: { text: string }) => l.text === 'Notes edited')).toMatchObject({ task_title: null })
      expect(log.find((l: { text: string }) => l.text === 'Created in Inbox')).toMatchObject({ task_title: null })
    })
  })
})
