# Task Mania on Cloudflare — design

**Date:** 2026-09-03
**Status:** approved in conversation, awaiting written review

## Goal

Run Task Mania on Cloudflare's free plan so it is reachable from anywhere,
whether or not the author's PC is on. Anyone with an email address can sign in
and gets a private board of their own.

## Decisions already made

| Question | Decision |
|---|---|
| Must work with the PC off | Yes → backend and database move to Cloudflare |
| Platform | One Worker: React static assets + Hono API + D1 + R2 |
| Login | Cloudflare Access (One-time PIN; Google can be added later in the dashboard) |
| Who can sign in | Anyone, any email (Access policy *Everyone*). Free cap: 50 users/month |
| Users and boards | One user per email; one board per user, created on first sign-in |
| AI screenshot reading | Dropped. The upload-and-type flow stays |
| Existing local data | Not migrated; fresh start |
| Deploys | GitHub → Workers Builds; every push to `main` deploys |
| Local Laravel + XAMPP | Kept working. `backend/` gets one tiny addition (see *Frontend changes*) |

## Architecture

```
task-mania/
  backend/     Laravel — unchanged except a 6-line /api/me route
  frontend/    React — small changes listed below
  worker/      NEW — everything Cloudflare
    wrangler.jsonc
    package.json
    tsconfig.json
    migrations/0001_init.sql
    src/
      index.ts          Hono app; mounts /api, /storage; assets fall through
      env.ts            Bindings type (DB, FILES, vars)
      auth.ts           Access JWT verification, user + board provisioning
      db.ts             typed query helpers, batch helper
      dates.ts          today(tz), now()
      defaults.ts       DEFAULT_COLUMNS, DEFAULT_SOURCES, PRIORITIES
      validate.ts       zod schemas + Laravel-shaped 422 responses
      serialize.ts      board / task / file / activity / source JSON shapes
      routes/
        me.ts  boards.ts  tasks.ts  sources.ts  scan.ts  files.ts  storage.ts
    test/               vitest on the Workers runtime
    README.md           first-time setup and day-to-day operations
```

### Request flow

```
browser ─► https://task-mania.<account>.workers.dev
            │  Cloudflare Access (attached to the Worker; login before code runs)
            ▼
          Worker
            ├─ /api/*      → auth middleware → Hono routes → D1 / R2
            ├─ /storage/*  → auth middleware → R2 object stream
            └─ everything else → static assets (../frontend/dist), SPA fallback
```

`wrangler.jsonc` sets `assets.run_worker_first = ["/api/*", "/storage/*"]` so
those paths always reach the Worker; `not_found_handling =
"single-page-application"` serves `index.html` for any other unknown path.

Same origin for UI and API → no CORS, no `VITE_API_URL` at runtime (the build
bakes in `/api`).

## Auth and users

### Cloudflare Access

- Enabled from the Worker's *Settings → Domains & Routes → Enable Cloudflare
  Access*. Policy: Include **Everyone**; login method One-time PIN.
- Free plan: 50 unique users per month. Beyond that, new sign-ins are refused
  until the plan is upgraded. The policy can be tightened at any time (for
  example `@arvinintl.com` only) without a code change.
- Log out: link to `/cdn-cgi/access/logout` on the app hostname.

### Worker middleware (`auth.ts`) — runs on every `/api/*` and `/storage/*` request

1. Read `Cf-Access-Jwt-Assertion`. Missing → `401 {"message":"Not signed in."}`.
2. Verify with `jose`: `jwtVerify(token, JWKS, { issuer: ACCESS_TEAM_DOMAIN,
   audience: ACCESS_AUD })`, JWKS from
   `${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs` (`createRemoteJWKSet`, cached
   per isolate). Invalid or expired → 401.
3. `email` claim, trimmed and lower-cased, is the identity.
4. Upsert the user:
   `INSERT INTO users (email, created_at, last_seen_at) VALUES (?,?,?)
    ON CONFLICT(email) DO UPDATE SET last_seen_at = excluded.last_seen_at
    RETURNING id, email, name`.
