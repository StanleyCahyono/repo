/**
 * Optional passcode sign-in for remote deployments (brief §11). Localhost stays simple: nothing here does anything
 * unless PISTE_PASSCODE is set.
 *
 * - PISTE_PASSCODE set → every page and API needs a signed session cookie (enforced by src/proxy.ts).
 * - PISTE_SESSION_SECRET (≥ 32 characters) signs that cookie with HMAC-SHA256. A missing or short secret never falls
 *   back to running unprotected: the proxy answers every request with a configuration error instead ("fail closed").
 * - Session token: `v1.<issuedAt>.<expiresAt>.<nonce>.<signature>` (seconds since the epoch; nonce and signature
 *   base64url). The signing key is derived from the secret AND the passcode, so changing either one signs every
 *   browser out.
 * - Passcodes are compared in constant time: HMAC digests of equal length through `timingSafeEqual`.
 * - Sign-in attempts are rate-limited in memory, per client address and globally. The limiter lives in the server
 *   process: it resets on restart and is not shared between several server instances.
 *
 * Sessions expire in real (wall-clock) time, so this module uses `Date.now()` rather than the app clock: demo mode's
 * simulated date must never keep a session alive or expire it.
 *
 * Framework-free on purpose (no `next/*`, no `server-only`): the proxy, the /signin route handlers, the Settings page
 * and the unit tests all import it.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'piste-session'
/** Sessions last 30 days on a browser; then the passcode is asked again. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
export const MIN_SECRET_LENGTH = 32
/** Shorter passcodes work, but Settings warns about them. */
export const RECOMMENDED_PASSCODE_LENGTH = 12
/** Longest passcode input considered (longer input is rejected before hashing). */
export const MAX_PASSCODE_INPUT = 1024
/** Clock skew tolerated for a token's issue time. */
const SKEW_SECONDS = 300

type Env = Record<string, string | undefined>

export type AuthConfig =
  | { state: 'off' }
  | { state: 'misconfigured'; problem: 'secret-missing' | 'secret-short' }
  | { state: 'on'; passcode: string; secret: string }

/** Read the auth configuration. Values are trimmed (a stray space in .env must not change the passcode). */
export function authConfig(env: Env = process.env): AuthConfig {
  const passcode = env.PISTE_PASSCODE?.trim() ?? ''
  if (!passcode) return { state: 'off' }
  const secret = env.PISTE_SESSION_SECRET?.trim() ?? ''
  if (!secret) return { state: 'misconfigured', problem: 'secret-missing' }
  if (secret.length < MIN_SECRET_LENGTH) return { state: 'misconfigured', problem: 'secret-short' }
  return { state: 'on', passcode, secret }
}

export function misconfigurationText(problem: 'secret-missing' | 'secret-short'): string {
  return problem === 'secret-missing'
    ? 'PISTE_PASSCODE is set, but PISTE_SESSION_SECRET is missing.'
    : `PISTE_PASSCODE is set, but PISTE_SESSION_SECRET is shorter than ${MIN_SECRET_LENGTH} characters.`
}

// ---------------------------------------------------------------------------
// Keys

type OnConfig = Extract<AuthConfig, { state: 'on' }>

/** Session signing key: bound to the secret and to the passcode (a new passcode invalidates old sessions). */
function sessionKey(cfg: OnConfig): Buffer {
  const passcodeDigest = createHash('sha256').update(cfg.passcode, 'utf8').digest()
  return createHmac('sha256', cfg.secret).update('piste-session-v1\0').update(passcodeDigest).digest()
}

function compareKey(cfg: OnConfig): Buffer {
  return createHmac('sha256', cfg.secret).update('piste-passcode-compare-v1').digest()
}

// ---------------------------------------------------------------------------
// Passcode

/** Constant-time passcode check. Over-long input is rejected before any hashing. */
export function passcodeMatches(cfg: OnConfig, candidate: unknown): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > MAX_PASSCODE_INPUT) return false
  const key = compareKey(cfg)
  const a = createHmac('sha256', key).update(candidate.trim(), 'utf8').digest()
  const b = createHmac('sha256', key).update(cfg.passcode, 'utf8').digest()
  return timingSafeEqual(a, b)
}

// ---------------------------------------------------------------------------
// Session tokens

export interface SessionInfo {
  issuedAt: number
  expiresAt: number
}

export type VerifyResult =
  | ({ ok: true } & SessionInfo)
  | { ok: false; reason: 'missing' | 'malformed' | 'bad-signature' | 'expired' | 'not-yet-valid' }

const TOKEN_RE = /^v1\.(\d{1,12})\.(\d{1,12})\.([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]{43})$/

