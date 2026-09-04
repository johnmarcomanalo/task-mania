import { describe, expect, it } from 'vitest'
import { quotaOf } from '../src/quota'
import type { Env } from '../src/env'
import { ALICE, BOB, boardOf, call, columnOf, del, env, get, json, meOf, post } from './helpers'

const upload = (path: string, body: FormData, who: string, e: Env) => call(path, { method: 'POST', body }, who, e)

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

async function taskFor(who = ALICE): Promise<number> {
  const board = await boardOf(who)
  const res = await post(`/api/boards/${board.slug}/tasks`, { column_id: columnOf(board, 'inbox'), title: 'With files' }, who)
  return (await json(res)).data.id
}

interface Storage { used_bytes: number; files: number; limit_bytes: number; limit_files: number }

async function storageOf(who = ALICE): Promise<Storage> {
  return (await json(await get('/api/me', who))).data.storage
}

describe('quotaOf', () => {
  it('parses the vars and converts MB to bytes', () => {
    const quota = quotaOf({ ...env, STORAGE_USER_MB: '1', STORAGE_USER_FILES: '7', STORAGE_TOTAL_MB: '2' } as Env)
    expect(quota).toEqual({ userBytes: 1024 * 1024, userFiles: 7, totalBytes: 2 * 1024 * 1024 })
  })

  it('falls back to the defaults on garbage or negative values', () => {
    const quota = quotaOf({
      ...env,
      STORAGE_USER_MB: 'nope',
      STORAGE_USER_FILES: '-3',
      STORAGE_TOTAL_MB: undefined,
    } as Env)
    expect(quota).toEqual({ userBytes: 300 * 1024 * 1024, userFiles: 500, totalBytes: 5120 * 1024 * 1024 })
  })
})

describe('/api/me storage', () => {
  it('carries zero usage and the configured limits', async () => {
    expect(await storageOf(ALICE)).toEqual({
      used_bytes: 0, files: 0, limit_bytes: 300 * 1024 * 1024, limit_files: 500,
    })
  })
})

describe('scan quota', () => {
  it('refuses a scan past the per-user file cap', async () => {
    const me = await meOf(ALICE)
    const url = `/api/boards/${me.board_slug}/scan`
    const capped = { ...env, STORAGE_USER_FILES: '1' }

    const first = await upload(url, form('image', pngFile()), ALICE, capped)
    expect(first.status).toBe(200)

    const second = await upload(url, form('image', pngFile('shot2.png')), ALICE, capped)
    expect(second.status).toBe(422)
    expect((await json(second)).errors.image[0]).toMatch(/^File limit reached: 1 of 1 files\.$/)
  })
})

describe('attach quota', () => {
  it('refuses an attach past the per-user byte cap', async () => {
    const id = await taskFor()
    const capped = { ...env, STORAGE_USER_MB: '0.0000095367431640625' } // 10 bytes

    const small = new File(['12345'], 'small.txt', { type: 'text/plain' })
    const okRes = await upload(`/api/tasks/${id}/files`, form('files[]', small), ALICE, capped)
    expect(okRes.status).toBe(201)

    const big = new File(['123456'], 'big.txt', { type: 'text/plain' })
    const badRes = await upload(`/api/tasks/${id}/files`, form('files[]', big), ALICE, capped)
    expect(badRes.status).toBe(422)
    expect((await json(badRes)).errors.files[0]).toMatch(/^Storage limit reached: /)
  })

  it('refuses an attach past the total cap across users', async () => {
    const aliceTask = await taskFor(ALICE)
    const bobTask = await taskFor(BOB)
    const capped = { ...env, STORAGE_USER_MB: '1000', STORAGE_TOTAL_MB: '0.0000095367431640625' } // 10 bytes total

    const aliceFile = new File(['123456'], 'a.txt', { type: 'text/plain' })
    const aliceRes = await upload(`/api/tasks/${aliceTask}/files`, form('files[]', aliceFile), ALICE, capped)
    expect(aliceRes.status).toBe(201)

    const bobFile = new File(['123456'], 'b.txt', { type: 'text/plain' })
    const bobRes = await upload(`/api/tasks/${bobTask}/files`, form('files[]', bobFile), BOB, capped)
    expect(bobRes.status).toBe(422)
    expect((await json(bobRes)).errors.files[0]).toMatch(/^The app's storage is full/)
  })

  it('tracks usage through scan, attach, detach and delete, never going negative', async () => {
    const id = await taskFor()
    const png = pngFile()
    await post(`/api/boards/${(await meOf(ALICE)).board_slug}/scan`, form('image', png))

    const fileA = new File(['12345'], 'a.txt', { type: 'text/plain' })
    const fileB = new File(['123456'], 'b.txt', { type: 'text/plain' })
    const { data } = await json(await post(`/api/tasks/${id}/files`, form('files[]', fileA, fileB)))

    let storage = await storageOf(ALICE)
    expect(storage.files).toBe(3)
    expect(storage.used_bytes).toBe(png.size + fileA.size + fileB.size)

    await del(`/api/task-files/${data[0].id}`)
    storage = await storageOf(ALICE)
    expect(storage.files).toBe(2)
    expect(storage.used_bytes).toBe(png.size + fileB.size)

    await del(`/api/tasks/${id}`)
    storage = await storageOf(ALICE)
    expect(storage.files).toBe(1)
    expect(storage.used_bytes).toBe(png.size)
    expect(storage.used_bytes).toBeGreaterThanOrEqual(0)
    expect(storage.files).toBeGreaterThanOrEqual(0)
  })
})

describe('over the cap', () => {
  it('can still read and delete; only uploads are refused', async () => {
    const id = await taskFor()
    const capped = { ...env, STORAGE_USER_MB: '0.0000095367431640625' } // 10 bytes
    const big = new File(['1234567890123'], 'big.txt', { type: 'text/plain' })
    const rejected = await upload(`/api/tasks/${id}/files`, form('files[]', big), ALICE, capped)
    expect(rejected.status).toBe(422)

    const me = await meOf(ALICE)
    expect((await get(`/api/boards/${me.board_slug}`, ALICE)).status).toBe(200)
    expect((await del(`/api/tasks/${id}`)).status).toBe(204)
  })
})
