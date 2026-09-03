import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { requireUser, type AuthOptions } from './auth'
import type { AppEnv } from './env'
import { HttpError, ValidationError } from './errors'
import { boards } from './routes/boards'
import { files } from './routes/files'
import { me } from './routes/me'
import { scan } from './routes/scan'
import { sources } from './routes/sources'
import { storage } from './routes/storage'
import { tasks } from './routes/tasks'

export function createApp(options: AuthOptions = {}) {
  const app = new Hono<AppEnv>()

  app.onError((err, c) => {
    if (err instanceof ValidationError) return c.json({ message: err.message, errors: err.errors }, 422)
    if (err instanceof HttpError) return c.json({ message: err.message }, err.status as ContentfulStatusCode)
    console.error(err)
    return c.json({ message: 'Server error.' }, 500)
  })

  app.notFound((c) => c.json({ message: 'Not found.' }, 404))

  app.use('/api/*', requireUser(options))
  app.use('/storage/*', requireUser({ ...options, provision: false }))

  app.route('/api', me)
  app.route('/api', boards)
  app.route('/api', sources)
  app.route('/api', tasks)
  app.route('/api', scan)
  app.route('/api', files)
  app.route('/storage', storage)

  return app
}
