export const MAX_FILE_BYTES = 10 * 1024 * 1024 // Laravel: max:10240 (KB)
export const MAX_FILES = 10

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/msword': 'doc',
}

/** Extension from the declared type, else from the name; letters and digits only. */
export function extensionFor(file: { type: string; name: string }): string {
  const byMime = EXT_BY_MIME[file.type]
  if (byMime) return byMime
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(file.name)
  return m ? m[1].toLowerCase() : 'bin'
}

/** Laravel's store() layout: <folder>/<random>.<ext>. */
export function objectKey(folder: 'screenshots' | 'attachments', file: { type: string; name: string }): string {
  return `${folder}/${crypto.randomUUID()}.${extensionFor(file)}`
}

export type ImageKind = 'png' | 'jpg' | 'gif' | 'webp'

export const IMAGE_MIMES: Record<ImageKind, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** What the bytes say the image is, whatever the upload claims. */
export function sniffImage(b: Uint8Array): ImageKind | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif'
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return 'webp'
  return null
}

/** Store bytes under the caller's ownership so /storage can check who may read them. */
export async function putObject(
  bucket: R2Bucket,
  key: string,
  bytes: ArrayBuffer,
  contentType: string,
  ownerId: number,
  name: string,
): Promise<void> {
  await bucket.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { owner: String(ownerId), name },
  })
}

/** The File entries under a multipart field, whether one or many were sent. */
export function filesFrom(body: Record<string, unknown>, field: string): File[] {
  const raw = body[field]
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]
  return list.filter((f): f is File => f instanceof File)
}
