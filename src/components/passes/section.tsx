/**
 * Editorial section for the Passes & Costs pages (same language as Forecast and the resort page: fine top rule,
 * optional mono index, sentence-case h2, one line of context). Server-renderable.
 */
import type { ReactNode } from 'react'
import { Diamond } from 'lucide-react'
import { cn } from '@/lib/ui/cn'

export function PassesSection({
  id,
  index,
  title,
  meta,
  actions,
  children,
  className,
  rule = true,
}: {
  id: string
  index?: number
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** Draw the strong top rule (off for the first section under the tabs). */
  rule?: boolean
}) {
  const headingId = `${id}-title`
  return (
    <section id={id} aria-labelledby={headingId} className={cn('min-w-0 scroll-mt-20 md:scroll-mt-8', className)}>
      <header className={cn('mb-4 md:mb-5', rule && 'pt-4 md:pt-6')}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-3">
              {index != null ? (
                <span aria-hidden className="hud text-teal tnum">
                  {String(index).padStart(2, '0')}
                </span>
              ) : null}
              <h2 id={headingId} className="text-[26px] leading-[1.1] font-light tracking-[-0.03em] text-ink md:text-[30px]">
                {title}
              </h2>
            </div>
            {meta ? <div className={cn('mt-1.5 max-w-[72ch] text-[14px] leading-[1.5] text-ink-2', index != null && 'md:pl-[34px]')}>{meta}</div> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </header>
      {children}
    </section>
  )
}

/** Sub-heading inside a panel. */
export function SubHead({ id, children, aside, className, as: Tag = 'h3' }: { id?: string; children: ReactNode; aside?: ReactNode; className?: string; as?: 'h3' | 'h4' }) {
  return (
    <div className={cn('mb-3 flex items-baseline justify-between gap-3', className)}>
      <Tag id={id} className="text-[16px] leading-snug font-semibold text-ink">
        {children}
      </Tag>
      {aside ? <div className="max-w-full min-w-0 shrink-0 text-[13px]">{aside}</div> : null}
    </div>
  )
}

/** "Researched — confirm at source" tag (research-grade or unverified facts). */
export function ConfirmTag({ text = 'Researched — confirm at source', className }: { text?: string; className?: string }) {
  return (
    <span className={cn('inline-flex min-h-6 items-center gap-1.5 rounded-full border border-caution/35 bg-caution-bg/60 px-2 text-[12px] leading-tight font-medium text-caution', className)}>
      <Diamond aria-hidden className="size-3 shrink-0" strokeWidth={2.2} />
      {text}
    </span>
  )
}

/** "Manual — you entered" tag for rules typed into the rule editor. */
export function YouEnteredTag({ className }: { className?: string }) {
  return <span className={cn('inline-flex h-5 items-center rounded-sm bg-copper/12 px-1.5 text-[12px] font-semibold text-copper', className)}>Manual — you entered</span>
}

/** "Yours" / "Sam's" ownership tag. */
export function HolderTag({ holder, className }: { holder: string; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 items-center rounded-sm bg-copper/12 px-1.5 text-[12px] font-semibold whitespace-nowrap text-copper', className)}>
      {holder === 'me' ? 'Your pass' : `${holder}’s pass`}
    </span>
  )
}