function signature(cfg: OnConfig, payload: string): Buffer {
  return createHmac('sha256', sessionKey(cfg)).update(payload, 'utf8').digest()
}

/** A new session token valid from `nowSec` for `ttlSec` seconds. */
export function signSession(cfg: OnConfig, nowSec: number, ttlSec: number = SESSION_TTL_SECONDS): string {
  const iat = Math.floor(nowSec)
  const exp = iat + Math.max(1, Math.floor(ttlSec))
  const nonce = randomBytes(12).toString('base64url')
  const payload = `v1.${iat}.${exp}.${nonce}`
  return `${payload}.${signature(cfg, payload).toString('base64url')}`
}

export function verifySession(cfg: OnConfig, token: string | null | undefined, nowSec: number): VerifyResult {
  if (!token) return { ok: false, reason: 'missing' }
  if (token.length > 200) return { ok: false, reason: 'malformed' }
  const m = TOKEN_RE.exec(token)
  if (!m) return { ok: false, reason: 'malformed' }
  const [, iatText, expText, nonce, sigText] = m
  const payload = `v1.${iatText}.${expText}.${nonce}`
  const expected = signature(cfg, payload)
  const given = Buffer.from(sigText, 'base64url')
  // Equal lengths are guaranteed by the pattern (43 base64url chars = 32 bytes); check anyway before comparing.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'bad-signature' }
  const iat = Number(iatText)
  const exp = Number(expText)
  if (exp <= iat || exp - iat > SESSION_TTL_SECONDS + 60) return { ok: false, reason: 'malformed' }
  if (iat > nowSec + SKEW_SECONDS) return { ok: false, reason: 'not-yet-valid' }
  if (exp <= nowSec) return { ok: false, reason: 'expired' }
  return { ok: true, issuedAt: iat, expiresAt: exp }
}

/** Cookie options for the session. `secure` when the request arrived over https (directly or via a proxy). */
export function sessionCookieOptions(secure: boolean, maxAge: number = SESSION_TTL_SECONDS) {
  return { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge }
}

export function isHttps(url: string, forwardedProto: string | null | undefined): boolean {
  if (url.startsWith('https:')) return true
  return (forwardedProto ?? '').split(',')[0].trim().toLowerCase() === 'https'
}

// ---------------------------------------------------------------------------
// Paths

/**
 * Paths reachable without a session: the sign-in routes (page, form post, sign-out, its fonts), Next's static build
 * assets, the favicon and the MapLibre worker modules. Everything else — every page, every API route, `_next/image`,
 * unknown paths — needs a session. `pathname` is the already-normalised URL path (dot segments resolved), exactly as
 * the proxy sees it; matching is case-sensitive and prefix matches require the trailing slash, so `/signinx` or
 * `/SIGNIN` are protected.
 */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/signin' ||
    pathname.startsWith('/signin/') ||
    pathname.startsWith('/_next/static/') ||
    pathname === '/icon.svg' ||
    pathname.startsWith('/vendor/maplibre/')
  )
}

export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/')
}

/**
 * Where to send the browser after signing in: a same-origin path (with query) only. Anything else — absolute URLs,
 * protocol-relative `//host`, backslash tricks, control characters, the sign-in page itself — falls back to `/`.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || raw.length > 2048) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/'
  // Control characters (header injection, log spoofing) are refused outright.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return '/'
  let url: URL
  try {
    url = new URL(raw, 'http://piste.invalid')
  } catch {
    return '/'
  }
  if (url.origin !== 'http://piste.invalid') return '/'
  if (url.pathname === '/signin' || url.pathname.startsWith('/signin/')) return '/'
  return `${url.pathname}${url.search}`
}

// ---------------------------------------------------------------------------
// Proxy decision (pure, unit-tested; src/proxy.ts turns it into a response)

export interface ProxyRequestInfo {
  pathname: string
  /** Query string including '?', or ''. */
  search: string
  method: string
  /** The request invokes a Server Function (`Next-Action` header). */
  isServerAction: boolean
  sessionToken: string | null | undefined
}

export type ProxyDecision =
  | { action: 'next' }
  /** Page request without a session: send to /signin, then back to `next`. */
  | { action: 'signin'; next: string }
  /** API request without a session. */
  | { action: 'unauthorized-api' }
  /** Server Function call or non-GET page request without a session. */
  | { action: 'unauthorized' }
  /** Auth is configured wrongly: pages show the configuration error, APIs answer 503. */
  | { action: 'misconfigured-page' }
  | { action: 'misconfigured-api' }

