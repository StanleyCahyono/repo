/**
 * Browser-level glue so unmodified app code works from a file:// URL:
 * - history.pushState/replaceState are translated from app URLs (`/explore?x=1`, `#journal`,
 *   `${location.pathname}${location.search}#id`) to this document's `?query#/path#section` form. Query-only and
 *   section-only changes re-render the URL hooks without reloading data (as in Next); a new path loads the route.
 * - popstate → render the route for the new location (or just scroll for a section change).
 * - Clicks on plain <a href="/…"> (not next/link) navigate in-app; `#id` anchors scroll without touching the route;
 *   `/api/export/…` links and GET forms run the export handler in the browser and download the file.
 * - fetch('/api/…') calls the matching route handler in the browser; everything else goes to the network.
 */
import { apiUrlOf, callApi, downloadApi } from './api'
import { currentAppUrl, entryKey, go, goTo, knownUrl, notifyUrlChanged, rawHistory, scrollToSection, setApiDownloader, setKnownUrl, withKey } from './router'
import { isApiPath, resolveAppUrl, sameRoute, toRealHref, toRealUrl, type AppUrl } from './url'

const scrollPositions = new Map<string, number>()
export function savedScroll(key: string | null): number | null {
  return key ? (scrollPositions.get(key) ?? null) : null
}

function patchHistory() {
  const h = window.history
  const make = (kind: 'push' | 'replace') =>
    function (this: History, state: unknown, unused: string, url?: string | URL | null) {
      const raw = kind === 'push' ? rawHistory.push : rawHistory.replace
      if (url === undefined || url === null) return raw.call(h, withKey(state, kind === 'push'), unused)
      const prev = knownUrl()
      const r = resolveAppUrl(String(url), prev, window.location)
      // Anything else (another origin) is refused by the browser exactly as before.
      if (r.kind === 'external') return raw.call(h, state, unused, url)
      raw.call(h, withKey(state, kind === 'push'), unused, toRealUrl(r.url, window.location))
      setKnownUrl(r.url)
      if (r.url.pathname !== prev.pathname) void goTo(r.url, 'sync', kind === 'push')
      else if (r.url.search !== prev.search || r.url.section !== prev.section) notifyUrlChanged(r.url)
    }
  h.pushState = make('push')
  h.replaceState = make('replace')
}

function onPopState() {
  const next = currentAppUrl()
  const prev = knownUrl()
  setKnownUrl(next)
  if (sameRoute(next, prev)) {
    notifyUrlChanged(next)
    if (next.section) scrollToSection(next.section)
    return
  }
  void goTo(next, 'pop', true)
}

function onHashChange() {
  // Someone edited the fragment by hand (or code set location.hash = 'x'): a bare section stays on the route.
  const hash = window.location.hash.slice(1)
  if (hash && !hash.startsWith('/')) {
    const prev = knownUrl()
    const next = { ...prev, section: hash }
    rawHistory.replace.call(window.history, window.history.state, '', toRealUrl(next, window.location))
    setKnownUrl(next)
    notifyUrlChanged(next)
    scrollToSection(hash)
  }
}

const modified = (e: MouseEvent) => e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

function anchorOf(e: Event): HTMLAnchorElement | null {
  const t = e.target as Element | null
  const a = t && typeof t.closest === 'function' ? t.closest('a[href]') : null
  return a instanceof HTMLAnchorElement ? a : null
}

/** Give plain internal <a href="/x"> elements a real href (new tab, status bar, stopped clicks all behave). */
function translateAnchor(a: HTMLAnchorElement) {
  if (a.hasAttribute('data-app-href') || a.hasAttribute('data-piste-href')) return
  const href = a.getAttribute('href')
  if (!href || href.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) return
  const r = resolveAppUrl(href, knownUrl(), window.location)
  if (r.kind !== 'app' || isApiPath(r.url.pathname)) return
  a.setAttribute('data-piste-href', href)
  a.setAttribute('href', toRealHref(r.url, window.location))
}

