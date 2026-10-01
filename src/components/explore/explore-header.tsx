/**
 * Shared header for the Explore routes (Resorts, Compare, Events), Glass HUD: a teal mono eyebrow, a big light
 * title, the section tabs as a glass pill beside it, and an optional actions slot (e.g. the scenario controls) on
 * the right. Server-renderable; the tabs are a small client island.
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
      {eyebrow ? <div className="hud flex flex-wrap items-center gap-x-2.5 gap-y-1 tracking-[0.16em] text-teal">{eyebrow}</div> : null}
      <div className="mt-2.5 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3">
          <h1 className="m-0 min-w-0 text-[clamp(36px,4.4vw,64px)] leading-[0.98] font-light tracking-[-0.04em] text-ink">{title}</h1>
          <ExploreTabs />
        </div>
        {actions ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {lead ? <p className="mt-3 max-w-[68ch] text-[15px] leading-relaxed text-ink-2 max-sm:hidden md:text-[16px]">{lead}</p> : null}
    </header>
  )
}
