import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { requireUser, type AuthOptions } from './auth'
import type { AppEnv } from './env'
import { HttpError, ValidationError } from './errors'
import { boards } from './routes/boards'
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
  app.route('/api', boards)

  return app
}
