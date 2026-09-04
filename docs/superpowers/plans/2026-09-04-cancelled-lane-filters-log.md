# Cancelled Lane, Compact Filters, Detailed Log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A terminal *Cancelled* lane (archived like Done, no streak credit, repeating tasks skip to their next copy), a one-row filter bar, and a Log that names the task and shows old → new values.

**Architecture:** Server: a migration adds `board_columns.is_cancelled` and `tasks.cancelled_on` and backfills the lane; the move/update/create paths treat "terminal" columns uniformly; activity lines get old → new text and a `task_title`. Client: closed-task semantics in one helper, a muted lane, compact filter CSS, and a rebuilt Log view.

**Tech Stack:** Cloudflare Worker (Hono, D1, vitest), React 19 + TS + Vite.

**Spec:** `docs/superpowers/specs/2026-09-04-cancelled-lane-filters-log-design.md`

## Global Constraints

- Branch `cancelled-and-log` from `main`; commit per task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Worker: `npm --prefix worker test [-- test/<file>]`, `npm --prefix worker run typecheck`. Frontend: `npm --prefix frontend run lint` (12 pre-existing warnings; none new), `npm --prefix frontend run build`. No `backend/` changes.
- Activity texts verbatim from the spec table. Dates in lines are `YYYY-MM-DD`; empty sides are `—`; title sides cut to 40 chars + `…`.
- Column key/name: `cancelled` / `Cancelled`, always last; `is_cancelled` and `is_done` are mutually exclusive.
- Existing JSON fields keep their shapes; additions only: column `is_cancelled`, task `cancelled_on`, activity `task_title`.

## File map

| Path | Responsibility |
|---|---|
| `worker/migrations/0004_cancelled.sql` | columns + backfill |
| `worker/src/defaults.ts` | 7th default column |
| `worker/src/auth.ts` | provisioning inserts `is_cancelled` |
| `worker/src/serialize.ts` | `ColumnRow.is_cancelled`, `TaskRow.cancelled_on`, `ActivityRow.task_title`; JSON |
| `worker/src/routes/tasks.ts` | terminal semantics (`closedDates()`), spawn on terminal entry, detailed lines (`changeLines()`) |
| `worker/src/hygiene.ts`, `worker/src/queries.ts`, `worker/src/routes/boards.ts` | archive predicate incl. `cancelled_on`; activity joins |
| `worker/src/db.ts` | `note()` unchanged |
| `worker/test/cancelled.test.ts`, `worker/test/activity.test.ts` | new tests; existing tests updated for the new line texts |
| `frontend/src/types.ts`, `frontend/src/lib/filters.ts` (`isClosed`), `App.tsx`, `Lane.tsx`, `TaskCard.tsx`, `ArchiveView.tsx`, `FilterBar.tsx`, `styles/app.css` | closed semantics, muted cancelled cards, compact filter bar |
| `frontend/src/api.ts` (`activity`), `frontend/src/components/LogView.tsx`, `App.tsx` | the Log view |
| docs | `docs/cloudflare-setup.md` §5, `worker/README.md` |

---

### Task 0: Branch
- [ ] `git checkout -b cancelled-and-log main`

---

### Task 1: Cancelled lane on the server

**Files:** create `worker/migrations/0004_cancelled.sql`, `worker/test/cancelled.test.ts`; modify `worker/src/defaults.ts`, `worker/src/auth.ts`, `worker/src/serialize.ts`, `worker/src/routes/tasks.ts`, `worker/src/hygiene.ts`, `worker/src/queries.ts`, `worker/src/routes/boards.ts`; update `worker/test/auth.test.ts`, `boards.test.ts`, `archive.test.ts`, `recurring.test.ts` where they assert six columns or done-only semantics.

**Interfaces produced:** `ColumnRow.is_cancelled: number`; `TaskRow.cancelled_on: string | null`; `columnJson(...).is_cancelled`; `taskJson(...).cancelled_on`; `closedDates(column, task, today): { done_on, cancelled_on }`; `isTerminal(column)`.

