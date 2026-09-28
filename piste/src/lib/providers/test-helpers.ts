/**
 * Test-only helpers: an HttpClient backed by a scripted fake fetch, with recorded calls and sleeps. Never import
 * from application code.
 */
import { createHttpClient, type HttpClient } from './http'

export interface FakeCall {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}

export type FakeHandler = (call: FakeCall, init: RequestInit) => Response | Promise<Response>

export interface FakeHarness {
  client: HttpClient
  calls: FakeCall[]
  sleeps: number[]
  /** Advance the fake monotonic clock (ms). */
  advance(ms: number): void
}

export function fakeHttp(
  handler: FakeHandler,
  opts: { env?: Record<string, string | undefined>; nowIso?: string; random?: () => number } = {},
): FakeHarness {
  const calls: FakeCall[] = []
  const sleeps: number[] = []
  let ms = 1_800_000_000_000
  const client = createHttpClient({
    fetch: async (url, init = {}) => {
      const headers: Record<string, string> = {}
      new Headers(init.headers).forEach((v, k) => (headers[k] = v))
      const call: FakeCall = { url, method: init.method ?? 'GET', headers, body: typeof init.body === 'string' ? init.body : null }
      calls.push(call)
      return handler(call, init)
    },
    sleep: async (d) => {
      sleeps.push(d)
      ms += d
    },
    random: opts.random ?? (() => 0.5),
    nowMs: () => ms,
    nowIso: () => opts.nowIso ?? '2027-01-15T14:00:00.000Z',
    env: () => opts.env ?? {},
  })
  return { client, calls, sleeps, advance: (d) => (ms += d) }
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } })
}

export function text(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, ...init, headers: { 'content-type': 'text/html; charset=utf-8', ...(init.headers ?? {}) } })
}

/** A fetch that never answers until its AbortSignal fires (simulates an upstream hang). */
export function hang(init: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    const signal = init.signal
    if (!signal) return
    signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('aborted', 'AbortError')))
  })
}
