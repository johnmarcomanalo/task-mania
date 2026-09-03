# Task Mania

A Kanban board that turns screenshots of messages into tasks. React + TypeScript
front end, Laravel API, MySQL (`task_mania`) in XAMPP.

Built to the **Nocturne** design system from the Claude Design project — the real
`styles.css` is vendored at `frontend/src/styles/nocturne.css` and every value in
`frontend/src/styles/app.css` comes from its tokens. `frontend/DESIGN-SYSTEM.md`
is the system's own guide.

```
task-mania/
  backend/    Laravel 13 REST API + screenshot reading
  frontend/   React 19 + Vite + TypeScript
```

## Running it

Start MySQL from the XAMPP control panel, then two terminals:

```bash
# 1. API  ->  http://127.0.0.1:8000
cd C:\xampp\htdocs\task-mania\backend
php artisan serve

# 2. UI   ->  http://localhost:5173
cd C:\xampp\htdocs\task-mania\frontend
npm run dev
```

Rebuild the database at any time with `php artisan migrate:fresh --seed`.

## Running it on Cloudflare

The same app runs on Cloudflare's free plan — UI, API, database and files —
with Cloudflare Access sign-in and a private board per email. `worker/` holds
that build; [`worker/README.md`](worker/README.md) covers local runs, the
one-time setup and day-to-day operations.

## Screenshots

Press **Add from screenshot**, paste an image with `Ctrl+V`, or drop one anywhere
on the window. The screenshot is stored and the review panel opens so you can type
the task details — title, sender, deadline, priority, column. Add several tasks
from one screenshot with **+ Another task from this screenshot**.

Click the preview to enlarge it — you are reading the message while you type, so
it opens full size over the panel. Escape closes the image and leaves your typing
untouched; a second Escape closes the panel.

Every task made this way keeps its screenshot: shown in the detail panel (also
click-to-enlarge), marked `SHOT` on the card. You can always see where a task
came from.

**No API key, no cost, no network calls.** This is the normal way to work.

### Optional: reading the screenshot automatically

The app can also pre-fill those fields for you. It is off unless you put an
Anthropic API key in `backend/.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

That is billed separately from any Claude subscription, per token, at
[console.anthropic.com](https://console.anthropic.com) — roughly $0.03–0.06 per
screenshot on the default model, most of it output tokens rather than the image.

Turned on, `php artisan scan:check` verifies it: it reads a sample message and
prints what it found, or the exact reason it could not. `SCAN_MAX_EDGE` caps the
size of the copy sent for reading (`1568` default, matching the API's own limit;
lower it for fewer tokens). The stored original always keeps full resolution.

The UI adapts on its own — with no key it says "New task from screenshot" and
never mentions configuration. See
[`ScanController.php`](backend/app/Http/Controllers/Api/ScanController.php) and
[`ScreenshotReader.php`](backend/app/Services/ScreenshotReader.php).

## Data model

| Table | Purpose |
|---|---|
| `boards` | A board, addressed by `slug`. |
| `board_columns` | Inbox, To Do, In Progress, Waiting, For Review, Done. `is_done` marks the completed lane. |
| `tasks` | Title, source, sender, due date, priority, verbatim `quote`, tags, `screenshot_path`, `captured_on`, `done_on`, `position`. |
| `task_files` | Attachments on a task. |
| `activities` | The activity log; rows tied to a task are that task's history. |

Sources: Viber, Email, Messenger, WhatsApp, Teams, SMS, Slack, Manual.
Priorities: high (shown as Urgent), normal, low.

Task `position` is a dense `0..n-1` per column. The move endpoint closes the gap
a task leaves, opens one where it lands, and renumbers both columns inside a
transaction.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/boards` | List boards |
| GET | `/api/boards/{slug}` | Board with columns, tasks, files and activity |
| GET | `/api/boards/{slug}/activity` | Full activity log |
| POST | `/api/boards/{slug}/tasks` | Create a task |
| POST | `/api/boards/{slug}/tasks/bulk` | Create several (a confirmed screenshot review) |
| POST | `/api/boards/{slug}/scan` | Upload a screenshot, get proposed tasks back |
| PATCH | `/api/tasks/{id}` | Update fields |
| PATCH | `/api/tasks/{id}/move` | `{ column_id, position }` |
| DELETE | `/api/tasks/{id}` | Delete a task |
| POST | `/api/tasks/{id}/files` | Attach files |
| DELETE | `/api/task-files/{id}` | Remove an attachment |

Cross-board moves are rejected: `column_id` is validated against the task's own board.

## Front end

- **Three views**: Board, Deadline (open tasks by due date), Log (activity).
- **Drag and drop** via `@dnd-kit`, with in-column reordering. Moves apply
  optimistically and roll back to a pre-drag snapshot if the request fails.
- **Keyboard**: Tab to a card, Space to pick up, arrows to move, Space to drop,
  Escape to cancel; Enter opens the detail panel.
- **Detail panel** edits every field with debounced autosave, shows the source
  screenshot, handles attachments (upload, download, preview) and per-task history.
- **Streak block** counts consecutive days with completed work plus the last
  seven days, from each task's `done_on`.

## One deliberate deviation from the design

The design wraps the screenshot preview in the design system's `.lighten` class
(`mix-blend-mode: lighten`), which Nocturne intends for photographs shot on dark
backgrounds. Message screenshots are the opposite — light backgrounds with dark
text — so that blend erases the text you need to read while reviewing. The three
screenshot surfaces use a plain inset surface instead. Everything else follows
the design.