- [ ] **Tests** (`worker/test/cancelled.test.ts`; helpers as in the other files; `todayIn('Asia/Manila')` for today):
  1. A new board has 7 columns; the last is `{ key: 'cancelled', name: 'Cancelled', is_done: false, is_cancelled: true }`; the other six have `is_cancelled: false`.
  2. Create a task in Cancelled → `cancelled_on = today`, `done_on = null`, history `Created in Cancelled`.
  3. Move Inbox → Cancelled: `cancelled_on = today`, `done_on = null`, history[0] `Moved: Inbox → Cancelled`; board `streak.done_today` stays 0; header-relevant: the task is still in `tasks`.
  4. Move Cancelled → Done: `done_on = today`, `cancelled_on = null`; Done → Cancelled the reverse; neither spawns a copy for a repeating task (seed the rule with a PATCH before the first move; assert the board keeps exactly the tasks it had after the first spawn).
  5. A repeating task moved Inbox → Cancelled spawns its copy in To Do (rule moved, `Completed; repeats …` line on the cancelled one).
  6. Status change (`PATCH { column_id: cancelled }`) sets `cancelled_on`; back to To Do clears it.
  7. Archive: seed a task with `cancelled_on` 31 days ago (raw SQL, in the cancelled column) → excluded from board `tasks`, `archived_count = 1`, returned by the archive endpoint with that `cancelled_on`; restore to To Do clears `cancelled_on`. A task cancelled exactly 30 days ago stays.

- [ ] **Implement**
  - Migration as in the spec.
  - `defaults.ts`: add the 7th column (`is_cancelled: true`); type the entries with `is_cancelled: boolean`. `auth.ts` seed insert adds `is_cancelled`.
  - `serialize.ts`: rows + JSON additions.
  - `routes/tasks.ts`:
    ```ts
    export const isTerminal = (c: ColumnRow) => c.is_done === 1 || c.is_cancelled === 1
    /** The two closing dates a task carries in a column: kept when already set, cleared when leaving. */
    export function closedDates(column: ColumnRow, task: Pick<TaskRow, 'done_on' | 'cancelled_on'> | null, today: string) {
      return {
        done_on: column.is_done ? (task?.done_on ?? today) : null,
        cancelled_on: column.is_cancelled ? (task?.cancelled_on ?? today) : null,
      }
    }
    ```
    `insertTask` writes `cancelled_on` (via `closedDates(column, null, today)`); the move batch sets both dates; the update route sets both when the column changes; spawn condition becomes `isTerminal(to) && !isTerminal(from)` in both routes (`from`/`before` are the previous column rows — the move route must read the source column row; `findColumn(db, board.id, task.board_column_id)`).
  - `hygiene.ts`/`queries.ts`/`boards.ts`: archived predicate `((done_on IS NOT NULL AND done_on < ?cutoff) OR (cancelled_on IS NOT NULL AND cancelled_on < ?cutoff))`; board tasks = NOT archived; count = archived; archive order `COALESCE(t.done_on, t.cancelled_on) DESC, t.id DESC`. `streakOf` unchanged.
  - The existing "Moved to X" line becomes `Moved: <from> → <to>` in both routes (spec); update the tests that assert it (`tasks.test.ts`, `tasks-move.test.ts`, `recurring.test.ts`).
- [ ] Run the file, the suite, typecheck. Commit `Worker: a Cancelled lane — terminal, archived, skips a repeat`.

---

### Task 2: Detailed activity lines and task titles

**Files:** modify `worker/src/routes/tasks.ts`, `worker/src/serialize.ts`, `worker/src/queries.ts`, `worker/src/routes/boards.ts`; create `worker/test/activity.test.ts`; update `worker/test/tasks.test.ts` expectations.

- [ ] **Tests** (`worker/test/activity.test.ts`):
  1. PATCH title `Send the quotation` → `Send the revised quotation` → line `Title: "Send the quotation" → "Send the revised quotation"`; a 60-char title is cut to 40 + `…` on that side.
  2. PATCH `{ priority: 'high', due: '2026-09-10', sender: 'Ms. Rivera', source: 'Email', tags: ['client'] }` on a fresh task → lines (newest first): `Tags: — → client`, `Source: Manual → Email`, `Sender: — → Ms. Rivera`, `Due date: — → 2026-09-10`, `Priority: normal → high`.
  3. PATCH `{ due: '' }` afterwards → `Due date: 2026-09-10 → —`; `{ tags: [] }` → `Tags: client → —`.
  4. PATCH `{ repeat: {freq:'weekly', weekday:4} }` → `Repeat: — → every Thursday`; then `{ repeat: null }` → `Repeat: every Thursday → —`.
  5. `{ quote: 'x' }` → `Notes edited`.
  6. `task_title`: board `activity[0].task_title` equals the task's title; `GET …/activity` rows too; task `history` rows too; after `DELETE` the `Deleted: …` line has `task_title: null` and the task's older lines have `task_title: null`.

