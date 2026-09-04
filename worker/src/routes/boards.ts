import { Hono } from 'hono'
import { todayIn, zone } from '../dates'
import { rows } from '../db'
import type { AppEnv } from '../env'
import { archiveCutoff } from '../hygiene'
import { boardPayload } from '../queries'
import { ownBoard } from '../scope'
import { activityJson, taskJson, type ActivityRow, type FileRow, type TaskRow } from '../serialize'

export const boards = new Hono<AppEnv>()

boards.get('/boards', (c) => {
  const b = c.get('board')
  return c.json({ data: [{ id: b.id, name: b.name, slug: b.slug, description: b.description }] })
})

boards.get('/boards/:slug', async (c) => {
  const board = ownBoard(c)
  const today = todayIn(zone(c.env))
  return c.json({ data: await boardPayload(c.env.DB, board, today) })
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

/** Escape LIKE metacharacters so a search term matches its characters literally. */
const escapeLike = (s: string) => s.replace(/[%_]/g, (ch) => `\\${ch}`)

/** Archived tasks (done more than ARCHIVE_AFTER_DAYS ago), newest done_on first, searchable, paged by 50. */
boards.get('/boards/:slug/archive', async (c) => {
  const board = ownBoard(c)
  const db = c.env.DB
  const today = todayIn(zone(c.env))
  const cutoff = archiveCutoff(today)
  const q = (c.req.query('q') ?? '').trim().toLowerCase()
  const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1)
  const per = 50
  const like = `%${escapeLike(q)}%`

  const search =
    `(LOWER(title) LIKE ?3 ESCAPE '\\' OR LOWER(COALESCE(sender,'')) LIKE ?3 ESCAPE '\\'` +
    ` OR LOWER(source) LIKE ?3 ESCAPE '\\' OR LOWER(COALESCE(quote,'')) LIKE ?3 ESCAPE '\\'` +
    ` OR LOWER(COALESCE(tags,'')) LIKE ?3 ESCAPE '\\')`
  const searchJoin =
    `(LOWER(t.title) LIKE ?3 ESCAPE '\\' OR LOWER(COALESCE(t.sender,'')) LIKE ?3 ESCAPE '\\'` +
    ` OR LOWER(t.source) LIKE ?3 ESCAPE '\\' OR LOWER(COALESCE(t.quote,'')) LIKE ?3 ESCAPE '\\'` +
    ` OR LOWER(COALESCE(t.tags,'')) LIKE ?3 ESCAPE '\\')`
  const where = `board_id = ?1 AND done_on < ?2` + (q ? ` AND ${search}` : '')
  const whereJoin = `t.board_id = ?1 AND t.done_on < ?2` + (q ? ` AND ${searchJoin}` : '')
  const bind = q ? [board.id, cutoff, like] : [board.id, cutoff]

  const [count, list] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE ${where}`).bind(...bind),
    db
      .prepare(
        `SELECT t.*, c.key AS column_key FROM tasks t JOIN board_columns c ON c.id = t.board_column_id
          WHERE ${whereJoin} ORDER BY t.done_on DESC, t.id DESC LIMIT ${per} OFFSET ${(page - 1) * per}`,
      )
      .bind(...bind),
  ])

  const tasks = list.results as unknown as (TaskRow & { column_key: string })[]
  const ids = tasks.map((t) => t.id)
  const files = ids.length
    ? await rows<FileRow>(
        db
          .prepare(`SELECT * FROM task_files WHERE task_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
          .bind(...ids),
      )
    : []
  const filesOf = new Map<number, FileRow[]>()
  for (const f of files) (filesOf.get(f.task_id) ?? filesOf.set(f.task_id, []).get(f.task_id)!).push(f)

  return c.json({
    data: {
      tasks: tasks.map((t) => taskJson(t, { columnKey: t.column_key, files: filesOf.get(t.id) ?? [] })),
      total: (count.results[0] as { n: number }).n,
      page,
      per_page: per,
    },
  })
})
