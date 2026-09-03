import { describe, expect, it } from 'vitest'
import { ALICE, BOB, boardIdOf, boardOf, del, env, get, json, meOf, patch, post, seedTask } from './helpers'

async function sourceId(who: string, name: string): Promise<number> {
  const board = await boardOf(who)
  return board.sources.find((s) => s.name === name)!.id
}

describe('sources', () => {
  it('lists the sources a board starts with, counting tasks', async () => {
    const me = await meOf(ALICE)
    await seedTask(await boardIdOf(me.board_slug), 'Viber')

    const { data } = await json(await get(`/api/boards/${me.board_slug}/sources`))
    expect(data).toHaveLength(8)
    expect(data[0]).toEqual({ id: expect.any(Number), name: 'Viber', position: 0, is_archived: false, task_count: 1 })
    expect(data[1].task_count).toBe(0)
  })

  it('adds a source', async () => {
    const me = await meOf(ALICE)
    const res = await post(`/api/boards/${me.board_slug}/sources`, { name: 'Zoom' })
    expect(res.status).toBe(201)
    expect((await json(res)).data).toEqual({ id: expect.any(Number), name: 'Zoom', position: 8, is_archived: false })
  })

  it('rejects a name already on the board, whatever its case', async () => {
    const me = await meOf(ALICE)
    for (const name of ['Viber', 'viber']) {
      const res = await post(`/api/boards/${me.board_slug}/sources`, { name })
      expect(res.status).toBe(422)
      expect((await json(res)).errors.name).toEqual(['The name has already been taken.'])
    }
  })

  it('allows the same name on a different board', async () => {
    await meOf(ALICE)
    const bob = await meOf(BOB)
    await del(`/api/sources/${await sourceId(BOB, 'Viber')}`, BOB)
    expect((await post(`/api/boards/${bob.board_slug}/sources`, { name: 'Viber' }, BOB)).status).toBe(201)
  })

  it('renames a source and carries existing tasks with it', async () => {
    const me = await meOf(ALICE)
    const taskId = await seedTask(await boardIdOf(me.board_slug), 'Viber')

    const res = await patch(`/api/sources/${await sourceId(ALICE, 'Viber')}`, { name: 'Viber Work' })
    expect(res.status).toBe(200)
    expect((await json(res)).data.name).toBe('Viber Work')

    const task = await env.DB.prepare(`SELECT source FROM tasks WHERE id = ?1`).bind(taskId).first<{ source: string }>()
    expect(task!.source).toBe('Viber Work')
  })

  it('leaves other boards\' tasks alone when renaming', async () => {
    await meOf(ALICE)
    const bob = await meOf(BOB)
    const untouched = await seedTask(await boardIdOf(bob.board_slug), 'Viber')

    await patch(`/api/sources/${await sourceId(ALICE, 'Viber')}`, { name: 'Viber Work' })

    const task = await env.DB.prepare(`SELECT source FROM tasks WHERE id = ?1`).bind(untouched).first<{ source: string }>()
    expect(task!.source).toBe('Viber')
  })

  it('deletes a source no task uses', async () => {
    const id = await sourceId(ALICE, 'Slack')
    const res = await del(`/api/sources/${id}`)
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ archived: false, tasks_using: 0 })
    expect(await env.DB.prepare(`SELECT id FROM sources WHERE id = ?1`).bind(id).first()).toBeNull()
  })

  it('archives instead of deleting a source tasks still use', async () => {
    const me = await meOf(ALICE)
    await seedTask(await boardIdOf(me.board_slug), 'Viber')
    const id = await sourceId(ALICE, 'Viber')

    const res = await del(`/api/sources/${id}`)
    expect(await json(res)).toEqual({ archived: true, tasks_using: 1 })
    const row = await env.DB.prepare(`SELECT is_archived FROM sources WHERE id = ?1`).bind(id).first<{ is_archived: number }>()
    expect(row!.is_archived).toBe(1)
  })

  it('can archive and restore a source', async () => {
    const id = await sourceId(ALICE, 'SMS')
    expect((await json(await patch(`/api/sources/${id}`, { is_archived: true }))).data.is_archived).toBe(true)
    expect((await json(await patch(`/api/sources/${id}`, { is_archived: false }))).data.is_archived).toBe(false)
  })

  it('carries archived sources on the board payload', async () => {
    await patch(`/api/sources/${await sourceId(ALICE, 'Slack')}`, { is_archived: true })
    const board = await boardOf(ALICE)
    expect(board.sources[0]).toMatchObject({ name: 'Viber', is_archived: false })
    expect(board.sources[6]).toMatchObject({ name: 'Slack', is_archived: true })
  })

  it('hides other people\'s sources behind a 404', async () => {
    const id = await sourceId(ALICE, 'Viber')
    await meOf(BOB)
    expect((await patch(`/api/sources/${id}`, { name: 'X' }, BOB)).status).toBe(404)
    expect((await del(`/api/sources/${id}`, BOB)).status).toBe(404)
  })
})
