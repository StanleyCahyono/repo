'use client'
/**
 * Passes & Costs section tabs. Real links with aria-current; the active marker glides between tabs (shared layoutId).
 * Each tab remembers the query you left it with (sessionStorage, per browser tab), so switching to Products and back
 * to Day costs keeps its date and filter. The strip scrolls horizontally on narrow screens and keeps the
 * active tab in view.
 */
import { useEffect, useRef, type MouseEvent } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'motion/react'
import { Calculator, ReceiptText, Tags, Ticket } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { ScrollRow } from '@/components/ui/scroll-row'

type TabId = 'mine' | 'products' | 'costs' | 'compare'

const TABS: { id: TabId; href: string; label: string; short: string; Icon: typeof Ticket }[] = [
  { id: 'mine', href: '/passes', label: 'My passes', short: 'My passes', Icon: Ticket },
  { id: 'products', href: '/passes/products', label: 'Products & prices', short: 'Prices', Icon: Tags },
  { id: 'costs', href: '/passes/costs', label: 'Day costs', short: 'Day costs', Icon: ReceiptText },
  { id: 'compare', href: '/passes/compare', label: 'Pass vs tickets', short: 'Vs tickets', Icon: Calculator },
]

function activeTab(pathname: string): TabId {
  if (pathname.startsWith('/passes/products')) return 'products'
  // The rule editor is opened from the checker ("Enter the rule") and returns to it.
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
    <ScrollRow as="nav" aria-label="Passes & Costs sections" className={cn('-mx-4 px-4 py-2 scrollbar-thin md:mx-0 md:px-0', className)}>
      <ul ref={listRef} className="glass flex w-max items-center gap-0.5 rounded-full p-[5px]">
        {TABS.map((tab) => {
          const on = tab.id === active
          return (
            <li key={tab.id} className="relative">
              <Link
                href={tab.href}
                onClick={go(tab)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'relative flex h-10 items-center gap-2 rounded-full px-3 text-[13px] font-medium whitespace-nowrap outline-offset-2 transition-colors duration-150 max-md:h-11 sm:px-3.5 sm:text-[14px] lg:px-4',
                  on ? 'text-on-ink-chip' : 'text-ink-2 hover:text-ink',
                )}
              >
                {on ? <motion.span layoutId="passes-tab" transition={{ type: 'spring', stiffness: 520, damping: 40, mass: 0.9 }} aria-hidden className="absolute inset-0 rounded-full bg-ink-chip shadow-[0_6px_16px_-6px_rgb(19_32_44/0.45)]" /> : null}
                <tab.Icon aria-hidden className="relative size-4 max-sm:hidden" strokeWidth={1.8} />
                <span className="relative sm:hidden">{tab.short}</span>
                <span className="relative max-sm:hidden">{tab.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </ScrollRow>
  )
}
