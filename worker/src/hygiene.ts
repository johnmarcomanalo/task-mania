export const ARCHIVE_AFTER_DAYS = 30
export const FEATURES = { repeat: true, archive: true } as const

const DAY = 86_400_000
const shift = (ymd: string, days: number) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * DAY).toISOString().slice(0, 10)
}

/** Tasks done before this date are archived. */
export const archiveCutoff = (today: string) => shift(today, -ARCHIVE_AFTER_DAYS)

export interface Streak { streak: number; done_today: number; week: { label: string; count: number }[] }

/** frontend/src/lib/dates.ts#streakInfo, on the server, over every task of the board. */
export async function streakOf(db: D1Database, boardId: number, today: string): Promise<Streak> {
  const { results } = await db
    .prepare(`SELECT done_on AS day, COUNT(*) AS n FROM tasks WHERE board_id = ?1 AND done_on IS NOT NULL GROUP BY done_on`)
    .bind(boardId)
    .all<{ day: string; n: number }>()
  const count = new Map(results.map((r) => [r.day, r.n]))

  let streak = 0
  for (let i = 0; i < 365; i++) {
    if (count.get(shift(today, -i))) streak++
    else if (i > 0) break
  }
  const week = []
  for (let i = 6; i >= 0; i--) {
    const day = shift(today, -i)
    week.push({ label: day, count: count.get(day) ?? 0 })
  }
  return { streak, done_today: count.get(today) ?? 0, week }
}
