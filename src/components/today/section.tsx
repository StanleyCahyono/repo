/**
 * Section frame for Today's blocks: a quiet eyebrow + sentence-case title, optional actions, then content. Blocks are
 * ruled panels (12 px radius, fine border, no resting shadow) so the page reads as an editorial sheet rather than a
 * grid of identical cards.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'

export function Block({
  id,
  eyebrow,
  title,
  actions,
  children,
  className,
  bodyClassName,
  level = 2,
  tone = 'surface',
}: {
  id: string
  eyebrow?: ReactNode
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  level?: 2 | 3
  tone?: 'surface' | 'plain'
}) {
  const H = level === 2 ? 'h2' : 'h3'
  return (
    <section aria-labelledby={id} className={cn(tone === 'surface' && 'rounded-[12px] border border-divider bg-surface', className)}>
      <header className={cn('flex flex-wrap items-start justify-between gap-x-3 gap-y-2', tone === 'surface' ? 'px-4 pt-4 pb-3 md:px-5' : 'pb-3')}>
        <div className="min-w-0">
          {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
          <H id={id} className="text-[17px] leading-snug font-semibold text-ink">
            {title}
          </H>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn(tone === 'surface' && 'px-4 pb-4 md:px-5', bodyClassName)}>{children}</div>
    </section>
  )
}

/** Small uppercase label inside a block ("Alternatives", "Evidence limits"). */
export function Label({ children, className, as: Tag = 'p', id }: { children: ReactNode; className?: string; as?: 'p' | 'h3' | 'h4'; id?: string }) {
  return (
    <Tag id={id} className={cn('text-[12px] leading-tight font-semibold tracking-[0.06em] text-ink-3 uppercase', className)}>
      {children}
    </Tag>
  )
}
