import type { ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'

/**
 * Page header (Glass HUD): a teal mono eyebrow, a big Geist Light title with tight tracking, one supporting line, and
 * actions that sit on the title's baseline at md+ and wrap below it on phones. Sits straight on the sky (no panel).
 */
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
    <header className={cn('mb-7 flex flex-col gap-4 md:mb-9 md:flex-row md:items-end md:justify-between md:gap-8', className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow-hud mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">{eyebrow}</div> : null}
        <h1 className="title-hud text-[40px] break-words text-ink md:text-[52px] xl:text-[60px]">{title}</h1>
        {lead ? <p className="mt-3 max-w-[62ch] text-[15px] leading-[1.55] text-ink-2 md:text-[16px]">{lead}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2 md:pb-1">{actions}</div> : null}
    </header>
  )
}
