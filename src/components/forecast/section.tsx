/**
 * Numbered section for the Forecast page in the Glass HUD language: mono index, big light sentence-case h2, one line
 * of context. Server-renderable.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'

export function ForecastSection({
  id,
  index,
  title,
  meta,
  actions,
  children,
  className,
}: {
  id: string
  index: number
  title: string
  meta?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  const headingId = `${id}-title`
  return (
    <section id={id} aria-labelledby={headingId} className={cn('scroll-mt-20 md:scroll-mt-8', className)}>
      <header className="mb-4 pt-4 md:mb-5 md:pt-6">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <span aria-hidden className="hud text-teal tnum">
              {String(index).padStart(2, '0')} ·
            </span>
            <h2 id={headingId} className="mt-1 text-[30px] leading-[1.05] font-light tracking-[-0.03em] text-ink md:text-[40px]">
              {title}
            </h2>
            {meta ? <div className="mt-1.5 text-[13.5px] text-ink-2">{meta}</div> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </header>
      {children}
    </section>
  )
}

/** Small uppercase label for a group of facts. */
export function Eyebrow({ children, className, as: Tag = 'p' }: { children: ReactNode; className?: string; as?: 'p' | 'h3' | 'h4' | 'span' }) {
  return <Tag className={cn('eyebrow', className)}>{children}</Tag>
}
