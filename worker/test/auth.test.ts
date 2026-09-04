import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { Env } from '../src/env'
import { ALICE, app, BOB, env, get, json, meOf } from './helpers'

describe('dev bypass', () => {
  it('signs the caller in as the dev email and gives them a board', async () => {
    const me = await meOf(ALICE)
    expect(me.email).toBe(ALICE)
    expect(me.name).toBeNull()
    expect(me.board_slug).toMatch(/^b-[a-z2-7]{8}$/)
  })

  it('creates the default columns and sources once', async () => {
    const first = await meOf(ALICE)
    const second = await meOf(ALICE)
    expect(second.board_slug).toBe(first.board_slug)

    const cols = await env.DB.prepare(
      `SELECT c.key, c.is_done, c.is_cancelled FROM board_columns c JOIN boards b ON b.id = c.board_id
        WHERE b.slug = ?1 ORDER BY c.position`,
    ).bind(first.board_slug).all<{ key: string; is_done: number; is_cancelled: number }>()
    expect(cols.results.map((c) => c.key)).toEqual(['inbox', 'todo', 'doing', 'wait', 'review', 'done', 'cancelled'])
    expect(cols.results.map((c) => c.is_done)).toEqual([0, 0, 0, 0, 0, 1, 0])
    expect(cols.results.map((c) => c.is_cancelled)).toEqual([0, 0, 0, 0, 0, 0, 1])

    const sources = await env.DB.prepare(
      `SELECT s.name FROM sources s JOIN boards b ON b.id = s.board_id WHERE b.slug = ?1 ORDER BY s.position`,
    ).bind(first.board_slug).all<{ name: string }>()
    expect(sources.results.map((s) => s.name)).toEqual([
      'Viber', 'Email', 'Messenger', 'WhatsApp', 'Teams', 'SMS', 'Slack', 'Manual',
    ])
  })

  it('gives different people different boards', async () => {
    expect((await meOf(ALICE)).board_slug).not.toBe((await meOf(BOB)).board_slug)
  })

  it('lower-cases and trims the email', async () => {
    expect((await meOf('  Carol@Example.COM ')).email).toBe('carol@example.com')
  })

  it('refuses when there is neither a token nor a dev email', async () => {
    const res = await createApp().request('/api/me', {}, { ...env, ACCESS_DEV_EMAIL: undefined })
    expect(res.status).toBe(401)
    expect(await json(res)).toEqual({ message: 'Not signed in.' })
  })

  it('does not honour the dev bypass off localhost', async () => {
    const res = await app.request(
      'http://task-mania.example.workers.dev/api/me',
      { headers: { 'X-Dev-Email': ALICE } },
      env,
    )
    expect(res.status).toBe(401)
    expect(await json(res)).toEqual({ message: 'Not signed in.' })
  })
})

describe('Access JWT', () => {
  let privateKey: CryptoKey
  let app: ReturnType<typeof createApp>
  const strict: Env = { ...env, ACCESS_DEV_EMAIL: undefined }

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256')
    privateKey = pair.privateKey
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
    app = createApp({ keys: createLocalJWKSet({ keys: [jwk] }) })
  })

  const token = (claims: Record<string, unknown>, issuer = env.ACCESS_TEAM_DOMAIN!, audience = env.ACCESS_AUD!, exp = '1h') =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(privateKey)

  const withToken = async (t: string) =>
    app.request('/api/me', { headers: { 'Cf-Access-Jwt-Assertion': t } }, strict)

  it('accepts a token signed for this application', async () => {
    const res = await withToken(await token({ email: 'Dana@Example.com' }))
    expect(res.status).toBe(200)
    expect((await json(res)).data.email).toBe('dana@example.com')
  })

  it('rejects the wrong audience', async () => {
    const res = await withToken(await token({ email: 'dana@example.com' }, undefined, 'other-app'))
    expect(res.status).toBe(401)
  })

  it('rejects the wrong issuer', async () => {
    const res = await withToken(await token({ email: 'dana@example.com' }, 'https://other.cloudflareaccess.com'))
    expect(res.status).toBe(401)
  })

  it('rejects an expired token', async () => {
    const res = await withToken(await token({ email: 'dana@example.com' }, undefined, undefined, '-1s'))
    expect(res.status).toBe(401)
  })

  it('rejects a token without an email', async () => {
    const res = await withToken(await token({ sub: 'x' }))
    expect(res.status).toBe(401)
  })

  it('rejects a token signed by another key', async () => {
    const other = await generateKeyPair('RS256')
    const forged = await new SignJWT({ email: 'eve@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(env.ACCESS_TEAM_DOMAIN!)
      .setAudience(env.ACCESS_AUD!)
      .setExpirationTime('1h')
      .sign(other.privateKey)
    expect((await withToken(forged)).status).toBe(401)
  })

  it('ignores the dev header when a token is present', async () => {
    const res = await app.request(
      '/api/me',
      { headers: { 'Cf-Access-Jwt-Assertion': await token({ email: 'dana@example.com' }), 'X-Dev-Email': BOB } },
      env,
    )
    expect((await json(res)).data.email).toBe('dana@example.com')
  })
})

describe('provisioning', () => {
  async function lastSeenAt(email: string): Promise<string> {
    const row = await env.DB.prepare(`SELECT last_seen_at FROM users WHERE email = ?1`).bind(email).first<{
      last_seen_at: string
    }>()
    return row!.last_seen_at
  }

  it('re-touches last_seen_at only once it is more than an hour stale', async () => {
    await meOf(ALICE)

    const staleAt = new Date(Date.now() - 2 * 3600_000).toISOString()
    await env.DB.prepare(`UPDATE users SET last_seen_at = ?1 WHERE email = ?2`).bind(staleAt, ALICE).run()
    await meOf(ALICE)
    expect(await lastSeenAt(ALICE)).not.toBe(staleAt)

    const freshAt = new Date(Date.now() - 5 * 60_000).toISOString()
    await env.DB.prepare(`UPDATE users SET last_seen_at = ?1 WHERE email = ?2`).bind(freshAt, ALICE).run()
    await meOf(ALICE)
    expect(await lastSeenAt(ALICE)).toBe(freshAt)
  })

  it('never provisions a user from /storage', async () => {
    const res = await get('/storage/screenshots/x.png', 'never-seen@example.com')
    expect(res.status).toBe(404)
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users`).first<{ n: number }>()
    expect(count!.n).toBe(0)
  })
})

describe('routing', () => {
  it('answers unknown API paths with JSON 404', async () => {
    const res = await get('/api/nothing')
    expect(res.status).toBe(404)
    expect(await json(res)).toEqual({ message: 'Not found.' })
  })
})
