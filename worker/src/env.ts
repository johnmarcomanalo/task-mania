/** Bindings and vars declared in wrangler.jsonc (and vitest.config.ts). */
export interface Env {
  DB: D1Database
  FILES: R2Bucket
  APP_TIMEZONE?: string
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  /** Local development only: act as this email when no Access JWT is present. */
  ACCESS_DEV_EMAIL?: string
}

export interface AuthUser {
  id: number
  email: string
  name: string | null
}

export interface AuthBoard {
  id: number
  slug: string
  name: string
  description: string | null
}

/** Hono generics: bindings plus the per-request user and board. */
export type AppEnv = {
  Bindings: Env
  Variables: { user: AuthUser; board: AuthBoard }
}
