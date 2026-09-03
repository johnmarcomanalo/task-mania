import { Hono } from 'hono'
import { nowIso } from '../dates'
import { note } from '../db'
import type { AppEnv } from '../env'
import { invalid, notFound } from '../errors'
import { findTask } from '../queries'
import { fileJson, type FileRow } from '../serialize'
import { MAX_FILES, MAX_FILE_BYTES, filesFrom, objectKey, putObject } from '../uploads'

export const files = new Hono<AppEnv>()

files.post('/tasks/:id/files', async (c) => {
  const board = c.get('board')
  const db = c.env.DB
  const task = await findTask(db, board.id, Number(c.req.param('id')))
  if (!task) throw notFound()

  const body = await c.req.parseBody({ all: true })
  const list = filesFrom(body, 'files[]')
  if (list.length === 0) throw invalid('files', 'The files field is required.')
  if (list.length > MAX_FILES) throw invalid('files', `The files may not have more than ${MAX_FILES} items.`)
  list.forEach((f, i) => {
    if (f.size > MAX_FILE_BYTES) throw invalid(`files.${i}`, `The files.${i} may not be greater than 10240 kilobytes.`)
  })

  const made: FileRow[] = []
  for (const f of list) {
    const key = objectKey('attachments', f)
    const mime = f.type || 'application/octet-stream'
    await putObject(c.env.FILES, key, await f.arrayBuffer(), mime, c.get('user').id, f.name)
    const row = await db
      .prepare(
        `INSERT INTO task_files (task_id, name, mime, size, path, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) RETURNING *`,
      )
      .bind(task.id, f.name, mime, f.size, key, nowIso())
      .first<FileRow>()
    made.push(row!)
  }

  await note(db, board.id, `Attached ${made.length} file(s): ${made.map((f) => f.name).join(', ')}`, task.id).run()

  return c.json({ data: made.map(fileJson) }, 201)
})

files.delete('/task-files/:id', async (c) => {
  const board = c.get('board')
  const db = c.env.DB
  const file = await db
    .prepare(`SELECT f.* FROM task_files f JOIN tasks t ON t.id = f.task_id WHERE f.id = ?1 AND t.board_id = ?2`)
    .bind(Number(c.req.param('id')), board.id)
    .first<FileRow>()
  if (!file) throw notFound()

  await c.env.FILES.delete(file.path)
  await db.batch([
    note(db, board.id, `Removed attachment ${file.name}`, file.task_id),
    db.prepare(`DELETE FROM task_files WHERE id = ?1`).bind(file.id),
  ])

  return c.body(null, 204)
})
