import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

// Setup files run outside per-test storage isolation and may run more than
// once; applyD1Migrations only applies what is not applied yet.
const e = env as unknown as { DB: D1Database; TEST_MIGRATIONS: D1Migration[] }
await applyD1Migrations(e.DB, e.TEST_MIGRATIONS)
