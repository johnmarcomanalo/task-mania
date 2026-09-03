# Task Mania on Cloudflare — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Task Mania on Cloudflare's free plan — one Worker serving the React UI and a Hono API on D1 + R2, behind Cloudflare Access, with a private board per signed-in email.

**Architecture:** A new `worker/` package holds a Hono app that mirrors the Laravel API route-for-route and field-for-field (so `frontend/src/api.ts` and `types.ts` stay as they are), stores rows in D1 and files in R2, and derives the user from the Access JWT. The React build is served as Worker static assets from the same origin (`/api` relative), so there is no CORS. Workers Builds deploys on every push to `main`.

**Tech Stack:** TypeScript, Hono 4, jose 6, zod 4, Cloudflare Workers (static assets, D1, R2), wrangler 4, vitest 4 + `@cloudflare/vitest-plugin`, React 19 + Vite 8 (existing).

**Spec:** `docs/superpowers/specs/2026-09-03-cloudflare-deployment-design.md`

## Global Constraints

- Node 24 / npm on Windows. Run worker commands from the repo root as `npm --prefix worker run <script>` (or `npm --prefix worker test`). `--prefix` makes npm run the script inside `worker/`.
- Packages (exact floors): `hono ^4.13.5`, `jose ^6.2.10`, `zod ^4.5.4`, `wrangler ^4.128.0`, `vitest ^4.1.11`, `@cloudflare/vitest-plugin ^1.1.3`, `@cloudflare/workers-types ^5.20260903.1`, `cross-env ^10.1.0`, `typescript ~6.0.2`.
- Response JSON must match the Laravel resources field for field (spec *API* section). `frontend/src/types.ts` is the contract; do not edit it.
- Error shapes: `422 {message, errors}`, `404 {message:"Not found."}`, `401 {message:"Not signed in."}`.
- Ownership failures are always 404, never 403.
- Activity line texts are verbatim from the spec (*Activity lines*); `text` is cut to 500 chars.
- Dates: `captured_on`/`done_on` use `todayIn(APP_TIMEZONE)` (default `Asia/Manila`); timestamps are UTC ISO-8601.
- R2 keys: `screenshots/<uuid>.<ext>`, `attachments/<uuid>.<ext>`; every object carries `customMetadata.owner = String(user.id)`.
- `backend/` changes are limited to the `GET /api/me` route. `frontend/src/types.ts` is not modified.
- Commit after every task. Commit messages end with the line
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Work on branch `cloudflare` (Task 0); merge to `main` in the last task.

## File map

| Path | Responsibility |
|---|---|
| `worker/package.json`, `tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts` | Package, compiler, Worker bindings, test runtime |
| `worker/migrations/0001_init.sql` | D1 schema (spec *Database*) |
| `worker/src/env.ts` | `Env` bindings, `AuthUser`, `AuthBoard`, `AppEnv` (Hono generics) |
| `worker/src/dates.ts` | `nowIso()`, `todayIn(tz, at?)`, `isValidDate(s)` |
| `worker/src/defaults.ts` | Default columns, sources, priorities, name limits |
| `worker/src/errors.ts` | `HttpError`, `ValidationError`, `notFound()`, `invalid(field, msg)` |
| `worker/src/validate.ts` | zod schemas + `parse()` → Laravel-shaped 422 |
| `worker/src/db.ts` | `rows()`, `renumber()`, `note()` prepared statements |
| `worker/src/serialize.ts` | Row types and `taskJson`, `fileJson`, `activityJson`, `sourceJson`, `columnJson` |
| `worker/src/queries.ts` | `findColumn`, `findTask`, `findSource`, `activeSourceExists`, `nextPosition`, `taskPayload`, `boardPayload` |
| `worker/src/scope.ts` | `ownBoard(c)` — the `:slug` must be the caller's board |
| `worker/src/auth.ts` | `identify()`, `provision()`, `requireUser()` middleware |
| `worker/src/uploads.ts` | R2 helpers: `extensionFor`, `objectKey`, `sniffImage`, `putObject`, `filesFrom` |
| `worker/src/routes/{me,boards,sources,tasks,files,scan,storage}.ts` | One Hono sub-app per resource |
| `worker/src/app.ts`, `worker/src/index.ts` | `createApp(options)` factory; default export |
| `worker/test/*.test.ts`, `test/helpers.ts`, `test/apply-migrations.ts` | Tests on the Workers runtime |
| `worker/README.md`, `worker/.dev.vars.example` | Setup and operations |
| `frontend/src/api.ts`, `frontend/src/App.tsx`, `frontend/src/styles/app.css`, `frontend/.env.example` | `/me`, board slug from `/me`, header user chip, error copy |
| `backend/routes/api.php` | `GET /api/me` stub for local Laravel |
| `.gitignore`, `README.md` | Worker ignores; pointer to the deploy guide |

---

### Task 0: Branch

**Files:** none

- [ ] **Step 1: Create the working branch**

```bash
git checkout -b cloudflare main
```

Expected: `Switched to a new branch 'cloudflare'`.

---

### Task 1: Worker scaffold, schema, test runtime

**Files:**
- Create: `worker/package.json`, `worker/tsconfig.json`, `worker/wrangler.jsonc`, `worker/vitest.config.ts`
- Create: `worker/migrations/0001_init.sql`
- Create: `worker/src/env.ts`, `worker/src/index.ts`
- Create: `worker/test/apply-migrations.ts`, `worker/test/helpers.ts`, `worker/test/schema.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `Env`, `AuthUser`, `AuthBoard`, `AppEnv` types (below) used by every later task; `test/helpers.ts` exporting `env` (typed `Env`) that every test imports.

- [ ] **Step 1: Write the package and compiler config**

`worker/package.json`:

```json
{
  "name": "task-mania-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "build:ui": "cross-env VITE_API_URL=/api npm --prefix ../frontend run build",
    "build": "npm --prefix ../frontend ci && npm run build:ui",
    "dev": "npm run build:ui && wrangler d1 migrations apply DB --local && wrangler dev",
    "deploy": "wrangler d1 migrations apply DB --remote && wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.13.5",
    "jose": "^6.2.10",
    "zod": "^4.5.4"
  },
  "devDependencies": {
    "@cloudflare/vitest-plugin": "^1.1.3",
    "@cloudflare/workers-types": "^5.20260903.1",
    "cross-env": "^10.1.0",
    "typescript": "~6.0.2",
    "vitest": "^4.1.11",
    "wrangler": "^4.128.0"
  }
}
```

`worker/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-plugin/types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

`worker/wrangler.jsonc` (the D1 id is a placeholder until `wrangler d1 create` in the README):

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "task-mania",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "assets": {
    "directory": "../frontend/dist",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/storage/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "task-mania",
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "migrations"
    }
  ],
  "r2_buckets": [{ "binding": "FILES", "bucket_name": "task-mania-files" }],
  "vars": {
    "APP_TIMEZONE": "Asia/Manila",
    "ACCESS_TEAM_DOMAIN": "https://REPLACE-ME.cloudflareaccess.com",
    "ACCESS_AUD": "REPLACE-ME"
  },
  "observability": { "enabled": true }
}
```

`worker/vitest.config.ts` — bindings are declared directly (not via `wrangler.configPath`) so the test runtime never needs `../frontend/dist` to exist:

```ts
import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'))

  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          compatibilityDate: '2026-09-01',
          d1Databases: ['DB'],
          r2Buckets: ['FILES'],
          bindings: {
            APP_TIMEZONE: 'Asia/Manila',
            ACCESS_TEAM_DOMAIN: 'https://test.cloudflareaccess.com',
            ACCESS_AUD: 'test-aud',
            ACCESS_DEV_EMAIL: 'alice@example.com',
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  }
})
```

- [ ] **Step 2: Write the D1 migration**

`worker/migrations/0001_init.sql`:

```sql
-- Task Mania schema. Timestamps are ISO-8601 UTC text; dates are YYYY-MM-DD.
-- MySQL's default collation is case-insensitive, so source names keep that
-- behaviour here with COLLATE NOCASE.

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
  name        TEXT NOT NULL COLLATE NOCASE,
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
  tags             TEXT,
  screenshot_path  TEXT,
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
  path       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE activities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX activities_board_created ON activities (board_id, created_at);
CREATE INDEX activities_task_created  ON activities (task_id, created_at);
```

- [ ] **Step 3: Write the shared types and a placeholder entry point**

`worker/src/env.ts`:

```ts
/** Bindings and vars declared in wrangler.jsonc (and vitest.config.ts). */
export interface Env {
  DB: D1Database
  FILES: R2Bucket
  APP_TIMEZONE?: string
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  /** Local development only: act as this email when no Access JWT is present. */
  ACCESS_DEV_EMAIL?: string
}

export interface AuthUser {
  id: number
  email: string
  name: string | null
}

export interface AuthBoard {
  id: number
  slug: string
  name: string
  description: string | null
}

/** Hono generics: bindings plus the per-request user and board. */
export type AppEnv = {
  Bindings: Env
  Variables: { user: AuthUser; board: AuthBoard }
}
```

`worker/src/index.ts` (replaced in Task 4):

```ts
export default {
  fetch: () => new Response('Not found.', { status: 404 }),
}
```

- [ ] **Step 4: Write the test bootstrap and the schema test**

`worker/test/apply-migrations.ts`:

```ts
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

// Setup files run outside per-test storage isolation and may run more than
// once; applyD1Migrations only applies what is not applied yet.
const e = env as unknown as { DB: D1Database; TEST_MIGRATIONS: D1Migration[] }
await applyD1Migrations(e.DB, e.TEST_MIGRATIONS)
```

`worker/test/helpers.ts` (grows in Task 4):

```ts
import { env as rawEnv } from 'cloudflare:workers'
import type { Env } from '../src/env'

export const env = rawEnv as unknown as Env
```

`worker/test/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { env } from './helpers'

