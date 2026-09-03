import { nowIso } from './dates'

export async function rows<T>(stmt: D1PreparedStatement): Promise<T[]> {
  return (await stmt.all<T>()).results
}

/** Rewrite a column's positions to a dense 0..n-1 sequence, ordered by position then id. */
export function renumber(db: D1Database, columnId: number): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE tasks SET position = (
         SELECT rn FROM (
           SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) - 1 AS rn
           FROM tasks WHERE board_column_id = ?1
         ) r WHERE r.id = tasks.id
       ) WHERE board_column_id = ?1`,
    )
    .bind(columnId)
}

/** An activity line; Activity::note() in Laravel. */
export function note(db: D1Database, boardId: number, text: string, taskId: number | null = null): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO activities (board_id, task_id, text, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)`,
    )
    .bind(boardId, taskId, text.slice(0, 500), nowIso())
}
