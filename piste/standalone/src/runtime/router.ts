/**
 * Router API shared by the shims (next/link, next/navigation, next/cache), the history/fetch interceptors and the
 * React root. The React root (app.tsx) binds the implementation once it has mounted.
 */
import { isApiPath, readLocation, resolveAppUrl, toRealUrl, type AppUrl } from './url'

/**
 * push / replace: the router writes the history entry. pop: the browser moved (back/forward). sync: app code wrote a
 * new path with history.pushState/replaceState itself. refresh: same URL, fresh data.
 */
export type NavKind = 'push' | 'replace' | 'pop' | 'sync' | 'refresh'

export interface RouterImpl {
  /** Load the route for `target` and render it (inside a transition). Resolves once its data is ready. */
  navigate(target: AppUrl, kind: NavKind, scroll: boolean): Promise<void>
  /** The URL changed without a navigation (history.replaceState from a component): re-render hooks only. */
  urlChanged(target: AppUrl): void
}

let impl: RouterImpl | null = null
const queued: (() => void)[] = []

export function bindRouter(next: RouterImpl) {
  impl = next
  for (const q of queued.splice(0)) q()
}

/** The unpatched history methods (the router writes real URLs through these). */
export const rawHistory = {
  push: History.prototype.pushState,
  replace: History.prototype.replaceState,
}

export function currentAppUrl(): AppUrl {
  return readLocation(window.location)
}

let lastUrl: AppUrl | null = null
/** The app URL as of the last history change the app knows about (router writes, patched history, popstate). */
export function knownUrl(): AppUrl {
  return lastUrl ?? currentAppUrl()
}
export function setKnownUrl(u: AppUrl) {
  lastUrl = u
}

export function writeHistory(kind: 'push' | 'replace', target: AppUrl, state?: unknown) {
  const fn = kind === 'push' ? rawHistory.push : rawHistory.replace
  const base = state !== undefined ? state : kind === 'push' ? null : window.history.state
  fn.call(window.history, withKey(base, kind === 'push'), '', toRealUrl(target, window.location))
  setKnownUrl(target)
}

/** Scroll the element for an in-page section into view (like the browser does for a #fragment). */
export function scrollToSection(section: string, smooth = false): boolean {
  if (!section) return false
  let id = section
  try {
    id = decodeURIComponent(section)
  } catch {
    /* keep raw */
  }
  const el = document.getElementById(id) ?? document.getElementsByName(id)[0] ?? null
  if (!el) return false
  el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  return true
}

// ---------------------------------------------------------------------------------------------------------------------
// History entry keys (for scroll restoration on back/forward). Stored inside history.state next to whatever app code
// puts there; app code passing `null` gets an object back — harmless (Next stores its own keys there too).

let keySeq = 0
const newKey = () => `${Date.now().toString(36)}-${(keySeq++).toString(36)}`

export function withKey(state: unknown, fresh: boolean): unknown {
  const prevKey = entryKey()
  const key = fresh || !prevKey ? newKey() : prevKey
  if (state && typeof state === 'object' && !Array.isArray(state)) return { ...(state as object), __pisteKey: key }
  if (state === null || state === undefined) return { __pisteKey: key }
  return state
}

export function entryKey(): string | null {
  const s = window.history.state as { __pisteKey?: string } | null
  return s && typeof s === 'object' && typeof s.__pisteKey === 'string' ? s.__pisteKey : null
}

// ---------------------------------------------------------------------------------------------------------------------

type Downloader = (url: AppUrl) => Promise<void>
let apiDownloader: Downloader | null = null
export function setApiDownloader(fn: Downloader) {
  apiDownloader = fn
}

function run(fn: () => Promise<void> | void): Promise<void> {
  if (impl) return Promise.resolve(fn())
  return new Promise((resolve) => queued.push(() => resolve(fn())))
}

/** Navigate to an app URL written by app code. External URLs leave the app like a normal link. */
export function go(href: string, kind: 'push' | 'replace', scroll = true): Promise<void> {
  const r = resolveAppUrl(href, knownUrl(), window.location)
  if (r.kind === 'external') {
    if (kind === 'replace') window.location.replace(r.href)
    else window.location.assign(r.href)
    return Promise.resolve()
  }
  if (isApiPath(r.url.pathname)) return apiDownloader ? apiDownloader(r.url) : Promise.resolve()
  return run(() => impl!.navigate(r.url, kind, scroll))
}

export function goTo(target: AppUrl, kind: NavKind, scroll = true): Promise<void> {
  return run(() => impl!.navigate(target, kind, scroll))
}

export function refresh(): Promise<void> {
  return run(() => impl!.navigate(knownUrl(), 'refresh', false))
}

export function notifyUrlChanged(target: AppUrl) {
  impl?.urlChanged(target)
}

/** The object useRouter() returns (stable identity, like Next's). */
export const appRouter = {
  push: (href: string, opts?: { scroll?: boolean }) => void go(href, 'push', opts?.scroll !== false),
  replace: (href: string, opts?: { scroll?: boolean }) => void go(href, 'replace', opts?.scroll !== false),
  refresh: () => void refresh(),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  prefetch: () => {},
  hmrRefresh: () => {},
}

// ---------------------------------------------------------------------------------------------------------------------
// Revalidation (next/cache): collapse many revalidatePath calls into one refresh after the current task. Server-action
// wrappers await the pending refresh so, like Next, the action resolves once the fresh data is on screen.

let pending: Promise<void> | null = null

export function scheduleRefresh(): Promise<void> {
  if (!pending) {
    pending = new Promise<void>((resolve) => {
      setTimeout(() => {
        pending = null
        refresh().then(resolve, resolve)
      }, 0)
    })
  }
  return pending
}

export function pendingRefresh(): Promise<void> | null {
  return pending
}