describe('schema', () => {
  it('creates the seven tables', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%'
        ORDER BY name`,
    ).all<{ name: string }>()

    expect(results.map((r) => r.name)).toEqual([
      'activities', 'board_columns', 'boards', 'sources', 'task_files', 'tasks', 'users',
    ])
  })

  it('enforces foreign keys', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO boards (user_id, name, slug, created_at, updated_at) VALUES (999, 'x', 'x', 't', 't')`,
      ).run(),
    ).rejects.toThrow()
  })

  it('compares source names case-insensitively', async () => {
    const t = '2026-01-01T00:00:00.000Z'
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO users (email, created_at, last_seen_at) VALUES ('a@x.io', ?1, ?1)`).bind(t),
      env.DB.prepare(`INSERT INTO boards (user_id, name, slug, created_at, updated_at) VALUES (1, 'B', 'b-1', ?1, ?1)`).bind(t),
      env.DB.prepare(`INSERT INTO sources (board_id, name, position, created_at, updated_at) VALUES (1, 'Viber', 0, ?1, ?1)`).bind(t),
    ])

    await expect(
      env.DB.prepare(`INSERT INTO sources (board_id, name, position, created_at, updated_at) VALUES (1, 'viber', 1, ?1, ?1)`).bind(t).run(),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 5: Ignore local files**

Append to the root `.gitignore`:

```
# Cloudflare worker: local secrets, wrangler state, dependencies
worker/.dev.vars
worker/.wrangler/
worker/node_modules/
```

- [ ] **Step 6: Install and run the schema test**

```bash
npm --prefix worker install
npm --prefix worker test -- test/schema.test.ts
```

Expected: 3 tests pass. If the plugin reports that it needs a `main` or a wrangler config, add `wrangler: { configPath: './wrangler.jsonc' }` to `cloudflareTest({...})` **and** create an empty `frontend/dist/index.html` locally (it is git-ignored) so the assets directory exists.

- [ ] **Step 7: Typecheck and commit**

```bash
npm --prefix worker run typecheck
git add .gitignore worker
git commit -m "Scaffold the Cloudflare worker: schema, bindings, test runtime

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Dates and defaults

**Files:**
- Create: `worker/src/dates.ts`, `worker/src/defaults.ts`
- Test: `worker/test/dates.test.ts`

**Interfaces:**
- Produces: `nowIso(): string`, `todayIn(tz: string, at?: Date): string`, `isValidDate(s: string): boolean`; `DEFAULT_COLUMNS`, `DEFAULT_SOURCES`, `PRIORITIES`, `Priority`, `SOURCE_MAX_NAME`.

- [ ] **Step 1: Write the failing tests**

`worker/test/dates.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isValidDate, nowIso, todayIn } from '../src/dates'

describe('dates', () => {
  it('formats today in the given time zone', () => {
    // 23:30 UTC is already the next day in Manila (UTC+8).
    expect(todayIn('Asia/Manila', new Date('2026-09-03T23:30:00Z'))).toBe('2026-09-04')
    expect(todayIn('UTC', new Date('2026-09-03T23:30:00Z'))).toBe('2026-09-03')
  })

  it('emits ISO-8601 UTC timestamps', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('accepts real calendar dates only', () => {
    expect(isValidDate('2026-02-28')).toBe(true)
    expect(isValidDate('2026-02-30')).toBe(false)
    expect(isValidDate('2026-9-3')).toBe(false)
    expect(isValidDate('yesterday')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

```bash
npm --prefix worker test -- test/dates.test.ts
```

Expected: FAIL — cannot resolve `../src/dates`.

- [ ] **Step 3: Implement**

`worker/src/dates.ts`:

```ts
export function nowIso(): string {
  return new Date().toISOString()
}

/** Calendar date (YYYY-MM-DD) of an instant in a time zone. en-CA formats that way natively. */
export function todayIn(tz: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/** Strict YYYY-MM-DD that also exists on the calendar. */
export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}
```

`worker/src/defaults.ts` (copied from the Laravel `Board`, `Source` and `Task` models):

```ts
export const DEFAULT_COLUMNS = [
  { key: 'inbox', name: 'Inbox', is_done: false },
  { key: 'todo', name: 'To Do', is_done: false },
  { key: 'doing', name: 'In Progress', is_done: false },
  { key: 'wait', name: 'Waiting', is_done: false },
  { key: 'review', name: 'For Review', is_done: false },
  { key: 'done', name: 'Done', is_done: true },
] as const

export const DEFAULT_SOURCES = [
  'Viber', 'Email', 'Messenger', 'WhatsApp', 'Teams', 'SMS', 'Slack', 'Manual',
] as const

export const PRIORITIES = ['high', 'normal', 'low'] as const
export type Priority = (typeof PRIORITIES)[number]

/** Matches the width of tasks.source, which holds the name verbatim. */
export const SOURCE_MAX_NAME = 24
```

- [ ] **Step 4: Run the tests**

```bash
npm --prefix worker test -- test/dates.test.ts
```

Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add worker/src/dates.ts worker/src/defaults.ts worker/test/dates.test.ts
git commit -m "Worker: time-zone aware dates and board defaults

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Errors and validation

**Files:**
- Create: `worker/src/errors.ts`, `worker/src/validate.ts`
- Test: `worker/test/validate.test.ts`

**Interfaces:**
- Produces: `HttpError(status, message)`, `ValidationError(errors)`, `notFound()`, `invalid(field, message)`; `parse(schema, data)`, `jsonBody(c)`, and the schemas `taskCreateSchema`, `taskUpdateSchema`, `bulkSchema`, `moveSchema`, `sourceCreateSchema`, `sourceUpdateSchema` with their inferred types `TaskCreate`, `TaskUpdate`, `BulkInput`, `MoveInput`, `SourceCreate`, `SourceUpdate`.

- [ ] **Step 1: Write the failing tests**

`worker/test/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/errors'
import {
  bulkSchema, moveSchema, parse, sourceCreateSchema, taskCreateSchema, taskUpdateSchema,
} from '../src/validate'

function errorsOf(fn: () => unknown): Record<string, string[]> {
  try {
    fn()
  } catch (e) {
    if (e instanceof ValidationError) return e.errors
    throw e
  }
  throw new Error('expected a ValidationError')
}

describe('validate', () => {
  it('requires column_id and title on create', () => {
    const errors = errorsOf(() => parse(taskCreateSchema, {}))
    expect(errors.column_id).toEqual(['The column id field is required.'])
    expect(errors.title).toEqual(['The title field is required.'])
  })

  it('uses the first error as the message, Laravel style', () => {
    try {
      parse(taskCreateSchema, { column_id: 1 })
    } catch (e) {
      expect((e as ValidationError).message).toBe('The title field is required.')
    }
  })

  it('normalises an empty due date to null and rejects bad ones', () => {
    expect(parse(taskCreateSchema, { column_id: 1, title: 'x', due: '' }).due).toBeNull()
    expect(parse(taskCreateSchema, { column_id: 1, title: 'x', due: '2026-09-04' }).due).toBe('2026-09-04')
    expect(errorsOf(() => parse(taskCreateSchema, { column_id: 1, title: 'x', due: 'soon' })).due)
      .toEqual(['The due is not a valid date.'])
  })

  it('caps tags at six of 32 characters', () => {
    expect(errorsOf(() => parse(taskUpdateSchema, { tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).tags)
      .toEqual(['The tags may not have more than 6 items.'])
    expect(errorsOf(() => parse(taskUpdateSchema, { tags: ['x'.repeat(33)] }))['tags.0'])
      .toEqual(['The tags.0 may not be greater than 32 characters.'])
  })

  it('rejects an unknown priority', () => {
    expect(errorsOf(() => parse(taskUpdateSchema, { priority: 'urgent' })).priority)
      .toEqual(['The selected priority is invalid.'])
  })

  it('validates bulk rows by index', () => {
    const errors = errorsOf(() =>
      parse(bulkSchema, { screenshot_path: 'attachments/x.png', tasks: [{ column_id: 1, title: '' }] }),
    )
    expect(errors.screenshot_path).toEqual(['The screenshot path is invalid.'])
    expect(errors['tasks.0.title']).toEqual(['The title field is required.'])
    expect(errorsOf(() => parse(bulkSchema, { tasks: [] })).tasks).toEqual(['The tasks field is required.'])
  })

  it('validates move and source inputs', () => {
    expect(errorsOf(() => parse(moveSchema, { column_id: 1, position: -1 })).position)
      .toEqual(['The position must be at least 0.'])
    expect(errorsOf(() => parse(sourceCreateSchema, { name: 'x'.repeat(25) })).name)
      .toEqual(['The name may not be greater than 24 characters.'])
  })

  it('drops keys it does not know', () => {
    const out = parse(taskUpdateSchema, { title: 'ok', board_id: 42 }) as Record<string, unknown>
    expect(out).toEqual({ title: 'ok' })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

```bash
npm --prefix worker test -- test/validate.test.ts
```

Expected: FAIL — cannot resolve `../src/errors`.

- [ ] **Step 3: Implement the error types**

`worker/src/errors.ts`:

```ts
/** An error with an HTTP status; app.onError turns it into {message}. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/** Laravel's 422 shape: the first message is the headline, errors is per field. */
export class ValidationError extends Error {
  constructor(public errors: Record<string, string[]>) {
    super(Object.values(errors)[0]?.[0] ?? 'The given data was invalid.')
    this.name = 'ValidationError'
  }
}

export const notFound = () => new HttpError(404, 'Not found.')

export const invalid = (field: string, message: string) => new ValidationError({ [field]: [message] })
```

- [ ] **Step 4: Implement the schemas**

`worker/src/validate.ts`:

```ts
import type { Context } from 'hono'
import { z, type ZodType } from 'zod'
import { isValidDate } from './dates'
import { PRIORITIES, SOURCE_MAX_NAME } from './defaults'
import { ValidationError } from './errors'

const text = (field: string, max: number) =>
  z.string(`The ${field} must be a string.`).max(max, `The ${field} may not be greater than ${max} characters.`)

const optionalText = (field: string, max: number) => text(field, max).nullable().optional()

const id = (field: string) =>
  z.number(`The ${field} field is required.`).int(`The ${field} must be an integer.`)

const due = z
  .string('The due must be a string.')
  .nullable()
  .optional()
  .refine((v) => !v || isValidDate(v), 'The due is not a valid date.')
  // Absent stays absent (an update must not clear it); '' becomes null.
  .transform((v) => (v === undefined ? undefined : v ? v : null))

const tags = z
  .array(z.string().max(32, 'The tags.* may not be greater than 32 characters.'))
  .max(6, 'The tags may not have more than 6 items.')
  .optional()

const priority = z.enum(PRIORITIES, 'The selected priority is invalid.').optional()

/** Rules shared by create, update and bulk rows — Laravel's TaskController::rules(). */
const taskFields = {
  source: text('source', SOURCE_MAX_NAME).optional(),
  sender: optionalText('sender', 120),
  due,
  priority,
  quote: optionalText('quote', 5000),
  attachments: optionalText('attachments', 255),
  tags,
}

// A missing title is "required", not "must be a string" — the type error carries that message.
const requiredTitle = z
  .string('The title field is required.')
  .min(1, 'The title field is required.')
  .max(255, 'The title may not be greater than 255 characters.')

export const taskCreateSchema = z.object({
  column_id: id('column id'),
  title: requiredTitle,
  ...taskFields,
})

export const taskUpdateSchema = z.object({
  column_id: id('column id').optional(),
  title: requiredTitle.optional(),
  ...taskFields,
})

const bulkRow = z.object({
  column_id: id('column id'),
  title: requiredTitle,
  sender: taskFields.sender,
  due,
  priority,
  quote: taskFields.quote,
  attachments: taskFields.attachments,
  tags,
})

export const bulkSchema = z.object({
  screenshot_path: z
    .string('The screenshot path must be a string.')
    .max(255, 'The screenshot path may not be greater than 255 characters.')
    .regex(/^screenshots\//, 'The screenshot path is invalid.')
    .nullable()
    .optional(),
  source: taskFields.source,
  tasks: z
    .array(bulkRow, 'The tasks field is required.')
    .min(1, 'The tasks field is required.')
    .max(20, 'The tasks may not have more than 20 items.'),
})

export const moveSchema = z.object({
  column_id: id('column id'),
  position: z
    .number('The position field is required.')
    .int('The position must be an integer.')
    .min(0, 'The position must be at least 0.'),
})

const sourceName = z
  .string('The name field is required.')
  .min(1, 'The name field is required.')
  .max(SOURCE_MAX_NAME, `The name may not be greater than ${SOURCE_MAX_NAME} characters.`)

export const sourceCreateSchema = z.object({ name: sourceName })

export const sourceUpdateSchema = z.object({
  name: sourceName.optional(),
  is_archived: z.boolean('The is archived field must be true or false.').optional(),
})

export type TaskCreate = z.infer<typeof taskCreateSchema>
export type TaskUpdate = z.infer<typeof taskUpdateSchema>
export type BulkInput = z.infer<typeof bulkSchema>
export type MoveInput = z.infer<typeof moveSchema>
export type SourceCreate = z.infer<typeof sourceCreateSchema>
export type SourceUpdate = z.infer<typeof sourceUpdateSchema>

/** Parse or throw a ValidationError keyed the way Laravel keys nested fields (tasks.0.title). */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (result.success) return result.data

  const errors: Record<string, string[]> = {}
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.map(String).join('.') : '_'
    const message = issue.message.replace('tags.*', key)
    ;(errors[key] ??= []).push(message)
  }
  throw new ValidationError(errors)
}

/** The JSON body, or a 422 when it is not JSON. */
export async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    throw new ValidationError({ _: ['The request body must be JSON.'] })
  }
}
```

- [ ] **Step 5: Run the tests**

```bash
npm --prefix worker test -- test/validate.test.ts
```

Expected: 8 pass. If zod reports a different default message for a missing `column_id` (a type mismatch), the string passed to `z.number('…')` is the one that must surface — check it is the first argument, not an options object.

- [ ] **Step 6: Commit**

```bash
git add worker/src/errors.ts worker/src/validate.ts worker/test/validate.test.ts
git commit -m "Worker: Laravel-shaped validation errors

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Access auth, provisioning, `/api/me`

**Files:**
- Create: `worker/src/auth.ts`, `worker/src/app.ts`, `worker/src/routes/me.ts`
- Modify: `worker/src/index.ts`, `worker/test/helpers.ts`
- Test: `worker/test/auth.test.ts`

**Interfaces:**
- Consumes: `Env`, `AppEnv`, `AuthUser`, `AuthBoard` (Task 1); `nowIso` (Task 2); `DEFAULT_COLUMNS`, `DEFAULT_SOURCES` (Task 2); `HttpError`, `ValidationError` (Task 3).
- Produces: `identify(req, env, keys?)`, `provision(db, email)`, `requireUser(options)`; `createApp(options?: { keys?: JWTVerifyGetKey })`; test helpers `app`, `call(path, init?, who?, env?)`, `json(res)`, `get/post/patch/del`, `meOf(who)`.

- [ ] **Step 1: Extend the test helpers**

Replace `worker/test/helpers.ts`:

```ts
import { env as rawEnv } from 'cloudflare:workers'
import { createApp } from '../src/app'
import type { Env } from '../src/env'

export const env = rawEnv as unknown as Env
export const app = createApp()

export const ALICE = 'alice@example.com'
export const BOB = 'bob@example.com'

/** Call the app as `who` through the dev bypass (ACCESS_DEV_EMAIL is set in vitest.config.ts). */
export function call(path: string, init: RequestInit = {}, who = ALICE, e: Env = env) {
  const headers = new Headers(init.headers)
  headers.set('X-Dev-Email', who)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return app.request(path, { ...init, headers }, e)
}

export const get = (path: string, who?: string) => call(path, {}, who)
export const post = (path: string, body: unknown, who?: string) =>
  call(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) }, who)
export const patch = (path: string, body: unknown, who?: string) =>
  call(path, { method: 'PATCH', body: JSON.stringify(body) }, who)
export const del = (path: string, who?: string) => call(path, { method: 'DELETE' }, who)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const json = async <T = any>(res: Response): Promise<T> => (await res.json()) as T

export async function meOf(who = ALICE): Promise<{ email: string; name: string | null; board_slug: string }> {
  return (await json(await get('/api/me', who))).data
}
```

- [ ] **Step 2: Write the failing tests**

`worker/test/auth.test.ts`:

```ts
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { Env } from '../src/env'
import { ALICE, BOB, env, get, json, meOf } from './helpers'

describe('dev bypass', () => {
  it('signs the caller in as the dev email and gives them a board', async () => {
    const me = await meOf(ALICE)
    expect(me.email).toBe(ALICE)
    expect(me.name).toBeNull()
    expect(me.board_slug).toMatch(/^b-[a-z2-7]{8}$/)
  })

  it('creates the default columns and sources once', async () => {
    const first = await meOf(ALICE)
    const second = await meOf(ALICE)
    expect(second.board_slug).toBe(first.board_slug)

    const cols = await env.DB.prepare(
      `SELECT c.key, c.is_done FROM board_columns c JOIN boards b ON b.id = c.board_id
        WHERE b.slug = ?1 ORDER BY c.position`,
    ).bind(first.board_slug).all<{ key: string; is_done: number }>()
    expect(cols.results.map((c) => c.key)).toEqual(['inbox', 'todo', 'doing', 'wait', 'review', 'done'])
    expect(cols.results.map((c) => c.is_done)).toEqual([0, 0, 0, 0, 0, 1])

    const sources = await env.DB.prepare(
      `SELECT s.name FROM sources s JOIN boards b ON b.id = s.board_id WHERE b.slug = ?1 ORDER BY s.position`,
    ).bind(first.board_slug).all<{ name: string }>()
    expect(sources.results.map((s) => s.name)).toEqual([
      'Viber', 'Email', 'Messenger', 'WhatsApp', 'Teams', 'SMS', 'Slack', 'Manual',
    ])
  })

  it('gives different people different boards', async () => {
    expect((await meOf(ALICE)).board_slug).not.toBe((await meOf(BOB)).board_slug)
  })

  it('lower-cases and trims the email', async () => {
    expect((await meOf('  Carol@Example.COM ')).email).toBe('carol@example.com')
  })

  it('refuses when there is neither a token nor a dev email', async () => {
    const res = await createApp().request('/api/me', {}, { ...env, ACCESS_DEV_EMAIL: undefined })
    expect(res.status).toBe(401)
    expect(await json(res)).toEqual({ message: 'Not signed in.' })
  })
})

describe('Access JWT', () => {
  let privateKey: CryptoKey
  let app: ReturnType<typeof createApp>
  const strict: Env = { ...env, ACCESS_DEV_EMAIL: undefined }

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256')
    privateKey = pair.privateKey
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
    app = createApp({ keys: createLocalJWKSet({ keys: [jwk] }) })
  })

  const token = (claims: Record<string, unknown>, issuer = env.ACCESS_TEAM_DOMAIN!, audience = env.ACCESS_AUD!, exp = '1h') =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(privateKey)

  const withToken = async (t: string) =>
    app.request('/api/me', { headers: { 'Cf-Access-Jwt-Assertion': t } }, strict)

  it('accepts a token signed for this application', async () => {
    const res = await withToken(await token({ email: 'Dana@Example.com' }))
    expect(res.status).toBe(200)
    expect((await json(res)).data.email).toBe('dana@example.com')
  })

  it('rejects the wrong audience', async () => {
    const res = await withToken(await token({ email: 'dana@example.com' }, undefined, 'other-app'))
    expect(res.status).toBe(401)
  })

  it('rejects the wrong issuer', async () => {
    const res = await withToken(await token({ email: 'dana@example.com' }, 'https://other.cloudflareaccess.com'))
    expect(res.status).toBe(401)
  })

  it('rejects an expired token', async () => {
    const res = await withToken(await token({ email: 'dana@example.com' }, undefined, undefined, '-1s'))
    expect(res.status).toBe(401)
  })

  it('rejects a token without an email', async () => {
    const res = await withToken(await token({ sub: 'x' }))
    expect(res.status).toBe(401)
  })

  it('rejects a token signed by another key', async () => {
    const other = await generateKeyPair('RS256')
    const forged = await new SignJWT({ email: 'eve@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(env.ACCESS_TEAM_DOMAIN!)
      .setAudience(env.ACCESS_AUD!)
      .setExpirationTime('1h')
      .sign(other.privateKey)
    expect((await withToken(forged)).status).toBe(401)
  })

  it('ignores the dev header when a token is present', async () => {
    const res = await app.request(
      '/api/me',
      { headers: { 'Cf-Access-Jwt-Assertion': await token({ email: 'dana@example.com' }), 'X-Dev-Email': BOB } },
      env,
    )
    expect((await json(res)).data.email).toBe('dana@example.com')
  })
})

describe('routing', () => {
  it('answers unknown API paths with JSON 404', async () => {
    const res = await get('/api/nothing')
    expect(res.status).toBe(404)
    expect(await json(res)).toEqual({ message: 'Not found.' })
  })
})
```

- [ ] **Step 3: Run it to see it fail**

```bash
npm --prefix worker test -- test/auth.test.ts
```

Expected: FAIL — cannot resolve `../src/app`.

- [ ] **Step 4: Implement auth**

`worker/src/auth.ts`:

```ts
import type { MiddlewareHandler } from 'hono'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { nowIso } from './dates'
import { DEFAULT_COLUMNS, DEFAULT_SOURCES } from './defaults'
import type { AppEnv, AuthBoard, AuthUser, Env } from './env'
import { HttpError } from './errors'

export interface AuthOptions {
  /** Key resolver for the Access JWT; tests inject a local key set. */
  keys?: JWTVerifyGetKey
}

const remoteKeys = new Map<string, JWTVerifyGetKey>()

function keysFor(teamDomain: string): JWTVerifyGetKey {
  let keys = remoteKeys.get(teamDomain)
  if (!keys) {
    keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', teamDomain))
    remoteKeys.set(teamDomain, keys)
  }
  return keys
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.includes('@') ? email : null
}

/**
 * Who is calling. A Cf-Access-Jwt-Assertion header is verified against the
 * team's keys; without one, the local dev bypass applies when ACCESS_DEV_EMAIL
 * is set (X-Dev-Email may override it so tests can be several people). Null
 * means nobody we trust.
 */
export async function identify(req: Request, env: Env, keys?: JWTVerifyGetKey): Promise<string | null> {
  const token = req.headers.get('Cf-Access-Jwt-Assertion')

  if (token) {
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null
    try {
      const { payload } = await jwtVerify(token, keys ?? keysFor(env.ACCESS_TEAM_DOMAIN), {
        issuer: env.ACCESS_TEAM_DOMAIN,
        audience: env.ACCESS_AUD,
      })
      return normalizeEmail(payload.email)
    } catch {
      return null
    }
  }

  if (env.ACCESS_DEV_EMAIL) {
    return normalizeEmail(req.headers.get('X-Dev-Email') ?? env.ACCESS_DEV_EMAIL)
  }

  return null
}

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

export function newSlug(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return 'b-' + Array.from(bytes, (b) => SLUG_ALPHABET[b % 32]).join('')
}

async function findBoard(db: D1Database, userId: number): Promise<AuthBoard | null> {
  return db
    .prepare(`SELECT id, slug, name, description FROM boards WHERE user_id = ?1`)
    .bind(userId)
    .first<AuthBoard>()
}

/** The board plus its default columns and sources, as one atomic batch. */
function seedStatements(db: D1Database, userId: number, at: string): D1PreparedStatement[] {
  const board = `(SELECT id FROM boards WHERE user_id = ?1)`
  return [
    db
      .prepare(
        `INSERT INTO boards (user_id, name, slug, description, created_at, updated_at)
         VALUES (?1, 'Task Mania', ?2, NULL, ?3, ?3)`,
      )
      .bind(userId, newSlug(), at),
    ...DEFAULT_COLUMNS.map((c, i) =>
      db
        .prepare(
          `INSERT INTO board_columns (board_id, key, name, position, is_done, created_at, updated_at)
           VALUES (${board}, ?2, ?3, ?4, ?5, ?6, ?6)`,
        )
        .bind(userId, c.key, c.name, i, c.is_done ? 1 : 0, at),
    ),
    ...DEFAULT_SOURCES.map((name, i) =>
      db
        .prepare(
          `INSERT INTO sources (board_id, name, position, is_archived, created_at, updated_at)
           VALUES (${board}, ?2, ?3, 0, ?4, ?4)`,
        )
        .bind(userId, name, i, at),
    ),
  ]
}

/** Upsert the user by email and make sure they own a board. */
export async function provision(db: D1Database, email: string): Promise<{ user: AuthUser; board: AuthBoard }> {
  const at = nowIso()

  const user = await db
    .prepare(
      `INSERT INTO users (email, created_at, last_seen_at) VALUES (?1, ?2, ?2)
       ON CONFLICT(email) DO UPDATE SET last_seen_at = excluded.last_seen_at
       RETURNING id, email, name`,
    )
    .bind(email, at)
    .first<AuthUser>()
  if (!user) throw new HttpError(500, 'Could not sign in.')

  let board = await findBoard(db, user.id)
  if (!board) {
    try {
      await db.batch(seedStatements(db, user.id, at))
    } catch {
      // A concurrent first request already created it: boards.user_id is UNIQUE.
    }
    board = await findBoard(db, user.id)
    if (!board) throw new HttpError(500, 'Could not create the board.')
  }

  return { user, board }
}

export function requireUser(options: AuthOptions = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const email = await identify(c.req.raw, c.env, options.keys)
    if (!email) throw new HttpError(401, 'Not signed in.')

    const { user, board } = await provision(c.env.DB, email)
    c.set('user', user)
    c.set('board', board)
    await next()
  }
}
```

- [ ] **Step 5: Implement the app factory and `/me`**

`worker/src/routes/me.ts`:

```ts
import { Hono } from 'hono'
import type { AppEnv } from '../env'

export const me = new Hono<AppEnv>()

me.get('/me', (c) => {
  const user = c.get('user')
  return c.json({ data: { email: user.email, name: user.name, board_slug: c.get('board').slug } })
})
```

`worker/src/app.ts` (route imports for later tasks are added as those tasks land):

```ts
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { requireUser, type AuthOptions } from './auth'
import type { AppEnv } from './env'
import { HttpError, ValidationError } from './errors'
import { me } from './routes/me'

export function createApp(options: AuthOptions = {}) {
  const app = new Hono<AppEnv>()

  app.onError((err, c) => {
    if (err instanceof ValidationError) return c.json({ message: err.message, errors: err.errors }, 422)
    if (err instanceof HttpError) return c.json({ message: err.message }, err.status as ContentfulStatusCode)
    console.error(err)
    return c.json({ message: 'Server error.' }, 500)
  })

  app.notFound((c) => c.json({ message: 'Not found.' }, 404))

  const guard = requireUser(options)
  app.use('/api/*', guard)
  app.use('/storage/*', guard)

  app.route('/api', me)

  return app
}
```

`worker/src/index.ts`:

```ts
import { createApp } from './app'

export default createApp()
```

- [ ] **Step 6: Run the tests**

```bash
npm --prefix worker test -- test/auth.test.ts
```

Expected: 13 pass. RSA key generation makes the JWT block take a few seconds.

- [ ] **Step 7: Typecheck and commit**

```bash
npm --prefix worker run typecheck
git add worker/src worker/test
git commit -m "Worker: Access JWT auth with per-user boards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Serializers, queries, board routes

**Files:**
- Create: `worker/src/serialize.ts`, `worker/src/db.ts`, `worker/src/queries.ts`, `worker/src/scope.ts`, `worker/src/routes/boards.ts`
- Modify: `worker/src/app.ts`, `worker/test/helpers.ts`
- Test: `worker/test/boards.test.ts`

**Interfaces:**
- Consumes: `AppEnv`, `AuthBoard` (Task 1); `nowIso` (Task 2); `notFound` (Task 3); `createApp` (Task 4).
- Produces: row types `ColumnRow`, `SourceRow`, `TaskRow`, `FileRow`, `ActivityRow`; `columnJson`, `sourceJson(row, taskCount?)`, `fileJson`, `activityJson`, `taskJson(row, { columnKey, files, history? })`, `storageUrl(key)`; `rows(stmt)`, `renumber(db, columnId)`, `note(db, boardId, text, taskId?)`; `findColumn`, `findTask`, `findSource`, `activeSourceExists`, `nextPosition`, `taskPayload(db, boardId, taskId, withHistory)`, `boardPayload(db, board)`; `ownBoard(c)`; test helpers `boardOf(who)`, `columnOf(board, key)`.

- [ ] **Step 1: Add test helpers**

Append to `worker/test/helpers.ts`:

```ts
export interface BoardJson {
  id: number
  name: string
  slug: string
  description: string | null
  sources: { id: number; name: string; position: number; is_archived: boolean }[]
  priorities: string[]
  scan_enabled: boolean
  columns: { id: number; key: string; name: string; position: number; is_done: boolean }[]
  tasks: Record<string, unknown>[]
  activity: { id: number; task_id: number | null; text: string; at: string }[]
}

export async function boardOf(who = ALICE): Promise<BoardJson> {
  const me = await meOf(who)
  return (await json(await get(`/api/boards/${me.board_slug}`, who))).data
}

export function columnOf(board: BoardJson, key: string): number {
  const column = board.columns.find((c) => c.key === key)
  if (!column) throw new Error(`no column ${key}`)
  return column.id
}
```

- [ ] **Step 2: Write the failing tests**

`worker/test/boards.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ALICE, BOB, boardOf, get, json, meOf } from './helpers'

describe('boards', () => {
  it('lists the caller\'s board', async () => {
    const me = await meOf(ALICE)
    const res = await get('/api/boards')
    expect(res.status).toBe(200)
    const { data } = await json(res)
    expect(data).toHaveLength(1)
    expect(data[0]).toEqual({ id: expect.any(Number), name: 'Task Mania', slug: me.board_slug, description: null })
  })

  it('serves the board in the shape the UI expects', async () => {
    const board = await boardOf(ALICE)
    expect(board.name).toBe('Task Mania')
    expect(board.priorities).toEqual(['high', 'normal', 'low'])
    expect(board.scan_enabled).toBe(false)
    expect(board.columns.map((c) => c.key)).toEqual(['inbox', 'todo', 'doing', 'wait', 'review', 'done'])
    expect(board.columns[5]).toMatchObject({ name: 'Done', position: 5, is_done: true })
    expect(board.sources.map((s) => s.name)).toEqual([
      'Viber', 'Email', 'Messenger', 'WhatsApp', 'Teams', 'SMS', 'Slack', 'Manual',
    ])
    expect(board.sources[0]).toEqual({ id: expect.any(Number), name: 'Viber', position: 0, is_archived: false })
    expect(board.tasks).toEqual([])
    expect(board.activity).toEqual([])
  })

  it('hides other people\'s boards behind a 404', async () => {
    const alice = await meOf(ALICE)
    const res = await get(`/api/boards/${alice.board_slug}`, BOB)
    expect(res.status).toBe(404)
    expect(await json(res)).toEqual({ message: 'Not found.' })
    expect((await get(`/api/boards/${alice.board_slug}/activity`, BOB)).status).toBe(404)
  })

  it('serves the activity log', async () => {
    const me = await meOf(ALICE)
    const res = await get(`/api/boards/${me.board_slug}/activity`)
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ data: [] })
  })
})
```

- [ ] **Step 3: Run it to see it fail**

```bash
npm --prefix worker test -- test/boards.test.ts
```

Expected: FAIL — `/api/boards` returns 404.

- [ ] **Step 4: Implement serializers and statement helpers**

`worker/src/serialize.ts` — the shapes of `BoardResource`, `TaskResource`, `TaskFileResource`, `ActivityResource`, `SourceResource`:

```ts
export interface ColumnRow {
  id: number; board_id: number; key: string; name: string; position: number; is_done: number
  created_at: string; updated_at: string
}
export interface SourceRow {
  id: number; board_id: number; name: string; position: number; is_archived: number
  created_at: string; updated_at: string
}
export interface TaskRow {
  id: number; board_id: number; board_column_id: number; title: string; source: string
  sender: string | null; due_date: string | null; priority: 'high' | 'normal' | 'low'
  quote: string | null; attachments_note: string | null; tags: string | null
  screenshot_path: string | null; captured_on: string | null; done_on: string | null
  position: number; created_at: string; updated_at: string
}
export interface FileRow {
  id: number; task_id: number; name: string; mime: string | null; size: number; path: string
  created_at: string; updated_at: string
}
export interface ActivityRow {
  id: number; board_id: number; task_id: number | null; text: string
  created_at: string; updated_at: string
}

export const storageUrl = (key: string) => `/storage/${key}`

export function columnJson(c: ColumnRow) {
  return { id: c.id, key: c.key, name: c.name, position: c.position, is_done: c.is_done === 1 }
}

/** task_count rides along only from the sources endpoint, which counts them. */
export function sourceJson(s: SourceRow, taskCount?: number) {
  const out: Record<string, unknown> = {
    id: s.id, name: s.name, position: s.position, is_archived: s.is_archived === 1,
  }
  if (taskCount !== undefined) out.task_count = taskCount
  return out
}

export function fileJson(f: FileRow) {
  return {
    id: f.id, name: f.name, mime: f.mime, size: f.size,
    url: storageUrl(f.path), is_image: (f.mime ?? '').startsWith('image/'),
  }
}

export function activityJson(a: ActivityRow) {
  return { id: a.id, task_id: a.task_id, text: a.text, at: a.created_at }
}

export function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.map(String) : []
  } catch {
    return []
  }
}

export function taskJson(t: TaskRow, extra: { columnKey: string; files: FileRow[]; history?: ActivityRow[] }) {
  return {
    id: t.id,
    column_id: t.board_column_id,
    column_key: extra.columnKey,
    title: t.title,
    source: t.source,
    sender: t.sender,
    due: t.due_date ?? '',
    priority: t.priority,
    quote: t.quote ?? '',
    attachments: t.attachments_note ?? '',
    tags: parseTags(t.tags),
    shot: t.screenshot_path ? storageUrl(t.screenshot_path) : null,
    captured: t.captured_on,
    done_on: t.done_on,
    position: t.position,
    files: extra.files.map(fileJson),
    // Present on single-task replies only, like Laravel's whenLoaded('activities').
    ...(extra.history ? { history: extra.history.map(activityJson) } : {}),
  }
}
```

`worker/src/db.ts`:

```ts
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
```

- [ ] **Step 5: Implement queries and the board scope**

`worker/src/queries.ts`:

```ts
import { PRIORITIES } from './defaults'
import type { AuthBoard } from './env'
import { notFound } from './errors'
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

/** BoardResource with columns, sources, tasks (+files) and the latest 80 activities. */
export async function boardPayload(db: D1Database, board: AuthBoard) {
  const [cols, srcs, tsks, fls, acts] = await db.batch([
    db.prepare(`SELECT * FROM board_columns WHERE board_id = ?1 ORDER BY position, id`).bind(board.id),
    db.prepare(`SELECT * FROM sources WHERE board_id = ?1 ORDER BY position, id`).bind(board.id),
    db.prepare(`SELECT * FROM tasks WHERE board_id = ?1 ORDER BY position, id`).bind(board.id),
    db
      .prepare(`SELECT f.* FROM task_files f JOIN tasks t ON t.id = f.task_id WHERE t.board_id = ?1 ORDER BY f.id`)
      .bind(board.id),
    db
      .prepare(`SELECT * FROM activities WHERE board_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 80`)
      .bind(board.id),
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
  }
}
```

`worker/src/scope.ts`:

```ts
import type { Context } from 'hono'
import type { AppEnv, AuthBoard } from './env'
import { notFound } from './errors'

/** The :slug in the URL must be the caller's own board; anything else is a 404, not a 403. */
export function ownBoard(c: Context<AppEnv>): AuthBoard {
  const board = c.get('board')
  if (c.req.param('slug') !== board.slug) throw notFound()
  return board
}
```

- [ ] **Step 6: Implement the board routes and mount them**

`worker/src/routes/boards.ts`:

```ts
import { Hono } from 'hono'
import { rows } from '../db'
import type { AppEnv } from '../env'
import { boardPayload } from '../queries'
import { ownBoard } from '../scope'
import { activityJson, type ActivityRow } from '../serialize'

export const boards = new Hono<AppEnv>()

boards.get('/boards', (c) => {
  const b = c.get('board')
  return c.json({ data: [{ id: b.id, name: b.name, slug: b.slug, description: b.description }] })
})

boards.get('/boards/:slug', async (c) => {
  const board = ownBoard(c)
  return c.json({ data: await boardPayload(c.env.DB, board) })
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
```

In `worker/src/app.ts` add the import and mount, next to `me`:

```ts
import { boards } from './routes/boards'
// …
  app.route('/api', me)
  app.route('/api', boards)
```

- [ ] **Step 7: Run the tests**

```bash
npm --prefix worker test -- test/boards.test.ts
```

Expected: 4 pass.

- [ ] **Step 8: Typecheck and commit**

```bash
npm --prefix worker run typecheck
git add worker/src worker/test
git commit -m "Worker: board payload and activity log

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Sources

**Files:**
- Create: `worker/src/routes/sources.ts`
- Modify: `worker/src/app.ts`, `worker/test/helpers.ts`
- Test: `worker/test/sources.test.ts`

**Interfaces:**
- Consumes: `ownBoard` (Task 5); `findSource`, `rows`, `sourceJson`, `nowIso`; `parse`, `jsonBody`, `sourceCreateSchema`, `sourceUpdateSchema`, `invalid`, `notFound`.
- Produces: test helpers `boardIdOf(slug)`, `seedTask(boardId, source, title?)` (inserts a task row directly, the way `SourceTest.php` used `Task::create`).

- [ ] **Step 1: Add test helpers**

Append to `worker/test/helpers.ts`:

```ts
export async function boardIdOf(slug: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT id FROM boards WHERE slug = ?1`).bind(slug).first<{ id: number }>()
  if (!row) throw new Error(`no board ${slug}`)
  return row.id
}

/** A task row without going through the API, for tests about other resources. */
export async function seedTask(boardId: number, source: string, title = 'Follow up with the supplier'): Promise<number> {
  const column = await env.DB
    .prepare(`SELECT id FROM board_columns WHERE board_id = ?1 ORDER BY position LIMIT 1`)
    .bind(boardId)
    .first<{ id: number }>()
  const at = '2026-01-01T00:00:00.000Z'
  const row = await env.DB
    .prepare(
      `INSERT INTO tasks (board_id, board_column_id, title, source, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5) RETURNING id`,
    )
    .bind(boardId, column!.id, title, source, at)
    .first<{ id: number }>()
  return row!.id
}
```

- [ ] **Step 2: Write the failing tests** (the cases from `backend/tests/Feature/SourceTest.php`, plus isolation)

`worker/test/sources.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ALICE, BOB, boardIdOf, boardOf, del, env, get, json, meOf, patch, post, seedTask } from './helpers'

async function sourceId(who: string, name: string): Promise<number> {
  const board = await boardOf(who)
  return board.sources.find((s) => s.name === name)!.id
}

describe('sources', () => {
  it('lists the sources a board starts with, counting tasks', async () => {
    const me = await meOf(ALICE)
    await seedTask(await boardIdOf(me.board_slug), 'Viber')

    const { data } = await json(await get(`/api/boards/${me.board_slug}/sources`))
    expect(data).toHaveLength(8)
    expect(data[0]).toEqual({ id: expect.any(Number), name: 'Viber', position: 0, is_archived: false, task_count: 1 })
    expect(data[1].task_count).toBe(0)
  })

  it('adds a source', async () => {
    const me = await meOf(ALICE)
    const res = await post(`/api/boards/${me.board_slug}/sources`, { name: 'Zoom' })
    expect(res.status).toBe(201)
    expect((await json(res)).data).toEqual({ id: expect.any(Number), name: 'Zoom', position: 8, is_archived: false })
  })

  it('rejects a name already on the board, whatever its case', async () => {
    const me = await meOf(ALICE)
    for (const name of ['Viber', 'viber']) {
      const res = await post(`/api/boards/${me.board_slug}/sources`, { name })
      expect(res.status).toBe(422)
      expect((await json(res)).errors.name).toEqual(['The name has already been taken.'])
    }
  })

  it('allows the same name on a different board', async () => {
    await meOf(ALICE)
    const bob = await meOf(BOB)
    await del(`/api/sources/${await sourceId(BOB, 'Viber')}`, BOB)
    expect((await post(`/api/boards/${bob.board_slug}/sources`, { name: 'Viber' }, BOB)).status).toBe(201)
  })

  it('renames a source and carries existing tasks with it', async () => {
    const me = await meOf(ALICE)
    const taskId = await seedTask(await boardIdOf(me.board_slug), 'Viber')

    const res = await patch(`/api/sources/${await sourceId(ALICE, 'Viber')}`, { name: 'Viber Work' })
    expect(res.status).toBe(200)
    expect((await json(res)).data.name).toBe('Viber Work')

    const task = await env.DB.prepare(`SELECT source FROM tasks WHERE id = ?1`).bind(taskId).first<{ source: string }>()
    expect(task!.source).toBe('Viber Work')
  })

  it('leaves other boards\' tasks alone when renaming', async () => {
    await meOf(ALICE)
    const bob = await meOf(BOB)
    const untouched = await seedTask(await boardIdOf(bob.board_slug), 'Viber')

    await patch(`/api/sources/${await sourceId(ALICE, 'Viber')}`, { name: 'Viber Work' })

    const task = await env.DB.prepare(`SELECT source FROM tasks WHERE id = ?1`).bind(untouched).first<{ source: string }>()
    expect(task!.source).toBe('Viber')
  })

  it('deletes a source no task uses', async () => {
    const id = await sourceId(ALICE, 'Slack')
    const res = await del(`/api/sources/${id}`)
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ archived: false, tasks_using: 0 })
    expect(await env.DB.prepare(`SELECT id FROM sources WHERE id = ?1`).bind(id).first()).toBeNull()
  })

  it('archives instead of deleting a source tasks still use', async () => {
    const me = await meOf(ALICE)
    await seedTask(await boardIdOf(me.board_slug), 'Viber')
    const id = await sourceId(ALICE, 'Viber')

    const res = await del(`/api/sources/${id}`)
    expect(await json(res)).toEqual({ archived: true, tasks_using: 1 })
    const row = await env.DB.prepare(`SELECT is_archived FROM sources WHERE id = ?1`).bind(id).first<{ is_archived: number }>()
    expect(row!.is_archived).toBe(1)
  })

  it('can archive and restore a source', async () => {
    const id = await sourceId(ALICE, 'SMS')
    expect((await json(await patch(`/api/sources/${id}`, { is_archived: true }))).data.is_archived).toBe(true)
    expect((await json(await patch(`/api/sources/${id}`, { is_archived: false }))).data.is_archived).toBe(false)
  })

  it('carries archived sources on the board payload', async () => {
    await patch(`/api/sources/${await sourceId(ALICE, 'Slack')}`, { is_archived: true })
    const board = await boardOf(ALICE)
    expect(board.sources[0]).toMatchObject({ name: 'Viber', is_archived: false })
    expect(board.sources[6]).toMatchObject({ name: 'Slack', is_archived: true })
  })

  it('hides other people\'s sources behind a 404', async () => {
    const id = await sourceId(ALICE, 'Viber')
    await meOf(BOB)
    expect((await patch(`/api/sources/${id}`, { name: 'X' }, BOB)).status).toBe(404)
    expect((await del(`/api/sources/${id}`, BOB)).status).toBe(404)
  })
})
```

- [ ] **Step 3: Run it to see it fail**

```bash
npm --prefix worker test -- test/sources.test.ts
```

Expected: FAIL — the source routes return 404.

- [ ] **Step 4: Implement the routes**

`worker/src/routes/sources.ts`:

```ts
import { Hono } from 'hono'
import { nowIso } from '../dates'
import { rows } from '../db'
import type { AppEnv } from '../env'
import { invalid, notFound } from '../errors'
import { findSource } from '../queries'
import { ownBoard } from '../scope'
import { sourceJson, type SourceRow } from '../serialize'
import { jsonBody, parse, sourceCreateSchema, sourceUpdateSchema } from '../validate'

/**
 * The channels a board captures tasks from. Names live on tasks.source
 * verbatim, so a rename has to carry the old tasks with it and a name still
 * in use is archived rather than dropped.
 */
export const sources = new Hono<AppEnv>()

async function assertNameFree(db: D1Database, boardId: number, name: string, ignoreId = 0): Promise<void> {
  const taken = await db
    .prepare(`SELECT id FROM sources WHERE board_id = ?1 AND name = ?2 AND id <> ?3`)
    .bind(boardId, name, ignoreId)
    .first()
  if (taken) throw invalid('name', 'The name has already been taken.')
}

function taskCount(db: D1Database, source: SourceRow) {
  return db
    .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE board_id = ?1 AND source = ?2`)
    .bind(source.board_id, source.name)
    .first<{ n: number }>()
    .then((r) => r?.n ?? 0)
}

sources.get('/boards/:slug/sources', async (c) => {
  const board = ownBoard(c)
  const list = await rows<SourceRow & { task_count: number }>(
    c.env.DB
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM tasks t WHERE t.board_id = s.board_id AND t.source = s.name) AS task_count
           FROM sources s WHERE s.board_id = ?1 ORDER BY s.position, s.id`,
      )
      .bind(board.id),
  )
  return c.json({ data: list.map((s) => sourceJson(s, s.task_count)) })
})

sources.post('/boards/:slug/sources', async (c) => {
  const board = ownBoard(c)
  const db = c.env.DB
  const data = parse(sourceCreateSchema, await jsonBody(c))
  await assertNameFree(db, board.id, data.name)

  const next = await db
    .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM sources WHERE board_id = ?1`)
    .bind(board.id)
    .first<{ next: number }>()

  const row = await db
    .prepare(
      `INSERT INTO sources (board_id, name, position, is_archived, created_at, updated_at)
       VALUES (?1, ?2, ?3, 0, ?4, ?4) RETURNING *`,
    )
    .bind(board.id, data.name, next?.next ?? 0, nowIso())
    .first<SourceRow>()

  return c.json({ data: sourceJson(row!) }, 201)
})

sources.patch('/sources/:id', async (c) => {
  const board = c.get('board')
  const db = c.env.DB
  const source = await findSource(db, board.id, Number(c.req.param('id')))
  if (!source) throw notFound()

  const data = parse(sourceUpdateSchema, await jsonBody(c))
  const at = nowIso()
  const statements: D1PreparedStatement[] = []

  if (data.name !== undefined && data.name !== source.name) {
    await assertNameFree(db, board.id, data.name, source.id)
    // Tasks store the name, not the id, so the rename has to reach them.
    statements.push(
      db
        .prepare(`UPDATE tasks SET source = ?1, updated_at = ?2 WHERE board_id = ?3 AND source = ?4`)
        .bind(data.name, at, board.id, source.name),
    )
  }

  const archived = data.is_archived === undefined ? source.is_archived : data.is_archived ? 1 : 0
  statements.push(
    db
      .prepare(`UPDATE sources SET name = ?1, is_archived = ?2, updated_at = ?3 WHERE id = ?4`)
      .bind(data.name ?? source.name, archived, at, source.id),
  )
  await db.batch(statements)

  return c.json({ data: sourceJson((await findSource(db, board.id, source.id))!) })
})

sources.delete('/sources/:id', async (c) => {
  const board = c.get('board')
  const db = c.env.DB
  const source = await findSource(db, board.id, Number(c.req.param('id')))
  if (!source) throw notFound()

  // Dropping a name still on a task would leave that task unreadable,
  // so the source is retired from the picker instead.
  const using = await taskCount(db, source)
  if (using > 0) {
    await db.prepare(`UPDATE sources SET is_archived = 1, updated_at = ?1 WHERE id = ?2`).bind(nowIso(), source.id).run()
    return c.json({ archived: true, tasks_using: using })
  }

  await db.prepare(`DELETE FROM sources WHERE id = ?1`).bind(source.id).run()
  return c.json({ archived: false, tasks_using: 0 })
})
```

In `worker/src/app.ts`:

```ts
import { sources } from './routes/sources'
// …
  app.route('/api', sources)
```

- [ ] **Step 5: Run the tests**

```bash
npm --prefix worker test -- test/sources.test.ts
```

Expected: 11 pass.

- [ ] **Step 6: Typecheck and commit**

```bash
npm --prefix worker run typecheck
git add worker/src worker/test
git commit -m "Worker: sources — add, rename, archive-instead-of-delete

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Tasks — create and update

**Files:**
- Create: `worker/src/routes/tasks.ts`
- Modify: `worker/src/app.ts`
- Test: `worker/test/tasks.test.ts`

**Interfaces:**
- Consumes: `ownBoard`; `findColumn`, `findTask`, `activeSourceExists`, `nextPosition`, `taskPayload`; `note`, `renumber`; `todayIn`, `nowIso`; `parse`, `jsonBody`, `taskCreateSchema`, `taskUpdateSchema`, `TaskUpdate`; `invalid`, `notFound`; `ColumnRow`.
- Produces (used by Task 8 in the same file): `payload(data: TaskUpdate): Record<string, string | number | null>`, `checkRefs(db, boardId, data)`, `insertTask(db, tz, boardId, column, fields): Promise<number>`, `zone(env)`.

- [ ] **Step 1: Write the failing tests**

`worker/test/tasks.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { todayIn } from '../src/dates'
import { ALICE, BOB, boardOf, columnOf, json, meOf, patch, post } from './helpers'

const today = () => todayIn('Asia/Manila')

async function create(body: Record<string, unknown> = {}, who = ALICE) {
  const board = await boardOf(who)
  const res = await post(
    `/api/boards/${board.slug}/tasks`,
    { column_id: columnOf(board, 'inbox'), title: 'Send the quotation', ...body },
    who,
  )
  return { board, res }
}

async function created(body: Record<string, unknown> = {}, who = ALICE) {
  const { board, res } = await create(body, who)
  expect(res.status).toBe(201)
  return { board, task: (await json(res)).data }
}

describe('create task', () => {
  it('fills the defaults and logs the creation', async () => {
    const { board, task } = await created()
    expect(task).toEqual({
      id: expect.any(Number),
      column_id: columnOf(board, 'inbox'),
      column_key: 'inbox',
      title: 'Send the quotation',
      source: 'Manual',
      sender: null,
      due: '',
      priority: 'normal',
      quote: '',
      attachments: '',
      tags: [],
      shot: null,
      captured: today(),
      done_on: null,
      position: 0,
      files: [],
      history: [{ id: expect.any(Number), task_id: task.id, text: 'Created in Inbox', at: expect.any(String) }],
    })
  })

  it('keeps every field it is given', async () => {
    const { task } = await created({
      source: 'Viber', sender: 'Ms. Rivera', due: '2026-09-10', priority: 'high',
      quote: 'Can you send it today?', attachments: 'quote.pdf', tags: ['client', 'urgent'],
    })
    expect(task).toMatchObject({
      source: 'Viber', sender: 'Ms. Rivera', due: '2026-09-10', priority: 'high',
      quote: 'Can you send it today?', attachments: 'quote.pdf', tags: ['client', 'urgent'],
    })
  })

  it('appends to the end of the column', async () => {
    await created()
    const { task } = await created({ title: 'Second' })
    expect(task.position).toBe(1)
  })

  it('marks a task done when it starts in the done lane', async () => {
    const board = await boardOf()
    const { task } = await created({ column_id: columnOf(board, 'done') })
    expect(task.done_on).toBe(today())
    expect(task.history[0].text).toBe('Created in Done')
  })

  it('rejects a column that belongs to someone else', async () => {
    const bob = await boardOf(BOB)
    const { res } = await create({ column_id: columnOf(bob, 'inbox') })
    expect(res.status).toBe(422)
    expect((await json(res)).errors.column_id).toEqual(['The selected column id is invalid.'])
  })

  it('rejects a source the board does not have or has archived', async () => {
    const { res } = await create({ source: 'Carrier Pigeon' })
    expect(res.status).toBe(422)
    expect((await json(res)).errors.source).toEqual(['The selected source is invalid.'])

    const board = await boardOf()
    const slack = board.sources.find((s) => s.name === 'Slack')!
    await patch(`/api/sources/${slack.id}`, { is_archived: true })
    expect((await create({ source: 'Slack' })).res.status).toBe(422)
  })

  it('rejects an unknown board slug', async () => {
    await meOf(ALICE)
    expect((await post('/api/boards/b-nope/tasks', { column_id: 1, title: 'x' })).status).toBe(404)
  })

  it('lists the task on the board without history', async () => {
    const { task } = await created()
    const board = await boardOf()
    expect(board.tasks).toHaveLength(1)
    expect(board.tasks[0]).toMatchObject({ id: task.id, column_key: 'inbox' })
    expect(board.tasks[0]).not.toHaveProperty('history')
    expect(board.activity[0].text).toBe('Created in Inbox')
  })
})

describe('update task', () => {
  it('logs a line per field that actually changed', async () => {
    const { task } = await created()
    const res = await patch(`/api/tasks/${task.id}`, { title: 'Send the revised quotation', priority: 'high', due: '' })
    expect(res.status).toBe(200)
    const fresh = (await json(res)).data
    expect(fresh.title).toBe('Send the revised quotation')
    expect(fresh.priority).toBe('high')
    expect(fresh.history.map((h: { text: string }) => h.text)).toEqual(['Priority changed', 'Title edited', 'Created in Inbox'])
  })

  it('logs nothing when nothing changed', async () => {
    const { task } = await created()
    const fresh = (await json(await patch(`/api/tasks/${task.id}`, { title: 'Send the quotation', due: '' }))).data
    expect(fresh.history).toHaveLength(1)
  })

  it('moves between lanes through column_id and keeps done_on in step', async () => {
    const board = await boardOf()
    const { task } = await created()

    const done = (await json(await patch(`/api/tasks/${task.id}`, { column_id: columnOf(board, 'done') }))).data
    expect(done.column_key).toBe('done')
    expect(done.done_on).toBe(today())
    expect(done.history[0].text).toBe('Moved to Done')

    const back = (await json(await patch(`/api/tasks/${task.id}`, { column_id: columnOf(board, 'inbox') }))).data
    expect(back.done_on).toBeNull()
  })

  it('changes tags, sender, source and notes with their own lines', async () => {
    const { task } = await created()
    const fresh = (await json(await patch(`/api/tasks/${task.id}`, {
      tags: ['finance'], sender: 'Accounting', source: 'Email', quote: 'See attached.',
    }))).data
    expect(fresh.tags).toEqual(['finance'])
    expect(fresh.history.map((h: { text: string }) => h.text)).toEqual([
      'Tags changed', 'Notes edited', 'Source changed', 'Sender changed', 'Created in Inbox',
    ])
  })

  it('validates and scopes like create', async () => {
    const { task } = await created()
    const bob = await boardOf(BOB)
    expect((await patch(`/api/tasks/${task.id}`, { column_id: columnOf(bob, 'todo') })).status).toBe(422)
    expect((await patch(`/api/tasks/${task.id}`, { title: '' })).status).toBe(422)
    expect((await patch(`/api/tasks/${task.id}`, { title: 'x' }, BOB)).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

```bash
npm --prefix worker test -- test/tasks.test.ts
```

Expected: FAIL — task routes return 404.

- [ ] **Step 3: Implement create and update**

`worker/src/routes/tasks.ts`:

```ts
import { Hono } from 'hono'
import { nowIso, todayIn } from '../dates'
import { note, renumber } from '../db'
import type { AppEnv, Env } from '../env'
import { invalid, notFound } from '../errors'
import { activeSourceExists, findColumn, findTask, nextPosition, taskPayload } from '../queries'
import { ownBoard } from '../scope'
import type { ColumnRow } from '../serialize'
import { jsonBody, parse, taskCreateSchema, taskUpdateSchema, type TaskUpdate } from '../validate'

export const tasks = new Hono<AppEnv>()

export const zone = (env: Env) => env.APP_TIMEZONE || 'Asia/Manila'

type Fields = Record<string, string | number | null>

/** Client field names → column names, as TaskController::payload(). Only keys that were sent. */
export function payload(data: TaskUpdate): Fields {
  const out: Fields = {}
  if (data.column_id !== undefined) out.board_column_id = data.column_id
  if (data.title !== undefined) out.title = data.title
  if (data.source !== undefined) out.source = data.source
  if (data.sender !== undefined) out.sender = data.sender
  if (data.due !== undefined) out.due_date = data.due
  if (data.priority !== undefined) out.priority = data.priority
  if (data.quote !== undefined) out.quote = data.quote
  if (data.attachments !== undefined) out.attachments_note = data.attachments
  if (data.tags !== undefined) out.tags = JSON.stringify(data.tags)
  return out
}

/** The column and source a task refers to must be the board's own (Laravel's exists rules). */
export async function checkRefs(
  db: D1Database,
  boardId: number,
  data: { column_id?: number; source?: string },
): Promise<ColumnRow | null> {
  let column: ColumnRow | null = null
  if (data.column_id !== undefined) {
    column = await findColumn(db, boardId, data.column_id)
    if (!column) throw invalid('column_id', 'The selected column id is invalid.')
  }
  if (data.source !== undefined && !(await activeSourceExists(db, boardId, data.source))) {
    throw invalid('source', 'The selected source is invalid.')
  }
  return column
}

/** Insert at the end of the column; captured today, done today when the column is the done lane. */
export async function insertTask(
  db: D1Database,
  tz: string,
  boardId: number,
  column: ColumnRow,
  fields: Fields,
): Promise<number> {
  const today = todayIn(tz)
  const row = await db
    .prepare(
      `INSERT INTO tasks (board_id, board_column_id, title, source, sender, due_date, priority, quote,
                          attachments_note, tags, screenshot_path, captured_on, done_on, position,
                          created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)
       RETURNING id`,
    )
    .bind(
      boardId,
      column.id,
      fields.title,
      fields.source ?? 'Manual',
      fields.sender ?? null,
      fields.due_date ?? null,
      fields.priority ?? 'normal',
      fields.quote ?? null,
      fields.attachments_note ?? null,
      fields.tags ?? null,
      fields.screenshot_path ?? null,
      today,
      column.is_done ? today : null,
      await nextPosition(db, column.id),
      nowIso(),
    )
    .first<{ id: number }>()
  return row!.id
}

tasks.post('/boards/:slug/tasks', async (c) => {
  const board = ownBoard(c)
  const db = c.env.DB
  const data = parse(taskCreateSchema, await jsonBody(c))
  const column = (await checkRefs(db, board.id, data))!

  const id = await insertTask(db, zone(c.env), board.id, column, payload(data))
  await db.batch([note(db, board.id, `Created in ${column.name}`, id), renumber(db, column.id)])

  return c.json({ data: await taskPayload(db, board.id, id, true) }, 201)
})

const LINES: Record<string, string> = {
  title: 'Title edited',
  priority: 'Priority changed',
  due_date: 'Due date changed',
  sender: 'Sender changed',
  source: 'Source changed',
  quote: 'Notes edited',
  tags: 'Tags changed',
}

tasks.patch('/tasks/:id', async (c) => {
  const board = c.get('board')
  const db = c.env.DB
  const task = await findTask(db, board.id, Number(c.req.param('id')))
  if (!task) throw notFound()

  const data = parse(taskUpdateSchema, await jsonBody(c))
  const column = await checkRefs(db, board.id, data)

  // Only fields whose value actually changed are written and logged — Eloquent's getChanges().
  const current = task as unknown as Record<string, unknown>
  const changes: Fields = {}
  for (const [key, value] of Object.entries(payload(data))) {
    if (current[key] !== value) changes[key] = value
  }
  if (Object.keys(changes).length === 0) {
    return c.json({ data: await taskPayload(db, board.id, task.id, true) })
  }

  const statements: D1PreparedStatement[] = []
  const movedTo = 'board_column_id' in changes ? column : null
  if (movedTo) changes.done_on = movedTo.is_done ? todayIn(zone(c.env)) : null

  const keys = Object.keys(changes)
  statements.push(
    db
      .prepare(
        `UPDATE tasks SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_at = ?${keys.length + 1}
          WHERE id = ?${keys.length + 2}`,
      )
      .bind(...keys.map((k) => changes[k]), nowIso(), task.id),
  )
  if (movedTo) statements.push(note(db, board.id, `Moved to ${movedTo.name}`, task.id))
  for (const [field, line] of Object.entries(LINES)) {
    if (field in changes) statements.push(note(db, board.id, line, task.id))
  }
  await db.batch(statements)

  return c.json({ data: await taskPayload(db, board.id, task.id, true) })
})
```

The column names interpolated into the `UPDATE` come from `payload()`'s fixed list plus `done_on`, never from the request.

In `worker/src/app.ts`:

```ts
import { tasks } from './routes/tasks'
// …
  app.route('/api', tasks)
```

- [ ] **Step 4: Run the tests**

```bash
npm --prefix worker test -- test/tasks.test.ts
```

Expected: 13 pass. Activity order within one batch relies on `created_at DESC, id DESC`; the lines are inserted in the order `Moved to`, then `LINES` order — the tests assert exactly that.

- [ ] **Step 5: Typecheck and commit**

```bash
npm --prefix worker run typecheck
git add worker/src worker/test
git commit -m "Worker: create and update tasks with per-field activity

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Tasks — move, delete, bulk create

**Files:**
- Modify: `worker/src/routes/tasks.ts`
- Test: `worker/test/tasks-move.test.ts`

**Interfaces:**
- Consumes: from Task 7 in the same file — `payload`, `insertTask`, `zone`; `moveSchema`, `bulkSchema`; `rows`, `renumber`, `note`; `FileRow`.

- [ ] **Step 1: Write the failing tests**

`worker/test/tasks-move.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { todayIn } from '../src/dates'
import { ALICE, BOB, boardOf, columnOf, del, env, get, json, patch, post, type BoardJson } from './helpers'

const today = () => todayIn('Asia/Manila')

async function add(board: BoardJson, key: string, title: string, who = ALICE): Promise<number> {
  const res = await post(`/api/boards/${board.slug}/tasks`, { column_id: columnOf(board, key), title }, who)
  expect(res.status).toBe(201)
  return (await json(res)).data.id
}

/** Titles per column key, in position order, straight from the board payload. */
async function lanes(who = ALICE): Promise<Record<string, string[]>> {
  const board = await boardOf(who)
  const out: Record<string, string[]> = {}
  for (const c of board.columns) {
    out[c.key] = board.tasks
      .filter((t) => t.column_id === c.id)
      .sort((a, b) => (a.position as number) - (b.position as number))
      .map((t) => t.title as string)
  }
  return out
}

async function positions(who = ALICE): Promise<Record<string, number[]>> {
  const board = await boardOf(who)
  const out: Record<string, number[]> = {}
  for (const c of board.columns) {
    out[c.key] = board.tasks.filter((t) => t.column_id === c.id).map((t) => t.position as number).sort()
  }
  return out
}

describe('move', () => {
  it('closes the gap it leaves and opens one where it lands', async () => {
    const board = await boardOf()
    await add(board, 'inbox', 'A')
    const b = await add(board, 'inbox', 'B')
    await add(board, 'inbox', 'C')
    await add(board, 'todo', 'X')
    await add(board, 'todo', 'Y')

    const res = await patch(`/api/tasks/${b}/move`, { column_id: columnOf(board, 'todo'), position: 1 })
    expect(res.status).toBe(200)
    const moved = (await json(res)).data
    expect(moved.column_key).toBe('todo')
    expect(moved.position).toBe(1)
    expect(moved.history[0].text).toBe('Moved to To Do')

    expect(await lanes()).toMatchObject({ inbox: ['A', 'C'], todo: ['X', 'B', 'Y'] })
    expect(await positions()).toMatchObject({ inbox: [0, 1], todo: [0, 1, 2] })
  })

  it('reorders inside a column without logging a move', async () => {
    const board = await boardOf()
    await add(board, 'inbox', 'A')
    await add(board, 'inbox', 'B')
    const cId = await add(board, 'inbox', 'C')

    const moved = (await json(await patch(`/api/tasks/${cId}/move`, { column_id: columnOf(board, 'inbox'), position: 0 }))).data
    expect(moved.history).toHaveLength(1)
    expect(await lanes()).toMatchObject({ inbox: ['C', 'A', 'B'] })
  })

  it('sets done_on on the way into Done, keeps it there, clears it on the way out', async () => {
    const board = await boardOf()
    const id = await add(board, 'inbox', 'A')
    const done = columnOf(board, 'done')

    expect((await json(await patch(`/api/tasks/${id}/move`, { column_id: done, position: 0 }))).data.done_on).toBe(today())

    await env.DB.prepare(`UPDATE tasks SET done_on = '2026-01-01' WHERE id = ?1`).bind(id).run()
    expect((await json(await patch(`/api/tasks/${id}/move`, { column_id: done, position: 0 }))).data.done_on).toBe('2026-01-01')

    expect((await json(await patch(`/api/tasks/${id}/move`, { column_id: columnOf(board, 'wait'), position: 0 }))).data.done_on).toBeNull()
  })

  it('refuses a column from another board and hides other people\'s tasks', async () => {
    const board = await boardOf()
    const id = await add(board, 'inbox', 'A')
    const bob = await boardOf(BOB)
    expect((await patch(`/api/tasks/${id}/move`, { column_id: columnOf(bob, 'inbox'), position: 0 })).status).toBe(422)
    expect((await patch(`/api/tasks/${id}/move`, { column_id: columnOf(board, 'inbox'), position: 0 }, BOB)).status).toBe(404)
  })
})

describe('delete', () => {
  it('removes the task, its files and renumbers the column', async () => {
    const board = await boardOf()
    const a = await add(board, 'inbox', 'A')
    const b = await add(board, 'inbox', 'B')
    await add(board, 'inbox', 'C')

    await env.FILES.put('attachments/gone.bin', 'bytes', { customMetadata: { owner: '1', name: 'gone.bin' } })
    await env.DB
      .prepare(`INSERT INTO task_files (task_id, name, mime, size, path, created_at, updated_at) VALUES (?1, 'gone.bin', 'application/octet-stream', 5, 'attachments/gone.bin', 't', 't')`)
      .bind(b)
      .run()

    const res = await del(`/api/tasks/${b}`)
    expect(res.status).toBe(204)

    expect(await env.DB.prepare(`SELECT id FROM tasks WHERE id = ?1`).bind(b).first()).toBeNull()
    expect(await env.DB.prepare(`SELECT id FROM task_files WHERE task_id = ?1`).bind(b).first()).toBeNull()
    expect(await env.FILES.head('attachments/gone.bin')).toBeNull()
    expect(await lanes()).toMatchObject({ inbox: ['A', 'C'] })
    expect(await positions()).toMatchObject({ inbox: [0, 1] })

    const { data: log } = await json(await get(`/api/boards/${board.slug}/activity`))
    expect(log[0]).toMatchObject({ text: 'Deleted: B', task_id: null })
    // The task's older lines stay on the board log, detached from the task.
    expect(log.find((l: { text: string; task_id: number | null }) => l.text === 'Created in Inbox' && l.task_id === null)).toBeTruthy()
    expect(log.find((l: { task_id: number | null }) => l.task_id === a)).toBeTruthy()
  })

  it('hides other people\'s tasks', async () => {
    const board = await boardOf()
    const id = await add(board, 'inbox', 'A')
    expect((await del(`/api/tasks/${id}`, BOB)).status).toBe(404)
  })
})

describe('bulk create', () => {
  it('creates every row with the shared source and screenshot', async () => {
    const board = await boardOf()
    const res = await post(`/api/boards/${board.slug}/tasks/bulk`, {
      screenshot_path: 'screenshots/abc.png',
      source: 'Viber',
      tasks: [
        { column_id: columnOf(board, 'inbox'), title: 'One', sender: 'Ms. Rivera' },
        { column_id: columnOf(board, 'done'), title: 'Two', priority: 'high', tags: ['client'] },
      ],
    })
    expect(res.status).toBe(201)
    const { data } = await json(res)
    expect(data).toHaveLength(2)
    expect(data[0]).toMatchObject({
      title: 'One', source: 'Viber', sender: 'Ms. Rivera', shot: '/storage/screenshots/abc.png',
      column_key: 'inbox', position: 0, captured: today(), done_on: null,
    })
    expect(data[0].history[0].text).toBe('Captured from Viber (Ms. Rivera) — placed in Inbox')
    expect(data[1]).toMatchObject({ title: 'Two', priority: 'high', tags: ['client'], column_key: 'done', done_on: today() })
    expect(data[1].history[0].text).toBe('Captured from Viber — placed in Done')
  })

  it('defaults the source to Manual and validates rows by index', async () => {
    const board = await boardOf()
    const ok = await post(`/api/boards/${board.slug}/tasks/bulk`, {
      tasks: [{ column_id: columnOf(board, 'inbox'), title: 'One' }],
    })
    expect((await json(ok)).data[0].source).toBe('Manual')

    const bob = await boardOf(BOB)
    const bad = await post(`/api/boards/${board.slug}/tasks/bulk`, {
      tasks: [{ column_id: columnOf(bob, 'inbox'), title: 'One' }],
    })
    expect(bad.status).toBe(422)
    expect((await json(bad)).errors['tasks.0.column_id']).toEqual(['The selected tasks.0.column_id is invalid.'])

    const path = await post(`/api/boards/${board.slug}/tasks/bulk`, {
      screenshot_path: 'attachments/x.png',
      tasks: [{ column_id: columnOf(board, 'inbox'), title: 'One' }],
    })
    expect((await json(path)).errors.screenshot_path).toEqual(['The screenshot path is invalid.'])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

```bash
npm --prefix worker test -- test/tasks-move.test.ts
```

Expected: FAIL — move/delete/bulk return 404.

- [ ] **Step 3: Implement**

Append to `worker/src/routes/tasks.ts` (add `rows` to the `../db` import, `FileRow` to the `../serialize` import, and `bulkSchema`, `moveSchema` to the `../validate` import):

```ts
/**
 * Move a task to a column at an explicit index, closing the gap it left and
 * opening one where it lands. Both lists end contiguous from 0.
 */
tasks.patch('/tasks/:id/move', async (c) => {
  const board = c.get('board')
  const db = c.env.DB
  const task = await findTask(db, board.id, Number(c.req.param('id')))
  if (!task) throw notFound()

  const data = parse(moveSchema, await jsonBody(c))
  const column = await findColumn(db, board.id, data.column_id)
  if (!column) throw invalid('column_id', 'The selected column id is invalid.')

  const from = task.board_column_id
  const to = column.id
  const target = data.position
  const doneOn = column.is_done ? (task.done_on ?? todayIn(zone(c.env))) : null

  const statements = [
    db
      .prepare(`UPDATE tasks SET position = position - 1 WHERE board_column_id = ?1 AND position > ?2 AND id <> ?3`)
      .bind(from, task.position, task.id),
    db
      .prepare(`UPDATE tasks SET position = position + 1 WHERE board_column_id = ?1 AND position >= ?2 AND id <> ?3`)
      .bind(to, target, task.id),
    db
      .prepare(`UPDATE tasks SET board_column_id = ?1, position = ?2, done_on = ?3, updated_at = ?4 WHERE id = ?5`)
      .bind(to, target, doneOn, nowIso(), task.id),
    renumber(db, from),
  ]
  if (to !== from) statements.push(renumber(db, to), note(db, board.id, `Moved to ${column.name}`, task.id))
  await db.batch(statements)

  return c.json({ data: await taskPayload(db, board.id, task.id, true) })
})

tasks.delete('/tasks/:id', async (c) => {
  const board = c.get('board')
  const db = c.env.DB
  const task = await findTask(db, board.id, Number(c.req.param('id')))
  if (!task) throw notFound()

  const files = await rows<FileRow>(db.prepare(`SELECT * FROM task_files WHERE task_id = ?1`).bind(task.id))
  await Promise.all(files.map((f) => c.env.FILES.delete(f.path)))

  // The line outlives the task, so it carries no task id; older lines lose theirs via ON DELETE SET NULL.
  await db.batch([
    note(db, board.id, `Deleted: ${task.title}`),
    db.prepare(`DELETE FROM tasks WHERE id = ?1`).bind(task.id),
    renumber(db, task.board_column_id),
  ])

  return c.body(null, 204)
})

/** Create several tasks at once, as a confirmed screenshot review does. */
tasks.post('/boards/:slug/tasks/bulk', async (c) => {
  const board = ownBoard(c)
  const db = c.env.DB
  const data = parse(bulkSchema, await jsonBody(c))

  if (data.source !== undefined && !(await activeSourceExists(db, board.id, data.source))) {
    throw invalid('source', 'The selected source is invalid.')
  }
  const source = data.source ?? 'Manual'

  const columns = new Map<number, ColumnRow>()
  for (const [i, row] of data.tasks.entries()) {
    if (columns.has(row.column_id)) continue
    const column = await findColumn(db, board.id, row.column_id)
    if (!column) throw invalid(`tasks.${i}.column_id`, `The selected tasks.${i}.column_id is invalid.`)
    columns.set(row.column_id, column)
  }

  const ids: number[] = []
  const after: D1PreparedStatement[] = []
  for (const row of data.tasks) {
    const column = columns.get(row.column_id)!
    const id = await insertTask(db, zone(c.env), board.id, column, {
      ...payload(row),
      source,
      screenshot_path: data.screenshot_path ?? null,
    })
    const who = (row.sender ?? '').trim()
    after.push(note(db, board.id, `Captured from ${source}${who ? ` (${who})` : ''} — placed in ${column.name}`, id))
    ids.push(id)
  }
  for (const columnId of columns.keys()) after.push(renumber(db, columnId))
  await db.batch(after)

  const list = await Promise.all(ids.map((id) => taskPayload(db, board.id, id, true)))
  return c.json({ data: list }, 201)
})
```

- [ ] **Step 4: Run the tests**

```bash
npm --prefix worker test -- test/tasks-move.test.ts
npm --prefix worker test
```

Expected: 8 pass in this file; the whole suite green.

- [ ] **Step 5: Typecheck and commit**

```bash
npm --prefix worker run typecheck
git add worker/src worker/test
git commit -m "Worker: move, delete and bulk-create tasks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Screenshots, attachments, `/storage`

**Files:**
- Create: `worker/src/uploads.ts`, `worker/src/routes/scan.ts`, `worker/src/routes/files.ts`, `worker/src/routes/storage.ts`
- Modify: `worker/src/app.ts`
- Test: `worker/test/uploads.test.ts`

**Interfaces:**
- Consumes: `ownBoard`, `findTask`, `note`, `nowIso`, `fileJson`, `storageUrl`, `FileRow`, `invalid`, `notFound`.
- Produces: `MAX_FILE_BYTES`, `MAX_FILES`, `extensionFor(file)`, `objectKey(folder, file)`, `sniffImage(bytes)`, `IMAGE_MIMES`, `putObject(bucket, key, bytes, contentType, ownerId, name)`, `filesFrom(body, field)`.

- [ ] **Step 1: Write the failing tests**

`worker/test/uploads.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ALICE, BOB, boardOf, columnOf, del, env, get, json, meOf, post } from './helpers'

// A 1×1 transparent PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function pngFile(name = 'shot.png'): File {
  const bytes = Uint8Array.from(atob(PNG), (ch) => ch.charCodeAt(0))
  return new File([bytes], name, { type: 'image/png' })
}

function form(field: string, ...files: File[]): FormData {
  const f = new FormData()
  for (const file of files) f.append(field, file)
  return f
}

async function userId(email: string): Promise<number> {
  return (await env.DB.prepare(`SELECT id FROM users WHERE email = ?1`).bind(email).first<{ id: number }>())!.id
}

async function taskFor(who = ALICE): Promise<number> {
  const board = await boardOf(who)
  const res = await post(`/api/boards/${board.slug}/tasks`, { column_id: columnOf(board, 'inbox'), title: 'With files' }, who)
  return (await json(res)).data.id
}

describe('scan', () => {
  it('stores the screenshot under the caller and answers the manual shape', async () => {
    const me = await meOf(ALICE)
    const res = await post(`/api/boards/${me.board_slug}/scan`, form('image', pngFile()))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.screenshot.path).toMatch(/^screenshots\/[0-9a-f-]{36}\.png$/)
    expect(body).toEqual({
      screenshot: { path: body.screenshot.path, url: `/storage/${body.screenshot.path}` },
      source: 'Manual',
      rows: [],
      error: null,
      manual: true,
    })

    const object = await env.FILES.head(body.screenshot.path)
    expect(object?.customMetadata).toEqual({ owner: String(await userId(ALICE)), name: 'shot.png' })
    expect(object?.httpMetadata?.contentType).toBe('image/png')
  })

  it('rejects a missing, non-image or mislabelled file', async () => {
    const me = await meOf(ALICE)
    const url = `/api/boards/${me.board_slug}/scan`

    expect((await post(url, new FormData())).status).toBe(422)

    const text = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const typed = await post(url, form('image', text))
    expect(typed.status).toBe(422)
    expect((await json(typed)).errors.image).toEqual(['The image must be a file of type: png, jpg, jpeg, gif, webp.'])

    const fake = new File(['hello'], 'fake.png', { type: 'image/png' })
    const sniffed = await post(url, form('image', fake))
    expect(sniffed.status).toBe(422)
    expect((await json(sniffed)).errors.image).toEqual(['The image must be an image.'])
  })
})

describe('storage', () => {
  it('serves an object to its owner only', async () => {
    const me = await meOf(ALICE)
    const { screenshot } = await json(await post(`/api/boards/${me.board_slug}/scan`, form('image', pngFile())))

    const mine = await get(screenshot.url)
    expect(mine.status).toBe(200)
    expect(mine.headers.get('content-type')).toBe('image/png')
    expect(mine.headers.get('cache-control')).toBe('private, max-age=3600')
    expect((await mine.arrayBuffer()).byteLength).toBe(pngFile().size)

    expect((await get(screenshot.url, BOB)).status).toBe(404)
    expect((await get('/storage/screenshots/missing.png')).status).toBe(404)
    expect((await get('/storage/../wrangler.jsonc')).status).toBe(404)
    expect((await get('/storage/other/x.png')).status).toBe(404)
  })
})

describe('attachments', () => {
  it('attaches files, records them and logs one line', async () => {
    const id = await taskFor()
    const notes = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const res = await post(`/api/tasks/${id}/files`, form('files[]', pngFile(), notes))
    expect(res.status).toBe(201)

    const { data } = await json(res)
    expect(data).toHaveLength(2)
    expect(data[0]).toEqual({
      id: expect.any(Number), name: 'shot.png', mime: 'image/png', size: pngFile().size,
      url: expect.stringMatching(/^\/storage\/attachments\/[0-9a-f-]{36}\.png$/), is_image: true,
    })
    expect(data[1]).toMatchObject({ name: 'notes.txt', mime: 'text/plain', size: 5, is_image: false })
    expect(data[1].url).toMatch(/\.txt$/)

    expect((await get(data[0].url)).status).toBe(200)

    const board = await boardOf()
    expect(board.tasks[0].files).toHaveLength(2)
    expect(board.activity[0]).toMatchObject({ text: 'Attached 2 file(s): shot.png, notes.txt', task_id: id })
  })

  it('validates the batch and scopes the task', async () => {
    const id = await taskFor()
    const none = await post(`/api/tasks/${id}/files`, new FormData())
    expect(none.status).toBe(422)
    expect((await json(none)).errors.files).toEqual(['The files field is required.'])

    const many = form('files[]', ...Array.from({ length: 11 }, (_, i) => pngFile(`s${i}.png`)))
    expect((await post(`/api/tasks/${id}/files`, many)).status).toBe(422)

    expect((await post(`/api/tasks/${id}/files`, form('files[]', pngFile()), BOB)).status).toBe(404)
  })

  it('detaches a file, removing the object and the row', async () => {
    const id = await taskFor()
    const { data } = await json(await post(`/api/tasks/${id}/files`, form('files[]', pngFile())))
    const key = data[0].url.replace('/storage/', '')

    expect((await del(`/api/task-files/${data[0].id}`, BOB)).status).toBe(404)

    const res = await del(`/api/task-files/${data[0].id}`)
    expect(res.status).toBe(204)
    expect(await env.FILES.head(key)).toBeNull()
    expect(await env.DB.prepare(`SELECT id FROM task_files WHERE id = ?1`).bind(data[0].id).first()).toBeNull()

    const board = await boardOf()
    expect(board.activity[0]).toMatchObject({ text: 'Removed attachment shot.png', task_id: id })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

```bash
npm --prefix worker test -- test/uploads.test.ts
```

Expected: FAIL — scan/storage/files routes return 404.

- [ ] **Step 3: Implement the upload helpers**

`worker/src/uploads.ts`:

```ts
export const MAX_FILE_BYTES = 10 * 1024 * 1024 // Laravel: max:10240 (KB)
export const MAX_FILES = 10

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/msword': 'doc',
}

/** Extension from the declared type, else from the name; letters and digits only. */
export function extensionFor(file: { type: string; name: string }): string {
  const byMime = EXT_BY_MIME[file.type]
  if (byMime) return byMime
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(file.name)
  return m ? m[1].toLowerCase() : 'bin'
}

/** Laravel's store() layout: <folder>/<random>.<ext>. */
export function objectKey(folder: 'screenshots' | 'attachments', file: { type: string; name: string }): string {
  return `${folder}/${crypto.randomUUID()}.${extensionFor(file)}`
}

export type ImageKind = 'png' | 'jpg' | 'gif' | 'webp'

export const IMAGE_MIMES: Record<ImageKind, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** What the bytes say the image is, whatever the upload claims. */
export function sniffImage(b: Uint8Array): ImageKind | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif'
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return 'webp'
  return null
}

/** Store bytes under the caller's ownership so /storage can check who may read them. */
export async function putObject(
  bucket: R2Bucket,
  key: string,
  bytes: ArrayBuffer,
  contentType: string,
  ownerId: number,
  name: string,
): Promise<void> {
  await bucket.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { owner: String(ownerId), name },
  })
}