- [ ] **Implement**
  - `serialize.ts`: `ActivityRow.task_title?: string | null`; `activityJson` adds `task_title: a.task_title ?? null`.
  - `queries.ts` (board activity, task history) and `boards.ts` (activity endpoint): `SELECT a.*, t.title AS task_title FROM activities a LEFT JOIN tasks t ON t.id = a.task_id …`.
  - `routes/tasks.ts`: replace the `LINES` map with `changeLines(before: TaskRow, changes: Fields, columns: { from?: ColumnRow; to?: ColumnRow }): string[]` producing the spec's texts; helpers `side(v)` (`—` for null/empty), `cut40(s)`, `tagsText(json)`, `repeatText(json)` (uses `describe(parseRule(...))`). Order of insertion: `Moved`, `Title`, `Priority`, `Due date`, `Sender`, `Source`, `Tags`, `Repeat`, `Notes edited` (so newest-first reads in reverse, as the tests assert).
  - Update `tasks.test.ts` assertions (`Title edited` → the new text, etc.).
- [ ] Run, suite, typecheck. Commit `Worker: activity lines name the task and show old → new`.

---

### Task 3: Frontend — closed semantics, cancelled lane, compact filter bar

**Files:** modify `frontend/src/types.ts` (`Column.is_cancelled?`, `Task.cancelled_on?`, `Activity.task_title?`), `frontend/src/lib/filters.ts` (`isClosed(t) = !!t.done_on || !!t.cancelled_on`; use it in `overdue`/`week`), `frontend/src/App.tsx` (`openCount` and `dueRows` use `isClosed`; the 7-day rule applies to `is_done || is_cancelled` lanes on `done_on ?? cancelled_on`; pass `closed` to lanes), `Lane.tsx`/`TaskCard.tsx` (`done` prop → `closed: 'done' | 'cancelled' | null`; `tcard__title--done` for both, plus `tcard--cancelled` on the card), `ArchiveView.tsx` (`Cancelled` chip when `cancelled_on`; date `done_on ?? cancelled_on`), `FilterBar.tsx` + `app.css` (compact row).

- [ ] Implement:
  - CSS: `.filterbar { padding: var(--space-1) var(--space-5); gap: var(--space-2); }`, `.filterbar .input.mini { width: auto; max-width: 150px; min-height: 26px; font-size: 11.5px; padding: 0 var(--space-2); }`, `.filterbar__sep { width: 1px; height: 16px; background: var(--color-divider); margin: 0 var(--space-1); }` between the chips and the selects; `.tcard--cancelled { opacity: .6; }`; `.archrow__cancelled { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--color-neutral-500); }`.
  - Selects render with `style={{ width: 'auto' }}` removed if any; first option `All sources` / `All tags`.
- [ ] Lint (12), build. Commit `UI: Cancelled lane, closed-task semantics, one-row filter bar`.

---

### Task 4: Frontend — the Log view

**Files:** modify `frontend/src/api.ts` (`activity: (slug) => request<Activity[]>(`/boards/${slug}/activity`)`), create `frontend/src/components/LogView.tsx`, modify `App.tsx` (render it for `view === 'log'`; props `slug`, `onOpen(taskId)` → `setView('board'); setOpenId(id)`, `notify`), `app.css`.

- [ ] Implement `LogView`: state `rows`, `loading`, `q`; fetch on mount (and when `slug` changes) with a `reqId` guard like `ArchiveView`; filter rows client-side by `q` against `task_title` and `text` (case-insensitive); group by `at.slice(0,10)` in the browser's local date (use `new Date(at)` — `at` is a full ISO timestamp, so local conversion is correct here) with headers `Today` / `Yesterday` / `formatDay(ymd)`; row layout `.logrow` → time (`HH:MM`, `toLocaleTimeString` hour/minute), title button (`btn btn-ghost logrow__task`, only when `task_title`), text. Empty states: `Nothing recorded yet.` / `No log lines match "<q>".`
- [ ] CSS: `.logday { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--color-neutral-500); margin: var(--space-4) 0 var(--space-2); }`, `.logrow { display: grid; grid-template-columns: 48px minmax(0, 220px) 1fr; gap: var(--space-3); align-items: baseline; }`, `.logrow__task { justify-content: flex-start; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`.
- [ ] Lint (12), build. Commit `UI: Log view with task titles, day groups and search`.

---

### Task 5: Docs, verification, merge
- [ ] `docs/cloudflare-setup.md` §5: rows for *Cancel a task* (drag to Cancelled; archived after 30 days; repeating tasks skip to the next copy) and *Read the log* (titles, old → new, search). `worker/README.md` *Day to day*: one bullet for Cancelled.
- [ ] Full verification (worker tests, typecheck, frontend lint/build, Laravel tests). API smoke on `wrangler dev`: move a task to Cancelled, check `cancelled_on`, activity text and the archive predicate.
- [ ] Commit docs. Merge to `main` (controller) and push; after the deploy, verify on the remote D1 that every board has the `cancelled` column and migration `0004` is applied.
