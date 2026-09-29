/**
 * React root of the single-file build: holds the current route (a promise of its resolved tree) and the URL the hooks
 * see. Navigations load data first and swap the tree inside a transition, so — like Next — the old page stays on screen
 * while the new one loads (a caller's useTransition stays pending until the new data is rendered). A navigation to
 * another path that takes more than 150 ms shows the target's loading.tsx.
 */
import { startTransition, use, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ParamsContext, UrlContext } from './contexts'
import { loadingElementFor, loadRoute } from './loader'
import { LoadingOverrideContext, RedirectBoundary, ResolvedContext, type Resolved } from './outlet'
import { bindRouter, entryKey, go, scrollToSection, setKnownUrl, writeHistory, type NavKind } from './router'
import { savedScroll } from './interceptors'
import { formatAppUrl, type AppUrl } from './url'

export interface Entry {
  id: number
  url: AppUrl
  promise: Promise<Resolved>
  kind: NavKind | 'initial'
  scroll: boolean
}

/**
 * Mark a promise with React's thenable fields when it settles, so `use()` reads a resolved route synchronously
 * instead of suspending once (which costs React's 300 ms Suspense throttle on the first render).
 */
function tracked<T>(p: Promise<T>): Promise<T> {
  const t = p as Promise<T> & { status?: string; value?: T; reason?: unknown }
  t.status = 'pending'
  p.then(
    (value) => {
      t.status = 'fulfilled'
      t.value = value
    },
    (reason: unknown) => {
      t.status = 'rejected'
      t.reason = reason
    },
  )
  return p
}

let navSeq = 0
export function initialEntry(url: AppUrl): Entry {
  return { id: ++navSeq, url, promise: tracked(loadRoute(url)), kind: 'initial', scroll: true }
}

const THEME_KEY = 'piste:standalone:theme'

function applyDocument(r: Resolved) {
  const el = document.documentElement
  if (r.html.lang) el.lang = r.html.lang
  if (r.html.theme) el.setAttribute('data-theme', r.html.theme)
  else el.removeAttribute('data-theme')
  if (r.html.className !== undefined && el.className !== r.html.className) el.className = r.html.className
  try {
    window.localStorage.setItem(THEME_KEY, r.html.theme ?? 'system')
  } catch {
    /* storage unavailable: the next start may flash the system theme briefly */
  }
  if (r.title && document.title !== r.title) document.title = r.title
}

export function App({ initial, onFirstCommit }: { initial: Entry; onFirstCommit?: () => void }) {
  const [entry, setEntry] = useState(initial)
  const [url, setUrl] = useState(initial.url)
  const [loadingFor, setLoadingFor] = useState<{ id: number; url: AppUrl } | null>(null)
  const announcer = useRef<HTMLParagraphElement>(null)
  const committedPath = useRef(initial.url.pathname)
  const firstCommit = useRef(onFirstCommit)

  useLayoutEffect(() => {
    bindRouter({
      navigate(target, kind, scroll) {
        if (kind === 'push' || kind === 'replace') writeHistory(kind, target)
        else setKnownUrl(target)
        const id = ++navSeq
        const promise = tracked(loadRoute(target))
        const pathChanged = target.pathname !== committedPath.current
        startTransition(() => {
          setEntry({ id, url: target, promise, kind, scroll })
          setUrl(target)
        })
        if (pathChanged && kind !== 'refresh') {
          const timer = setTimeout(() => setLoadingFor({ id, url: target }), 150)
          promise.then(
            () => clearTimeout(timer),
            () => clearTimeout(timer),
          )
        }
        return promise.then(
          () => undefined,
          () => undefined,
        )
      },
      urlChanged(target) {
        setKnownUrl(target)
        setUrl(target)
      },
    })
  }, [])

  const resolved = use(entry.promise)
  const loading = loadingFor && loadingFor.id > entry.id ? loadingElementFor(loadingFor.url) : null

  useLayoutEffect(() => {
    committedPath.current = entry.url.pathname
    applyDocument(resolved)
    if (entry.kind === 'initial') {
      if (entry.url.section) requestAnimationFrame(() => scrollToSection(entry.url.section))
      firstCommit.current?.()
      firstCommit.current = undefined
      return
    }
    // Route announcer (like Next's): screen readers hear the new page's title.
    if (announcer.current) announcer.current.textContent = resolved.title
    if (entry.kind === 'pop') {
      const y = savedScroll(entryKey())
      if (y !== null) window.scrollTo(0, y)
      else if (!scrollToSection(entry.url.section)) window.scrollTo(0, 0)
      return
    }
    if (entry.kind === 'refresh' || !entry.scroll) {
      if (entry.url.section && entry.kind !== 'refresh') scrollToSection(entry.url.section)
      return
    }
    if (!scrollToSection(entry.url.section)) window.scrollTo(0, 0)
  }, [entry, resolved])

  useEffect(() => {
    if (resolved.redirect) void go(resolved.redirect.url, resolved.redirect.type)
  }, [resolved])

  return (
    <UrlContext.Provider value={url}>
      <ParamsContext.Provider value={resolved.params}>
        <ResolvedContext.Provider value={resolved}>
          <LoadingOverrideContext.Provider value={loading}>
            <RedirectBoundary>{resolved.body as ReactNode}</RedirectBoundary>
          </LoadingOverrideContext.Provider>
        </ResolvedContext.Provider>
      </ParamsContext.Provider>
      <p ref={announcer} aria-live="assertive" aria-atomic="true" className="sr-only" data-route-announcer data-url={formatAppUrl(url)} />
    </UrlContext.Provider>
  )
}
