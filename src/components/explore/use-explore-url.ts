'use client'
/**
 * Explore URL state. The query string is the single source of truth, so returning from a resort page (or reloading,
 * or sharing the link) restores the same list:
 *
 * - Filters, sort and the mobile list/map view are applied on the client: they are written with
 *   `history.replaceState`, which Next keeps in sync with `useSearchParams` — no server round trip, no history spam.
 * - `date` and `mode` change the data itself (scores, closures, costs, pass access), so they navigate with
 *   `router.replace` inside a transition; `pending` is true until the new data has rendered.
 *
 * The latest query per tab is also remembered in sessionStorage (wrapped in try/catch) so the Explore tabs can link
 * back to the view you left.
 */
import { useCallback, useMemo, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { filtersToParams, parseFilters, type ExploreFilters } from './filters'

export type ExploreView = 'list' | 'map'

const MEMORY_KEY = (tab: string) => `piste:explore:last-query:${tab}`

/** Remember the latest query string of an Explore tab (per browser tab; storage failures are ignored). */
export function rememberQuery(tab: 'resorts' | 'events' | 'compare', search: string) {
  try {
    window.sessionStorage.setItem(MEMORY_KEY(tab), search.startsWith('?') ? search.slice(1) : search)
  } catch {
    // Storage unavailable: the tab link simply opens the default view.
  }
}

export function recallQuery(tab: 'resorts' | 'events' | 'compare'): string {
  try {
    return window.sessionStorage.getItem(MEMORY_KEY(tab)) ?? ''
  } catch {
    return ''
  }
}

/** Query string with list commas left readable (`region=Vermont,Utah`, `ids=a,b`) — commas are valid in queries. */
export function readableQuery(params: URLSearchParams): string {
  return params.toString().replace(/%2C/gi, ',')
}

function withQuery(pathname: string, params: URLSearchParams): string {
  const q = readableQuery(params)
  return q ? `${pathname}?${q}` : pathname
}

export function useExploreUrl() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()

  const filters = useMemo(() => parseFilters(sp), [sp])
  const view: ExploreView = sp.get('view') === 'map' ? 'map' : 'list'
  /** Map region jump (camera + list scope); absent = World. */
  const jump = sp.get('at')

  const replaceLocal = useCallback(
    (params: URLSearchParams) => {
      const url = withQuery(pathname, params)
      // `null`, not window.history.state: Next skips its router sync for states it marked as its own (__NA), which
      // would leave useSearchParams stale. With null, Next copies its internal state in and syncs the params.
      window.history.replaceState(null, '', url)
      rememberQuery('resorts', params.toString())
    },
    [pathname],
  )

  /** Update filters (client-side only). Accepts a value or an updater of the CURRENT url state. */
  const setFilters = useCallback(
    (next: ExploreFilters | ((cur: ExploreFilters) => ExploreFilters)) => {
      const current = new URLSearchParams(window.location.search)
      const value = typeof next === 'function' ? next(parseFilters(current)) : next
      replaceLocal(filtersToParams(value, current))
    },
    [replaceLocal],
  )

  const setView = useCallback(
    (v: ExploreView) => {
      const p = new URLSearchParams(window.location.search)
      if (v === 'map') p.set('view', 'map')
      else p.delete('view')
      replaceLocal(p)
    },
    [replaceLocal],
  )

  const setJump = useCallback(
    (key: string | null) => {
      const p = new URLSearchParams(window.location.search)
      if (key && key !== 'world') p.set('at', key)
      else p.delete('at')
      replaceLocal(p)
    },
    [replaceLocal],
  )

  /** Change the scenario (server data): date and/or scoring mode. `null` removes the key (back to the default). */
  const navigate = useCallback(
    (patch: Record<string, string | null>) => {
      const p = new URLSearchParams(window.location.search)
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') p.delete(k)
        else p.set(k, v)
      }
      rememberQuery('resorts', p.toString())
      start(() => router.replace(withQuery(pathname, p), { scroll: false }))
    },
    [pathname, router],
  )

  return { filters, setFilters, view, setView, jump, setJump, navigate, pending, search: sp.toString() }
}
