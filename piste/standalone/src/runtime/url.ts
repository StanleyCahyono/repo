/**
 * URL scheme of the single-file build.
 *
 * A page opened from file:// may only change the query and the fragment of its own URL (pushState to another path
 * throws). So the app URL `/resorts/alta?date=2027-01-15#conditions` is stored as
 *
 *   index.html?date=2027-01-15#/resorts/alta#conditions
 *
 * - the app QUERY is the real `location.search`, so components that read `window.location.search` keep working;
 * - the app PATH is the fragment up to a second `#`; no fragment means `/`;
 * - an in-page SECTION (anchor target) follows the second `#`. A fragment that does not start with `/` is a section of
 *   the current route (`#journal`), never a route.
 *
 * Everything here is pure (the location is passed in) so it can be reasoned about and tested in isolation.
 */

export interface AppUrl {
  /** App path, always starting with `/`, no trailing slash (except the root). */
  pathname: string
  /** App query including the leading `?`, or ''. */
  search: string
  /** In-page anchor id (without `#`), or ''. */
  section: string
}

export interface DocLocation {
  href: string
  pathname: string
  search: string
  hash: string
}

export type Resolved = { kind: 'app'; url: AppUrl } | { kind: 'external'; href: string }

const APP_BASE = 'http://piste.invalid'

export function normalizePath(p: string): string {
  let out = p || '/'
  if (!out.startsWith('/')) out = `/${out}`
  out = out.replace(/\/{2,}/g, '/')
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
  return out
}

function splitRouteFragment(frag: string): { pathname: string; section: string } {
  const i = frag.indexOf('#')
  return { pathname: normalizePath(i >= 0 ? frag.slice(0, i) : frag), section: i >= 0 ? frag.slice(i + 1) : '' }
}

/** The app URL encoded in the real location. */
export function readLocation(loc: Pick<DocLocation, 'search' | 'hash'>): AppUrl {
  const frag = loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash
  if (frag.startsWith('/')) return { ...splitRouteFragment(frag), search: loc.search === '?' ? '' : loc.search }
  return { pathname: '/', search: loc.search === '?' ? '' : loc.search, section: frag }
}

/** `/path?query#section` — the URL the app code thinks it is on. */
export function formatAppUrl(u: AppUrl): string {
  return `${u.pathname}${u.search}${u.section ? `#${u.section}` : ''}`
}

function fragmentOf(u: AppUrl): string {
  return `${u.pathname}${u.section ? `#${u.section}` : ''}`
}

/** Absolute real URL for history.pushState/replaceState (same document path, new query and fragment). */
export function toRealUrl(u: AppUrl, loc: Pick<DocLocation, 'href'>): string {
  const real = new URL(loc.href)
  real.search = u.search
  real.hash = fragmentOf(u)
  return real.href
}

/** Document-relative href for an <a> element: works for clicks, middle-clicks and "open in new tab". */
export function toRealHref(u: AppUrl, loc: Pick<DocLocation, 'pathname'>): string {
  const file = loc.pathname.slice(loc.pathname.lastIndexOf('/') + 1) || './'
  return `${file}${u.search}#${fragmentOf(u)}`
}

function samePath(a: string, b: string): boolean {
  if (a === b) return true
  try {
    return decodeURI(a) === decodeURI(b)
  } catch {
    return false
  }
}

/** A URL's query + fragment read as if it were the real location (document path given explicitly). */
function fromRealParts(search: string, hash: string, current: AppUrl): AppUrl {
  const frag = hash.startsWith('#') ? hash.slice(1) : hash
  if (frag.startsWith('/')) return { ...splitRouteFragment(frag), search }
  return { pathname: current.pathname, search, section: frag }
}

/**
 * Resolve a URL written by app code (Link href, router.push, history.replaceState, <a href>) against the current app
 * URL. Handles:
 * - `/explore?x=1#s`, `?x=1`, `#s`, `../x` — ordinary app-relative URLs;
 * - `${location.pathname}${location.search}#id` — the document's own path: same route, the fragment is a section;
 * - `${pathname}?q${location.hash}` — an app path followed by the REAL fragment (`#/route#section`): the explicit
 *   path wins, the section survives;
 * - `file:` URLs of this document; anything else with a scheme (or `//host`) is external.
 */
export function resolveAppUrl(input: string, current: AppUrl, loc: Pick<DocLocation, 'pathname'>): Resolved {
  const raw = input.trim()
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw)) {
    let u: URL
    try {
      u = new URL(raw)
    } catch {
      return { kind: 'external', href: raw }
    }
    if (u.protocol === 'file:' && samePath(u.pathname, loc.pathname)) return { kind: 'app', url: fromRealParts(u.search, u.hash, current) }
    return { kind: 'external', href: raw }
  }
  if (raw.startsWith('//')) return { kind: 'external', href: raw }
  const base = new URL(`${APP_BASE}${current.pathname}${current.search}`)
  let u: URL
  try {
    u = new URL(raw, base)
  } catch {
    return { kind: 'external', href: raw }
  }
  if (samePath(u.pathname, loc.pathname)) return { kind: 'app', url: fromRealParts(u.search, u.hash, current) }
  const frag = u.hash.startsWith('#') ? u.hash.slice(1) : ''
  const section = frag.startsWith('/') ? splitRouteFragment(frag).section : frag
  return { kind: 'app', url: { pathname: normalizePath(u.pathname), search: u.search, section } }
}

export function sameRoute(a: AppUrl, b: AppUrl): boolean {
  return a.pathname === b.pathname && a.search === b.search
}

/** Next-style search params record: repeated keys become arrays. */
export function searchRecord(search: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of new URLSearchParams(search)) {
    const prev = out[k]
    if (prev === undefined) out[k] = v
    else out[k] = Array.isArray(prev) ? [...prev, v] : [prev, v]
  }
  return out
}

/** Is this app path one of the in-browser API routes (/api/…)? */
export const isApiPath = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/')
