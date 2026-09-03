import type { Context } from 'hono'
import type { AppEnv, AuthBoard } from './env'
import { notFound } from './errors'

/** The :slug in the URL must be the caller's own board; anything else is a 404, not a 403. */
export function ownBoard(c: Context<AppEnv>): AuthBoard {
  const board = c.get('board')
  if (c.req.param('slug') !== board.slug) throw notFound()
  return board
}
