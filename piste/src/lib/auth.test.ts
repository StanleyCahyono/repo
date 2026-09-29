import { describe, expect, it } from 'vitest'
import {
  authConfig,
  clientAddress,
  decideProxy,
  isApiPath,
  isPublicPath,
  isSameOriginPost,
  passcodeMatches,
  safeNextPath,
  SESSION_TTL_SECONDS,
  SignInLimiter,
  signSession,
  verifySession,
  type AuthConfig,
  type ProxyRequestInfo,
} from './auth'

const SECRET = 'x'.repeat(16) + 'y'.repeat(16) + 'z'.repeat(8)
const on = (passcode = 'correct horse battery', secret = SECRET) => {
  const cfg = authConfig({ PISTE_PASSCODE: passcode, PISTE_SESSION_SECRET: secret })
  if (cfg.state !== 'on') throw new Error('expected auth on')
  return cfg
}
const NOW = 1_800_000_000 // seconds

const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null })

describe('authConfig', () => {
  it('is off without a passcode (blank counts as unset)', () => {
    expect(authConfig({})).toEqual({ state: 'off' })
    expect(authConfig({ PISTE_PASSCODE: '   ', PISTE_SESSION_SECRET: SECRET })).toEqual({ state: 'off' })
  })

  it('refuses to enable auth with a missing or short secret (fail closed, never unprotected)', () => {
    expect(authConfig({ PISTE_PASSCODE: 'pass' })).toEqual({ state: 'misconfigured', problem: 'secret-missing' })
    expect(authConfig({ PISTE_PASSCODE: 'pass', PISTE_SESSION_SECRET: 'short' })).toEqual({ state: 'misconfigured', problem: 'secret-short' })
    expect(authConfig({ PISTE_PASSCODE: 'pass', PISTE_SESSION_SECRET: `  ${'a'.repeat(31)}  ` })).toMatchObject({ state: 'misconfigured', problem: 'secret-short' })
    expect(authConfig({ PISTE_PASSCODE: ' pass ', PISTE_SESSION_SECRET: 'a'.repeat(32) })).toEqual({ state: 'on', passcode: 'pass', secret: 'a'.repeat(32) })
  })
})

