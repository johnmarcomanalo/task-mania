import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { notFound } from '../errors'
import { IMAGE_MIMES } from '../uploads'

/** Streams an R2 object to the user who uploaded it. Mounted at /storage. */
export const storage = new Hono<AppEnv>()

const KEY = /^(screenshots|attachments)\/[A-Za-z0-9._-]+$/
const INLINE_TYPES = new Set<string>(Object.values(IMAGE_MIMES))

// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME_CHARS = /["\u0000-\u001f\u007f]/g

/** Strip quotes and control characters so a stored name can't break the header. */
function safeFilename(name: string): string {
  return name.replace(UNSAFE_FILENAME_CHARS, '')
}

storage.get('/*', async (c) => {
  let key: string
  try {
    key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/storage\//, ''))
  } catch {
    throw notFound()
  }
  if (!KEY.test(key)) throw notFound()

  const object = await c.env.FILES.get(key)
  if (!object || object.customMetadata?.owner !== String(c.get('user').id)) throw notFound()

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Cache-Control', 'private, max-age=3600')
  headers.set('ETag', object.httpEtag)

  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream'
  if (!INLINE_TYPES.has(contentType)) {
    const name = safeFilename(object.customMetadata?.name || key.split('/').pop() || 'download')
    headers.set('Content-Disposition', `attachment; filename="${name}"`)
  }

  return new Response(object.body, { headers })
})
