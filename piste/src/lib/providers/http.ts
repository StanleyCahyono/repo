/**
 * The only network entry point for provider adapters.
 *
 * `fetchWithPolicy` wraps fetch with: an AbortController timeout covering headers AND body, bounded retries with
 * exponential backoff + jitter, Retry-After handling for 429/503, an identifying User-Agent (api.weather.gov
 * requires one), a per-host minimum request interval, a small in-memory TTL cache for GETs and error kinds that
 * match `ProviderErrorKind`. Every call returns a `SourceFetch` record (credentials redacted) for provenance.
 *
 * Server-side only: secrets are read from process.env at call time. Node's built-in fetch honours HTTPS_PROXY
 * only when NODE_USE_ENV_PROXY=1 (Node ≥ 22.21).
 *
 * Time: `nowIso` (recorded timestamps) follows the app clock (`PISTE_FIXED_NOW` aware); `nowMs` (timers,
 * cache expiry, pacing) is the real monotonic-enough wall clock. Both are injectable for tests.
 */
import { createHash } from 'node:crypto'
import { nowFor } from '@/lib/clock'
import type { ProviderErrorKind, SourceFetch } from './types'

export { assertPublicHttpUrl, classifyIp, isPublicIp, UnsafeUrlError, systemResolver } from './url-guard'
export type { Resolver, ResolvedAddress, GuardOptions, GuardedUrl, UnsafeUrlReason } from './url-guard'

if (typeof window !== 'undefined') {
  throw new Error('src/lib/providers/http.ts is server-only: it reads credentials from the environment')
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface HttpEnv {
  fetch: FetchLike
  sleep: (ms: number) => Promise<void>
  random: () => number
  nowMs: () => number
  nowIso: () => string
  /** Environment variables (PISTE_CONTACT, API keys). Read lazily. */
  env: () => Record<string, string | undefined>
}

export interface BackoffPolicy {
  /** First retry delay before jitter. Default 500 ms. */
  baseMs?: number
  /** Cap per delay. Default 8000 ms. */
  maxMs?: number
  /** Multiplier per attempt. Default 2. */
  factor?: number
}

export interface FetchPolicy {
  method?: 'GET' | 'HEAD' | 'POST'
  headers?: Record<string, string>
  /** String bodies are sent as-is; objects are JSON-encoded (Content-Type set if absent). */
  body?: string | Record<string, unknown> | unknown[]
  expect?: 'json' | 'text'
  /** Per attempt, covering headers and body. Default 15 s. */
  timeoutMs?: number
  /** Extra attempts after the first. Default 2 for GET/HEAD, 0 for POST. */
  retries?: number
  backoff?: BackoffPolicy
  /** Cache successful GETs for this long (in memory, per process). 0/undefined = no cache. */
  cacheTtlMs?: number
  /** Minimum spacing between request starts to the same host. Defaults per host (see HOST_MIN_INTERVAL_MS). */
  minIntervalMs?: number
  /** Longest Retry-After we will sleep for inside one call; longer → fail as rate-limited for the scheduler. */
  maxRetryAfterMs?: number
  /** Response size limit. Default 5 MB. */
  maxBytes?: number
  /** Non-2xx statuses to treat as a successful response (e.g. 404 for robots.txt). */
  acceptStatus?: number[]
}

interface Base {
  attempts: number
  fetch: SourceFetch
}

export interface HttpSuccess extends Base {
  ok: true
  status: number
  /** Parsed JSON when `expect: 'json'`, else the body text. */
  data: unknown
  text: string
  headers: Headers
  finalUrl: string
  fromCache: boolean
}

export interface HttpFailure extends Base {
  ok: false
  errorKind: ProviderErrorKind
  error: string
  retriable: boolean
  status: number | null
  retryAfterMs: number | null
  /** First ~300 characters of an error body (for provider error messages such as Open-Meteo's `reason`). */
  bodySnippet: string | null
}

export type HttpResult = HttpSuccess | HttpFailure

export interface RawOk {
  ok: true
  response: Response
  /** Clear the timeout; call after you are done reading/cancelling the body. */
  done: () => void
}
export interface RawErr {
  ok: false
  errorKind: ProviderErrorKind
  error: string
}

export interface HttpClient {
  readonly env: HttpEnv
  request(url: string, policy?: FetchPolicy): Promise<HttpResult>
  /**
   * One attempt with User-Agent, timeout and host pacing, but no retries, caching or body handling. Used by the
   * link checker, which follows redirects manually so each hop can be re-validated.
   */
  raw(url: string, init: { method: 'GET' | 'HEAD'; headers?: Record<string, string>; redirect?: RequestRedirect; timeoutMs?: number }): Promise<RawOk | RawErr>
  clearCache(): void
}

export const DEFAULT_TIMEOUT_MS = 15_000
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const MAX_CACHE_ENTRIES = 200

/** Politeness defaults per host (request-start spacing). */
export const HOST_MIN_INTERVAL_MS: Record<string, number> = {
  'api.weather.gov': 1000,
  'api.open-meteo.com': 200,
  'customer-api.open-meteo.com': 100,
  'api.frankfurter.app': 500,
  'api.duffel.com': 500,
  'www.greekpeak.net': 3000,
  'greekpeak.net': 3000,
  'www.alta.com': 3000,
  'alta.com': 3000,
}

// ---------------------------------------------------------------------------
// Helpers

export function userAgent(env: Record<string, string | undefined>): string {
  const contact = (env.PISTE_CONTACT ?? '').replace(/[^\x20-\x7e]/g, '').replace(/[()]/g, '').trim().slice(0, 120)
  return `Piste/0.1 (+personal ski planner; contact: ${contact || 'unset'})`
}

const SECRET_PARAMS = ['apikey', 'api_key', 'key', 'token', 'access_token', 'appid', 'client_secret', 'signature']

/** Remove credentials from a URL before it is logged or stored. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url)
    u.username = ''
    u.password = ''
    for (const p of [...u.searchParams.keys()]) {
      if (SECRET_PARAMS.includes(p.toLowerCase())) u.searchParams.set(p, 'REDACTED')
    }
    return u.toString()
  } catch {
    return url.replace(/([?&](?:apikey|api_key|key|token|access_token)=)[^&#]*/gi, '$1REDACTED')
  }
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex')
}

