import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { quotaOf, usageOf } from '../quota'

export const me = new Hono<AppEnv>()

me.get('/me', async (c) => {
  const user = c.get('user')
  const quota = quotaOf(c.env)
  const usage = await usageOf(c.env.DB, user.id)
  return c.json({
    data: {
      email: user.email,
      name: user.name,
      board_slug: c.get('board').slug,
      storage: { used_bytes: usage.bytes, files: usage.files, limit_bytes: quota.userBytes, limit_files: quota.userFiles },
    },
  })
})
