import { env as rawEnv } from 'cloudflare:workers'
import type { Env } from '../src/env'

export const env = rawEnv as unknown as Env
