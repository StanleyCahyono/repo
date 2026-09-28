import { describe, expect, it } from 'vitest'
import { backoffDelay, parseRetryAfter, redactUrl, stableHash, userAgent } from './http'
import { fakeHttp, hang, json, text } from './test-helpers'

describe('fetchWithPolicy: timeouts and retries', () => {
  it('gives up with errorKind timeout after exactly 1 + retries attempts, backing off between them', async () => {
    const h = fakeHttp((_, init) => hang(init))
    const r = await h.client.request('https://api.example.org/slow', { timeoutMs: 5, retries: 2, backoff: { baseMs: 100, maxMs: 1000 } })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errorKind).toBe('timeout')
    expect(r.retriable).toBe(true)
    expect(h.calls).toHaveLength(3)
    // equal jitter with random()=0.5: 75 ms then 150 ms
    expect(h.sleeps).toEqual([75, 150])
    expect(r.fetch).toMatchObject({ ok: false, httpStatus: null, attempts: 3 })
  })

  it('times out a body that stalls after headers arrive', async () => {
    const h = fakeHttp((_, init) => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"partial":'))
          init.signal!.addEventListener('abort', () => controller.error(init.signal!.reason))
        },
      })
      return new Response(stream, { status: 200 })
    })
    const r = await h.client.request('https://api.example.org/stall', { timeoutMs: 5, retries: 0, expect: 'json' })
    expect(r.ok === false && r.errorKind).toBe('timeout')
  })

  it('honours Retry-After on 429 and then succeeds', async () => {
    let n = 0
    const h = fakeHttp(() => (n++ === 0 ? new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }) : json({ ok: 1 })))
    const r = await h.client.request('https://api.example.org/x', { expect: 'json', retries: 2 })
    expect(r.ok).toBe(true)
    expect(h.sleeps).toEqual([2000])
    expect(r.ok && r.attempts).toBe(2)
  })

  it('does not sleep through a long Retry-After: returns rate-limited for the scheduler', async () => {
    const h = fakeHttp(() => new Response('', { status: 429, headers: { 'retry-after': '3600' } }))
    const r = await h.client.request('https://api.example.org/x', { retries: 3 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errorKind).toBe('rate-limited')
    expect(r.retryAfterMs).toBe(3_600_000)
    expect(h.calls).toHaveLength(1)
    expect(h.sleeps).toEqual([])
  })

  it('retries 503 (with Retry-After) but not 404', async () => {
    let n = 0
    const h = fakeHttp(() => (n++ < 1 ? new Response('', { status: 503, headers: { 'retry-after': '1' } }) : text('ok')))
    expect((await h.client.request('https://a.example.org/', { retries: 2 })).ok).toBe(true)
    expect(h.sleeps).toEqual([1000])

    const g = fakeHttp(() => new Response('nope', { status: 404 }))
    const r = await g.client.request('https://b.example.org/', { retries: 3 })
    expect(r.ok === false && r.errorKind).toBe('http')
    expect(r.ok === false && r.retriable).toBe(false)
    expect(g.calls).toHaveLength(1)
  })

  it('does not retry POST by default (offer requests are not idempotent)', async () => {
    const h = fakeHttp(() => new Response('', { status: 502 }))
    const r = await h.client.request('https://api.example.org/x', { method: 'POST', body: { a: 1 } })
    expect(r.ok).toBe(false)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].headers['content-type']).toBe('application/json')
    expect(h.calls[0].body).toBe('{"a":1}')
  })

  it('maps network failures and invalid JSON to their error kinds', async () => {
    const net = fakeHttp(() => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })))
    const a = await net.client.request('https://nowhere.example.org/', { retries: 0 })
    expect(a.ok === false && a.errorKind).toBe('network')
    expect(a.ok === false && a.error).toMatch(/ENOTFOUND/)

    const bad = fakeHttp(() => text('<html>proxy error</html>'))
    const b = await bad.client.request('https://api.example.org/', { expect: 'json' })
    expect(b.ok === false && b.errorKind).toBe('parse')
  })

  it('refuses oversized responses', async () => {
    const h = fakeHttp(() => text('x'.repeat(2000)))
    const r = await h.client.request('https://api.example.org/', { maxBytes: 1000 })
    expect(r.ok === false && r.errorKind).toBe('parse')
  })
})

