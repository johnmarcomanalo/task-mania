# Recurring tasks and board hygiene — design

**Date:** 2026-09-04
**Status:** approved in conversation

## Goal

1. A task can repeat: weekly on a weekday, monthly on a date, or monthly on the
   Nth weekday. Completing it creates the next occurrence.
2. The board stays readable as tasks pile up: the Done lane shows the last
   seven days, every lane caps its visible cards, quick filters narrow the
   board, and tasks done more than 30 days ago move to an Archive view.

Both are Cloudflare-Worker features. The local Laravel backend is untouched;
the UI hides what a backend does not advertise.

## Decisions

| Question | Decision |
|---|---|
| When is the next occurrence created | When the task enters a done column (drag, or Status change) — "repeat after completion" |
| Where does it land | The `todo` column (fallback: the first non-done column), at the end |
| Next due date | First date matching the rule strictly after `max(due, today)` (today in `APP_TIMEZONE`) |
| Monthly on the 31st in a short month | Clamped to the month's last day |
| Who keeps the rule | The new copy; the completed task's `repeat` is cleared — one live occurrence per rule |
| Archive | Derived, not a flag: done tasks with `done_on` older than 30 days leave the board payload and appear in `GET …/archive` |
| Restore | Moving an archived task with the existing move endpoint (move clears `done_on` when the target is not done) |
| Streak | Computed by the server over all tasks (archived included) in `APP_TIMEZONE`; the UI uses it when present |
| Laravel | No changes; board payload has no `features`, so the UI hides Repeat and Archive and keeps the client-side streak |

## Data

Migration `worker/migrations/0003_recurring.sql`:

```sql
ALTER TABLE tasks ADD COLUMN repeat TEXT;   -- JSON rule or NULL
```

Rule JSON (`worker/src/recur.ts`, mirrored in `frontend/src/types.ts`):

```ts
type RepeatRule =
  | { freq: 'weekly'; weekday: number }                    // 0 = Sunday … 6 = Saturday
  | { freq: 'monthly'; day: number }                       // 1–31
  | { freq: 'monthly'; nth: 1 | 2 | 3 | 4 | -1; weekday: number }  // -1 = last
```

Task JSON gains `repeat: RepeatRule | null`. `TaskInput` accepts `repeat`
(null clears). Validation: `freq` in `weekly|monthly`; `weekday` int 0–6;
`day` int 1–31; `nth` in `1,2,3,4,-1`; exactly the keys of one shape.

## Date math (`recur.ts`)

- `nextDue(rule, after: 'YYYY-MM-DD'): 'YYYY-MM-DD'` — pure calendar math with
  `Date.UTC`, never local time.
  - weekly: the first date after `after` whose weekday matches (1–7 days later).
  - monthly/day: candidate = `min(day, daysInMonth)` in `after`'s month; if not
    after `after`, the same in the next month.
  - monthly/nth: the Nth (or last) weekday of `after`'s month; if not after
    `after`, of the next month.
- `describe(rule)`: `every Thursday`, `every month on the 15th`, `every 2nd Monday`, `every last Friday`.
- `parseRule(text | null)`: JSON parse + shape check; invalid → null.

## Completion → next copy

In `PATCH /tasks/:id/move` (when the target column is done and the source was
not) and in `PATCH /tasks/:id` (when `column_id` changes to a done column):

1. `rule = parseRule(task.repeat)`; nothing to do without one.
2. `base = max(task.due_date ?? today, today)`; `next = nextDue(rule, base)`.
3. Target column: key `todo`, else the first `is_done = 0` column by position.
4. Insert a copy with the same `title, source, sender, priority, quote,
   attachments_note, tags, screenshot_path`, `due_date = next`, `repeat = task.repeat`,
   `captured_on = today`, at the end of the target column; then, in one batch:
   activity on the copy `Repeats <describe> — next on <next>`, renumber the
   target column, `UPDATE tasks SET repeat = NULL` on the completed task, and
   activity on it `Completed; repeats <describe> — next copy due <next>`.
5. The response is unchanged (the moved/updated task). The UI already re-reads
   the board after a move or patch, so the copy appears.

