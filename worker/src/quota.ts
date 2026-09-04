import type { Env } from './env'
import { invalid } from './errors'

export interface Quota { userBytes: number; userFiles: number; totalBytes: number }

const MB = 1024 * 1024
function num(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Limits from the vars; defaults match wrangler.jsonc. */
export function quotaOf(env: Env): Quota {
  return {
    userBytes: Math.round(num(env.STORAGE_USER_MB, 300) * MB),
    userFiles: Math.round(num(env.STORAGE_USER_FILES, 500)),
    totalBytes: Math.round(num(env.STORAGE_TOTAL_MB, 5120) * MB),
  }
}

export interface Usage { bytes: number; files: number }

export async function usageOf(db: D1Database, userId: number): Promise<Usage> {
  const row = await db
    .prepare(`SELECT storage_bytes AS bytes, storage_files AS files FROM users WHERE id = ?1`)
    .bind(userId)
    .first<Usage>()
  return row ?? { bytes: 0, files: 0 }
}

export async function totalBytes(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT COALESCE(SUM(storage_bytes), 0) AS bytes FROM users`).first<{ bytes: number }>()
  return row!.bytes
}

export const fmtMb = (bytes: number) => (bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)

/**
 * Refuse an upload that would exceed the caller's or the app's limits.
 * `field` names the multipart field so the 422 lands on it ('image' for scan, 'files' for attach).
 */
export async function assertRoom(db: D1Database, env: Env, userId: number, incoming: Usage, field: 'image' | 'files'): Promise<void> {
  const quota = quotaOf(env)
  const used = await usageOf(db, userId)
  if (used.files + incoming.files > quota.userFiles)
    throw invalid(field, `File limit reached: ${used.files} of ${quota.userFiles} files.`)
  if (used.bytes + incoming.bytes > quota.userBytes)
    throw invalid(field, `Storage limit reached: ${fmtMb(used.bytes)} of ${fmtMb(quota.userBytes)} MB used.`)
  const total = await totalBytes(db)
  if (total + incoming.bytes > quota.totalBytes)
    throw invalid(field, `The app's storage is full (${fmtMb(total)} of ${fmtMb(quota.totalBytes)} MB).`)
}

/** Statement that records an upload against the user. */
export function charge(db: D1Database, userId: number, bytes: number, files: number): D1PreparedStatement {
  return db
    .prepare(`UPDATE users SET storage_bytes = storage_bytes + ?1, storage_files = storage_files + ?2 WHERE id = ?3`)
    .bind(bytes, files, userId)
}

/** Statement that gives the space back; never below zero. */
export function refund(db: D1Database, userId: number, bytes: number, files: number): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE users SET storage_bytes = MAX(0, storage_bytes - ?1), storage_files = MAX(0, storage_files - ?2) WHERE id = ?3`,
    )
    .bind(bytes, files, userId)
}
