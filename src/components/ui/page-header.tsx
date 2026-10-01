import type { ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'

/** Compact editorial page header: eyebrow, Barlow Condensed title, supporting line, actions. */
export function PageHeader({
  eyebrow,
  title,
  lead,
  actions,
  className,
  children,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  lead?: ReactNode
  actions?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <header className={cn('mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">{eyebrow}</div> : null}
        <h1 className="font-display text-[32px] leading-[1.02] text-ink md:text-[44px]">{title}</h1>
        {lead ? <p className="mt-2 max-w-[62ch] text-[15px] text-ink-2 md:text-[16px]">{lead}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
