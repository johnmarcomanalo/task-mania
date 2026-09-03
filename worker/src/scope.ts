import type { Context } from 'hono'
import type { AppEnv, AuthBoard } from './env'
import { notFound } from './errors'

/** The :slug in the URL must be the caller's own board; anything else is a 404, not a 403. */
export function ownBoard(c: Context<AppEnv>): AuthBoard {
  const board = c.get('board')
  if (c.req.param('slug') !== board.slug) throw notFound()
  return board
}

/**
 * A route :id must be a plain positive integer — its string form round-tripped
 * through parseInt has to match the raw param exactly, so "12abc", "1.5", "-1",
 * "0x1", "1e2" and leading zeroes or whitespace all 404 instead of being
 * coerced (or silently matching nothing) further down.
 */
export function idParam(c: Context<AppEnv>, name = 'id'): number {
  const raw = c.req.param(name)
  const id = raw === undefined ? NaN : Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== raw) throw notFound()
  return id
}
