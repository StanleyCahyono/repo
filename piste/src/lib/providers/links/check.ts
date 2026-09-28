/**
 * Link checker for catalog and user-supplied URLs. HEAD first (falls back to GET without reading the body when
 * HEAD fails or is refused), follows at most 5 redirects MANUALLY so every hop passes the SSRF guard, and records
 * the final URL, status and whether the target allows being framed (X-Frame-Options / CSP frame-ancestors).
 */
import { defaultHttp, redactUrl, type HttpClient, type RawOk } from '../http'
import type { LinkCheckResult } from '../types'
import { assertPublicHttpUrl, UnsafeUrlError, type Resolver } from '../url-guard'

export interface CheckLinkOptions {
  http?: HttpClient
  resolver?: Resolver
  /** SSRF guard on every hop. Default true; only tests of trusted fixtures should turn it off. */
  guard?: boolean
  maxRedirects?: number
  timeoutMs?: number
}

/**
 * Whether a browser would render the page inside our iframe. X-Frame-Options DENY/SAMEORIGIN or a CSP
 * frame-ancestors list that does not allow every origin → false.
 */
export function embeddableFrom(headers: Headers): boolean {
  const xfo = headers.get('x-frame-options')
  if (xfo && /\b(deny|sameorigin)\b/i.test(xfo)) return false
  const csp = headers.get('content-security-policy')
  if (csp) {
    for (const directive of csp.split(/[;,]/)) {
      const [name, ...sources] = directive.trim().split(/\s+/)
      if (name?.toLowerCase() !== 'frame-ancestors') continue
      const s = sources.map((x) => x.toLowerCase())
      if (s.includes("'none'")) return false
      if (s.includes('*') || s.includes('https:') || s.includes('http:')) continue
      return false
    }
  }
  return true
}

const isRedirect = (s: number) => s === 301 || s === 302 || s === 303 || s === 307 || s === 308

export async function checkLink(url: string, opts: CheckLinkOptions = {}): Promise<LinkCheckResult> {
  const http = opts.http ?? defaultHttp
  const checkedAt = http.env.nowIso()
  const maxRedirects = opts.maxRedirects ?? 5
  const result = (over: Partial<LinkCheckResult>): LinkCheckResult => ({
    url,
    ok: false,
    httpStatus: null,
    finalUrl: null,
    embeddable: null,
    error: null,
    checkedAt,
    ...over,
  })

  let current = url
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (opts.guard !== false) {
      try {
        await assertPublicHttpUrl(current, { resolver: opts.resolver })
      } catch (e) {
        const msg = e instanceof UnsafeUrlError ? e.message : String(e)
        return result({ finalUrl: redactUrl(current), error: `Blocked: ${msg}` })
      }
    }
    let res: RawOk | null = null
    let lastError: string | null = null
    for (const method of ['HEAD', 'GET'] as const) {
      const r = await http.raw(current, { method, redirect: 'manual', timeoutMs: opts.timeoutMs ?? 10_000, headers: { Accept: 'text/html,*/*;q=0.8' } })
      if (!r.ok) {
        lastError = r.error
        continue
      }
      const status = r.response.status
      // Do not download bodies: we only need status and headers.
      await r.response.body?.cancel().catch(() => {})
      r.done()
      if (method === 'HEAD' && status >= 400) {
        res = r
        continue // some servers refuse HEAD (405/403/404); retry with GET
      }
      res = r
      break
    }
    if (!res) return result({ finalUrl: redactUrl(current), error: lastError ?? 'Request failed' })
    const status = res.response.status
    if (isRedirect(status)) {
      const location = res.response.headers.get('location')
      if (!location) return result({ httpStatus: status, finalUrl: redactUrl(current), error: 'Redirect without Location header' })
      try {
        current = new URL(location, current).toString()
      } catch {
        return result({ httpStatus: status, finalUrl: redactUrl(current), error: 'Invalid redirect Location' })
      }
      continue
    }
    const ok = status >= 200 && status < 300
    return result({
      ok,
      httpStatus: status,
      finalUrl: redactUrl(current),
      embeddable: ok ? embeddableFrom(res.response.headers) : null,
      error: ok ? null : `HTTP ${status}`,
    })
  }
  return result({ finalUrl: redactUrl(current), error: `Too many redirects (more than ${maxRedirects})` })
}