Moving within a done column, or out of one, never spawns.

## Archive

- `ARCHIVE_AFTER_DAYS = 30`. A task is archived when
  `done_on < today − 30 days` (calendar days in `APP_TIMEZONE`).
- `GET /boards/:slug` — `tasks` excludes archived ones; adds
  `archived_count` (number), `streak` (below) and `features: { repeat: true, archive: true }`.
- `GET /boards/:slug/archive?q=&page=1` → `{ data: { tasks: Task[], total, page, per_page: 50 } }`,
  archived tasks newest `done_on` first (then id desc), `q` matches title,
  sender, source, quote or tags (case-insensitive `LIKE`). Task JSON as on the
  board (with `column_key`, `files`, no `history`).
- Restore: `PATCH /tasks/:id/move` to any non-done column; nothing new.
- `GET /boards/:slug/activity` unchanged.

## Streak (server)

`streak: { streak: number, done_today: number, week: [{ label: 'YYYY-MM-DD', count }×7] }`
computed as `frontend/src/lib/dates.ts#streakInfo` does, but on the server
from `SELECT done_on, COUNT(*) … WHERE board_id = ? AND done_on IS NOT NULL
GROUP BY done_on`, with "today" from `APP_TIMEZONE`. The UI prefers it over
the client calculation when present.

## UI

- **Repeat editor** (detail panel, after *Due*, only when `features.repeat`):
  `Repeat` select None / Weekly / Monthly. Weekly → weekday select (default:
  the due date's weekday, else today's). Monthly → radio *on day [1–31]*
  (default: due's day) or *on the [1st|2nd|3rd|4th|last] [weekday]*. Every
  change patches `repeat`.
- **Card badge**: `↻ Thu` / `↻ 15th` / `↻ 2nd Mon` / `↻ last Fri` in the card's
  top row when `task.repeat`.
- **Done lane**: shows tasks with `done_on` within the last 7 days; the rest
  behind a `Show N older` link at the lane's foot (toggle, per session).
- **Lane cap**: at most 10 cards, then `N more…` (toggle). Search and filters
  apply before the cap.
- **Quick filters**: a slim bar under the header on the Board and Deadline
  views: chips **Urgent**, **Overdue**, **This week** (toggles), and selects
  **Source** and **Tag** (options from the board's tasks). All combine with
  the search box (AND). The header's match counter reflects them.
- **Archive view**: a fourth view (`Board · Deadline · Log · Archive`, shown
  only when `features.archive`). Search box, rows: done date, title, source or
  sender, tags, **Restore** button (moves to `todo`, position 0, then re-reads
  the board and the archive). `Load more` pages by 50. Header tally gains
  `· N archived` when `archived_count > 0`.
- **Streak block**: uses `board.streak` when present.

## Validation and errors

Same shapes as everything else: `422 { message, errors }` with `repeat`,
`repeat.weekday`, `repeat.day`, `repeat.nth` keys.

## Tests

Worker (vitest, real D1):
- `recur.test.ts`: weekly wrap across weeks/years; monthly day clamp
  (31 → Feb 28/29, leap year); nth weekday incl. `last` and a 5th-week edge;
  `after` equal to a matching date is skipped (strictly after); `describe` texts;
  `parseRule` rejects garbage.
- `recurring.test.ts`: validation 422s; move into Done spawns a copy in To Do
  with the next due, same fields, rule moved, both activity lines; Status
  change to Done spawns; moving within Done or out of Done does not; a task
  with no due date uses today; a copy completed again spawns the next one.
- `archive.test.ts`: cutoff boundary (30 days exactly stays, 31 goes);
  board `tasks` excludes archived and `archived_count` matches; endpoint
  ordering, search, paging; restore via move clears `done_on` and the task is
  back on the board.
- `streak.test.ts`: server streak equals the client algorithm's result for a
  seeded set including archived tasks; `features` present.

Frontend: `tsc -b`, `oxlint`, `vite build`; a manual checklist for the user.

## Out of scope

Editing a rule's start date, end dates or "every N weeks"; manual archive
button; skipping an occurrence; notifications.
