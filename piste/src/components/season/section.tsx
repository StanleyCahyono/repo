/**
 * Numbered section frame for My Season (server-safe), matching the Trips detail rhythm: a strong rule, a mono index,
 * a 21–22px heading that the section bar can focus, a short meta line and actions on the right.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'

export function SeasonSection({
  id,
  index,
  title,
  meta,
  lead,
  actions,
  children,
  className,
}: {
  id: string
  index: number
  title: string
  meta?: ReactNode
  lead?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  const headingId = `${id}-title`
  return (
    <section id={id} aria-labelledby={headingId} className={cn('scroll-mt-[120px] md:scroll-mt-[76px]', className)}>
      <header className="mb-5 border-t border-divider-strong pt-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-baseline gap-3">
            <span aria-hidden className="font-mono text-[12px] tracking-wider text-ink-3 tnum">
              {String(index).padStart(2, '0')}
            </span>
            <div className="min-w-0">
              <h2 id={headingId} tabIndex={-1} className="text-[21px] leading-tight font-semibold text-ink outline-none md:text-[22px]">
                {title}
              </h2>
              {meta ? <p className="mt-1 text-[13.5px] text-ink-2">{meta}</p> : null}
            </div>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {lead ? <p className="mt-2 max-w-[70ch] text-[14.5px] text-ink-2">{lead}</p> : null}
      </header>
      {children}
    </section>
  )
}

export function SubHead({ children, id, aside, className }: { children: ReactNode; id?: string; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1', className)}>
      <h3 id={id} className="text-[16px] leading-snug font-semibold text-ink">
        {children}
      </h3>
      {aside ? <div className="text-[12.5px] text-ink-3">{aside}</div> : null}
    </div>
  )
}

/** Dashed empty slot with a short explanation and an action. */
export function EmptySlot({ title, body, action, className }: { title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-[12px] border border-dashed border-divider-strong bg-surface-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="min-w-0">
        <p className="text-[14.5px] font-semibold text-ink">{title}</p>
        {body ? <div className="mt-0.5 text-[13.5px] text-ink-2">{body}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </div>
  )
}