/** JSON with object keys sorted — stable across key order, for hashing normalized values. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

export function stableHash(value: unknown): string {
  return sha256Hex(stableStringify(value))
}

/** Parse Retry-After (delta-seconds or HTTP-date) into milliseconds from `nowMs`. */
export function parseRetryAfter(header: string | null, nowMs: number): number | null {
  if (!header) return null
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) return null
  return Math.max(0, at - nowMs)
}

export function backoffDelay(attempt: number, b: BackoffPolicy | undefined, random: () => number): number {
  const base = b?.baseMs ?? 500
  const max = b?.maxMs ?? 8000
  const factor = b?.factor ?? 2
  const d = Math.min(max, base * factor ** Math.max(0, attempt - 1))
  // "Equal jitter": half fixed, half random — bounded and never zero.
  return Math.round(d / 2 + random() * (d / 2))
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}

class TimeoutSignal extends Error {
  constructor() {
    super('timeout')
    this.name = 'TimeoutSignal'
  }
}
class TooLarge extends Error {}

function describeNetworkError(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause
    const code = cause?.code ? ` (${cause.code})` : ''
    return `${e.message}${code}`
  }
  return String(e)
}

function isConnectTimeout(e: unknown): boolean {
  const code = (e as { cause?: { code?: string } })?.cause?.code
  return code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'ETIMEDOUT'
}

