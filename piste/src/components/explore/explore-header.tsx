/**
 * Shared header for the Explore routes (Resorts, Compare, Events): eyebrow, Barlow title, one supporting line and
 * the section tabs. Server-renderable; the tabs are a small client island.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'
import { ExploreTabs } from './explore-tabs'

export function ExploreHeader({
  eyebrow,
  title,
  lead,
  actions,
  className,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  lead?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('mb-5 md:mb-6', className)}>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="min-w-0">
          {eyebrow ? <div className="eyebrow mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">{eyebrow}</div> : null}
          <h1 className="font-display text-[32px] leading-[1.02] text-ink md:text-[44px]">{title}</h1>
          {lead ? <p className="mt-2 max-w-[68ch] text-[15px] text-ink-2 max-sm:hidden md:text-[15.5px]">{lead}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 md:justify-end">{actions}</div> : null}
      </div>
      <ExploreTabs className="mt-4 md:mt-5" />
    </header>
  )
}