/** The File entries under a multipart field, whether one or many were sent. */
export function filesFrom(body: Record<string, unknown>, field: string): File[] {
  const raw = body[field]
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]
  return list.filter((f): f is File => f instanceof File)
}
```

- [ ] **Step 4: Implement the three routes**

`worker/src/routes/scan.ts`:

```ts
import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { invalid } from '../errors'
import { ownBoard } from '../scope'
import { storageUrl } from '../serialize'
import { IMAGE_MIMES, MAX_FILE_BYTES, filesFrom, objectKey, putObject, sniffImage } from '../uploads'

/**
 * Stores a screenshot of a message. Reading it automatically is not part of
 * this deployment, so the reply is always the capture-and-type shape — which is
 * a complete way to work, not a degraded one, and says nothing about configuration.
 */
export const scan = new Hono<AppEnv>()

const ALLOWED = new Set(Object.values(IMAGE_MIMES))

scan.post('/boards/:slug/scan', async (c) => {
  ownBoard(c)
  const body = await c.req.parseBody({ all: true })
  const [image] = filesFrom(body, 'image')

  if (!image) throw invalid('image', 'The image field is required.')
  if (!ALLOWED.has(image.type)) throw invalid('image', 'The image must be a file of type: png, jpg, jpeg, gif, webp.')
  if (image.size > MAX_FILE_BYTES) throw invalid('image', 'The image may not be greater than 10240 kilobytes.')

  const bytes = await image.arrayBuffer()
  const kind = sniffImage(new Uint8Array(bytes))
  if (!kind || IMAGE_MIMES[kind] !== image.type) throw invalid('image', 'The image must be an image.')

  const key = objectKey('screenshots', image)
  await putObject(c.env.FILES, key, bytes, image.type, c.get('user').id, image.name)

  return c.json({
    screenshot: { path: key, url: storageUrl(key) },
    source: 'Manual',
    rows: [],
    error: null,
    manual: true,
  })
})
```

`worker/src/routes/files.ts`:

```ts
import { Hono } from 'hono'
import { nowIso } from '../dates'
import { note } from '../db'
import type { AppEnv } from '../env'
import { invalid, notFound } from '../errors'
import { findTask } from '../queries'
import { fileJson, type FileRow } from '../serialize'
import { MAX_FILES, MAX_FILE_BYTES, filesFrom, objectKey, putObject } from '../uploads'

