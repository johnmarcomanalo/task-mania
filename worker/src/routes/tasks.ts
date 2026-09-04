import { Hono } from 'hono'
import { nowIso, todayIn, zone } from '../dates'
import { note, renumber, rows } from '../db'
import type { AppEnv, Env } from '../env'
import { invalid, notFound } from '../errors'
import { activeSourceExists, findColumn, findTask, nextPosition, taskPayload } from '../queries'
import { refund } from '../quota'
import { describe as describeRule, nextDue, parseRule } from '../recur'
import { idParam, ownBoard } from '../scope'
import type { ColumnRow, FileRow, TaskRow } from '../serialize'
import { bulkSchema, jsonBody, moveSchema, parse, taskCreateSchema, taskUpdateSchema, type TaskUpdate } from '../validate'

export const tasks = new Hono<AppEnv>()

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
  if (data.repeat !== undefined) out.repeat = data.repeat === null ? null : JSON.stringify(data.repeat)
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
                          attachments_note, tags, screenshot_path, captured_on, done_on, repeat, position,
                          created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)
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
      fields.repeat ?? null,
      await nextPosition(db, column.id),
      nowIso(),
    )
    .first<{ id: number }>()
  return row!.id
}

/** Where a repeated task lands: the todo lane, else the first lane that is not done. */
async function landingColumn(db: D1Database, boardId: number): Promise<ColumnRow> {
  const cols = await rows<ColumnRow>(
    db.prepare(`SELECT * FROM board_columns WHERE board_id = ?1 AND is_done = 0 ORDER BY position, id`).bind(boardId),
  )
  return cols.find((c) => c.key === 'todo') ?? cols[0]
}

/**
 * A completed task with a repeat rule leaves its next occurrence behind: a copy
 * in the landing column, due on the rule's next date, carrying the rule. The
 * completed task keeps its place in Done and loses the rule.
 */
export async function spawnNext(db: D1Database, env: Env, boardId: number, task: TaskRow): Promise<number | null> {
  const rule = parseRule(task.repeat)
  if (!rule) return null

  const today = todayIn(zone(env))
  const base = task.due_date && task.due_date > today ? task.due_date : today
  const next = nextDue(rule, base)
  const column = await landingColumn(db, boardId)

  const id = await insertTask(db, zone(env), boardId, column, {
    title: task.title, source: task.source, sender: task.sender, due_date: next, priority: task.priority,
    quote: task.quote, attachments_note: task.attachments_note, tags: task.tags,
    screenshot_path: task.screenshot_path, repeat: task.repeat,
  })
  const what = describeRule(rule)
  await db.batch([
    note(db, boardId, `Repeats ${what} — next on ${next}`, id),
    renumber(db, column.id),
    db.prepare(`UPDATE tasks SET repeat = NULL, updated_at = ?1 WHERE id = ?2`).bind(nowIso(), task.id),
    note(db, boardId, `Completed; repeats ${what} — next copy due ${next}`, task.id),
  ])
  return id
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
  const task = await findTask(db, board.id, idParam(c))
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
  const before = movedTo ? await findColumn(db, board.id, task.board_column_id) : null

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

  if (movedTo?.is_done && !before?.is_done) {
    await spawnNext(db, c.env, board.id, { ...task, ...changes } as TaskRow)
  }

  return c.json({ data: await taskPayload(db, board.id, task.id, true) })
})

/**
 * Move a task to a column at an explicit index, closing the gap it left and
 * opening one where it lands. Both lists end contiguous from 0.
 */
tasks.patch('/tasks/:id/move', async (c) => {
  const board = c.get('board')
  const db = c.env.DB
  const task = await findTask(db, board.id, idParam(c))
  if (!task) throw notFound()

  const data = parse(moveSchema, await jsonBody(c))
  const column = await findColumn(db, board.id, data.column_id)
  if (!column) throw invalid('column_id', 'The selected column id is invalid.')

  const from = task.board_column_id
  const to = column.id
  const target = data.position
  const doneOn = column.is_done ? (task.done_on ?? todayIn(zone(c.env))) : null

  const statements = [
    db
      .prepare(`UPDATE tasks SET position = position - 1 WHERE board_column_id = ?1 AND position > ?2 AND id <> ?3`)
      .bind(from, task.position, task.id),
    db
      .prepare(`UPDATE tasks SET position = position + 1 WHERE board_column_id = ?1 AND position >= ?2 AND id <> ?3`)
      .bind(to, target, task.id),
    db
      .prepare(`UPDATE tasks SET board_column_id = ?1, position = ?2, done_on = ?3, updated_at = ?4 WHERE id = ?5`)
      .bind(to, target, doneOn, nowIso(), task.id),
    renumber(db, from),
  ]
  if (to !== from) statements.push(renumber(db, to), note(db, board.id, `Moved to ${column.name}`, task.id))
  await db.batch(statements)

  if (to !== from && column.is_done) await spawnNext(db, c.env, board.id, task)

  return c.json({ data: await taskPayload(db, board.id, task.id, true) })
})

tasks.delete('/tasks/:id', async (c) => {
  const board = c.get('board')
  const db = c.env.DB
  const task = await findTask(db, board.id, idParam(c))
  if (!task) throw notFound()

  const files = await rows<FileRow>(db.prepare(`SELECT * FROM task_files WHERE task_id = ?1`).bind(task.id))
  await Promise.all(files.map((f) => c.env.FILES.delete(f.path)))

  // The line outlives the task, so it carries no task id; older lines lose theirs via ON DELETE SET NULL.
  const statements = [
    note(db, board.id, `Deleted: ${task.title}`),
    db.prepare(`DELETE FROM tasks WHERE id = ?1`).bind(task.id),
    renumber(db, task.board_column_id),
  ]
  if (files.length > 0) {
    statements.push(refund(db, c.get('user').id, files.reduce((sum, f) => sum + f.size, 0), files.length))
  }
  await db.batch(statements)

  return c.body(null, 204)
})

/** Create several tasks at once, as a confirmed screenshot review does. */
tasks.post('/boards/:slug/tasks/bulk', async (c) => {
  const board = ownBoard(c)
  const db = c.env.DB
  const data = parse(bulkSchema, await jsonBody(c))

  if (data.source !== undefined && !(await activeSourceExists(db, board.id, data.source))) {
    throw invalid('source', 'The selected source is invalid.')
  }
  const source = data.source ?? 'Manual'

  const columns = new Map<number, ColumnRow>()
  for (const [i, row] of data.tasks.entries()) {
    if (columns.has(row.column_id)) continue
    const column = await findColumn(db, board.id, row.column_id)
    if (!column) throw invalid(`tasks.${i}.column_id`, `The selected tasks.${i}.column_id is invalid.`)
    columns.set(row.column_id, column)
  }

  const ids: number[] = []
  const after: D1PreparedStatement[] = []
  for (const row of data.tasks) {
    const column = columns.get(row.column_id)!
    const id = await insertTask(db, zone(c.env), board.id, column, {
      ...payload(row),
      source,
      screenshot_path: data.screenshot_path ?? null,
    })
    const who = (row.sender ?? '').trim()
    after.push(note(db, board.id, `Captured from ${source}${who ? ` (${who})` : ''} — placed in ${column.name}`, id))
    ids.push(id)
  }
  for (const columnId of columns.keys()) after.push(renumber(db, columnId))
  await db.batch(after)

  const list = await Promise.all(ids.map((id) => taskPayload(db, board.id, id, true)))
  return c.json({ data: list }, 201)
})
