import { Hono } from 'hono'
import { nowIso } from '../dates'
import { rows } from '../db'
import type { AppEnv } from '../env'
import { invalid, notFound } from '../errors'
import { findSource } from '../queries'
import { idParam, ownBoard } from '../scope'
import { sourceJson, type SourceRow } from '../serialize'
import { jsonBody, parse, sourceCreateSchema, sourceUpdateSchema } from '../validate'

/**
 * The channels a board captures tasks from. Names live on tasks.source
 * verbatim, so a rename has to carry the old tasks with it and a name still
 * in use is archived rather than dropped.
 */
export const sources = new Hono<AppEnv>()

async function assertNameFree(db: D1Database, boardId: number, name: string, ignoreId = 0): Promise<void> {
  const taken = await db
    .prepare(`SELECT id FROM sources WHERE board_id = ?1 AND name = ?2 AND id <> ?3`)
    .bind(boardId, name, ignoreId)
    .first()
  if (taken) throw invalid('name', 'The name has already been taken.')
}

function taskCount(db: D1Database, source: SourceRow) {
  return db
    .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE board_id = ?1 AND source = ?2`)
    .bind(source.board_id, source.name)
    .first<{ n: number }>()
    .then((r) => r?.n ?? 0)
}

sources.get('/boards/:slug/sources', async (c) => {
  const board = ownBoard(c)
  const list = await rows<SourceRow & { task_count: number }>(
    c.env.DB
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM tasks t WHERE t.board_id = s.board_id AND t.source = s.name) AS task_count
           FROM sources s WHERE s.board_id = ?1 ORDER BY s.position, s.id`,
      )
      .bind(board.id),
  )
  return c.json({ data: list.map((s) => sourceJson(s, s.task_count)) })
})

sources.post('/boards/:slug/sources', async (c) => {
  const board = ownBoard(c)
  const db = c.env.DB
  const data = parse(sourceCreateSchema, await jsonBody(c))
  await assertNameFree(db, board.id, data.name)

  const next = await db
    .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM sources WHERE board_id = ?1`)
    .bind(board.id)
    .first<{ next: number }>()

  const row = await db
    .prepare(
      `INSERT INTO sources (board_id, name, position, is_archived, created_at, updated_at)
       VALUES (?1, ?2, ?3, 0, ?4, ?4) RETURNING *`,
    )
    .bind(board.id, data.name, next?.next ?? 0, nowIso())
    .first<SourceRow>()

  return c.json({ data: sourceJson(row!) }, 201)
})

sources.patch('/sources/:id', async (c) => {
  const board = c.get('board')
  const db = c.env.DB
  const source = await findSource(db, board.id, idParam(c))
  if (!source) throw notFound()

  const data = parse(sourceUpdateSchema, await jsonBody(c))
  const at = nowIso()
  const statements: D1PreparedStatement[] = []

  if (data.name !== undefined && data.name !== source.name) {
    await assertNameFree(db, board.id, data.name, source.id)
    // Tasks store the name, not the id, so the rename has to reach them.
    statements.push(
      db
        .prepare(`UPDATE tasks SET source = ?1, updated_at = ?2 WHERE board_id = ?3 AND source = ?4`)
        .bind(data.name, at, board.id, source.name),
    )
  }

  const archived = data.is_archived === undefined ? source.is_archived : data.is_archived ? 1 : 0
  statements.push(
    db
      .prepare(`UPDATE sources SET name = ?1, is_archived = ?2, updated_at = ?3 WHERE id = ?4`)
      .bind(data.name ?? source.name, archived, at, source.id),
  )
  await db.batch(statements)

  return c.json({ data: sourceJson((await findSource(db, board.id, source.id))!) })
})

sources.delete('/sources/:id', async (c) => {
  const board = c.get('board')
  const db = c.env.DB
  const source = await findSource(db, board.id, idParam(c))
  if (!source) throw notFound()

  // Dropping a name still on a task would leave that task unreadable,
  // so the source is retired from the picker instead.
  const using = await taskCount(db, source)
  if (using > 0) {
    await db.prepare(`UPDATE sources SET is_archived = 1, updated_at = ?1 WHERE id = ?2`).bind(nowIso(), source.id).run()
    return c.json({ archived: true, tasks_using: using })
  }

  await db.prepare(`DELETE FROM sources WHERE id = ?1`).bind(source.id).run()
  return c.json({ archived: false, tasks_using: 0 })
})