function appHrefOf(a: HTMLAnchorElement): string | null {
  return a.getAttribute('data-piste-href') ?? a.getAttribute('href')
}

function onEarly(e: Event) {
  const a = anchorOf(e)
  if (a) translateAnchor(a)
}

function onClick(e: MouseEvent) {
  const a = anchorOf(e)
  if (!a || a.hasAttribute('data-app-href')) return
  const href = appHrefOf(a)
  if (!href) return
  const r = resolveAppUrl(href, knownUrl(), window.location)
  if (r.kind === 'external') return
  if (isApiPath(r.url.pathname)) {
    if (e.defaultPrevented) return
    e.preventDefault()
    void downloadApi(r.url)
    return
  }
  if (e.defaultPrevented || modified(e)) return
  const target = a.getAttribute('target')
  if ((target && target !== '_self') || a.hasAttribute('download')) return
  e.preventDefault()
  const current = knownUrl()
  if (href.startsWith('#') && sameRoute(r.url, current)) {
    // In-page anchor: a new history entry for the section, scroll, never a route change.
    rawHistory.push.call(window.history, withKey(null, true), '', toRealUrl(r.url, window.location))
    setKnownUrl(r.url)
    notifyUrlChanged(r.url)
    if (scrollToSection(r.url.section, !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)) {
      const el = document.getElementById(r.url.section)
      if (el && el.tabIndex >= 0) el.focus({ preventScroll: true })
    }
    return
  }
  void go(href, 'push')
}

function onSubmit(e: SubmitEvent) {
  if (e.defaultPrevented) return
  const form = e.target
  if (!(form instanceof HTMLFormElement)) return
  const action = form.getAttribute('action')
  if (!action || typeof (form as unknown as { action: unknown }).action === 'function') return
  const method = (form.getAttribute('method') ?? 'get').toLowerCase()
  const r = resolveAppUrl(action, knownUrl(), window.location)
  if (r.kind !== 'app') return
  e.preventDefault()
  if (method !== 'get') {
    console.warn(`Form posts to ${action} are not available in the single-file version`)
    return
  }
  const data = new FormData(form, e.submitter ?? undefined)
  const params = new URLSearchParams()
  for (const [k, v] of data) if (typeof v === 'string') params.append(k, v)
  const q = params.toString()
  const url: AppUrl = { pathname: r.url.pathname, search: q ? `?${q}` : '', section: '' }
  if (isApiPath(url.pathname)) void downloadApi(url)
  else void goTo(url, 'push', true)
}

function patchFetch() {
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const api = apiUrlOf(href, window.location.pathname)
    if (!api) return realFetch(input, init)
    let reqInit: RequestInit = init ?? {}
    if (input instanceof Request) {
      const body = ['GET', 'HEAD'].includes(input.method) ? undefined : await input.arrayBuffer()
      reqInit = { method: input.method, headers: input.headers, body, ...init }
    }
    return callApi(api, reqInit)
  }
}

let scrollRaf = 0
function onScroll() {
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    const key = entryKey()
    if (key) scrollPositions.set(key, window.scrollY)
  })
}

export function installInterceptors() {
  window.history.scrollRestoration = 'manual'
  // Give the initial entry a key so back/forward can restore its scroll position.
  if (!entryKey()) rawHistory.replace.call(window.history, withKey(window.history.state, true), '', window.location.href)
  setKnownUrl(currentAppUrl())
  patchHistory()
  patchFetch()
  setApiDownloader(downloadApi)
  window.addEventListener('popstate', onPopState)
  window.addEventListener('hashchange', onHashChange)
  window.addEventListener('scroll', onScroll, { passive: true })
  for (const type of ['pointerdown', 'mouseover', 'focusin', 'contextmenu', 'auxclick']) document.addEventListener(type, onEarly, true)
  document.addEventListener('click', onEarly, true)
  document.addEventListener('click', onClick)
  document.addEventListener('submit', onSubmit)
}
