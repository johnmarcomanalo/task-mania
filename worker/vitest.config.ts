import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'))

  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          compatibilityDate: '2026-09-01',
          d1Databases: ['DB'],
          r2Buckets: ['FILES'],
          bindings: {
            APP_TIMEZONE: 'Asia/Manila',
            ACCESS_TEAM_DOMAIN: 'https://test.cloudflareaccess.com',
            ACCESS_AUD: 'test-aud',
            ACCESS_DEV_EMAIL: 'alice@example.com',
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts', './test/reset.ts'],
    },
  }
})
