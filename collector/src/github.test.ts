import { createVerify, generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appJwt, get, resetAppToken } from './github.ts'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A fake API: the App endpoints mint numbered tokens, everything else echoes the token it got. */
function fakeApi(opts: { expiresInMs?: number; rejectToken?: string } = {}) {
  let minted = 0
  const calls: { url: string; auth: string | null }[] = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('authorization')
    calls.push({ url, auth })
    if (url.endsWith('/orgs/acme/installation')) return json({ id: 42 })
    if (url.endsWith('/app/installations/42/access_tokens')) {
      minted += 1
      const expiresAt = new Date(Date.now() + (opts.expiresInMs ?? 3_600_000)).toISOString()
      return json({ token: `app-${minted}`, expires_at: expiresAt }, 201)
    }
    if (auth === `Bearer ${opts.rejectToken}`) return json({ message: 'Bad credentials' }, 401)
    return json({ token: auth })
  })
  return { fetchMock, calls, minted: () => minted }
}

describe('appJwt', () => {
  it('signs a ten minute RS256 token for the App that GitHub can verify', () => {
    const now = Date.UTC(2026, 9, 20, 3, 0, 0)
    const [header, payload, signature] = appJwt('123', PEM, now).split('.')
    const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString())
    expect(claims).toEqual({ iat: now / 1000 - 60, exp: now / 1000 + 540, iss: '123' })
    const verified = createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(publicKey, Buffer.from(signature ?? '', 'base64url'))
    expect(verified).toBe(true)
  })
})

describe('App token refresh', () => {
  beforeEach(() => {
    resetAppToken()
    vi.stubEnv('GITHUB_TOKEN', 'given')
    vi.stubEnv('GITHUB_APP_ID', '123')
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', PEM.replace(/\n/g, '\\n'))
    vi.stubEnv('GITHUB_APP_OWNER', 'acme')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    resetAppToken()
  })

  it('mints its own token once and reuses it while it is fresh', async () => {
    const api = fakeApi()
    vi.stubGlobal('fetch', api.fetchMock)
    expect(await get('/repos/acme/a')).toEqual({ token: 'Bearer app-1' })
    expect(await get('/repos/acme/b')).toEqual({ token: 'Bearer app-1' })
    expect(api.minted()).toBe(1)
  })

  it('mints a new token before the old one expires, so a long collection never runs on a dead one', async () => {
    const api = fakeApi({ expiresInMs: 5 * 60_000 })
    vi.stubGlobal('fetch', api.fetchMock)
    await get('/repos/acme/a')
    expect(await get('/repos/acme/b')).toEqual({ token: 'Bearer app-2' })
  })

  it('mints again and retries once when a request answers 401', async () => {
    const api = fakeApi({ rejectToken: 'app-1' })
    vi.stubGlobal('fetch', api.fetchMock)
    expect(await get('/repos/acme/a')).toEqual({ token: 'Bearer app-2' })
  })

  it('falls back to the given token when the App cannot mint one', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/installation')) return json({ message: 'nope' }, 401)
      return json({ token: new Headers(init?.headers).get('authorization') })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await get('/repos/acme/a')).toEqual({ token: 'Bearer given' })
  })

  it('uses the given token alone when no App credentials are set', async () => {
    vi.stubEnv('GITHUB_APP_ID', '')
    const api = fakeApi()
    vi.stubGlobal('fetch', api.fetchMock)
    expect(await get('/repos/acme/a')).toEqual({ token: 'Bearer given' })
    expect(api.minted()).toBe(0)
  })
})