5. Ensure the board: `SELECT id, slug, name FROM boards WHERE user_id = ?`. None →
   one `batch()` inserting the board (`name = 'Task Mania'`, `slug = 'b-' +
   8 random base32 chars`) plus its 6 default columns and 8 default sources.
   `boards.user_id` is UNIQUE, so a concurrent first request fails the insert
   and simply re-selects.
6. `c.set('user', …)`, `c.set('board', …)` for the route handlers.

The check runs even though Access already gates the hostname, so an
accidentally disabled Access toggle leaves the API closed rather than open.

Config: `ACCESS_TEAM_DOMAIN` (`https://<team>.cloudflareaccess.com`) and
`ACCESS_AUD` (the application's AUD tag) as `vars` in `wrangler.jsonc`.

### Local development bypass

`wrangler dev` has no Access in front. When `ACCESS_DEV_EMAIL` is set (only in
the git-ignored `worker/.dev.vars`, never in production vars) and no JWT header
is present, the request is treated as that email. In that mode an `X-Dev-Email`
request header overrides it so tests can act as several users.

### `GET /api/me`

`{ "data": { "email": "…", "name": null, "board_slug": "b-…" } }`

## Database (D1)

Translated from the Laravel migrations. `TEXT` timestamps are ISO-8601 UTC;
dates are `YYYY-MM-DD`. D1 enforces foreign keys by default.

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);

CREATE TABLE boards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE board_columns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  is_done    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (board_id, key)
);
CREATE INDEX board_columns_board_position ON board_columns (board_id, position);

CREATE TABLE sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id    INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name        TEXT NOT NULL COLLATE NOCASE,   -- MySQL's default collation is case-insensitive; keep that
  position    INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (board_id, name)
);
CREATE INDEX sources_board_position ON sources (board_id, position);

CREATE TABLE tasks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id         INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  board_column_id  INTEGER NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  source           TEXT NOT NULL DEFAULT 'Manual' COLLATE NOCASE,
  sender           TEXT,
  due_date         TEXT,
  priority         TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('high','normal','low')),
  quote            TEXT,
  attachments_note TEXT,
  tags             TEXT,               -- JSON array
  screenshot_path  TEXT,               -- R2 key, e.g. screenshots/<uuid>.png
  captured_on      TEXT,
  done_on          TEXT,
  position         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX tasks_column_position ON tasks (board_column_id, position);
CREATE INDEX tasks_board_due       ON tasks (board_id, due_date);
CREATE INDEX tasks_board_done      ON tasks (board_id, done_on);

