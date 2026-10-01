/**
 * Layout primitives for the resort page: numbered editorial sections, sub-headings, fact lists with a source
 * trigger beside each value, and yes/no/unknown feature chips (unknown is never "no").
 */
import type { ReactNode } from 'react'
import { Check, CircleHelp, Minus } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { SourceDrawer, type SourceItem } from '@/components/ui/source-drawer'

export function ResortSection({
  id,
  index,
  title,
  meta,
  lead,
  actions,
  children,
  className,
  rule = true,
}: {
  id: string
  index: number
  title: string
  meta?: ReactNode
  lead?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** Top rule above the heading (off for the first section, which sits right under the section bar). */
  rule?: boolean
}) {
  const headingId = `${id}-title`
  return (
    <section id={id} aria-labelledby={headingId} data-section={id} className={cn('scroll-mt-[124px] md:scroll-mt-[84px]', className)}>
      <header className={cn('mb-5 md:mb-6', rule && 'border-t border-divider-strong pt-5')}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-baseline gap-3">
            <span aria-hidden className="font-mono text-[12px] tracking-wider text-ink-3 tnum">
              {String(index).padStart(2, '0')}
            </span>
            <h2 id={headingId} className="text-[21px] leading-tight font-semibold text-ink md:text-[22px]">
              {title}
            </h2>
            {meta ? <span className="hidden text-[13.5px] text-ink-2 sm:inline">{meta}</span> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {meta ? <p className="mt-1 text-[13.5px] text-ink-2 sm:hidden">{meta}</p> : null}
        {lead ? <p className="mt-2 max-w-[70ch] text-[14.5px] text-ink-2">{lead}</p> : null}
      </header>
      {children}
    </section>
  )
}

/** Small heading inside a section or panel. */
export function SubHead({ children, id, className, as: Tag = 'h3', aside }: { children: ReactNode; id?: string; className?: string; as?: 'h3' | 'h4'; aside?: ReactNode }) {
  return (
    <div className={cn('mb-3 flex items-baseline justify-between gap-3', className)}>
      <Tag id={id} className="text-[16px] leading-snug font-semibold text-ink">
        {children}
      </Tag>
      {aside ? <div className="shrink-0 text-[12.5px] text-ink-3">{aside}</div> : null}
    </div>
  )
}

/** Inline source trigger (small "i") for one or more facts. */
export function Src({ title, items, className }: { title: string; items: SourceItem[]; className?: string }) {
  if (!items.length) return null
  return <SourceDrawer title={title} items={items} className={cn('-my-1 shrink-0 align-middle', className)} />
}

/** Definition-list row: label left, value right-aligned (or stacked on narrow screens) with its source. */
export function FactRow({ label, children, source, hint, className }: { label: ReactNode; children: ReactNode; source?: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[minmax(88px,auto)_minmax(0,1fr)] items-baseline gap-x-4 gap-y-0.5 border-b border-divider py-2.5 last:border-b-0', className)}>
      <dt className="text-[13.5px] text-ink-2">{label}</dt>
      <dd className="flex min-w-0 items-baseline justify-end gap-1 text-right text-[14.5px] text-ink">
        <span className="min-w-0">{children}</span>
        {source}
      </dd>
      {hint ? <dd className="col-span-2 text-[12.5px] text-ink-3">{hint}</dd> : null}
    </div>
  )
}

/** Yes / No / Unknown chip. `null` means unknown — never shown as "No". */
export function TriChip({ value, yes = 'Yes', no = 'Not offered', unknown = 'Unknown', label }: { value: boolean | null | undefined; yes?: string; no?: string; unknown?: string; label: string }) {
  const v = value ?? null
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[13px] whitespace-nowrap',
        v === true && 'border-positive/35 bg-positive-bg text-positive',
        v === false && 'border-divider-strong bg-surface-2 text-ink-2',
        v === null && 'border-dashed border-divider-strong bg-surface text-ink-3',
      )}
    >
      {v === true ? <Check aria-hidden className="size-3.5" strokeWidth={2.4} /> : v === false ? <Minus aria-hidden className="size-3.5" /> : <CircleHelp aria-hidden className="size-3.5" />}
      <span className="font-medium text-ink">{label}</span>
      <span className={cn(v === null && 'italic')}>{v === true ? yes : v === false ? no : unknown}</span>
    </span>
  )
}

/** "Researched — confirm at source" / "Reference data" inline qualifier. */
export function ConfirmTag({ text = 'Confirm at source', className }: { text?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-sm border border-dashed border-caution/50 px-1.5 text-[11.5px] leading-5 font-medium text-caution', className)}>
      {text}
    </span>
  )
}