export function decideProxy(req: ProxyRequestInfo, cfg: AuthConfig, nowSec: number): ProxyDecision {
  if (cfg.state === 'off') return { action: 'next' }
  const authed = cfg.state === 'on' && verifySession(cfg, req.sessionToken, nowSec).ok
  if (isPublicPath(req.pathname)) {
    // Server Functions are not bound to the path they are posted to: never run one without a session, even when it
    // is posted to a public path such as /signin.
    return req.isServerAction && !authed ? { action: 'unauthorized' } : { action: 'next' }
  }
  if (cfg.state === 'misconfigured') return isApiPath(req.pathname) ? { action: 'misconfigured-api' } : { action: 'misconfigured-page' }
  if (authed) return { action: 'next' }
  if (isApiPath(req.pathname)) return { action: 'unauthorized-api' }
  if (req.isServerAction) return { action: 'unauthorized' }
  const method = req.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return { action: 'unauthorized' }
  return { action: 'signin', next: safeNextPath(`${req.pathname}${req.search}`) }
}

// ---------------------------------------------------------------------------
// Sign-in rate limit (in memory)

export interface LimiterOptions {
  windowMs: number
  /** Failed attempts allowed per client address within the window. */
  maxPerClient: number
  /** Failed attempts allowed from all clients together within the window (stops address rotation). */
  maxGlobal: number
  /** Bound on tracked addresses (oldest dropped first). */
  maxClients: number
}

export const DEFAULT_LIMITS: LimiterOptions = { windowMs: 15 * 60 * 1000, maxPerClient: 5, maxGlobal: 30, maxClients: 5000 }

export type LimitCheck = { allowed: true; remaining: number } | { allowed: false; retryAfterSec: number; scope: 'client' | 'global' }

export class SignInLimiter {
  private clients = new Map<string, number[]>()
  private global: number[] = []

  constructor(private readonly opts: LimiterOptions = DEFAULT_LIMITS) {}

  private prune(list: number[], nowMs: number): number[] {
    const from = nowMs - this.opts.windowMs
    let i = 0
    while (i < list.length && list[i] <= from) i++
    return i ? list.slice(i) : list
  }

  check(client: string, nowMs: number): LimitCheck {
    this.global = this.prune(this.global, nowMs)
    const mine = this.prune(this.clients.get(client) ?? [], nowMs)
    if (mine.length) this.clients.set(client, mine)
    else this.clients.delete(client)
    if (mine.length >= this.opts.maxPerClient) {
      return { allowed: false, scope: 'client', retryAfterSec: Math.max(1, Math.ceil((mine[mine.length - this.opts.maxPerClient] + this.opts.windowMs - nowMs) / 1000)) }
    }
    if (this.global.length >= this.opts.maxGlobal) {
      return { allowed: false, scope: 'global', retryAfterSec: Math.max(1, Math.ceil((this.global[this.global.length - this.opts.maxGlobal] + this.opts.windowMs - nowMs) / 1000)) }
    }
    return { allowed: true, remaining: this.opts.maxPerClient - mine.length }
  }

  fail(client: string, nowMs: number): void {
    const mine = this.prune(this.clients.get(client) ?? [], nowMs)
    mine.push(nowMs)
    this.clients.delete(client)
    this.clients.set(client, mine)
    this.global = this.prune(this.global, nowMs)
    this.global.push(nowMs)
    while (this.clients.size > this.opts.maxClients) {
      const oldest = this.clients.keys().next().value
      if (oldest === undefined) break
      this.clients.delete(oldest)
    }
  }

  /** A correct passcode clears that client's failures (not the global count). */
  succeed(client: string): void {
    this.clients.delete(client)
  }
}

const LIMITER_KEY = Symbol.for('piste.signin-limiter')

/** The process-wide limiter (kept on globalThis so dev-server reloads do not reset it). */
export function signInLimiter(): SignInLimiter {
  const g = globalThis as unknown as Record<symbol, SignInLimiter | undefined>
  return (g[LIMITER_KEY] ??= new SignInLimiter())
}

/**
 * Client address for rate limiting: the first X-Forwarded-For entry, else X-Real-IP, else 'unknown'. Without a
 * trusted reverse proxy these headers can be forged — the global limit still caps guessing then.
 */
export function clientAddress(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (forwarded) return forwarded.slice(0, 64)
  const real = headers.get('x-real-ip')?.trim()
  return real ? real.slice(0, 64) : 'unknown'
}

/** Browser same-origin check for the sign-in form posts (non-browser clients send neither header). */
export function isSameOriginPost(headers: { get(name: string): string | null }): boolean {
  if (headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = headers.get('origin')
  if (origin === null) return true
  if (origin === 'null') return false // opaque origin (sandboxed frame, file://)
  const host = headers.get('x-forwarded-host')?.split(',')[0]?.trim() || headers.get('host')
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
