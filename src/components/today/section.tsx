/**
 * Section frame for Today's blocks (unread alerts): a HUD eyebrow + sentence-case title, optional actions, then
 * content, on a glass panel (24px radius) like the cards above it.
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
    <section aria-labelledby={id} className={cn(tone === 'surface' && 'glass rounded-[24px]', className)}>
      <header className={cn('flex flex-wrap items-start justify-between gap-x-3 gap-y-2', tone === 'surface' ? 'px-5 pt-5 pb-3 md:px-6' : 'pb-3')}>
        <div className="min-w-0">
          {eyebrow ? <p className="hud mb-1 tracking-[0.14em] text-ink-2">{eyebrow}</p> : null}
          <H id={id} className="text-[17px] leading-snug font-semibold text-ink">
            {title}
          </H>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn(tone === 'surface' && 'px-5 pb-4 md:px-6', bodyClassName)}>{children}</div>
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
