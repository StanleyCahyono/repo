'use client'
/**
 * URL-state navigation for Today. The query string is the single source of truth (./params.ts).
 *
 * `navigate(patch)` applies a query patch inside a transition: selections (date chips, the day strip, presets)
 * move at once from the optimistic patch while the sections that depend on new server data dim under
 * <PendingVeil> — no skeleton flash, no scroll reset. `replaceLocal(patch)` records client-only state with
 * history.replaceState (Next keeps useSearchParams in sync), so a reload or "back from a resort" restores it.
 */
import { createContext, useCallback, useContext, useMemo, useOptimistic, useTransition, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/ui/cn'
import { datesOf, parseTodayParams, patchQuery, type TodayParams } from './params'

type Patch = Record<string, string | null | undefined>

interface NavApi {
  pending: boolean
  today: string
  params: TodayParams
  dates: string[]
  navigate: (patch: Patch) => void
  replaceLocal: (patch: Patch) => void
}

const NavCtx = createContext<NavApi | null>(null)

export function useTodayNav(): NavApi {
  const c = useContext(NavCtx)
  if (!c) throw new Error('useTodayNav must be used inside <TodayNav>')
  return c
}

export function TodayNav({ today, children }: { today: string; children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const [pending, start] = useTransition()
  const [optimistic, addOptimistic] = useOptimistic<Patch | null, Patch>(null, (state, patch) => ({ ...(state ?? {}), ...patch }))

  const navigate = useCallback(
    (patch: Patch) => {
      const q = patchQuery(window.location.search, patch)
      start(() => {
        addOptimistic(patch)
        router.replace(`${pathname}${q}`, { scroll: false })
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
    const q = optimistic ? patchQuery(search.toString(), optimistic) : `?${search.toString()}`
    return parseTodayParams(new URLSearchParams(q.replace(/^\?/, '')), today)
  }, [search, optimistic, today])
  const api = useMemo(
    () => ({
      pending,
      today,
      params,
      dates: datesOf(params, today),
      navigate,
      replaceLocal,
    }),
    [pending, today, params, navigate, replaceLocal],
  )
  return <NavCtx.Provider value={api}>{children}</NavCtx.Provider>
}

/** Keeps the previous render, dimmed and inert, while the server re-ranks for the new selection. */
export function PendingVeil({ children, className }: { children: ReactNode; className?: string }) {
  const { pending } = useTodayNav()
  return (
    <div
      aria-busy={pending || undefined}
      className={cn('transition-opacity duration-200 ease-[var(--ease-out-soft)]', pending && 'pointer-events-none opacity-55', className)}
    >
      {children}
    </div>
  )
}