export const files = new Hono<AppEnv>()

files.post('/tasks/:id/files', async (c) => {
  const board = c.get('board')
  const db = c.env.DB
  const task = await findTask(db, board.id, Number(c.req.param('id')))
  if (!task) throw notFound()

  const body = await c.req.parseBody({ all: true })
  const list = filesFrom(body, 'files[]')
  if (list.length === 0) throw invalid('files', 'The files field is required.')
  if (list.length > MAX_FILES) throw invalid('files', `The files may not have more than ${MAX_FILES} items.`)
  list.forEach((f, i) => {
    if (f.size > MAX_FILE_BYTES) throw invalid(`files.${i}`, `The files.${i} may not be greater than 10240 kilobytes.`)
  })

  const made: FileRow[] = []
  for (const f of list) {
    const key = objectKey('attachments', f)
    const mime = f.type || 'application/octet-stream'
    await putObject(c.env.FILES, key, await f.arrayBuffer(), mime, c.get('user').id, f.name)
    const row = await db
      .prepare(
        `INSERT INTO task_files (task_id, name, mime, size, path, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) RETURNING *`,
      )
      .bind(task.id, f.name, mime, f.size, key, nowIso())
      .first<FileRow>()
    made.push(row!)
  }

  await note(db, board.id, `Attached ${made.length} file(s): ${made.map((f) => f.name).join(', ')}`, task.id).run()

  return c.json({ data: made.map(fileJson) }, 201)
})

