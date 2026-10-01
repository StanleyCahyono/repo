'use client'
/**
 * Back link that returns to wherever the user came from inside Piste — so Explore's URL filters, the Today date or
 * a trip are restored exactly — and falls back to /explore for direct visits. The label names the page it returns to.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { PRIMARY_NAV, UTILITY_NAV } from '@/components/shell/nav'

interface NavigationEntryLike {
  url: string | null
}
interface NavigationLike {
  canGoBack: boolean
  currentEntry: { index: number } | null
  entries: () => NavigationEntryLike[]
}

function previousInAppPath(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const nav = (window as unknown as { navigation?: NavigationLike }).navigation
    if (nav?.canGoBack && nav.currentEntry) {
      const prev = nav.entries()[nav.currentEntry.index - 1]
      if (prev?.url) {
        const u = new URL(prev.url)
        if (u.origin === window.location.origin && u.pathname !== window.location.pathname) return u.pathname
      }
      return null
    }
    const ref = document.referrer ? new URL(document.referrer) : null
    if (ref && ref.origin === window.location.origin && ref.pathname !== window.location.pathname && window.history.length > 1) return ref.pathname
  } catch {
    /* fall back to /explore */
  }
  return null
}

function labelFor(path: string): string {
  if (path.startsWith('/resorts/')) return 'Back'
  if (path.startsWith('/explore/compare')) return 'Comparison'
  if (path.startsWith('/explore/events')) return 'Events'
  const item = [...PRIMARY_NAV, ...UTILITY_NAV].find((i) => i.match(path))
  return item?.short ?? item?.label ?? 'Back'
}

export function BackLink() {
  const router = useRouter()
  const [prev, setPrev] = useState<string | null>(null)
  useEffect(() => {
    // Read browser history after hydration (not available during server rendering).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrev(previousInAppPath())
  }, [])
  return (
    <Link
      href="/explore"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        if (previousInAppPath()) {
          e.preventDefault()
          router.back()
        }
      }}
      className="-ml-1 inline-flex h-7 items-center gap-1 rounded-md px-1 text-[13px] font-medium text-teal hover:underline"
    >
      <ArrowLeft aria-hidden className="size-3.5" />
      {prev ? labelFor(prev) : 'Explore'}
    </Link>
  )
}
