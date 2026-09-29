'use client'
/**
 * Passes & Costs section tabs. Real links with aria-current; the active marker glides between tabs (shared layoutId).
 * Each tab remembers the query you left it with (sessionStorage, per browser tab), so switching to Products and back
 * to the matrix keeps its date and family filter. The strip scrolls horizontally on narrow screens and keeps the
 * active tab in view.
 */
import { useEffect, useRef, type MouseEvent } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'motion/react'
import { Calculator, Grid3x3, ReceiptText, Tags, Ticket } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { ScrollRow } from '@/components/ui/scroll-row'
import { t } from '@/lib/ui/motion'

type TabId = 'mine' | 'products' | 'matrix' | 'costs' | 'compare'

const TABS: { id: TabId; href: string; label: string; short: string; Icon: typeof Ticket }[] = [
  { id: 'mine', href: '/passes', label: 'My passes', short: 'My passes', Icon: Ticket },
  { id: 'products', href: '/passes/products', label: 'Products & prices', short: 'Products', Icon: Tags },
  { id: 'matrix', href: '/passes/matrix', label: 'Access matrix', short: 'Matrix', Icon: Grid3x3 },
  { id: 'costs', href: '/passes/costs', label: 'Day costs', short: 'Day costs', Icon: ReceiptText },
  { id: 'compare', href: '/passes/compare', label: 'Pass vs tickets', short: 'Vs tickets', Icon: Calculator },
]

function activeTab(pathname: string): TabId {
  if (pathname.startsWith('/passes/products')) return 'products'
  // The rule editor is opened from the checker ("Enter the rule") and returns to it.
  if (pathname.startsWith('/passes/matrix')) return 'matrix'
  if (pathname.startsWith('/passes/costs')) return 'costs'
  if (pathname.startsWith('/passes/compare')) return 'compare'
  return 'mine'
}

const KEY = (tab: TabId) => `piste:passes:last-query:${tab}`

function remember(tab: TabId, query: string) {
  try {
    window.sessionStorage.setItem(KEY(tab), query)
  } catch {
    // Storage unavailable: tabs open their default view.
  }
}

function recall(tab: TabId): string {
  try {
    return window.sessionStorage.getItem(KEY(tab)) ?? ''
  } catch {
    return ''
  }
}

export function PassesTabs({ className }: { className?: string }) {
  const pathname = usePathname()
  const search = useSearchParams()
  const router = useRouter()
  const active = activeTab(pathname)
  const listRef = useRef<HTMLUListElement>(null)

  // Remember the current query for this tab (the rule editor has no query of its own).
  useEffect(() => {
    if (pathname.startsWith('/passes/rules')) return
    remember(active, search.toString())
  }, [active, pathname, search])

  // Keep the active tab visible in the scrolling strip.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  const go = (tab: (typeof TABS)[number]) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    if (tab.id === active && !pathname.startsWith('/passes/rules')) return
    const q = recall(tab.id)
    if (!q) return
    e.preventDefault()
    router.push(`${tab.href}?${q}`)
  }

  return (
    <ScrollRow as="nav" aria-label="Passes & Costs sections" className={cn('-mx-4 px-4 scrollbar-thin md:mx-0 md:px-0', className)}>
      <ul ref={listRef} className="flex w-max min-w-full items-end gap-1 border-b border-divider">
        {TABS.map((tab) => {
          const on = tab.id === active
          return (
            <li key={tab.id} className="relative">
              <Link
                href={tab.href}
                onClick={go(tab)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'relative flex h-11 items-center gap-2 rounded-t-md px-3 text-[14.5px] font-medium whitespace-nowrap transition-colors duration-150',
                  on ? 'text-teal' : 'text-ink-2 hover:text-ink',
                )}
              >
                <tab.Icon aria-hidden className="size-4 max-sm:hidden" strokeWidth={1.8} />
                <span className="sm:hidden">{tab.short}</span>
                <span className="max-sm:hidden">{tab.label}</span>
              </Link>
              {on ? <motion.span layoutId="passes-tab" transition={t.select} aria-hidden className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-teal" /> : null}
            </li>
          )
        })}
      </ul>
    </ScrollRow>
  )
}