files.delete('/task-files/:id', async (c) => {
  const board = c.get('board')
  const db = c.env.DB
  const file = await db
    .prepare(`SELECT f.* FROM task_files f JOIN tasks t ON t.id = f.task_id WHERE f.id = ?1 AND t.board_id = ?2`)
    .bind(Number(c.req.param('id')), board.id)
    .first<FileRow>()
  if (!file) throw notFound()

  await c.env.FILES.delete(file.path)
  await db.batch([
    note(db, board.id, `Removed attachment ${file.name}`, file.task_id),
    db.prepare(`DELETE FROM task_files WHERE id = ?1`).bind(file.id),
  ])

  return c.body(null, 204)
})
```

`worker/src/routes/storage.ts`:

```ts
import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { notFound } from '../errors'

/** Streams an R2 object to the user who uploaded it. Mounted at /storage. */
export const storage = new Hono<AppEnv>()

const KEY = /^(screenshots|attachments)\/[A-Za-z0-9._-]+$/

storage.get('/*', async (c) => {
  const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/storage\//, ''))
  if (!KEY.test(key)) throw notFound()

  const object = await c.env.FILES.get(key)
  if (!object || object.customMetadata?.owner !== String(c.get('user').id)) throw notFound()

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Length': String(object.size),
      'Cache-Control': 'private, max-age=3600',
      ETag: object.httpEtag,
    },
  })
})
```

In `worker/src/app.ts`:

```ts
import { files } from './routes/files'
import { scan } from './routes/scan'
import { storage } from './routes/storage'
// …
  app.route('/api', scan)
  app.route('/api', files)
  app.route('/storage', storage)
