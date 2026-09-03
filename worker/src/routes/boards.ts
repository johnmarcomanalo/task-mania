import { Hono } from 'hono'
import { rows } from '../db'
import type { AppEnv } from '../env'
import { boardPayload } from '../queries'
import { ownBoard } from '../scope'
import { activityJson, type ActivityRow } from '../serialize'

export const boards = new Hono<AppEnv>()

boards.get('/boards', (c) => {
  const b = c.get('board')
  return c.json({ data: [{ id: b.id, name: b.name, slug: b.slug, description: b.description }] })
})

boards.get('/boards/:slug', async (c) => {
  const board = ownBoard(c)
  return c.json({ data: await boardPayload(c.env.DB, board) })
})

boards.get('/boards/:slug/activity', async (c) => {
  const board = ownBoard(c)
  const list = await rows<ActivityRow>(
    c.env.DB
      .prepare(`SELECT * FROM activities WHERE board_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 200`)
      .bind(board.id),
  )
  return c.json({ data: list.map(activityJson) })
})
