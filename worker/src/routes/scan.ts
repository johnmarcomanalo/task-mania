import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { invalid } from '../errors'
import { assertRoom, charge } from '../quota'
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
  const body = await c.req.parseBody({ all: true }).catch(() => {
    throw invalid('image', 'The image field is required.')
  })
  const [image] = filesFrom(body, 'image')

  if (!image) throw invalid('image', 'The image field is required.')
  if (!ALLOWED.has(image.type)) throw invalid('image', 'The image must be a file of type: png, jpg, jpeg, gif, webp.')
  if (image.size > MAX_FILE_BYTES) throw invalid('image', 'The image may not be greater than 10240 kilobytes.')

  const bytes = await image.arrayBuffer()
  const kind = sniffImage(new Uint8Array(bytes))
  if (!kind || IMAGE_MIMES[kind] !== image.type) throw invalid('image', 'The image must be an image.')

  const user = c.get('user')
  await assertRoom(c.env.DB, c.env, user.id, { bytes: image.size, files: 1 }, 'image')

  const key = objectKey('screenshots', image)
  await putObject(c.env.FILES, key, bytes, image.type, user.id, image.name)
  await charge(c.env.DB, user.id, bytes.byteLength, 1).run()

  return c.json({
    screenshot: { path: key, url: storageUrl(key) },
    source: 'Manual',
    rows: [],
    error: null,
    manual: true,
  })
})