describe('session tokens', () => {
  it('round-trips a freshly signed token', () => {
    const cfg = on()
    const token = signSession(cfg, NOW)
    expect(token).toMatch(/^v1\.\d+\.\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/)
    expect(verifySession(cfg, token, NOW + 60)).toEqual({ ok: true, issuedAt: NOW, expiresAt: NOW + SESSION_TTL_SECONDS })
  })

  it('rejects tampered signatures and payloads', () => {
    const cfg = on()
    const token = signSession(cfg, NOW)
    const parts = token.split('.')
    const flipped = parts[4][0] === 'A' ? 'B' + parts[4].slice(1) : 'A' + parts[4].slice(1)
    expect(verifySession(cfg, [...parts.slice(0, 4), flipped].join('.'), NOW)).toEqual({ ok: false, reason: 'bad-signature' })
    // Extending the expiry invalidates the signature.
    const longer = [parts[0], parts[1], String(Number(parts[2]) + 3600), parts[3], parts[4]].join('.')
    expect(verifySession(cfg, longer, NOW)).toEqual({ ok: false, reason: 'bad-signature' })
    const otherNonce = [parts[0], parts[1], parts[2], 'AAAAAAAAAAAA', parts[4]].join('.')
    expect(verifySession(cfg, otherNonce, NOW)).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('rejects tokens signed with another secret or before a passcode change', () => {
    const token = signSession(on(), NOW)
    expect(verifySession(on('correct horse battery', 'q'.repeat(40)), token, NOW)).toEqual({ ok: false, reason: 'bad-signature' })
    expect(verifySession(on('a new passcode'), token, NOW)).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('expires, and refuses tokens issued in the future', () => {
    const cfg = on()
    const token = signSession(cfg, NOW, 3600)
    expect(verifySession(cfg, token, NOW + 3599).ok).toBe(true)
    expect(verifySession(cfg, token, NOW + 3600)).toEqual({ ok: false, reason: 'expired' })
    const future = signSession(cfg, NOW + 3600)
    expect(verifySession(cfg, future, NOW)).toEqual({ ok: false, reason: 'not-yet-valid' })
    // Within the tolerated clock skew.
    expect(verifySession(cfg, signSession(cfg, NOW + 120), NOW).ok).toBe(true)
  })

  it('rejects malformed input without throwing', () => {
    const cfg = on()
    for (const bad of ['', 'v1', 'v2.1.2.abcdefgh.' + 'a'.repeat(43), 'v1.1.2.abc.' + 'a'.repeat(43), 'v1.x.2.abcdefgh.' + 'a'.repeat(43), 'a'.repeat(500), 'v1.1.2.abcdefgh.' + 'a'.repeat(44)]) {
      expect(verifySession(cfg, bad, NOW).ok).toBe(false)
    }
    expect(verifySession(cfg, undefined, NOW)).toEqual({ ok: false, reason: 'missing' })
  })

  it('refuses a lifetime longer than the session TTL even when correctly signed', () => {
    const cfg = on()
    const token = signSession(cfg, NOW, SESSION_TTL_SECONDS * 3)
    expect(verifySession(cfg, token, NOW)).toEqual({ ok: false, reason: 'malformed' })
  })
})

describe('passcodeMatches', () => {
  it('matches only the configured passcode (trimmed), and ignores junk input', () => {
    const cfg = on('s3cret passcode')
    expect(passcodeMatches(cfg, 's3cret passcode')).toBe(true)
    expect(passcodeMatches(cfg, ' s3cret passcode ')).toBe(true)
    expect(passcodeMatches(cfg, 's3cret passcodE')).toBe(false)
    expect(passcodeMatches(cfg, 's3cret')).toBe(false)
    expect(passcodeMatches(cfg, '')).toBe(false)
    expect(passcodeMatches(cfg, null)).toBe(false)
    expect(passcodeMatches(cfg, 's'.repeat(5000))).toBe(false)
  })
})

describe('path matcher', () => {
  it('lets only sign-in, static build assets, the favicon and the map worker through', () => {
    for (const p of ['/signin', '/signin/signout', '/signin/fonts/ibm-plex-sans-latin-400-normal.woff2', '/_next/static/chunks/app.js', '/icon.svg', '/vendor/maplibre/maplibre-gl-worker.mjs']) {
      expect(isPublicPath(p), p).toBe(true)
    }
  })

  it('protects every page, API route, image endpoint and look-alike path', () => {
    for (const p of ['/', '/settings', '/sources', '/api/health', '/api/export/json', '/_next/image', '/_next/data/x.json', '/signinx', '/SIGNIN', '/signin%2f..%2fsettings', '/icon.svg.map', '/vendor/other.js', '/_next/staticx/a.js', '/favicon.ico']) {
      expect(isPublicPath(p), p).toBe(false)
    }
  })

  it('works on normalised paths: dot segments cannot escape a public prefix', () => {
    const norm = (p: string) => new URL(p, 'http://localhost').pathname
    expect(isPublicPath(norm('/signin/../settings'))).toBe(false)
    expect(isPublicPath(norm('/signin/%2e%2e/api/export/json'))).toBe(false)
    expect(isPublicPath(norm('/_next/static/../../api/refresh'))).toBe(false)
    expect(isPublicPath(norm('/vendor/maplibre/%2e%2e/%2e%2e/settings'))).toBe(false)
  })

  it('classifies API paths', () => {
    expect(isApiPath('/api')).toBe(true)
    expect(isApiPath('/api/refresh')).toBe(true)
    expect(isApiPath('/apix')).toBe(false)
    expect(isApiPath('/settings')).toBe(false)
  })
})

describe('safeNextPath (no open redirects)', () => {
  it('keeps same-origin paths with their query', () => {
    expect(safeNextPath('/explore?region=ne&date=2027-01-16')).toBe('/explore?region=ne&date=2027-01-16')
    expect(safeNextPath('/resorts/alta#plan')).toBe('/resorts/alta')
  })

  it('falls back to / for anything that could leave the site or loop', () => {
    for (const bad of [null, '', 'https://evil.example/', '//evil.example/x', '/\\evil.example', '\\\\evil', 'javascript:alert(1)', '/a\nb', '/a\rSet-Cookie:x', '/signin', '/signin?next=/x', '/signin/signout', '/' + 'x'.repeat(3000)]) {
      expect(safeNextPath(bad), String(bad)).toBe('/')
    }
  })

  it('leaves percent-encoded characters encoded (no header injection)', () => {
    expect(safeNextPath('/%0d%0aSet-Cookie:x')).toBe('/%0d%0aSet-Cookie:x')
  })
})

describe('decideProxy', () => {
  const req = (over: Partial<ProxyRequestInfo> = {}): ProxyRequestInfo => ({ pathname: '/settings', search: '', method: 'GET', isServerAction: false, sessionToken: null, ...over })
  const off: AuthConfig = { state: 'off' }
  const broken: AuthConfig = { state: 'misconfigured', problem: 'secret-short' }

  it('does nothing when no passcode is set', () => {
    expect(decideProxy(req({ pathname: '/api/export/json' }), off, NOW)).toEqual({ action: 'next' })
    expect(decideProxy(req({ isServerAction: true, method: 'POST' }), off, NOW)).toEqual({ action: 'next' })
  })

  it('sends signed-out page requests to /signin and answers APIs with 401', () => {
    const cfg = on()
    expect(decideProxy(req({ pathname: '/explore', search: '?region=ne' }), cfg, NOW)).toEqual({ action: 'signin', next: '/explore?region=ne' })
    expect(decideProxy(req({ pathname: '/api/health' }), cfg, NOW)).toEqual({ action: 'unauthorized-api' })
    expect(decideProxy(req({ pathname: '/api/refresh', method: 'POST' }), cfg, NOW)).toEqual({ action: 'unauthorized-api' })
    expect(decideProxy(req({ method: 'POST' }), cfg, NOW)).toEqual({ action: 'unauthorized' })
    expect(decideProxy(req({ pathname: '/_next/image', search: '?url=%2Fx' }), cfg, NOW)).toEqual({ action: 'signin', next: '/_next/image?url=%2Fx' })
  })

  it('lets a valid session through, and rejects an expired or forged one', () => {
    const cfg = on()
    const token = signSession(cfg, NOW)
    expect(decideProxy(req({ sessionToken: token }), cfg, NOW + 10)).toEqual({ action: 'next' })
    expect(decideProxy(req({ pathname: '/api/export/json', sessionToken: token }), cfg, NOW + 10)).toEqual({ action: 'next' })
    expect(decideProxy(req({ sessionToken: token }), cfg, NOW + SESSION_TTL_SECONDS + 1)).toMatchObject({ action: 'signin' })
    expect(decideProxy(req({ sessionToken: signSession(on('other'), NOW) }), cfg, NOW)).toMatchObject({ action: 'signin' })
  })

  it('never runs a Server Function without a session — not even when posted to /signin', () => {
    const cfg = on()
    expect(decideProxy(req({ pathname: '/signin', method: 'POST', isServerAction: true }), cfg, NOW)).toEqual({ action: 'unauthorized' })
    expect(decideProxy(req({ pathname: '/settings', method: 'POST', isServerAction: true }), cfg, NOW)).toEqual({ action: 'unauthorized' })
    expect(decideProxy(req({ pathname: '/signin', method: 'POST' }), cfg, NOW)).toEqual({ action: 'next' })
    expect(decideProxy(req({ pathname: '/settings', method: 'POST', isServerAction: true, sessionToken: signSession(cfg, NOW) }), cfg, NOW)).toEqual({ action: 'next' })
  })

  it('fails closed when misconfigured: pages show the error, APIs get 503, sign-in stays reachable to explain it', () => {
    expect(decideProxy(req(), broken, NOW)).toEqual({ action: 'misconfigured-page' })
    expect(decideProxy(req({ pathname: '/api/health' }), broken, NOW)).toEqual({ action: 'misconfigured-api' })
    expect(decideProxy(req({ pathname: '/signin' }), broken, NOW)).toEqual({ action: 'next' })
    expect(decideProxy(req({ pathname: '/signin', method: 'POST', isServerAction: true }), broken, NOW)).toEqual({ action: 'unauthorized' })
  })
})

describe('SignInLimiter', () => {
  const opts = { windowMs: 60_000, maxPerClient: 3, maxGlobal: 5, maxClients: 100 }

  it('locks a client after too many failures until the window passes', () => {
    const l = new SignInLimiter(opts)
    const t0 = 1_000_000
    expect(l.check('a', t0)).toEqual({ allowed: true, remaining: 3 })
    l.fail('a', t0)
    l.fail('a', t0 + 1000)
    l.fail('a', t0 + 2000)
    expect(l.check('a', t0 + 3000)).toEqual({ allowed: false, scope: 'client', retryAfterSec: 57 })
    expect(l.check('b', t0 + 3000)).toEqual({ allowed: true, remaining: 3 })
    expect(l.check('a', t0 + 60_001)).toEqual({ allowed: true, remaining: 1 })
  })

  it('caps failures from all clients together (address rotation)', () => {
    const l = new SignInLimiter(opts)
    const t0 = 5_000_000
    for (let i = 0; i < 5; i++) l.fail(`client-${i}`, t0 + i)
    expect(l.check('fresh', t0 + 10)).toMatchObject({ allowed: false, scope: 'global' })
    expect(l.check('fresh', t0 + 60_010)).toMatchObject({ allowed: true })
  })

  it('a correct passcode clears that client, and tracked clients stay bounded', () => {
    const l = new SignInLimiter({ ...opts, maxGlobal: 1000, maxClients: 3 })
    l.fail('a', 1)
    l.fail('a', 2)
    l.succeed('a')
    expect(l.check('a', 3)).toEqual({ allowed: true, remaining: 3 })
    for (const c of ['b', 'c', 'd', 'e']) l.fail(c, 10)
    // 'b' was dropped as the oldest tracked client.
    expect(l.check('b', 11)).toEqual({ allowed: true, remaining: 3 })
    expect(l.check('e', 11)).toEqual({ allowed: true, remaining: 2 })
  })
})

describe('request helpers', () => {
  it('reads the client address from forwarding headers', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9')
    expect(clientAddress(headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2')
    expect(clientAddress(headers({}))).toBe('unknown')
  })

  it('refuses cross-site sign-in posts', () => {
    expect(isSameOriginPost(headers({ host: 'piste.example', origin: 'https://piste.example' }))).toBe(true)
    expect(isSameOriginPost(headers({ host: 'piste.example' }))).toBe(true)
    expect(isSameOriginPost(headers({ host: 'piste.example', origin: 'https://evil.example' }))).toBe(false)
    expect(isSameOriginPost(headers({ host: 'piste.example', origin: 'null' }))).toBe(false)
    expect(isSameOriginPost(headers({ host: 'piste.example', 'sec-fetch-site': 'cross-site' }))).toBe(false)
  })
})
