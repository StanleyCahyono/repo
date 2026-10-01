'use client'
/**
 * URL-state navigation for the Passes & Costs routes (see params.ts). `navigate(patch)` rewrites the query string
 * inside a transition (router.replace, no scroll jump): the current view stays on screen, dimmed under
 * `PendingVeil`, until the server has rendered the new answer — no skeleton flash between choices.
 */
import { createContext, useCallback, useContext, useMemo, useTransition, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/ui/cn'
import { patchQuery } from './params'

type Patch = Record<string, string | null | undefined>

interface NavApi {
  pending: boolean
  navigate: (patch: Patch, opts?: { replaceAll?: boolean; hash?: string }) => void
}

const NavCtx = createContext<NavApi | null>(null)

export function usePassesNav(): NavApi {
  const c = useContext(NavCtx)
  if (!c) throw new Error('usePassesNav must be used inside <PassesNav>')
  return c
}

export function PassesNav({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()
  const navigate = useCallback(
    (patch: Patch, opts?: { replaceAll?: boolean; hash?: string }) => {
      const q = patchQuery(opts?.replaceAll ? '' : window.location.search, patch)
      start(() => {
        router.replace(`${pathname}${q}${opts?.hash ? `#${opts.hash}` : ''}`, { scroll: false })
      })
    },
    [pathname, router],
  )
  const api = useMemo(() => ({ pending, navigate }), [pending, navigate])
  return <NavCtx.Provider value={api}>{children}</NavCtx.Provider>
}

/** Keeps the previous answer on screen, dimmed, while the next one loads. */
export function PendingVeil({ children, className }: { children: ReactNode; className?: string }) {
  const { pending } = usePassesNav()
  return (
    <div aria-busy={pending || undefined} className={cn('transition-opacity duration-200 ease-[var(--ease-out-soft)]', pending && 'pointer-events-none opacity-55', className)}>
      {children}
    </div>
  )
}

/** Small "Updating…" status for toolbars (announced politely). */
export function PendingNote({ className }: { className?: string }) {
  const { pending } = usePassesNav()
  return (
    <span role="status" aria-live="polite" className={cn('text-[12.5px] text-ink-3', className)}>
      {pending ? 'Updating…' : ''}
    </span>
  )
}