async function readBody(res: Response, maxBytes: number): Promise<string> {
  const len = Number(res.headers.get('content-length'))
  if (Number.isFinite(len) && len > maxBytes) throw new TooLarge(`response is ${len} bytes (limit ${maxBytes})`)
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new TooLarge(`response exceeded ${maxBytes} bytes`)
    }
    chunks.push(value)
  }
  const charset = res.headers.get('content-type')?.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase()
  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(charset || 'utf-8')
  } catch {
    decoder = new TextDecoder('utf-8')
  }
  return decoder.decode(Buffer.concat(chunks))
}

function retriableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status !== 501 && status !== 505)
}

// ---------------------------------------------------------------------------
// Client

export function defaultHttpEnv(): HttpEnv {
  return {
    fetch: (input, init) => globalThis.fetch(input, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
    nowMs: () => Date.now(),
    nowIso: () => nowFor('live'),
    env: () => process.env,
  }
}

export function createHttpClient(overrides: Partial<HttpEnv> = {}): HttpClient {
  const env: HttpEnv = { ...defaultHttpEnv(), ...overrides }
  const cache = new Map<string, { expiresAt: number; value: HttpSuccess }>()
  const hostNext = new Map<string, number>()

  async function pace(url: string, minIntervalMs: number | undefined) {
    const host = hostOf(url)
    const interval = minIntervalMs ?? HOST_MIN_INTERVAL_MS[host] ?? 0
    if (interval <= 0) return
    const now = env.nowMs()
    const start = Math.max(now, hostNext.get(host) ?? 0)
    hostNext.set(host, start + interval)
    if (start > now) await env.sleep(start - now)
  }

  function baseHeaders(extra: Record<string, string> | undefined): Record<string, string> {
    const h: Record<string, string> = { 'User-Agent': userAgent(env.env()) }
    for (const [k, v] of Object.entries(extra ?? {})) h[k] = v
    return h
  }

  async function raw(
    url: string,
    init: { method: 'GET' | 'HEAD'; headers?: Record<string, string>; redirect?: RequestRedirect; timeoutMs?: number },
  ): Promise<RawOk | RawErr> {
    await pace(url, undefined)
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(new TimeoutSignal()), init.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    try {
      const response = await env.fetch(url, {
        method: init.method,
        headers: baseHeaders(init.headers),
        redirect: init.redirect ?? 'manual',
        signal: ac.signal,
      })
      return { ok: true, response, done: () => clearTimeout(timer) }
    } catch (e) {
      clearTimeout(timer)
      if (ac.signal.aborted || isConnectTimeout(e)) return { ok: false, errorKind: 'timeout', error: 'Request timed out' }
      return { ok: false, errorKind: 'network', error: describeNetworkError(e) }
    }
  }

  async function attempt(url: string, p: FetchPolicy, method: string, attemptNo: number): Promise<HttpResult> {
    const fetchedAt = env.nowIso()
    const safeUrl = redactUrl(url)
    const rec = (over: Partial<SourceFetch>): SourceFetch => ({
      url: safeUrl,
      fetchedAt,
      httpStatus: null,
      contentHash: null,
      attempts: attemptNo,
      ...over,
    })
    const fail = (
      errorKind: ProviderErrorKind,
      error: string,
      retriable: boolean,
      status: number | null = null,
      retryAfterMs: number | null = null,
      bodySnippet: string | null = null,
    ): HttpFailure => ({
      ok: false,
      errorKind,
      error,
      retriable,
      status,
      retryAfterMs,
      bodySnippet,
      attempts: attemptNo,
      fetch: rec({ httpStatus: status, ok: false, error }),
    })

    const headers = baseHeaders(p.headers)
    let body: string | undefined
    if (p.body !== undefined) {
      body = typeof p.body === 'string' ? p.body : JSON.stringify(p.body)
      if (typeof p.body !== 'string' && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json'
      }
    }

    const ac = new AbortController()
    const timeoutMs = p.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const timer = setTimeout(() => ac.abort(new TimeoutSignal()), timeoutMs)
    let res: Response
    let text: string
    try {
      res = await env.fetch(url, { method, headers, body, redirect: 'follow', signal: ac.signal })
      text = await readBody(res, p.maxBytes ?? DEFAULT_MAX_BYTES)
    } catch (e) {
      if (e instanceof TooLarge) return fail('parse', `Response too large: ${e.message}`, false)
      if (ac.signal.aborted || isConnectTimeout(e)) return fail('timeout', `Timed out after ${timeoutMs} ms`, true)
      return fail('network', `Network error: ${describeNetworkError(e)}`, true)
    } finally {
      clearTimeout(timer)
    }

    const status = res.status
    const accepted = (status >= 200 && status < 300) || (p.acceptStatus ?? []).includes(status)
    if (!accepted) {
      const snippet = text.slice(0, 300) || null
      const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'), env.nowMs())
      if (status === 429) return fail('rate-limited', `HTTP 429 Too Many Requests`, true, status, retryAfterMs, snippet)
      return fail('http', `HTTP ${status}${res.statusText ? ` ${res.statusText}` : ''}`, retriableStatus(status), status, retryAfterMs, snippet)
    }

    let data: unknown = text
    if (p.expect === 'json') {
      try {
        data = text.length ? JSON.parse(text) : null
      } catch {
        return fail('parse', 'Response was not valid JSON', false, status, null, text.slice(0, 300) || null)
      }
    }
    return {
      ok: true,
      status,
      data,
      text,
      headers: res.headers,
      finalUrl: res.url || url,
      fromCache: false,
      attempts: attemptNo,
      fetch: rec({ httpStatus: status, contentHash: sha256Hex(text), ok: true, error: null, fromCache: false }),
    }
  }

  async function request(url: string, policy: FetchPolicy = {}): Promise<HttpResult> {
    const method = policy.method ?? 'GET'
    const cacheable = method === 'GET' && (policy.cacheTtlMs ?? 0) > 0
    const accept = Object.entries(policy.headers ?? {}).find(([k]) => k.toLowerCase() === 'accept')?.[1] ?? ''
    const key = `${method} ${url} ${accept} ${policy.expect ?? 'text'}`
    if (cacheable) {
      const hit = cache.get(key)
      if (hit && hit.expiresAt > env.nowMs()) {
        // Keep the ORIGINAL fetchedAt: a cache hit is not a new observation.
        return { ...hit.value, fromCache: true, attempts: 0, fetch: { ...hit.value.fetch, fromCache: true, attempts: 0 } }
      }
      if (hit) cache.delete(key)
    }

    const retries = Math.max(0, Math.min(policy.retries ?? (method === 'POST' ? 0 : 2), 6))
    const maxRetryAfterMs = policy.maxRetryAfterMs ?? 30_000
    for (let n = 1; ; n++) {
      await pace(url, policy.minIntervalMs)
      const r = await attempt(url, policy, method, n)
      if (r.ok) {
        if (cacheable) {
          if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!)
          cache.set(key, { expiresAt: env.nowMs() + policy.cacheTtlMs!, value: r })
        }
        return r
      }
      if (!r.retriable || n > retries) return r
      let delay = backoffDelay(n, policy.backoff, env.random)
      if (r.retryAfterMs !== null) {
        // Honour the server's Retry-After, but do not park a job for minutes: hand it back to the scheduler.
        if (r.retryAfterMs > maxRetryAfterMs) return r
        delay = Math.max(r.retryAfterMs, 0)
      }
      await env.sleep(delay)
    }
  }

  return {
    env,
    request,
    raw,
    clearCache: () => {
      cache.clear()
      hostNext.clear()
    },
  }
}

/** Process-wide default client used by the registry's providers. */
export const defaultHttp: HttpClient = createHttpClient()

/** Convenience wrapper around the default client. */
export function fetchWithPolicy(url: string, policy: FetchPolicy = {}, client: HttpClient = defaultHttp): Promise<HttpResult> {
  return client.request(url, policy)
}