describe('fetchWithPolicy: identification, pacing and caching', () => {
  it('identifies itself with the contact from PISTE_CONTACT (sanitised)', async () => {
    const h = fakeHttp(() => text('ok'), { env: { PISTE_CONTACT: 'me@example.com\r\nX-Evil: 1' } })
    await h.client.request('https://api.example.org/')
    expect(h.calls[0].headers['user-agent']).toBe('Piste/0.1 (+personal ski planner; contact: me@example.comX-Evil: 1)')
    expect(userAgent({})).toBe('Piste/0.1 (+personal ski planner; contact: unset)')
  })

  it('spaces requests to the same host by the minimum interval', async () => {
    const h = fakeHttp(() => text('ok'))
    await h.client.request('https://slow.example.org/a', { minIntervalMs: 1000 })
    await h.client.request('https://slow.example.org/b', { minIntervalMs: 1000 })
    await h.client.request('https://other.example.org/c', { minIntervalMs: 1000 })
    expect(h.sleeps).toEqual([1000])
  })

  it('serves cached GETs with the ORIGINAL fetchedAt and never caches failures', async () => {
    let n = 0
    let now = '2027-01-15T14:00:00.000Z'
    const h = fakeHttp(() => (n++ === 0 ? json({ v: 1 }) : json({ v: 2 })))
    const client = h.client
    Object.assign(client.env, { nowIso: () => now })
    const a = await client.request('https://api.example.org/c', { expect: 'json', cacheTtlMs: 60_000 })
    now = '2027-01-15T14:00:30.000Z'
    const b = await client.request('https://api.example.org/c', { expect: 'json', cacheTtlMs: 60_000 })
    expect(h.calls).toHaveLength(1)
    expect(b.ok && b.fromCache).toBe(true)
    expect(b.ok && b.data).toEqual({ v: 1 })
    expect(b.fetch.fetchedAt).toBe(a.fetch.fetchedAt)
    h.advance(61_000)
    const c = await client.request('https://api.example.org/c', { expect: 'json', cacheTtlMs: 60_000 })
    expect(c.ok && c.data).toEqual({ v: 2 })

    const f = fakeHttp(() => new Response('', { status: 500 }))
    await f.client.request('https://api.example.org/f', { cacheTtlMs: 60_000, retries: 0 })
    await f.client.request('https://api.example.org/f', { cacheTtlMs: 60_000, retries: 0 })
    expect(f.calls).toHaveLength(2)
  })
})

describe('http helpers', () => {
  it('parses Retry-After seconds and HTTP dates', () => {
    const now = Date.parse('2027-01-15T14:00:00Z')
    expect(parseRetryAfter('120', now)).toBe(120_000)
    expect(parseRetryAfter('Fri, 15 Jan 2027 14:00:30 GMT', now)).toBe(30_000)
    expect(parseRetryAfter('soon', now)).toBeNull()
    expect(parseRetryAfter(null, now)).toBeNull()
  })

  it('bounds backoff with jitter and caps it', () => {
    expect(backoffDelay(1, { baseMs: 1000 }, () => 0)).toBe(500)
    expect(backoffDelay(1, { baseMs: 1000 }, () => 1)).toBe(1000)
    expect(backoffDelay(10, { baseMs: 1000, maxMs: 4000 }, () => 1)).toBe(4000)
  })

  it('redacts credentials from recorded URLs', () => {
    expect(redactUrl('https://user:pw@x.example.org/p?apikey=abc&latitude=1&token=t')).toBe('https://x.example.org/p?apikey=REDACTED&latitude=1&token=REDACTED')
  })

  it('hashes normalised values independently of key order', () => {
    expect(stableHash({ a: 1, b: [1, { c: 2, d: null }] })).toBe(stableHash({ b: [1, { d: null, c: 2 }], a: 1 }))
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }))
  })
})