```

- [ ] **Step 5: Run the tests**

```bash
npm --prefix worker test -- test/uploads.test.ts
npm --prefix worker test
```

Expected: 6 pass in this file; whole suite green. If `/storage/../wrangler.jsonc` comes back 200 from Hono's path normalisation, the `KEY` regex still rejects it — check the assertion is against the *response* status.

- [ ] **Step 6: Typecheck and commit**

```bash
npm --prefix worker run typecheck
git add worker/src worker/test
git commit -m "Worker: screenshots and attachments on R2 behind /storage

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Frontend — `/me`, board slug, user chip; Laravel `/me` stub

**Files:**
- Modify: `frontend/src/api.ts`, `frontend/src/App.tsx`, `frontend/src/styles/app.css`, `frontend/.env.example`
- Modify: `backend/routes/api.php`

**Interfaces:**
- Consumes: `GET /api/me` → `{ data: { email, name, board_slug } }` (Task 4).
- Produces: `api.me(): Promise<Me>`; `Me` type.

The frontend has no test runner; verification is `tsc -b`, `oxlint` and `vite build`, plus the Laravel route listing.

- [ ] **Step 1: `api.ts` — `me()`, session-ended detection, generic copy**

In `frontend/src/api.ts`:

1. After the `ApiError` class add:

