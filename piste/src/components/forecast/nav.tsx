'use client'
/**
 * URL-state navigation for the Forecast page. The query string is the single source of truth (see params.ts).
 *
 * - `navigate(patch)` changes params that need new server data (resorts, focus, point, month, mode, far dates)
 *   inside a transition. The patch is applied optimistically, so selections move at once, while sections that
 *   depend on the new server data wait under `PendingVeil` — no skeleton flash, no layout jump, no scroll reset.
 * - `replaceLocal(patch)` records purely client-side state (selected outlook day, open history day, outlook metric)
 *   with history.replaceState. Next syncs useSearchParams with it — but only for a state object without Next's own
 *   markers, so we pass `null` (Next copies its internal state across) — and a reload or "back from a resort"
 *   restores it without a server round trip.
 * - `useForecastParams()` reads the current params (URL + any pending optimistic patch).
 */
import { createContext, useCallback, useContext, useMemo, useOptimistic, useTransition, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/ui/cn'
import { parseForecastParams, patchQuery, type ForecastParams } from './params'

type Patch = Record<string, string | null | undefined>

interface NavApi {
  pending: boolean
  params: ForecastParams
  navigate: (patch: Patch, opts?: { hash?: string }) => void
  replaceLocal: (patch: Patch) => void
}

const NavCtx = createContext<NavApi | null>(null)

export function useForecastNav(): NavApi {
  const c = useContext(NavCtx)
  if (!c) throw new Error('useForecastNav must be used inside <ForecastNav>')
  return c
}

export function useForecastParams(): ForecastParams {
  return useForecastNav().params
}

export function ForecastNav({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const [pending, start] = useTransition()
  const [optimistic, addOptimistic] = useOptimistic<Patch | null, Patch>(null, (state, patch) => ({ ...(state ?? {}), ...patch }))

  const navigate = useCallback(
    (patch: Patch, opts?: { hash?: string }) => {
      const q = patchQuery(window.location.search, patch)
      const hash = opts?.hash ? `#${opts.hash}` : ''
      start(() => {
        addOptimistic(patch)
        router.replace(`${pathname}${q}${hash}`, { scroll: false })
      })
    },
    [pathname, router, addOptimistic],
  )
  const replaceLocal = useCallback(
    (patch: Patch) => {
      const q = patchQuery(window.location.search, patch)
      window.history.replaceState(null, '', `${pathname}${q}${window.location.hash}`)
    },
    [pathname],
  )
  const params = useMemo(() => {
    const q = optimistic ? patchQuery(search.toString(), optimistic) : search.toString()
    return parseForecastParams(new URLSearchParams(q.replace(/^\?/, '')))
  }, [search, optimistic])
  const api = useMemo(() => ({ pending, params, navigate, replaceLocal }), [pending, params, navigate, replaceLocal])
  return <NavCtx.Provider value={api}>{children}</NavCtx.Provider>
}

/**
 * Holds the previous render at reduced opacity while new server data loads. `when` narrows it to the sections whose
 * data is actually changing (default: any pending navigation).
 */
export function PendingVeil({ children, className, when }: { children: ReactNode; className?: string; when?: boolean }) {
  const { pending } = useForecastNav()
  const on = when ?? pending
  return (
    <div
      aria-busy={on || undefined}
      className={cn('transition-opacity duration-200 ease-[var(--ease-out-soft)]', on && 'pointer-events-none opacity-55', className)}
    >
      {children}
    </div>
  )
}
