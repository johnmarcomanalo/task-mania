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

const DEV_HOSTS = new Set(['localhost', '127.0.0.1'])

/**
 * Who is calling. A Cf-Access-Jwt-Assertion header is verified against the
 * team's keys; without one, the local dev bypass applies when ACCESS_DEV_EMAIL
 * is set AND the request's own hostname is localhost or 127.0.0.1 — what
 * `wrangler dev` and the tests use (Ruling R5). Any other host never gets the
 * bypass, even if the var were ever set in production by mistake. X-Dev-Email
 * may override the configured address so tests can be several people. Null
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

  if (env.ACCESS_DEV_EMAIL && DEV_HOSTS.has(new URL(req.url).hostname)) {
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
