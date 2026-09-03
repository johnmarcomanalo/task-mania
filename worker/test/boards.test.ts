import { describe, expect, it } from 'vitest'
import { ALICE, BOB, boardOf, get, json, meOf } from './helpers'

describe('boards', () => {
  it('lists the caller\'s board', async () => {
    const me = await meOf(ALICE)
    const res = await get('/api/boards')
    expect(res.status).toBe(200)
    const { data } = await json(res)
    expect(data).toHaveLength(1)
    expect(data[0]).toEqual({ id: expect.any(Number), name: 'Task Mania', slug: me.board_slug, description: null })
  })

  it('serves the board in the shape the UI expects', async () => {
    const board = await boardOf(ALICE)
    expect(board.name).toBe('Task Mania')
    expect(board.priorities).toEqual(['high', 'normal', 'low'])
    expect(board.scan_enabled).toBe(false)
    expect(board.columns.map((c) => c.key)).toEqual(['inbox', 'todo', 'doing', 'wait', 'review', 'done'])
    expect(board.columns[5]).toMatchObject({ name: 'Done', position: 5, is_done: true })
    expect(board.sources.map((s) => s.name)).toEqual([
      'Viber', 'Email', 'Messenger', 'WhatsApp', 'Teams', 'SMS', 'Slack', 'Manual',
    ])
    expect(board.sources[0]).toEqual({ id: expect.any(Number), name: 'Viber', position: 0, is_archived: false })
    expect(board.tasks).toEqual([])
    expect(board.activity).toEqual([])
  })

  it('hides other people\'s boards behind a 404', async () => {
    const alice = await meOf(ALICE)
    const res = await get(`/api/boards/${alice.board_slug}`, BOB)
    expect(res.status).toBe(404)
    expect(await json(res)).toEqual({ message: 'Not found.' })
    expect((await get(`/api/boards/${alice.board_slug}/activity`, BOB)).status).toBe(404)
  })

  it('serves the activity log', async () => {
    const me = await meOf(ALICE)
    const res = await get(`/api/boards/${me.board_slug}/activity`)
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ data: [] })
  })
})
