# Cancelled lane, compact filters, detailed log — design

**Date:** 2026-09-04
**Status:** approved in conversation

## Goal

1. A seventh, last column **Cancelled** for tasks that will not happen. It is
   terminal like Done but is not "completed": no streak credit, not open,
   hidden from deadline views, archived after 30 days, restorable.
2. The quick-filter bar is one compact row: chips and two narrow selects.
3. The Log tells you *what* happened to *which* task: task title on every
   line (click to open), old → new values for edits, grouped by day, searchable.

Worker-only, like the previous features; the local Laravel backend is
untouched and the UI tolerates its payloads.

## Decisions

| Question | Decision |
|---|---|
| Column name / key | `Cancelled` / `cancelled`, last position, `is_cancelled = 1`, `is_done = 0` |
| Existing boards | Migration adds the column to every board that lacks it |
| Repeating task cancelled | Treated as "skip this one": the next copy spawns exactly as on completion; the rule moves to the copy |
| Streak | Only `done_on` counts; cancelling never adds to it |
| Archive | `done_on < cutoff OR cancelled_on < cutoff`; the Archive view marks cancelled rows |
| Log detail | Task title on every line; edits show `old → new`; Notes stay `Notes edited` |
| Moved lines | `Moved: <from> → <to>` replaces `Moved to <to>` |

## Data

Migration `worker/migrations/0004_cancelled.sql`:

```sql
ALTER TABLE board_columns ADD COLUMN is_cancelled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN cancelled_on TEXT;
-- Every existing board gets the lane at the end.
INSERT INTO board_columns (board_id, key, name, position, is_done, is_cancelled, created_at, updated_at)
SELECT b.id, 'cancelled', 'Cancelled',
       (SELECT COALESCE(MAX(c.position), -1) + 1 FROM board_columns c WHERE c.board_id = b.id),
       0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM boards b
WHERE NOT EXISTS (SELECT 1 FROM board_columns c WHERE c.board_id = b.id AND c.key = 'cancelled');
```

`DEFAULT_COLUMNS` gains `{ key: 'cancelled', name: 'Cancelled', is_done: false, is_cancelled: true }`
as the seventh entry; provisioning inserts `is_cancelled`.

JSON: column `is_cancelled: boolean`; task `cancelled_on: string | null`;
activity `task_title: string | null` (from a `LEFT JOIN tasks`; null once the
task is deleted).

## Terminal columns

`terminal(column) = is_done || is_cancelled`. On entering a column (create,
move, Status change):

- `done_on = is_done ? (existing ?? today) : null`
- `cancelled_on = is_cancelled ? (existing ?? today) : null`

`spawnNext` runs when a task with a rule enters a terminal column from a
non-terminal one (move or update). Moving between the two terminal columns,
within one, or out of one never spawns.

## Archive and counts

- Archived ⇔ `done_on < cutoff OR cancelled_on < cutoff` (cutoff = today − 30).
- Board `tasks` excludes archived; `archived_count` counts both kinds.
- Archive endpoint orders by `COALESCE(done_on, cancelled_on) DESC, id DESC`;
  the row carries both dates so the UI can label it.
- Streak unchanged.

## Activity lines (server)

Written by the update/move routes, only for fields that changed:

| Change | Line |
|---|---|
| column | `Moved: <from name> → <to name>` |
| title | `Title: "<old>" → "<new>"` (each side cut to 40 chars + `…`) |
| priority | `Priority: <old> → <new>` |
| due_date | `Due date: <old or —> → <new or —>` (dates as `YYYY-MM-DD`) |
| sender | `Sender: <old or —> → <new or —>` |
| source | `Source: <old> → <new>` |
| tags | `Tags: <a, b or —> → <c, d or —>` |
| repeat | `Repeat: <describe or —> → <describe or —>` |
| quote | `Notes edited` |

Unchanged lines: `Created in <col>`, `Captured from … — placed in <col>`,
`Deleted: <title>`, `Attached …`, `Removed attachment …`, `Repeats … — next on …`,
`Completed; repeats … — next copy due …` (also used when a repeating task is cancelled).
Text still cut to 500 chars.

`GET /boards/:slug/activity` (200 rows) and the board's `activity` (80) and
task `history` all carry `task_title`.

## UI

- **Cancelled lane**: last; same 7-day rule as Done (`cancelled_on`); cards
  muted (`tcard--cancelled`: strikethrough title, reduced opacity).
- **Closed tasks** (`done_on || cancelled_on`) are excluded from the header's
  open count, the Deadline view, and the Overdue / This-week filters.
- **Archive view**: a `Cancelled` chip on cancelled rows; date shown is
  `done_on ?? cancelled_on`; Restore unchanged.
- **Filter bar**: one row — `Urgent · Overdue · This week · [Source ▾] · [Tag ▾] · Clear`;
  selects sized to content (max ~150 px), chip-height, wrapping only on narrow
  screens; the bar is visually lighter (less padding).
- **Log view**: fetches `GET …/activity` (200 rows) when opened; a search
  box filters by task title or text (client-side); rows grouped under day
  headers (`Today`, `Yesterday`, then `formatDay`); each row: time (`HH:MM`),
  task title as a button (opens the task on the Board view; plain text when
  `task_title` is null), then the line. Detail-panel history shows the same
  richer lines automatically.

## Laravel

No changes. Missing `is_cancelled`/`cancelled_on`/`task_title` are treated as
false/null/undefined: six lanes, plain log rows, no cancelled semantics.

## Tests (worker)

- Defaults: a new board has 7 columns, the last `cancelled` with `is_cancelled: true`.
- Move into Cancelled: `cancelled_on = today`, `done_on = null`, streak unchanged,
  `Moved: In Progress → Cancelled`; a repeating task spawns its copy; moving
  out clears `cancelled_on`; Cancelled → Done swaps the dates and does not spawn.
- Create in Cancelled sets `cancelled_on`.
- Archive: a task cancelled 31 days ago is archived and counted; the archive
  endpoint returns it with `cancelled_on`; restore clears it.
- Activity detail: each line format above, incl. `—` sides and the 40-char cut;
  `task_title` present on board activity, the activity endpoint and history;
  null after delete.
- Migration backfill: verified against the deployed database after the deploy
  (`SELECT key FROM board_columns WHERE board_id = …`).

## Out of scope

Editing column names, reordering lanes, a manual "cancel" button (drag or the
Status select does it), log pagination beyond 200 rows.
