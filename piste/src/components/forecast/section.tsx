/**
 * Numbered editorial section for the Forecast page (same language as the resort page: fine top rule, mono index,
 * sentence-case h2, one line of context). Server-renderable.
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
      <header className="mb-4 border-t border-divider-strong pt-5 md:mb-5">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-3">
              <span aria-hidden className="font-mono text-[12px] tracking-wider text-ink-3 tnum">
                {String(index).padStart(2, '0')}
              </span>
              <h2 id={headingId} className="text-[21px] leading-tight font-semibold text-ink md:text-[22px]">
                {title}
              </h2>
            </div>
            {meta ? <div className="mt-1 text-[13.5px] text-ink-2 md:pl-[30px]">{meta}</div> : null}
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
