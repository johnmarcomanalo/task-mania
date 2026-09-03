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
