import { describe, expect, it } from 'vitest'
import { todayIn } from '../src/dates'
import { ALICE, BOB, boardOf, columnOf, del, json, meOf, patch, post } from './helpers'

const today = () => todayIn('Asia/Manila')

async function create(body: Record<string, unknown> = {}, who = ALICE) {
  const board = await boardOf(who)
  const res = await post(
    `/api/boards/${board.slug}/tasks`,
    { column_id: columnOf(board, 'inbox'), title: 'Send the quotation', ...body },
    who,
  )
  return { board, res }
}

async function created(body: Record<string, unknown> = {}, who = ALICE) {
  const { board, res } = await create(body, who)
  expect(res.status).toBe(201)
  return { board, task: (await json(res)).data }
}

describe('create task', () => {
  it('fills the defaults and logs the creation', async () => {
    const { board, task } = await created()
    expect(task).toEqual({
      id: expect.any(Number),
      column_id: columnOf(board, 'inbox'),
      column_key: 'inbox',
      title: 'Send the quotation',
      source: 'Manual',
      sender: null,
      due: '',
      priority: 'normal',
      quote: '',
      attachments: '',
      tags: [],
      shot: null,
      captured: today(),
      done_on: null,
      cancelled_on: null,
      repeat: null,
      position: 0,
      files: [],
      history: [{ id: expect.any(Number), task_id: task.id, text: 'Created in Inbox', at: expect.any(String) }],
    })
  })

  it('keeps every field it is given', async () => {
    const { task } = await created({
      source: 'Viber', sender: 'Ms. Rivera', due: '2026-09-10', priority: 'high',
      quote: 'Can you send it today?', attachments: 'quote.pdf', tags: ['client', 'urgent'],
    })
    expect(task).toMatchObject({
      source: 'Viber', sender: 'Ms. Rivera', due: '2026-09-10', priority: 'high',
      quote: 'Can you send it today?', attachments: 'quote.pdf', tags: ['client', 'urgent'],
    })
  })

  it('appends to the end of the column', async () => {
    await created()
    const { task } = await created({ title: 'Second' })
    expect(task.position).toBe(1)
  })

  it('marks a task done when it starts in the done lane', async () => {
    const board = await boardOf()
    const { task } = await created({ column_id: columnOf(board, 'done') })
    expect(task.done_on).toBe(today())
    expect(task.history[0].text).toBe('Created in Done')
  })

  it('rejects a column that belongs to someone else', async () => {
    const bob = await boardOf(BOB)
    const { res } = await create({ column_id: columnOf(bob, 'inbox') })
    expect(res.status).toBe(422)
    expect((await json(res)).errors.column_id).toEqual(['The selected column id is invalid.'])
  })

  it('rejects a source the board does not have or has archived', async () => {
    const { res } = await create({ source: 'Carrier Pigeon' })
    expect(res.status).toBe(422)
    expect((await json(res)).errors.source).toEqual(['The selected source is invalid.'])

    const board = await boardOf()
    const slack = board.sources.find((s) => s.name === 'Slack')!
    await patch(`/api/sources/${slack.id}`, { is_archived: true })
    expect((await create({ source: 'Slack' })).res.status).toBe(422)
  })

  it('rejects an unknown board slug', async () => {
    await meOf(ALICE)
    expect((await post('/api/boards/b-nope/tasks', { column_id: 1, title: 'x' })).status).toBe(404)
  })

  it('lists the task on the board without history', async () => {
    const { task } = await created()
    const board = await boardOf()
    expect(board.tasks).toHaveLength(1)
    expect(board.tasks[0]).toMatchObject({ id: task.id, column_key: 'inbox' })
    expect(board.tasks[0]).not.toHaveProperty('history')
    expect(board.activity[0].text).toBe('Created in Inbox')
  })
})

describe('update task', () => {
  it('logs a line per field that actually changed', async () => {
    const { task } = await created()
    const res = await patch(`/api/tasks/${task.id}`, { title: 'Send the revised quotation', priority: 'high', due: '' })
    expect(res.status).toBe(200)
    const fresh = (await json(res)).data
    expect(fresh.title).toBe('Send the revised quotation')
    expect(fresh.priority).toBe('high')
    expect(fresh.history.map((h: { text: string }) => h.text)).toEqual(['Priority changed', 'Title edited', 'Created in Inbox'])
  })

  it('logs nothing when nothing changed', async () => {
    const { task } = await created()
    const fresh = (await json(await patch(`/api/tasks/${task.id}`, { title: 'Send the quotation', due: '' }))).data
    expect(fresh.history).toHaveLength(1)
  })

  it('moves between lanes through column_id and keeps done_on in step', async () => {
    const board = await boardOf()
    const { task } = await created()

    const done = (await json(await patch(`/api/tasks/${task.id}`, { column_id: columnOf(board, 'done') }))).data
    expect(done.column_key).toBe('done')
    expect(done.done_on).toBe(today())
    expect(done.history[0].text).toBe('Moved: Inbox → Done')

    const back = (await json(await patch(`/api/tasks/${task.id}`, { column_id: columnOf(board, 'inbox') }))).data
    expect(back.done_on).toBeNull()
  })

  it('changes tags, sender, source and notes with their own lines', async () => {
    const { task } = await created()
    const fresh = (await json(await patch(`/api/tasks/${task.id}`, {
      tags: ['finance'], sender: 'Accounting', source: 'Email', quote: 'See attached.',
    }))).data
    expect(fresh.tags).toEqual(['finance'])
    expect(fresh.history.map((h: { text: string }) => h.text)).toEqual([
      'Tags changed', 'Notes edited', 'Source changed', 'Sender changed', 'Created in Inbox',
    ])
  })

  it('validates and scopes like create', async () => {
    const { task } = await created()
    const bob = await boardOf(BOB)
    expect((await patch(`/api/tasks/${task.id}`, { column_id: columnOf(bob, 'todo') })).status).toBe(422)
    expect((await patch(`/api/tasks/${task.id}`, { title: '' })).status).toBe(422)
    expect((await patch(`/api/tasks/${task.id}`, { title: 'x' }, BOB)).status).toBe(404)
  })

  it('404s a non-numeric id instead of coercing it', async () => {
    expect((await patch('/api/tasks/abc', { title: 'x' })).status).toBe(404)
    expect((await del('/api/task-files/1.5')).status).toBe(404)
  })
})