CREATE TABLE task_files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  mime       TEXT,
  size       INTEGER NOT NULL DEFAULT 0,
  path       TEXT NOT NULL,            -- R2 key, e.g. attachments/<uuid>.xlsx
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE activities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  text       TEXT NOT NULL,            -- trimmed to 500 chars
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX activities_board_created ON activities (board_id, created_at);
CREATE INDEX activities_task_created  ON activities (task_id, created_at);
```

No seed rows. Defaults live in `defaults.ts`, copied from the Laravel models:

- Columns: `inbox` Inbox, `todo` To Do, `doing` In Progress, `wait` Waiting,
  `review` For Review, `done` Done (`is_done`).
- Sources: Viber, Email, Messenger, WhatsApp, Teams, SMS, Slack, Manual.
- Priorities: `high`, `normal`, `low`.

### Ownership scoping

Every lookup goes through the signed-in user:

- board: `WHERE slug = ? AND user_id = ?`
- task / source: joined to `boards.user_id`
- task file: via its task's board
- R2 object: `customMetadata.owner === String(user.id)` (set on upload). This
  also covers a screenshot that was just uploaded and is not yet on any task.

Anything that fails the check is a **404** (`{"message":"Not found."}`), never
403, so ids of other users' rows are not confirmed.

### Transactions

D1 has no interactive transactions; every multi-statement write is one
`DB.batch([...])`, which is atomic. Reads that the write depends on (the task's
current column and position, the target column's `is_done`) happen before the
batch. Single-user boards make the remaining race window irrelevant.

## API

Base path `/api`. Every route below requires the auth middleware. Response
bodies match the Laravel resources field for field so `frontend/src/api.ts`
and `types.ts` do not change.

| Method | Path | Behaviour |
|---|---|---|
| GET | `/me` | Current user and board slug |
| GET | `/boards` | `{data:[{id,name,slug,description}]}` — the user's boards (one) |
| GET | `/boards/:slug` | Board with `sources` (incl. archived), `priorities`, `scan_enabled:false`, `columns`, `tasks` (ordered `position, id`; with `column_key`, `files`; no `history`), `activity` (latest 80) |
| GET | `/boards/:slug/activity` | Latest 200 activities |
| GET | `/boards/:slug/sources` | Sources with `task_count` |
| POST | `/boards/:slug/sources` | Create; `name` unique per board, ≤24 chars → 201 |
| PATCH | `/sources/:id` | Rename (carries the name onto tasks) and/or `is_archived` |
| DELETE | `/sources/:id` | Archive when tasks use it, else delete → `{archived, tasks_using}` |
| POST | `/boards/:slug/tasks` | Create → 201, task with `history` |
| POST | `/boards/:slug/tasks/bulk` | Create 1–20 tasks sharing `source` and `screenshot_path` → 201 |
| POST | `/boards/:slug/scan` | Store the image; reply `manual:true`, no rows |
| PATCH | `/tasks/:id` | Update fields; activity lines per changed field; column change sets `done_on` |
| PATCH | `/tasks/:id/move` | `{column_id, position}`; closes/opens gaps, renumbers both columns |
| DELETE | `/tasks/:id` | Deletes task, its rows and its attachment objects → 204 |
| POST | `/tasks/:id/files` | Multipart `files[]`, ≤10 files, ≤10 MiB each → 201 |
| DELETE | `/task-files/:id` | Removes object and row → 204 |
| GET | `/storage/*` *(no `/api` prefix)* | Streams the R2 object with its content type; `Cache-Control: private, max-age=3600` |

### Task JSON

`id, column_id, column_key, title, source, sender, due ('' when null),
priority, quote (''), attachments (''), tags ([]), shot ('/storage/<key>' or
null), captured, done_on, position, files[], history[] (single-task responses
only, latest first)`.

### Validation

`zod` schemas in `validate.ts` mirror the Laravel rules:

- task: `column_id` int (required on create) and must belong to the board;
  `title` ≤255 (required on create); `source` must be an active source of the
  board; `sender` ≤120; `due` `YYYY-MM-DD` valid date, `''`/null → null;
  `priority` in list; `quote` ≤5000; `attachments` ≤255; `tags` ≤6 × ≤32 chars.
- bulk: `screenshot_path` ≤255 and must start with `screenshots/`; `source`
  active on the board; `tasks` 1–20 rows with the create rules.
- move: `column_id` on the board; `position` int ≥0.
- source: `name` ≤24, unique per board case-insensitively (MySQL's collation
  made Laravel behave that way; `COLLATE NOCASE` keeps it); `is_archived` boolean.
- scan: `image` png/jpeg/gif/webp by content type **and** magic bytes, ≤10 MiB.
- files: 1–10 entries, each ≤10 MiB, any type.

Errors use Laravel's shape, which `ApiError` in the frontend reads:

- `422 { "message": "<first error>", "errors": { "<field>": ["<msg>"] } }`
- `404 { "message": "Not found." }`
- `401 { "message": "Not signed in." }`
- Malformed multipart maps to the 422 shape with a `files` / `image` error.

### Activity lines (verbatim from Laravel)

`Created in <col>`, `Captured from <source> (<sender>) — placed in <col>`,
`Moved to <col>`, `Title edited`, `Priority changed`, `Due date changed`,
`Sender changed`, `Source changed`, `Notes edited`, `Tags changed`,
`Deleted: <title>`, `Attached <n> file(s): <names>`, `Removed attachment <name>`.
Only fields whose value actually changed produce a line.

### Move algorithm (one batch)

```sql
UPDATE tasks SET position = position - 1
  WHERE board_column_id = :from AND position > :oldPos AND id <> :id;
UPDATE tasks SET position = position + 1
  WHERE board_column_id = :to AND position >= :target AND id <> :id;
UPDATE tasks SET board_column_id = :to, position = :target,
                 done_on = :doneOn, updated_at = :now WHERE id = :id;
-- renumber :from, and :to when different
UPDATE tasks SET position = (
  SELECT rn FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) - 1 AS rn
    FROM tasks WHERE board_column_id = :col
  ) r WHERE r.id = tasks.id
) WHERE board_column_id = :col;
INSERT INTO activities ... 'Moved to <col>'   -- only when :to <> :from
```

`doneOn` = target column `is_done` ? (existing `done_on` ?? today) : null —
the same rule as Laravel. The same renumber statement runs after create,
delete and bulk create.

## Files (R2)

- Bucket `task-mania-files`, binding `FILES`.
- Keys keep Laravel's layout: `screenshots/<uuid>.<ext>`,
  `attachments/<uuid>.<ext>`; `<ext>` from the upload's content type, falling
  back to the original filename's extension, lower-cased, letters/digits only.
- `put(key, body, { httpMetadata: { contentType }, customMetadata: { owner, name } })`.
- Task delete removes its attachment objects; the screenshot is left in place
  because several tasks from one bulk create may share it (Laravel behaviour).
- `DELETE /task-files/:id` removes the object then the row.
- URLs in JSON are `/storage/<key>`.

## Dates and time zone

`APP_TIMEZONE` var, default `Asia/Manila`. `today()` formats the current
instant in that zone as `YYYY-MM-DD` via `Intl.DateTimeFormat('en-CA', {
timeZone })`; it feeds `captured_on` and `done_on`. Timestamps (`created_at`,
`updated_at`, activity `at`) are UTC ISO-8601.

## Frontend changes

1. `App.tsx`: `BOARD_SLUG` constant → state loaded from `api.me()` at start,
   before `getBoard`. While loading, the existing loading skeleton shows.
2. Header: when `me.email` is set, show the email and a **Log out** link to
   `/cdn-cgi/access/logout` in `.hdr__actions`, styled with existing Nocturne
   tokens (`btn btn-ghost`, muted text). Hidden when `email` is null (local
   Laravel).
3. `api.ts`:
   - `me: () => request<{ email: string | null; name: string | null; board_slug: string }>('/me')`
   - The "Is the Laravel server running on port 8000?" message → `Cannot reach the API.`
   - A response that is not JSON (Access redirected the fetch to its login
     page after the session expired) → `ApiError(401, 'Your session ended — reload to sign in again.')`.
4. `frontend/.env.example`: note that `/api` is used for the Cloudflare build.
5. `backend/routes/api.php`: `GET /api/me` returning
   `{"data":{"email":null,"name":null,"board_slug":"task-mania"}}` so the local
   Laravel setup keeps working with the new frontend. Nothing else in `backend/` changes.

## Build and deploy

### `worker/wrangler.jsonc`

```jsonc
{
  "name": "task-mania",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "assets": {
    "directory": "../frontend/dist",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/storage/*"]
  },
  "d1_databases": [{ "binding": "DB", "database_name": "task-mania",
                     "database_id": "<from wrangler d1 create>", "migrations_dir": "migrations" }],
  "r2_buckets": [{ "binding": "FILES", "bucket_name": "task-mania-files" }],
  "vars": { "APP_TIMEZONE": "Asia/Manila",
            "ACCESS_TEAM_DOMAIN": "https://<team>.cloudflareaccess.com",
            "ACCESS_AUD": "<aud tag>" },
  "observability": { "enabled": true }
}
```

### `worker/package.json` scripts

| Script | Does |
|---|---|
| `build:ui` | `cross-env VITE_API_URL=/api npm --prefix ../frontend run build` |
| `build` | `npm --prefix ../frontend ci && npm run build:ui` (what Workers Builds runs) |
| `dev` | `npm run build:ui && wrangler dev` → http://localhost:8787 with local D1/R2 |
| `deploy` | `wrangler d1 migrations apply DB --remote && wrangler deploy` |
| `test` | `vitest run` |
| `typecheck` | `tsc --noEmit` |

`cross-env` makes the `VITE_API_URL` override work on Windows too; a process
variable beats `frontend/.env`, so the local `.env` pointing at Laravel cannot
leak into a cloud build.

Dependencies: `hono`, `jose`, `zod`; dev: `wrangler`, `typescript`,
`@cloudflare/workers-types`, `vitest`, `@cloudflare/vitest-pool-workers`, `cross-env`.

### First-time setup (`worker/README.md` walks through it)

1. Push the repo to GitHub (private is fine).
2. `npx wrangler login`, then `npx wrangler d1 create task-mania` and
   `npx wrangler r2 bucket create task-mania-files`; paste the D1 id into
   `wrangler.jsonc`; commit.
3. Cloudflare dashboard → Workers & Pages → *Import a repository* → root
   directory `worker`, build command `npm run build`, deploy command
   `npm run deploy`. First build deploys the Worker.
4. Worker → Settings → Domains & Routes → *Enable Cloudflare Access* → edit the
   policy to Include *Everyone*, login method One-time PIN. Copy the team
   domain and the application's AUD tag into `vars`; commit → redeploys.
5. Open `https://task-mania.<account>.workers.dev`, sign in with any email.

Afterwards every push to `main` builds, applies pending D1 migrations and deploys.

### Repo housekeeping

- `.gitignore`: add `worker/.dev.vars`, `worker/.wrangler/`, `worker/node_modules/`.
- Root `README.md`: a *Deploying to Cloudflare* paragraph pointing at `worker/README.md`.

## Testing

`vitest` with `@cloudflare/vitest-pool-workers`: tests run inside the Workers
runtime against real D1 and R2 emulation, migrations applied in setup, each
test file on a fresh database. Requests go through the whole app (`SELF.fetch`)
with `ACCESS_DEV_EMAIL` set and `X-Dev-Email` to switch users.

Coverage, written test-first:

- **auth**: no JWT and no dev email → 401; invalid signature / wrong `aud` →
  401 (signed with a local key pair, verified through an injected local JWKS);
  first request creates user + board with 6 columns and 8 sources; second
  request reuses them; `/me` shape.
- **isolation**: user B gets 404 on user A's board slug, task id, source id,
  file id and `/storage/<key>`.
- **tasks**: create (position appended, `captured_on` today, `done_on` when the
  column is done, activity line); update (only changed fields log; column
  change updates `done_on`); move (gap closed, gap opened, both columns dense
  0..n-1, `done_on` rules, other board's `column_id` → 422); delete (row gone,
  attachments removed from R2, column renumbered, activity keeps the text with
  `task_id` null); bulk (shared source and screenshot, per-row activity).
- **sources**: create; duplicate name → 422; rename carries tasks; delete with
  tasks archives; delete without tasks removes; archived source rejected on
  tasks; `task_count`.
- **files**: attach stores objects with owner metadata and returns `is_image`;
  >10 files or >10 MiB → 422; detach removes object.
- **scan**: png accepted → `manual:true` reply with `/storage/` url; bad type or
  wrong magic bytes → 422.
- **storage**: owner streams with content type; other user → 404; unknown → 404.
- **dates**: `today('Asia/Manila')` at 23:30 UTC is the next day.

Ports the cases in `backend/tests/Feature/SourceTest.php`.

## Out of scope

Multiple boards per user, AI screenshot reading, migrating local data, custom
domain, profile/name editing, admin screens, sharing boards between users.

## Risks

- Zero Trust onboarding may ask for a payment method even on the free plan.
  Fallback if refused: app-level password login (separate design).
- 50 users/month cap; the *Everyone* policy lets strangers consume seats.
  Mitigation is a one-click policy change to an email domain or list.
- One-time PIN mail can be swallowed by corporate mail filters
  (`notify.cloudflare.com`).
- D1 free write quota (100k rows/day) is far above one person's use; a large
  team would need watching.