```ts
/** Who is signed in. `email` is null on the local Laravel setup, which has no login. */
export interface Me {
  email: string | null
  name: string | null
  board_slug: string
}
```

2. In `request()`, change the fetch `catch` and add the non-JSON check right after the 204 return:

```ts
  } catch {
    throw new ApiError(0, 'Cannot reach the API.')
  }

  if (res.status === 204) return undefined as T

  // Cloudflare Access answers an expired session by redirecting the call to
  // its login page, which is HTML: treat that as signed out.
  const type = res.headers.get('content-type') ?? ''
  if (res.redirected || (res.ok && !type.includes('json'))) {
    throw new ApiError(401, 'Your session ended — reload to sign in again.')
  }
```

3. Add the first entry of the `api` object:

```ts
export const api = {
  me: () => request<Me>('/me'),

  getBoard: (slug: string) => request<Board>(`/boards/${encodeURIComponent(slug)}`),
```

- [ ] **Step 2: `App.tsx` — slug from `/me`, header chip**

1. Import: `import { ApiError, api, type BulkRow, type Me, type TaskInput } from './api'`
2. Delete `const BOARD_SLUG = 'task-mania'`.
3. Next to `const [board, setBoard] = useState<Board | null>(null)` add:

```ts
  const [me, setMe] = useState<Me | null>(null)
  // The board slug comes from /me; a ref keeps the callbacks below free of it.
  const slugRef = useRef('')
```

