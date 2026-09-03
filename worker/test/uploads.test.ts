import { describe, expect, it } from 'vitest'
import { ALICE, BOB, boardOf, call, columnOf, del, env, get, json, meOf, post } from './helpers'

// A 1×1 transparent PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function pngFile(name = 'shot.png'): File {
  const bytes = Uint8Array.from(atob(PNG), (ch) => ch.charCodeAt(0))
  return new File([bytes], name, { type: 'image/png' })
}

function form(field: string, ...files: File[]): FormData {
  const f = new FormData()
  for (const file of files) f.append(field, file)
  return f
}

async function userId(email: string): Promise<number> {
  return (await env.DB.prepare(`SELECT id FROM users WHERE email = ?1`).bind(email).first<{ id: number }>())!.id
}

async function taskFor(who = ALICE): Promise<number> {
  const board = await boardOf(who)
  const res = await post(`/api/boards/${board.slug}/tasks`, { column_id: columnOf(board, 'inbox'), title: 'With files' }, who)
  return (await json(res)).data.id
}

describe('scan', () => {
  it('stores the screenshot under the caller and answers the manual shape', async () => {
    const me = await meOf(ALICE)
    const res = await post(`/api/boards/${me.board_slug}/scan`, form('image', pngFile()))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.screenshot.path).toMatch(/^screenshots\/[0-9a-f-]{36}\.png$/)
    expect(body).toEqual({
      screenshot: { path: body.screenshot.path, url: `/storage/${body.screenshot.path}` },
      source: 'Manual',
      rows: [],
      error: null,
      manual: true,
    })

    const object = await env.FILES.head(body.screenshot.path)
    expect(object?.customMetadata).toEqual({ owner: String(await userId(ALICE)), name: 'shot.png' })
    expect(object?.httpMetadata?.contentType).toBe('image/png')
  })

  it('rejects a missing, non-image or mislabelled file', async () => {
    const me = await meOf(ALICE)
    const url = `/api/boards/${me.board_slug}/scan`

    expect((await post(url, new FormData())).status).toBe(422)

    const text = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const typed = await post(url, form('image', text))
    expect(typed.status).toBe(422)
    expect((await json(typed)).errors.image).toEqual(['The image must be a file of type: png, jpg, jpeg, gif, webp.'])

    const fake = new File(['hello'], 'fake.png', { type: 'image/png' })
    const sniffed = await post(url, form('image', fake))
    expect(sniffed.status).toBe(422)
    expect((await json(sniffed)).errors.image).toEqual(['The image must be an image.'])
  })

  it('rejects a malformed multipart body', async () => {
    const me = await meOf(ALICE)
    const res = await call(`/api/boards/${me.board_slug}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
      body: 'garbage',
    })
    expect(res.status).toBe(422)
    expect((await json(res)).errors.image).toEqual(['The image field is required.'])
  })
})

describe('storage', () => {
  it('serves an object to its owner only', async () => {
    const me = await meOf(ALICE)
    const { screenshot } = await json(await post(`/api/boards/${me.board_slug}/scan`, form('image', pngFile())))

    const mine = await get(screenshot.url)
    expect(mine.status).toBe(200)
    expect(mine.headers.get('content-type')).toBe('image/png')
    expect(mine.headers.get('cache-control')).toBe('private, max-age=3600')
    expect((await mine.arrayBuffer()).byteLength).toBe(pngFile().size)

    expect((await get(screenshot.url, BOB)).status).toBe(404)
    expect((await get('/storage/screenshots/missing.png')).status).toBe(404)
    expect((await get('/storage/../wrangler.jsonc')).status).toBe(404)
    expect((await get('/storage/other/x.png')).status).toBe(404)
  })

  it('hardens the response headers for a non-image attachment', async () => {
    const id = await taskFor()
    const notes = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const { data } = await json(await post(`/api/tasks/${id}/files`, form('files[]', notes)))

    const res = await get(data[0].url)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="notes\.txt"/)
  })

  it('serves an inline image with no content-disposition', async () => {
    const me = await meOf(ALICE)
    const { screenshot } = await json(await post(`/api/boards/${me.board_slug}/scan`, form('image', pngFile())))

    const res = await get(screenshot.url)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-disposition')).toBeNull()
  })

  it('404s instead of throwing on a malformed URI escape', async () => {
    expect((await get('/storage/%E0%A4%A')).status).toBe(404)
  })
})

describe('attachments', () => {
  it('attaches files, records them and logs one line', async () => {
    const id = await taskFor()
    const notes = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const res = await post(`/api/tasks/${id}/files`, form('files[]', pngFile(), notes))
    expect(res.status).toBe(201)

    const { data } = await json(res)
    expect(data).toHaveLength(2)
    expect(data[0]).toEqual({
      id: expect.any(Number), name: 'shot.png', mime: 'image/png', size: pngFile().size,
      url: expect.stringMatching(/^\/storage\/attachments\/[0-9a-f-]{36}\.png$/), is_image: true,
    })
    expect(data[1]).toMatchObject({ name: 'notes.txt', mime: 'text/plain', size: 5, is_image: false })
    expect(data[1].url).toMatch(/\.txt$/)

    expect((await get(data[0].url)).status).toBe(200)

    const board = await boardOf()
    expect(board.tasks[0].files).toHaveLength(2)
    expect(board.activity[0]).toMatchObject({ text: 'Attached 2 file(s): shot.png, notes.txt', task_id: id })
  })

  it('validates the batch and scopes the task', async () => {
    const id = await taskFor()
    const none = await post(`/api/tasks/${id}/files`, new FormData())
    expect(none.status).toBe(422)
    expect((await json(none)).errors.files).toEqual(['The files field is required.'])

    const many = form('files[]', ...Array.from({ length: 11 }, (_, i) => pngFile(`s${i}.png`)))
    expect((await post(`/api/tasks/${id}/files`, many)).status).toBe(422)

    expect((await post(`/api/tasks/${id}/files`, form('files[]', pngFile()), BOB)).status).toBe(404)
  })

  it('rejects a malformed multipart body', async () => {
    const id = await taskFor()
    const res = await call(`/api/tasks/${id}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
      body: 'garbage',
    })
    expect(res.status).toBe(422)
    expect((await json(res)).errors.files).toEqual(['The files field is required.'])
  })

  it('detaches a file, removing the object and the row', async () => {
    const id = await taskFor()
    const { data } = await json(await post(`/api/tasks/${id}/files`, form('files[]', pngFile())))
    const key = data[0].url.replace('/storage/', '')

    expect((await del(`/api/task-files/${data[0].id}`, BOB)).status).toBe(404)

    const res = await del(`/api/task-files/${data[0].id}`)
    expect(res.status).toBe(204)
    expect(await env.FILES.head(key)).toBeNull()
    expect(await env.DB.prepare(`SELECT id FROM task_files WHERE id = ?1`).bind(data[0].id).first()).toBeNull()

    const board = await boardOf()
    expect(board.activity[0]).toMatchObject({ text: 'Removed attachment shot.png', task_id: id })
  })
})
