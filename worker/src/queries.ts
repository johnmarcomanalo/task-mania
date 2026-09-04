import { PRIORITIES } from './defaults'
import type { AuthBoard } from './env'
import { notFound } from './errors'
import { archiveCutoff, FEATURES, streakOf } from './hygiene'
import {
  activityJson, columnJson, sourceJson, taskJson,
  type ActivityRow, type ColumnRow, type FileRow, type SourceRow, type TaskRow,
} from './serialize'

export function findColumn(db: D1Database, boardId: number, columnId: number) {
  return db.prepare(`SELECT * FROM board_columns WHERE id = ?1 AND board_id = ?2`).bind(columnId, boardId).first<ColumnRow>()
}

export function findTask(db: D1Database, boardId: number, taskId: number) {
  return db.prepare(`SELECT * FROM tasks WHERE id = ?1 AND board_id = ?2`).bind(taskId, boardId).first<TaskRow>()
}

export function findSource(db: D1Database, boardId: number, sourceId: number) {
  return db.prepare(`SELECT * FROM sources WHERE id = ?1 AND board_id = ?2`).bind(sourceId, boardId).first<SourceRow>()
}

/** A task may only carry a source the board still offers. */
export async function activeSourceExists(db: D1Database, boardId: number, name: string): Promise<boolean> {
  const hit = await db
    .prepare(`SELECT id FROM sources WHERE board_id = ?1 AND name = ?2 AND is_archived = 0`)
    .bind(boardId, name)
    .first()
  return hit !== null
}

export async function nextPosition(db: D1Database, columnId: number): Promise<number> {
  const row = await db
    .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM tasks WHERE board_column_id = ?1`)
    .bind(columnId)
    .first<{ next: number }>()
  return row?.next ?? 0
}

/** One task with its column key, files and (optionally) history — TaskResource with those loaded. */
export async function taskPayload(db: D1Database, boardId: number, taskId: number, withHistory: boolean) {
  const [task, files, history] = await db.batch([
    db
      .prepare(
        `SELECT t.*, c.key AS column_key FROM tasks t
           JOIN board_columns c ON c.id = t.board_column_id
          WHERE t.id = ?1 AND t.board_id = ?2`,
      )
      .bind(taskId, boardId),
    db.prepare(`SELECT * FROM task_files WHERE task_id = ?1 ORDER BY id`).bind(taskId),
    db.prepare(`SELECT * FROM activities WHERE task_id = ?1 ORDER BY created_at DESC, id DESC`).bind(taskId),
  ])

  const row = task.results[0] as (TaskRow & { column_key: string }) | undefined
  if (!row) throw notFound()

  return taskJson(row, {
    columnKey: row.column_key,
    files: files.results as unknown as FileRow[],
    history: withHistory ? (history.results as unknown as ActivityRow[]) : undefined,
  })
}

/**
 * BoardResource with columns, sources, tasks (+files, minus archived ones) and
 * the latest 80 activities, plus how many tasks are archived, the streak and
 * the feature flags the UI gates Repeat/Archive on. `today` (the board's own
 * calendar day) decides the archive cutoff and the streak's "today".
 */
export async function boardPayload(db: D1Database, board: AuthBoard, today: string) {
  const cutoff = archiveCutoff(today)
  const [cols, srcs, tsks, fls, acts, archived] = await db.batch([
    db.prepare(`SELECT * FROM board_columns WHERE board_id = ?1 ORDER BY position, id`).bind(board.id),
    db.prepare(`SELECT * FROM sources WHERE board_id = ?1 ORDER BY position, id`).bind(board.id),
    db
      .prepare(`SELECT * FROM tasks WHERE board_id = ?1 AND (done_on IS NULL OR done_on >= ?2) ORDER BY position, id`)
      .bind(board.id, cutoff),
    db
      .prepare(
        `SELECT f.* FROM task_files f JOIN tasks t ON t.id = f.task_id
          WHERE t.board_id = ?1 AND (t.done_on IS NULL OR t.done_on >= ?2) ORDER BY f.id`,
      )
      .bind(board.id, cutoff),
    db
      .prepare(`SELECT * FROM activities WHERE board_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 80`)
      .bind(board.id),
    db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE board_id = ?1 AND done_on < ?2`).bind(board.id, cutoff),
  ])

  const columns = cols.results as unknown as ColumnRow[]
  const keyOf = new Map(columns.map((c) => [c.id, c.key]))

  const filesOf = new Map<number, FileRow[]>()
  for (const f of fls.results as unknown as FileRow[]) {
    ;(filesOf.get(f.task_id) ?? filesOf.set(f.task_id, []).get(f.task_id)!).push(f)
  }

  return {
    id: board.id,
    name: board.name,
    slug: board.slug,
    description: board.description,
    // Archived sources ride along so a task that still carries one stays readable.
    sources: (srcs.results as unknown as SourceRow[]).map((s) => sourceJson(s)),
    priorities: [...PRIORITIES],
    // Screenshots are captured and typed here, never read automatically.
    scan_enabled: false,
    columns: columns.map(columnJson),
    tasks: (tsks.results as unknown as TaskRow[]).map((t) =>
      taskJson(t, { columnKey: keyOf.get(t.board_column_id) ?? '', files: filesOf.get(t.id) ?? [] }),
    ),
    activity: (acts.results as unknown as ActivityRow[]).map(activityJson),
    archived_count: (archived.results[0] as { n: number }).n,
    streak: await streakOf(db, board.id, today),
    features: FEATURES,
  }
}