4. In `load`, replace `setBoard(await api.getBoard(BOARD_SLUG))` with:

```ts
      const who = await api.me()
      slugRef.current = who.board_slug
      setMe(who)
      setBoard(await api.getBoard(who.board_slug))
```

5. Replace every remaining `BOARD_SLUG` with `slugRef.current` (`api.scan`, `api.bulkCreate`, the reload after a failed move, both `api.createTask` calls). `grep -n BOARD_SLUG frontend/src/App.tsx` must print nothing afterwards.

6. In the header's `<div className="hdr__actions">`, after the hidden `<input ref={shotRef} …/>`, add:

```tsx
          {me?.email && (
            <div className="hdr__user">
              <span className="hdr__user-email" title={me.email}>{me.email}</span>
              <a className="btn btn-ghost" href="/cdn-cgi/access/logout" style={{ fontSize: 12, minHeight: 30 }}>
                Log out
              </a>
            </div>
          )}
```

- [ ] **Step 3: Styles and env note**

In `frontend/src/styles/app.css`, directly after the `.hdr__count` rule:

```css
.hdr__user { display: flex; align-items: center; gap: var(--space-2); }
.hdr__user-email {
  font-size: 10.5px; color: var(--color-neutral-500); white-space: nowrap;
  max-width: 180px; overflow: hidden; text-overflow: ellipsis;
}
```

Replace `frontend/.env.example` with:

```
# Where the Laravel API lives for local development. Everything in a Vite env
# file is compiled into the browser bundle, so never put a secret here.
# The Cloudflare build (worker/) overrides this with /api: same origin, no CORS.
VITE_API_URL=http://127.0.0.1:8000/api
```

- [ ] **Step 4: Laravel `/me` stub**

In `backend/routes/api.php`, before `Route::get('boards', …)`:

```php
// The Cloudflare build signs people in and gives each their own board; the
// local setup has no login and one board, so the UI asks here first either way.
Route::get('me', fn () => response()->json([
    'data' => ['email' => null, 'name' => null, 'board_slug' => 'task-mania'],
]));
```

- [ ] **Step 5: Verify**

```bash
npm --prefix frontend run lint
npm --prefix frontend run build
grep -n BOARD_SLUG frontend/src/App.tsx
php backend/artisan route:list --path=api/me
```

Expected: lint clean, `tsc -b && vite build` succeeds, no `BOARD_SLUG` left, and the route list shows `GET|HEAD api/me`. (`php` runs from the repo root because `artisan` resolves its own base path.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api.ts frontend/src/App.tsx frontend/src/styles/app.css frontend/.env.example backend/routes/api.php
git commit -m "UI: ask /me for the board, show who is signed in

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Docs and a local end-to-end run

**Files:**
- Create: `worker/README.md`, `worker/.dev.vars.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above; `npm --prefix worker run dev` (Task 1 scripts).

- [ ] **Step 1: Write the worker guide**

`worker/README.md`:

````markdown
# Task Mania on Cloudflare

This folder is the Cloudflare build of Task Mania: one Worker that serves the
React UI (built from `../frontend`) and a Hono API mirroring the Laravel one,
on the free plan. Rows live in D1, screenshots and attachments in R2, and
Cloudflare Access handles sign-in — every email that signs in gets a private
board.

```
worker/
  wrangler.jsonc     Worker name, D1 + R2 bindings, static assets, vars
  migrations/        D1 schema; the deploy applies new files automatically
  src/               Hono app (routes/, auth.ts, queries.ts, uploads.ts …)
  test/              vitest on the Workers runtime (local D1 + R2)
```

## Run it locally

```bash
npm --prefix worker install            # once
copy worker\.dev.vars.example worker\.dev.vars   # who you are without Access
npm --prefix worker run dev            # builds the UI, migrates local D1, serves http://localhost:8787
```

`npm --prefix worker test` runs the suite; `npm --prefix worker run typecheck` the compiler.

The local Laravel + XAMPP setup in `../backend` keeps working independently
(`php artisan serve` + `npm run dev` in `../frontend`); it has its own data.

## First deploy (once, about 15 minutes)

You need a free Cloudflare account and this repository on GitHub.

1. **Sign in from your PC** — in `worker/`: `npx wrangler login`.
2. **Create the database and the bucket**

   ```bash
   npx wrangler d1 create task-mania
   npx wrangler r2 bucket create task-mania-files
   ```

   Paste the `database_id` the first command prints into `wrangler.jsonc`.
   Commit and push.
3. **Connect the repository** — dashboard → *Workers & Pages* → *Create* →
   *Import a repository* → pick `task-mania`. Settings: root directory
   `worker`, build command `npm run build`, deploy command `npm run deploy`.
   Save and deploy. The first build applies the migrations and publishes
   `https://task-mania.<your-account>.workers.dev`. Every API call answers
   `401` until step 5 — expected.
4. **Turn on Access** — the Worker → *Settings* → *Domains & Routes* →
   `workers.dev` → *Enable Cloudflare Access*. If Zero Trust asks you to pick a
   team name, do; your team domain is `https://<team>.cloudflareaccess.com`.
   Then *Manage Cloudflare Access* → the application → *Policies*: edit the
   policy so **Include = Everyone**, login method **One-time PIN**. On the
   application's overview copy the **Application Audience (AUD) tag**.
5. **Tell the Worker about Access** — put the team domain and the AUD tag into
   `vars` in `wrangler.jsonc` (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`), commit,
   push. The push redeploys.
6. Open the URL, type your email, enter the PIN from the mail. Your board is there.

## Day to day

- **Deploy**: push to `main`. Build → migrations → deploy, about two minutes.
- **Logs**: the Worker → *Observability*, or `npx wrangler tail` in `worker/`.
- **Database**: dashboard → *Storage & Databases* → *D1* → `task-mania` →
  *Console* (SQL box), or `npx wrangler d1 execute DB --remote --command "SELECT count(*) FROM tasks"`.
- **Files**: dashboard → *R2* → `task-mania-files`.
- **Who may sign in**: the Access application → *Policies*. Change *Include*
  to a list of emails or an email domain to close the door. The free plan
  covers 50 users a month.
- **Schema change**: add `migrations/0002_<what>.sql`; the next deploy applies it.
- **Start over**: `npx wrangler d1 execute DB --remote --command "DELETE FROM users"`
  cascades to boards, tasks, files and activity rows. Objects in R2 stay;
  empty the bucket from its page if you want them gone too.

## Free-plan limits

Workers 100k requests/day · D1 5 GB, 5M row reads and 100k row writes/day ·
R2 10 GB · Access 50 users/month. A person, or a small team, stays far below.

## If something is off

- **401 on every request** after Access is on → `ACCESS_TEAM_DOMAIN` /
  `ACCESS_AUD` missing or wrong in `wrangler.jsonc`.
- **"Your session ended"** in the UI → the Access session expired; reload.
  Session length: Zero Trust → *Settings* → *Authentication*.
- **No PIN email** → check spam; allow `notify.cloudflare.com`.
- **Build fails installing the frontend** → `frontend/package-lock.json` must
  be committed (`npm ci` needs it).
- **Zero Trust wants a payment method** — it does that on the free plan for
  some accounts; you are not charged. If you would rather not add one, ask for
  the app-level password fallback instead of Access.
````

- [ ] **Step 2: The dev-vars example and the root README pointer**

`worker/.dev.vars.example`:

```
# Copy to .dev.vars (git-ignored). Who you are under `wrangler dev`, where there
# is no Cloudflare Access in front. Never set this in production vars.
ACCESS_DEV_EMAIL=you@example.com
```

In the root `README.md`, after the *Running it* section (before *Screenshots*), add:

```markdown
## Running it on Cloudflare

The same app runs on Cloudflare's free plan — UI, API, database and files —
with Cloudflare Access sign-in and a private board per email. `worker/` holds
that build; [`worker/README.md`](worker/README.md) covers local runs, the
one-time setup and day-to-day operations.
```

- [ ] **Step 3: Run the whole thing locally**

```bash
copy worker\.dev.vars.example worker\.dev.vars
```

(bash: `cp worker/.dev.vars.example worker/.dev.vars`.) Edit it so `ACCESS_DEV_EMAIL` is your own email.

In a second terminal: `npm --prefix worker run dev` — wait for `Ready on http://localhost:8787`. Then:

```bash
grep -l '"/api"' frontend/dist/assets/*.js
curl -s http://localhost:8787/api/me
curl -s http://localhost:8787/ | grep -c '<div id="root">'
curl -s -o /dev/null -w "%{http_code}" http://localhost:8787/storage/screenshots/nope.png
```

Expected, in order: at least one bundle path (the build baked in `/api`);
`{"data":{"email":"<your email>","name":null,"board_slug":"b-…"}}`; `1`; `404`.

Open http://localhost:8787 in a browser and check: the board loads with your
email and **Log out** in the header; **+ Task** adds a card; **Add from
screenshot** (or paste an image with Ctrl+V) opens the review panel with the
image and saves tasks; opening a task and pasting an image attaches it; drag a
card between lanes and reload — it stays. Stop the dev server with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add worker/README.md worker/.dev.vars.example README.md
git commit -m "Docs: running and deploying Task Mania on Cloudflare

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Merge, push, first deploy

**Files:** none new. The dashboard steps are the user's to click; the checklist below is what "done" means.

- [ ] **Step 1: Final verification on the branch**

```bash
npm --prefix worker test
npm --prefix worker run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
git status
```

Expected: every suite green, both builds clean, no uncommitted changes.

- [ ] **Step 2: Merge into main**

```bash
git checkout main
git merge --ff-only cloudflare
git log --oneline -12
```

Expected: the eleven task commits (Tasks 1–11) on top of `bf55276`.

- [ ] **Step 3: Push to GitHub**

If `git remote -v` prints nothing, create the repository first — with the GitHub CLI:

```bash
gh repo create task-mania --private --source=. --remote=origin
```

or on github.com (*New repository*, private, no README) and then
`git remote add origin https://github.com/<you>/task-mania.git`. Then:

```bash
git push -u origin main
```

- [ ] **Step 4: Cloudflare setup (user, ~15 minutes)**

Follow *First deploy* in `worker/README.md` steps 1–6. Two commits come out of
it (the D1 id; the Access vars) — push each.

- [ ] **Step 5: Verify the live app**

- `https://task-mania.<account>.workers.dev` asks for an email, mails a PIN, and shows an empty board with the email in the header.
- Sign in from a private window with a second email: a different, empty board.
- On the first board: add a task, paste a screenshot to create one, attach a file to a task, drag between lanes, reload — everything persists.
- From the second account, paste the first account's screenshot URL (`…/storage/screenshots/…`) into the address bar: **404**.
- Log out from the header link; the next visit asks for a PIN again.
