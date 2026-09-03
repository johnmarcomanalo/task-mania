import { Hono } from 'hono'
import { nowIso, todayIn } from '../dates'
import { note, renumber } from '../db'
import type { AppEnv, Env } from '../env'
import { invalid, notFound } from '../errors'
import { activeSourceExists, findColumn, findTask, nextPosition, taskPayload } from '../queries'
import { ownBoard } from '../scope'
import type { ColumnRow } from '../serialize'
import { jsonBody, parse, taskCreateSchema, taskUpdateSchema, type TaskUpdate } from '../validate'

export const tasks = new Hono<AppEnv>()

export const zone = (env: Env) => env.APP_TIMEZONE || 'Asia/Manila'

type Fields = Record<string, string | number | null>

/** Client field names → column names, as TaskController::payload(). Only keys that were sent. */
export function payload(data: TaskUpdate): Fields {
  const out: Fields = {}
  if (data.column_id !== undefined) out.board_column_id = data.column_id
  if (data.title !== undefined) out.title = data.title
  if (data.source !== undefined) out.source = data.source
  if (data.sender !== undefined) out.sender = data.sender
  if (data.due !== undefined) out.due_date = data.due
  if (data.priority !== undefined) out.priority = data.priority
  if (data.quote !== undefined) out.quote = data.quote
  if (data.attachments !== undefined) out.attachments_note = data.attachments
  if (data.tags !== undefined) out.tags = JSON.stringify(data.tags)
  return out
}

/** The column and source a task refers to must be the board's own (Laravel's exists rules). */
export async function checkRefs(
  db: D1Database,
  boardId: number,
  data: { column_id?: number; source?: string },
): Promise<ColumnRow | null> {
  let column: ColumnRow | null = null
  if (data.column_id !== undefined) {
    column = await findColumn(db, boardId, data.column_id)
    if (!column) throw invalid('column_id', 'The selected column id is invalid.')
  }
  if (data.source !== undefined && !(await activeSourceExists(db, boardId, data.source))) {
    throw invalid('source', 'The selected source is invalid.')
  }
  return column
}

/** Insert at the end of the column; captured today, done today when the column is the done lane. */
export async function insertTask(
  db: D1Database,
  tz: string,
  boardId: number,
  column: ColumnRow,
  fields: Fields,
): Promise<number> {
  const today = todayIn(tz)
  const row = await db
    .prepare(
      `INSERT INTO tasks (board_id, board_column_id, title, source, sender, due_date, priority, quote,
                          attachments_note, tags, screenshot_path, captured_on, done_on, position,
                          created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)
       RETURNING id`,
    )
    .bind(
      boardId,
      column.id,
      fields.title,
      fields.source ?? 'Manual',
      fields.sender ?? null,
      fields.due_date ?? null,
      fields.priority ?? 'normal',
      fields.quote ?? null,
      fields.attachments_note ?? null,
      fields.tags ?? null,
      fields.screenshot_path ?? null,
      today,
      column.is_done ? today : null,
      await nextPosition(db, column.id),
      nowIso(),
    )
    .first<{ id: number }>()
  return row!.id
}

tasks.post('/boards/:slug/tasks', async (c) => {
  const board = ownBoard(c)
  const db = c.env.DB
  const data = parse(taskCreateSchema, await jsonBody(c))
  const column = (await checkRefs(db, board.id, data))!

  const id = await insertTask(db, zone(c.env), board.id, column, payload(data))
  await db.batch([note(db, board.id, `Created in ${column.name}`, id), renumber(db, column.id)])

  return c.json({ data: await taskPayload(db, board.id, id, true) }, 201)
})

const LINES: Record<string, string> = {
  title: 'Title edited',
  priority: 'Priority changed',
  due_date: 'Due date changed',
  sender: 'Sender changed',
  source: 'Source changed',
  quote: 'Notes edited',
  tags: 'Tags changed',
}

tasks.patch('/tasks/:id', async (c) => {
  const board = c.get('board')
  const db = c.env.DB
  const task = await findTask(db, board.id, Number(c.req.param('id')))
  if (!task) throw notFound()

  const data = parse(taskUpdateSchema, await jsonBody(c))
  const column = await checkRefs(db, board.id, data)

  // Only fields whose value actually changed are written and logged — Eloquent's getChanges().
  const current = task as unknown as Record<string, unknown>
  const changes: Fields = {}
  for (const [key, value] of Object.entries(payload(data))) {
    if (current[key] !== value) changes[key] = value
  }
  if (Object.keys(changes).length === 0) {
    return c.json({ data: await taskPayload(db, board.id, task.id, true) })
  }

  const statements: D1PreparedStatement[] = []
  const movedTo = 'board_column_id' in changes ? column : null
  if (movedTo) changes.done_on = movedTo.is_done ? todayIn(zone(c.env)) : null

  const keys = Object.keys(changes)
  statements.push(
    db
      .prepare(
        `UPDATE tasks SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_at = ?${keys.length + 1}
          WHERE id = ?${keys.length + 2}`,
      )
      .bind(...keys.map((k) => changes[k]), nowIso(), task.id),
  )
  if (movedTo) statements.push(note(db, board.id, `Moved to ${movedTo.name}`, task.id))
  for (const [field, line] of Object.entries(LINES)) {
    if (field in changes) statements.push(note(db, board.id, line, task.id))
  }
  await db.batch(statements)

  return c.json({ data: await taskPayload(db, board.id, task.id, true) })
})
