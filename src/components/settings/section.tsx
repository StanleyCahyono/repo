/**
 * Numbered editorial section for Settings and Sources & Sync — the same language as Forecast, Passes and the resort
 * page (fine top rule, mono index, sentence-case h2, one line of context). Server-renderable.
 */
import type { FormHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'

export function SettingsSection({
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
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  const headingId = `${id}-title`
  return (
    <section id={id} aria-labelledby={headingId} data-settings-section className={cn('min-w-0 scroll-mt-32 md:scroll-mt-8', className)}>
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
            {meta ? <div className="mt-1 max-w-[72ch] text-[13.5px] text-ink-2 md:pl-[30px]">{meta}</div> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </header>
      {children}
    </section>
  )
}

/**
 * One setting: label + explanation on the left, control on the right (stacked on phones). Rows sit inside a panel
 * separated by fine rules.
 */
export function SettingRow({
  label,
  htmlFor,
  labelId,
  hint,
  children,
  className,
  align = 'start',
}: {
  label: ReactNode
  /** Associates the visible label with a single control. */
  htmlFor?: string
  /** For grouped controls: the id their group uses in aria-labelledby. */
  labelId?: string
  hint?: ReactNode
  children: ReactNode
  className?: string
  align?: 'start' | 'center'
}) {
  const Label = htmlFor ? 'label' : 'p'
  return (
    <div
      className={cn(
        'grid gap-x-8 gap-y-2.5 px-4 py-4 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:px-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]',
        align === 'center' && 'md:items-center',
        className,
      )}
    >
      <div className="min-w-0">
        <Label htmlFor={htmlFor} id={labelId} className="block text-[14.5px] font-semibold text-ink">
          {label}
        </Label>
        {hint ? <div className="mt-0.5 text-[13px] leading-snug text-ink-2">{hint}</div> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Panel that holds setting rows (divided by fine rules). Rendered as a <form> for forms with a save bar. */
export function SettingsPanel({
  children,
  className,
  as: Tag = 'div',
  ...rest
}: { children: ReactNode; className?: string; as?: 'div' | 'form' } & Omit<FormHTMLAttributes<HTMLFormElement>, 'children' | 'className'>) {
  return (
    <Tag className={cn('divide-y divide-divider overflow-hidden rounded-[12px] border border-divider bg-surface', className)} {...(rest as HTMLAttributes<HTMLElement>)}>
      {children}
    </Tag>
  )
}

/** Field-level validation message under a control (announced; linked with aria-describedby by the caller). */
export function FieldError({ id, error }: { id: string; error?: string | null }) {
  if (!error) return null
  return (
    <p id={id} role="alert" className="mt-1.5 text-[12.5px] font-medium text-critical">
      {error}
    </p>
  )
}

/** Small inline code (env keys, commands). */
export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cn('rounded-[5px] bg-surface-3 px-1.5 py-px font-mono text-[12.5px] break-words text-ink', className)}>{children}</code>
}
