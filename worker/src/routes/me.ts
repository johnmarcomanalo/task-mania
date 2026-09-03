import { Hono } from 'hono'
import type { AppEnv } from '../env'

export const me = new Hono<AppEnv>()

me.get('/me', (c) => {
  const user = c.get('user')
  return c.json({ data: { email: user.email, name: user.name, board_slug: c.get('board').slug } })
})
