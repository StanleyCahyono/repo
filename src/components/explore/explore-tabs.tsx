'use client'
/**
 * Explore section tabs: Resorts (list + map), Compare (the 2–4 resort comparison) and Events. Real links with
 * aria-current; the active marker glides between tabs (shared layoutId). Clicking a tab returns to the view you
 * left on it in this browser tab (remembered query), so switching to Events and back keeps your filters.
 */
import type { MouseEvent } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion } from 'motion/react'
import { CalendarDays, Columns3, Compass } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { ScrollRow } from '@/components/ui/scroll-row'
import { t } from '@/lib/ui/motion'
import { useCompareSelection } from '@/components/resort/card-compare'
import { readableQuery, recallQuery } from './use-explore-url'

type TabId = 'resorts' | 'compare' | 'events'

const TABS: { id: TabId; href: string; label: string; Icon: typeof Compass }[] = [
  { id: 'resorts', href: '/explore', label: 'Resorts', Icon: Compass },
  { id: 'compare', href: '/explore/compare', label: 'Compare', Icon: Columns3 },
  { id: 'events', href: '/explore/events', label: 'Events', Icon: CalendarDays },
]

function activeTab(pathname: string): TabId {
  if (pathname.startsWith('/explore/compare')) return 'compare'
  if (pathname.startsWith('/explore/events')) return 'events'
  return 'resorts'
}

/** Compare URL for a selection, carrying the Explore scenario (date, mode, product) when one is remembered. */
export function compareHref(ids: readonly string[], scenario?: URLSearchParams | null): string {
  const p = new URLSearchParams()
  if (ids.length) p.set('ids', ids.join(','))
  for (const k of ['date', 'mode', 'product']) {
    const v = scenario?.get(k)
    if (v) p.set(k, v)
  }
  const q = readableQuery(p)
  return q ? `/explore/compare?${q}` : '/explore/compare'
}

export function ExploreTabs({ className }: { className?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const active = activeTab(pathname)
  const compare = useCompareSelection()

  const go = (tab: TabId) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0 || tab === active) return
    let href: string | null = null
    if (tab === 'resorts') {
      const q = recallQuery('resorts')
      if (q) href = `/explore?${q}`
    } else if (tab === 'events') {
      const q = recallQuery('events')
      if (q) href = `/explore/events?${q}`
    } else if (compare.ids.length) {
      href = compareHref(compare.ids, new URLSearchParams(recallQuery('resorts')))
    }
    if (!href) return
    e.preventDefault()
    router.push(href)
  }

  return (
    <ScrollRow as="nav" aria-label="Explore sections" className={cn('scrollbar-thin', className)}>
      <ul className="flex w-max min-w-full items-end gap-1 border-b border-divider">
        {TABS.map((tab) => {
          const on = tab.id === active
          const count = tab.id === 'compare' ? compare.entries.length : 0
          return (
            <li key={tab.id} className="relative">
              <Link
                href={tab.href}
                onClick={go(tab.id)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'relative flex h-11 items-center gap-2 rounded-t-md px-3 text-[14.5px] font-medium transition-colors duration-150',
                  on ? 'text-teal' : 'text-ink-2 hover:text-ink',
                )}
              >
                <tab.Icon aria-hidden className="size-4" strokeWidth={1.8} />
                {tab.label}
                {count ? (
                  <span className="tnum inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-glacier px-1.5 text-[12px] font-semibold text-teal">
                    <span className="sr-only">(</span>
                    {count}
                    <span className="sr-only"> selected)</span>
                  </span>
                ) : null}
              </Link>
              {on ? (
                <motion.span layoutId="explore-tab" transition={t.select} aria-hidden className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-teal" />
              ) : null}
            </li>
          )
        })}
      </ul>
    </ScrollRow>
  )
}
