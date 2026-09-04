# Recurring Tasks and Board Hygiene — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tasks can repeat weekly/monthly (next copy created on completion); the board stays tidy with a 7-day Done lane, per-lane caps, quick filters and an Archive view for tasks done more than 30 days ago.

**Architecture:** Server side, a pure `recur.ts` module computes next dates; the move/update routes spawn the next copy; the board payload excludes archived tasks and carries `archived_count`, a server-computed `streak` and `features`; a new archive endpoint lists old done tasks. Client side, the existing Kanban UI gains a repeat editor, card badge, lane caps, a filter bar and an Archive view, all gated on `board.features`.

**Tech Stack:** Cloudflare Worker (Hono, D1, vitest on the Workers runtime), React 19 + TypeScript + Vite (existing).

**Spec:** `docs/superpowers/specs/2026-09-04-recurring-and-board-hygiene-design.md`

## Global Constraints

- Work on branch `recurring-hygiene` from `main`. Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Worker commands from the repo root: `npm --prefix worker test -- test/<file>`, `npm --prefix worker test`, `npm --prefix worker run typecheck`. Frontend: `npm --prefix frontend run lint` (12 pre-existing warnings are known; no new ones), `npm --prefix frontend run build`.
- No changes under `backend/`. Existing JSON fields keep their names and shapes; only additions listed in the spec.
- Dates are `YYYY-MM-DD`; "today" on the server is `todayIn(zone(env))` (`Asia/Manila` default). Date math in `recur.ts` uses `Date.UTC` only.
- Weekday numbering everywhere: 0 = Sunday … 6 = Saturday (JavaScript's `getUTCDay`).
- `ARCHIVE_AFTER_DAYS = 30`; `LANE_LIMIT = 10`; `DONE_RECENT_DAYS = 7`; archive page size 50.
- Activity texts verbatim: `Repeats <describe> — next on <date>` (on the copy) and `Completed; repeats <describe> — next copy due <date>` (on the completed task).
- Storage is reset before every worker test (`worker/test/reset.ts`); helpers in `worker/test/helpers.ts` (`env, app, ALICE, BOB, call, get, post, patch, del, json, meOf, boardOf, columnOf, boardIdOf, seedTask`).

## File map

| Path | Responsibility |
|---|---|
| `worker/migrations/0003_recurring.sql` | `tasks.repeat TEXT` |
| `worker/src/recur.ts` | `RepeatRule`, `parseRule`, `nextDue`, `describe`, `repeatSchema` (zod) |
| `worker/src/validate.ts` | `repeat` on create/update schemas |
| `worker/src/serialize.ts` | `TaskRow.repeat`, `repeat` in task JSON |
| `worker/src/routes/tasks.ts` | `payload()` maps `repeat`; `spawnNext()`; hooks in move/update |
| `worker/src/hygiene.ts` | `archiveCutoff(env)`, `streakOf(db, boardId, today)`, `FEATURES` |
| `worker/src/queries.ts` | board payload: exclude archived, add `archived_count`, `streak`, `features` |
| `worker/src/routes/boards.ts` | `GET /boards/:slug/archive` |
| `worker/test/{recur,recurring,archive,streak}.test.ts` | tests |
| `frontend/src/types.ts` | `RepeatRule`, `Task.repeat`, `Board.streak/archived_count/features`, `View` |
| `frontend/src/api.ts` | `TaskInput.repeat`, `api.archive()` |
| `frontend/src/lib/recur.ts` | `describeRule`, `badgeText`, weekday/nth labels, defaults |
| `frontend/src/components/RepeatEditor.tsx` | the Repeat row |
| `frontend/src/components/FilterBar.tsx` | quick filters |
| `frontend/src/components/ArchiveView.tsx` | the Archive view |
| `frontend/src/components/{DetailPanel,TaskCard,Lane}.tsx`, `App.tsx`, `styles/app.css` | wiring |
| `docs/cloudflare-setup.md`, `worker/README.md` | docs |

---

### Task 0: Branch

- [ ] `git checkout -b recurring-hygiene main`

---

### Task 1: Recurrence rules — data, math, validation

**Files:**
- Create: `worker/migrations/0003_recurring.sql`, `worker/src/recur.ts`, `worker/test/recur.test.ts`
- Modify: `worker/src/validate.ts`, `worker/src/serialize.ts`, `worker/src/routes/tasks.ts` (`payload()` only)

**Interfaces:**
- Produces: `RepeatRule`, `parseRule(text: string | null): RepeatRule | null`, `nextDue(rule: RepeatRule, after: string): string`, `describe(rule: RepeatRule): string`, `repeatSchema` (zod, accepts `RepeatRule | null`); `TaskRow.repeat: string | null`; task JSON `repeat: RepeatRule | null`; `TaskCreate/TaskUpdate.repeat?: RepeatRule | null`.

- [ ] **Step 1: Tests** — `worker/test/recur.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { describe as describeRule, nextDue, parseRule } from '../src/recur'
import { parse, taskUpdateSchema } from '../src/validate'
import { ValidationError } from '../src/errors'

describe('nextDue', () => {
  it('weekly: the next matching weekday strictly after the date', () => {
    expect(nextDue({ freq: 'weekly', weekday: 4 }, '2026-09-03')).toBe('2026-09-10') // Thu → next Thu
    expect(nextDue({ freq: 'weekly', weekday: 5 }, '2026-09-03')).toBe('2026-09-04') // Thu → Fri
    expect(nextDue({ freq: 'weekly', weekday: 3 }, '2026-09-03')).toBe('2026-09-09')
    expect(nextDue({ freq: 'weekly', weekday: 1 }, '2026-12-29')).toBe('2027-01-04') // across the year
  })

  it('monthly by day: same day next month, clamped to short months', () => {
    expect(nextDue({ freq: 'monthly', day: 15 }, '2026-09-03')).toBe('2026-09-15')
    expect(nextDue({ freq: 'monthly', day: 15 }, '2026-09-15')).toBe('2026-10-15')
    expect(nextDue({ freq: 'monthly', day: 31 }, '2026-01-31')).toBe('2026-02-28')
    expect(nextDue({ freq: 'monthly', day: 31 }, '2028-01-31')).toBe('2028-02-29') // leap year
    expect(nextDue({ freq: 'monthly', day: 31 }, '2026-02-28')).toBe('2026-03-31')
    expect(nextDue({ freq: 'monthly', day: 1 }, '2026-12-01')).toBe('2027-01-01')
  })

  it('monthly by nth weekday, including last', () => {
    expect(nextDue({ freq: 'monthly', nth: 2, weekday: 1 }, '2026-09-03')).toBe('2026-09-14') // 2nd Monday
    expect(nextDue({ freq: 'monthly', nth: 2, weekday: 1 }, '2026-09-14')).toBe('2026-10-12')
    expect(nextDue({ freq: 'monthly', nth: -1, weekday: 5 }, '2026-09-03')).toBe('2026-09-25') // last Friday
    expect(nextDue({ freq: 'monthly', nth: 4, weekday: 2 }, '2026-09-29')).toBe('2026-10-27') // 4th Tuesday
    expect(nextDue({ freq: 'monthly', nth: 1, weekday: 0 }, '2026-10-31')).toBe('2026-11-01')
  })
})

describe('describe / parseRule', () => {
  it('reads like the UI', () => {
    expect(describeRule({ freq: 'weekly', weekday: 4 })).toBe('every Thursday')
    expect(describeRule({ freq: 'monthly', day: 15 })).toBe('every month on the 15th')
    expect(describeRule({ freq: 'monthly', day: 1 })).toBe('every month on the 1st')
    expect(describeRule({ freq: 'monthly', day: 22 })).toBe('every month on the 22nd')
    expect(describeRule({ freq: 'monthly', nth: 2, weekday: 1 })).toBe('every 2nd Monday')
    expect(describeRule({ freq: 'monthly', nth: -1, weekday: 5 })).toBe('every last Friday')
  })

  it('parses stored JSON and rejects garbage', () => {
    expect(parseRule('{"freq":"weekly","weekday":4}')).toEqual({ freq: 'weekly', weekday: 4 })
    expect(parseRule('{"freq":"monthly","day":40}')).toBeNull()
    expect(parseRule('{"freq":"daily"}')).toBeNull()
    expect(parseRule('not json')).toBeNull()
    expect(parseRule(null)).toBeNull()
  })
})

describe('repeat validation', () => {
  const bad = (body: unknown) => {
    try { parse(taskUpdateSchema, body) } catch (e) { return (e as ValidationError).errors }
    throw new Error('expected 422')
  }
  it('accepts the three shapes and null', () => {
    expect(parse(taskUpdateSchema, { repeat: { freq: 'weekly', weekday: 0 } }).repeat).toEqual({ freq: 'weekly', weekday: 0 })
    expect(parse(taskUpdateSchema, { repeat: { freq: 'monthly', day: 31 } }).repeat).toEqual({ freq: 'monthly', day: 31 })
    expect(parse(taskUpdateSchema, { repeat: { freq: 'monthly', nth: -1, weekday: 6 } }).repeat).toEqual({ freq: 'monthly', nth: -1, weekday: 6 })
    expect(parse(taskUpdateSchema, { repeat: null }).repeat).toBeNull()
  })
  it('rejects wrong shapes with a repeat error', () => {
    expect(Object.keys(bad({ repeat: { freq: 'weekly', weekday: 7 } }))[0]).toMatch(/^repeat/)
    expect(Object.keys(bad({ repeat: { freq: 'monthly', day: 0 } }))[0]).toMatch(/^repeat/)
    expect(Object.keys(bad({ repeat: { freq: 'monthly', nth: 5, weekday: 1 } }))[0]).toMatch(/^repeat/)
    expect(Object.keys(bad({ repeat: { freq: 'yearly' } }))[0]).toMatch(/^repeat/)
  })
})
```

- [ ] **Step 2: Run** `npm --prefix worker test -- test/recur.test.ts` → fails (module missing).

- [ ] **Step 3: Implement**

`worker/migrations/0003_recurring.sql`:
```sql
-- A repeat rule (JSON) makes the task spawn its next occurrence when it is completed.
ALTER TABLE tasks ADD COLUMN repeat TEXT;
```

`worker/src/recur.ts`:
```ts
import { z } from 'zod'

/** 0 = Sunday … 6 = Saturday, as JavaScript counts. */
export type RepeatRule =
  | { freq: 'weekly'; weekday: number }
  | { freq: 'monthly'; day: number }
  | { freq: 'monthly'; nth: 1 | 2 | 3 | 4 | -1; weekday: number }

const weekday = z.number('The repeat weekday must be a number.').int().min(0, 'The repeat weekday is invalid.').max(6, 'The repeat weekday is invalid.')

export const repeatSchema = z.union([
  z.object({ freq: z.literal('weekly'), weekday }),
  z.object({ freq: z.literal('monthly'), day: z.number('The repeat day must be a number.').int().min(1, 'The repeat day is invalid.').max(31, 'The repeat day is invalid.') }),
  z.object({ freq: z.literal('monthly'), nth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)], 'The repeat week is invalid.'), weekday }),
], 'The repeat rule is invalid.')

export function parseRule(text: string | null): RepeatRule | null {
  if (!text) return null
  try {
    const r = repeatSchema.safeParse(JSON.parse(text))
    return r.success ? (r.data as RepeatRule) : null
  } catch {
    return null
  }
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const NTH: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', [-1]: 'last' }

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) > 3 ? 0 : n % 10] ?? 'th'
  return `${n}${s}`
}

export function describe(rule: RepeatRule): string {
  if (rule.freq === 'weekly') return `every ${WEEKDAYS[rule.weekday]}`
  if ('day' in rule) return `every month on the ${ordinal(rule.day)}`
  return `every ${NTH[rule.nth]} ${WEEKDAYS[rule.weekday]}`
}

/* ---- calendar math on YYYY-MM-DD strings, UTC only ---- */

const parts = (s: string) => s.split('-').map(Number) as [number, number, number]
const fmt = (d: Date) => d.toISOString().slice(0, 10)
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** The Nth (1–4) or last (-1) `weekday` of month m of year y. */
function nthWeekday(y: number, m: number, nth: number, weekday: number): Date {
  if (nth === -1) {
    const last = utc(y, m, daysInMonth(y, m))
    return utc(y, m, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7))
  }
  const first = utc(y, m, 1)
  const offset = (weekday - first.getUTCDay() + 7) % 7
  return utc(y, m, 1 + offset + (nth - 1) * 7)
}

/** The first date matching the rule strictly after `after`. */
export function nextDue(rule: RepeatRule, after: string): string {
  const [y, m, d] = parts(after)
  const base = utc(y, m, d)

  if (rule.freq === 'weekly') {
    const delta = ((rule.weekday - base.getUTCDay() + 7) % 7) || 7
    return fmt(utc(y, m, d + delta))
  }

  for (let k = 0; k < 2; k++) {
    const mm = m + k
    const yy = y + Math.floor((mm - 1) / 12)
    const month = ((mm - 1) % 12) + 1
    const candidate = 'day' in rule
      ? utc(yy, month, Math.min(rule.day, daysInMonth(yy, month)))
      : nthWeekday(yy, month, rule.nth, rule.weekday)
    if (candidate > base) return fmt(candidate)
  }
  throw new Error('unreachable: a monthly rule always matches within two months')
}
```
Simplify `ordinal` if the test set passes with a plainer version — the requirement is 1st/2nd/3rd/4th…11th–13th → th, 21st, 22nd, 23rd, 31st.

`worker/src/validate.ts`: import `repeatSchema` from `./recur`; add `repeat: repeatSchema.nullable().optional()` to `taskFields` (so create, update and bulk rows all accept it).

`worker/src/serialize.ts`: `TaskRow` gains `repeat: string | null`; `taskJson` gains `repeat: parseRule(t.repeat)` (import from `./recur`).

`worker/src/routes/tasks.ts` `payload()`: `if (data.repeat !== undefined) out.repeat = data.repeat === null ? null : JSON.stringify(data.repeat)`. `insertTask` gains `repeat` in its INSERT column list (`fields.repeat ?? null`).

- [ ] **Step 4: Run** `npm --prefix worker test -- test/recur.test.ts` and the full suite; typecheck. Commit: `Worker: repeat rules — schema, date math, validation`.

---

### Task 2: Spawn the next occurrence on completion

**Files:**
- Modify: `worker/src/routes/tasks.ts`
- Test: `worker/test/recurring.test.ts`

**Interfaces:**
- Consumes: `parseRule`, `nextDue`, `describe` (Task 1); `insertTask`, `zone`, `note`, `renumber`, `findColumn`; `todayIn`.
- Produces: `spawnNext(db, env, boardId, task: TaskRow): Promise<number | null>`.

- [ ] **Step 1: Tests** — `worker/test/recurring.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { todayIn } from '../src/dates'
import { nextDue } from '../src/recur'
import { ALICE, boardOf, columnOf, get, json, patch, post } from './helpers'

const today = () => todayIn('Asia/Manila')

async function make(body: Record<string, unknown>) {
  const board = await boardOf()
  const res = await post(`/api/boards/${board.slug}/tasks`, {
    column_id: columnOf(board, 'doing'), title: 'Weekly report', source: 'Email', sender: 'Boss',
    priority: 'high', quote: 'Every Thursday please', tags: ['report'],
    repeat: { freq: 'weekly', weekday: 4 }, ...body,
  })
  expect(res.status).toBe(201)
  return { board, task: (await json(res)).data }
}

async function tasksOf(slug: string) {
  return (await json(await get(`/api/boards/${slug}`))).data.tasks as Record<string, any>[]
}

describe('repeat on completion', () => {
  it('stores and returns the rule', async () => {
    const { task } = await make({})
    expect(task.repeat).toEqual({ freq: 'weekly', weekday: 4 })
  })

  it('moving into Done spawns the next copy in To Do and moves the rule', async () => {
    const { board, task } = await make({ due: '2026-09-03' })
    const res = await patch(`/api/tasks/${task.id}/move`, { column_id: columnOf(board, 'done'), position: 0 })
    expect(res.status).toBe(200)
    const done = (await json(res)).data
    expect(done.repeat).toBeNull()
    expect(done.history[0].text).toBe(`Completed; repeats every Thursday — next copy due ${expectedNext('2026-09-03')}`)

    const all = await tasksOf(board.slug)
    const copy = all.find((t) => t.id !== task.id)!
    expect(copy).toMatchObject({
      column_key: 'todo', title: 'Weekly report', source: 'Email', sender: 'Boss', priority: 'high',
      quote: 'Every Thursday please', tags: ['report'], due: expectedNext('2026-09-03'),
      repeat: { freq: 'weekly', weekday: 4 }, done_on: null, captured: today(),
    })
    const log = (await json(await get(`/api/boards/${board.slug}/activity`))).data
    expect(log.find((l: any) => l.task_id === copy.id).text).toBe(`Repeats every Thursday — next on ${copy.due}`)
  })

  it('changing Status to Done spawns too', async () => {
    const { board, task } = await make({ due: '2026-09-03', repeat: { freq: 'monthly', day: 15 } })
    await patch(`/api/tasks/${task.id}`, { column_id: columnOf(board, 'done') })
    const all = await tasksOf(board.slug)
    expect(all).toHaveLength(2)
    expect(all.find((t) => t.id !== task.id)!.due).toBe(expectedNext('2026-09-03', { freq: 'monthly', day: 15 }))
  })

  it('does not spawn when moving inside Done, or out of Done, or without a rule', async () => {
    const { board, task } = await make({ due: '2026-09-03' })
    await patch(`/api/tasks/${task.id}/move`, { column_id: columnOf(board, 'done'), position: 0 })
    expect(await tasksOf(board.slug)).toHaveLength(2)
    await patch(`/api/tasks/${task.id}/move`, { column_id: columnOf(board, 'done'), position: 0 })
    await patch(`/api/tasks/${task.id}/move`, { column_id: columnOf(board, 'todo'), position: 0 })
    expect(await tasksOf(board.slug)).toHaveLength(2)

    const plain = await make({ repeat: null, title: 'Once' })
    await patch(`/api/tasks/${plain.task.id}/move`, { column_id: columnOf(board, 'done'), position: 0 })
    expect(await tasksOf(board.slug)).toHaveLength(3)
  })

  it('uses today when the task has no due date or is overdue', async () => {
    const { board, task } = await make({ due: '' })
    await patch(`/api/tasks/${task.id}/move`, { column_id: columnOf(board, 'done'), position: 0 })
    const copy = (await tasksOf(board.slug)).find((t) => t.id !== task.id)!
    expect(copy.due).toBe(nextDue({ freq: 'weekly', weekday: 4 }, today()))

    const late = await make({ due: '2020-01-02', title: 'Late' })
    await patch(`/api/tasks/${late.task.id}/move`, { column_id: columnOf(board, 'done'), position: 0 })
    const lateCopy = (await tasksOf(board.slug)).find((t) => t.title === 'Late' && t.id !== late.task.id)!
    expect(lateCopy.due).toBe(nextDue({ freq: 'weekly', weekday: 4 }, today()))
  })

  it('the copy repeats again when completed', async () => {
    const { board, task } = await make({ due: '2026-09-03' })
    await patch(`/api/tasks/${task.id}/move`, { column_id: columnOf(board, 'done'), position: 0 })
    const copy = (await tasksOf(board.slug)).find((t) => t.id !== task.id)!
    await patch(`/api/tasks/${copy.id}/move`, { column_id: columnOf(board, 'done'), position: 0 })
    expect(await tasksOf(board.slug)).toHaveLength(3)
  })
})

function expectedNext(due: string, rule: any = { freq: 'weekly', weekday: 4 }) {
  const base = due > today() ? due : today()
  return nextDue(rule, base)
}
```

- [ ] **Step 2: Run** → fails (no copy is created).

- [ ] **Step 3: Implement** in `worker/src/routes/tasks.ts`

```ts
import { describe as describeRule, nextDue, parseRule } from '../recur'
import { rows } from '../db'   // already imported
import type { ColumnRow, TaskRow } from '../serialize'

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
```

Hook it in:
- **move**: after the existing batch, `if (to !== from && column.is_done) await spawnNext(db, c.env, board.id, task)` (`task` is the row read before the move; its `repeat` is still set).
- **update**: after the existing batch, `if (movedTo?.is_done && !(await findColumn(db, board.id, task.board_column_id))?.is_done) await spawnNext(...)` — i.e. only when the previous column was not done. Read the previous column once before the batch (`const before = await findColumn(db, board.id, task.board_column_id)`).

Both responses stay as they are (`taskPayload` of the moved/updated task, which now shows `repeat: null` and the new history line).

- [ ] **Step 4: Run** the file, the suite, typecheck. Commit: `Worker: completing a repeating task spawns its next occurrence`.

---

### Task 3: Archive cutoff, archive endpoint, server streak, features

**Files:**
- Create: `worker/src/hygiene.ts`, `worker/test/archive.test.ts`, `worker/test/streak.test.ts`
- Modify: `worker/src/queries.ts` (`boardPayload`), `worker/src/routes/boards.ts`

**Interfaces:**
- Produces: `ARCHIVE_AFTER_DAYS = 30`; `archiveCutoff(today: string): string` (today − 30 days, `YYYY-MM-DD`, UTC math); `streakOf(db, boardId, today): Promise<{ streak: number; done_today: number; week: { label: string; count: number }[] }>`; `FEATURES = { repeat: true, archive: true }`; board payload fields `archived_count`, `streak`, `features`; `GET /boards/:slug/archive`.

- [ ] **Step 1: Tests**

`worker/test/archive.test.ts` — seed done tasks directly with SQL (helper inside the file: `seedDone(boardId, columnId, title, doneOn)` inserting into `tasks` with `done_on`), then:
1. board `tasks` includes a task done exactly 30 days ago and excludes one done 31 days ago; `archived_count` = 1; `features` = `{ repeat: true, archive: true }`.
2. `GET /api/boards/:slug/archive` → `data.tasks` newest `done_on` first, `total`, `page: 1`, `per_page: 50`; each task has `column_key` and `files`, no `history`.
3. `?q=` matches title, sender, source, quote and a tag, case-insensitively; `?page=2` with 55 archived rows returns 5.
4. Restore: `PATCH /api/tasks/:id/move` to `todo` → task back on the board with `done_on: null`, `archived_count` decremented.
5. Another user gets 404 on the archive endpoint for a foreign slug.

`worker/test/streak.test.ts` — seed done tasks on: today (2), yesterday (1), 2 days ago (0), 40 days ago (3, archived). Expect `streak.streak === 2`, `done_today === 2`, `week` has 7 entries ending today with counts `[…,0,1,2]`; a board with nothing done → `streak 0`, all zero. Also seed today−1 and today−2 only (nothing today) → streak counts from yesterday (`streak === 2`) — mirroring the client algorithm (a gap only breaks after day 0).

- [ ] **Step 2: Run** → fails.

- [ ] **Step 3: Implement**

`worker/src/hygiene.ts`:
```ts
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
```

`worker/src/queries.ts` `boardPayload(db, board, today)` (add the `today` parameter; callers pass `todayIn(zone(env))`):
- tasks query: `WHERE board_id = ?1 AND (done_on IS NULL OR done_on >= ?2)` with `?2 = archiveCutoff(today)`;
- files query joins the same condition;
- add `SELECT COUNT(*) AS n FROM tasks WHERE board_id = ?1 AND done_on < ?2` for `archived_count`;
- `streak: await streakOf(db, board.id, today)` (a separate call is fine);
- `features: FEATURES`.

`worker/src/routes/boards.ts`:
```ts
boards.get('/boards/:slug/archive', async (c) => {
  const board = ownBoard(c)
  const db = c.env.DB
  const today = todayIn(zone(c.env))
  const cutoff = archiveCutoff(today)
  const q = (c.req.query('q') ?? '').trim().toLowerCase()
  const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1)
  const per = 50
  const like = `%${q.replace(/[%_]/g, (ch) => `\\${ch}`)}%`
  const where = `board_id = ?1 AND done_on < ?2` + (q ? ` AND (LOWER(title) LIKE ?3 ESCAPE '\\' OR LOWER(COALESCE(sender,'')) LIKE ?3 ESCAPE '\\' OR LOWER(source) LIKE ?3 ESCAPE '\\' OR LOWER(COALESCE(quote,'')) LIKE ?3 ESCAPE '\\' OR LOWER(COALESCE(tags,'')) LIKE ?3 ESCAPE '\\')` : '')
  const bind = q ? [board.id, cutoff, like] : [board.id, cutoff]
  const [count, list] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE ${where}`).bind(...bind),
    db.prepare(`SELECT t.*, c.key AS column_key FROM tasks t JOIN board_columns c ON c.id = t.board_column_id WHERE ${where.replace(/board_id/g, 't.board_id').replace(/\bdone_on\b/g, 't.done_on')} ORDER BY t.done_on DESC, t.id DESC LIMIT ${per} OFFSET ${(page - 1) * per}`).bind(...bind),
  ])
  const tasks = list.results as unknown as (TaskRow & { column_key: string })[]
  const ids = tasks.map((t) => t.id)
  const files = ids.length ? await rows<FileRow>(db.prepare(`SELECT * FROM task_files WHERE task_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).bind(...ids)) : []
  const filesOf = new Map<number, FileRow[]>()
  for (const f of files) (filesOf.get(f.task_id) ?? filesOf.set(f.task_id, []).get(f.task_id)!).push(f)
  return c.json({ data: {
    tasks: tasks.map((t) => taskJson(t, { columnKey: t.column_key, files: filesOf.get(t.id) ?? [] })),
    total: (count.results[0] as { n: number }).n, page, per_page: per,
  } })
})
```
(`zone` moves from `routes/tasks.ts` to `src/dates.ts` as `export const zone = (env: { APP_TIMEZONE?: string }) => env.APP_TIMEZONE || 'Asia/Manila'`; `tasks.ts` re-exports or imports it. Column references in the second query must be qualified (`t.`) — write the two WHERE strings explicitly rather than with `replace` if that is clearer.)

- [ ] **Step 4: Run** both files, the suite, typecheck. Commit: `Worker: archive tasks done over 30 days ago; server-side streak; feature flags`.

---

### Task 4: Frontend — repeat editor, card badge, types and API

**Files:**
- Create: `frontend/src/lib/recur.ts`, `frontend/src/components/RepeatEditor.tsx`
- Modify: `frontend/src/types.ts`, `frontend/src/api.ts`, `frontend/src/components/DetailPanel.tsx`, `frontend/src/components/TaskCard.tsx`, `frontend/src/styles/app.css`

- [ ] **Step 1: Types and API**

`types.ts`:
```ts
export type RepeatRule =
  | { freq: 'weekly'; weekday: number }
  | { freq: 'monthly'; day: number }
  | { freq: 'monthly'; nth: 1 | 2 | 3 | 4 | -1; weekday: number }
export type View = 'board' | 'due' | 'log' | 'archive'
// Task: add
  /** Absent on the local Laravel API. */
  repeat?: RepeatRule | null
// Board: add
  archived_count?: number
  streak?: { streak: number; done_today: number; week: { label: string; count: number }[] }
  /** What this backend supports; absent on the local Laravel API. */
  features?: { repeat: boolean; archive: boolean }
export interface ArchivePage { tasks: Task[]; total: number; page: number; per_page: number }
```
`api.ts`: `TaskInput.repeat?: RepeatRule | null`; `archive: (slug: string, q: string, page: number) => request<ArchivePage>(`/boards/${encodeURIComponent(slug)}/archive?q=${encodeURIComponent(q)}&page=${page}`)`.

- [ ] **Step 2: `lib/recur.ts`**

```ts
import type { RepeatRule } from '../types'
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const NTH_OPTIONS: { value: 1 | 2 | 3 | 4 | -1; label: string }[] = [
  { value: 1, label: '1st' }, { value: 2, label: '2nd' }, { value: 3, label: '3rd' }, { value: 4, label: '4th' }, { value: -1, label: 'last' },
]
export function ordinal(n: number): string   // same rule as the server
export function describeRule(rule: RepeatRule): string   // 'every Thursday' | 'every month on the 15th' | 'every 2nd Monday'
export function badgeText(rule: RepeatRule): string      // '↻ Thu' | '↻ 15th' | '↻ 2nd Mon' | '↻ last Fri'
/** Weekday (0–6) and day-of-month of a YYYY-MM-DD, or of today when empty. */
export function dateParts(due: string): { weekday: number; day: number }
```

- [ ] **Step 3: `RepeatEditor.tsx`**

Props `{ value: RepeatRule | null | undefined; due: string; onChange: (rule: RepeatRule | null) => void }`. Renders, using `input mini` selects and the `detail__grid` conventions:
- `<select aria-label="Repeat">` None / Weekly / Monthly. Switching to Weekly emits `{ freq: 'weekly', weekday: dateParts(due).weekday }`; to Monthly emits `{ freq: 'monthly', day: dateParts(due).day }`; None emits `null`.
- Weekly: a weekday `<select>` (Mon…Sun order, values 1…6,0).
- Monthly: two radio rows — `on day [select 1–31]` and `on the [nth select] [weekday select]`; picking a radio emits the corresponding shape with sensible defaults (day = due's day; nth = 1, weekday = due's weekday).
- A muted line under it: `describeRule(value)` when set.
Keep local state minimal: derive everything from `value`; every change calls `onChange` immediately (the panel's `onPatch` saves it).

- [ ] **Step 4: Wire the panel and the card**

`DetailPanel.tsx`: after the *Due* row, when `board.features?.repeat`:
```tsx
<span className="detail__key">Repeat</span>
<RepeatEditor value={task.repeat} due={task.due} onChange={(rule) => onPatch(task.id, { repeat: rule })} />
```
`App.tsx` `normalize()`: `if (body.repeat !== undefined) out.repeat = body.repeat`.

`TaskCard.tsx` top row, after the Urgent pill: `{task.repeat && <span className="tcard__repeat" title={describeRule(task.repeat)}>{badgeText(task.repeat)}</span>}`.

`app.css`: `.tcard__repeat { font-size: 10px; color: var(--color-neutral-500); white-space: nowrap; }`, `.repeat { display: flex; flex-direction: column; gap: var(--space-2); }`, `.repeat__row { display: flex; align-items: center; gap: var(--space-2); font-size: 11.5px; }`, `.repeat__hint { font-size: 10.5px; color: var(--color-neutral-500); }`.

- [ ] **Step 5: Verify** `npm --prefix frontend run lint` (no new warnings), `npm --prefix frontend run build`. Commit: `UI: repeat editor and card badge`.

---

### Task 5: Frontend — lane caps, 7-day Done lane, quick filters, server streak

**Files:**
- Create: `frontend/src/components/FilterBar.tsx`
- Modify: `frontend/src/components/Lane.tsx`, `frontend/src/App.tsx`, `frontend/src/lib/dates.ts`, `frontend/src/styles/app.css`

- [ ] **Step 1: Lane cap and older-done toggle** (`Lane.tsx`)

New props: `limit?: number` (default 10), `olderCount?: number` (Done lane only: tasks hidden by the 7-day rule), `onShowOlder?: () => void`, `showingOlder?: boolean`. State `expanded` (false). Render `tasks.slice(0, expanded ? undefined : limit)` inside the `SortableContext` (the `items` list stays the full `tasks.map(id)` so drag targets stay valid). Footer under the cards:
- when `tasks.length > limit`: a `btn btn-ghost` `lane__more` button: `${tasks.length - limit} more…` / `Show less`.
- when `olderCount > 0`: `Show ${olderCount} older` / `Hide older` calling `onShowOlder`.
CSS: `.lane__more { align-self: center; font-size: 11px; min-height: 24px; }`.

- [ ] **Step 2: Done lane rule in `App.tsx`**

State `const [showOlderDone, setShowOlderDone] = useState(false)`. In the board render, for a column with `is_done`: `recent = shown.filter((t) => !t.done_on || t.done_on >= shiftDay(-6))`; pass `tasks={showOlderDone ? shown : recent}`, `olderCount={shown.length - recent.length}`, `showingOlder={showOlderDone}`, `onShowOlder={() => setShowOlderDone((v) => !v)}`. (`shiftDay` from `lib/dates.ts`.)

- [ ] **Step 3: `FilterBar.tsx` and filtering**

```ts
export interface Filters { urgent: boolean; overdue: boolean; week: boolean; source: string; tag: string }
export const NO_FILTERS: Filters = { urgent: false, overdue: false, week: false, source: '', tag: '' }
export function applyFilters(tasks: Task[], f: Filters): Task[]
  // urgent → priority === 'high'; overdue → due && due < today() && !done_on; week → dueMeta(due)?.tone in ['now','soon'] && !done_on; source/tag → equality (tag in tags)
```
Component props `{ value: Filters; onChange: (f: Filters) => void; sources: string[]; tags: string[] }` rendering `<div className="filterbar">` with three chip buttons (`chip` + `chip--on`, `aria-pressed`) and two `input mini` selects ("All sources" / "All tags"), plus a `Clear` ghost button when any filter is active.

`App.tsx`: state `filters`; `visible = applyFilters(searchFiltered, filters)`; `sources = board.sources.map(s => s.name)`, `tags = unique tags across tasks, sorted`. Render `<FilterBar …/>` between `</header>` and `<div className="main">` when `view === 'board' || view === 'due'`. The header's match counter shows when `query || filtersActive`.
CSS: `.filterbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-5); border-bottom: 1px solid var(--color-neutral-200); }` `.chip--on { background: var(--color-neutral-900); color: var(--color-neutral-0); border-color: transparent; }` — read the existing `.chip` rule and follow its tokens.

- [ ] **Step 4: Server streak**

`App.tsx`: `const streak = useMemo(() => board?.streak ? { streak: board.streak.streak, doneToday: board.streak.done_today, week: board.streak.week } : streakInfo(tasks), [board, tasks])`. Header tally: `{openCount} open · {tasks.length} total{board.archived_count ? ` · ${board.archived_count} archived` : ''}`.

- [ ] **Step 5: Verify** lint (no new warnings — if a `useMemo` dependency warning appears for `board`, depend on `board?.streak` and `tasks`), build. Commit: `UI: lane caps, seven-day Done lane, quick filters, server streak`.

---

### Task 6: Frontend — Archive view

**Files:**
- Create: `frontend/src/components/ArchiveView.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/styles/app.css`

- [ ] **Step 1: `ArchiveView.tsx`**

Props `{ slug: string; columns: Column[]; todoColumnId: number; onRestored: () => void; notify: (text: string, tone?: 'info' | 'error') => void }`. State: `q`, `page`, `rows: Task[]`, `total`, `loading`. Effects: fetch page 1 on mount and when `q` changes (debounced 300 ms); `Load more` fetches `page + 1` and appends. Row (`listview` styling like the Log view): `archrow` with the done date (`done_on`), title, `sender ?? source`, tags, and a `Restore` ghost button → `api.moveTask(id, { column_id: todoColumnId, position: 0 })` → remove from `rows`, `total − 1`, `notify('Restored to To Do')`, `onRestored()` (App re-reads the board). Empty state: `Nothing archived yet — tasks move here 30 days after they are done.`

- [ ] **Step 2: Wire the view**

`App.tsx`: `VIEWS` becomes a function of `board.features?.archive` (append `{ id: 'archive', label: 'Archive' }` when true). Render `view === 'archive' && <ArchiveView slug={slugRef.current} columns={board.columns} todoColumnId={(board.columns.find(c => c.key === 'todo') ?? board.columns[0]).id} onRestored={() => void refreshQuiet()} notify={notify} />`.
CSS: `.archrow { display: grid; grid-template-columns: 84px 1fr auto auto; gap: var(--space-3); align-items: center; padding: var(--space-2) 0; border-bottom: 1px solid var(--color-neutral-200); font-size: 12px; }` `.archrow__when { color: var(--color-neutral-500); font-variant-numeric: tabular-nums; }`.

- [ ] **Step 3: Verify** lint, build. Commit: `UI: Archive view with search and restore`.

---

### Task 7: Docs, verification, merge

- [ ] `docs/cloudflare-setup.md` §5 table: rows `Make a task repeat | open it → Repeat → Weekly (pick the day) or Monthly (a date, or e.g. 2nd Monday); the next copy appears in To Do when you finish it` and `Find old finished tasks | Archive view (tasks done > 30 days ago); Restore sends them back to To Do`. `worker/README.md` *Day to day*: one bullet each for repeat and archive.
- [ ] Full verification: `npm --prefix worker test`, `npm --prefix worker run typecheck`, `npm --prefix frontend run lint`, `npm --prefix frontend run build`, `cd backend && php artisan test`.
- [ ] Local smoke: `npm --prefix worker run dev` → create a task with a weekly rule, drag to Done, see the copy in To Do with the badge; check the filter bar and lane caps; Archive view shows the empty state. Stop the server.
- [ ] Commit docs: `Docs: repeating tasks and the Archive view`. Merge to `main` (fast-forward) and push — the controller does this after the final review.
