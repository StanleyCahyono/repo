/**
 * Layout primitives for the resort page scroll story: numbered sections with a mono eyebrow and one big headline,
 * glass story cards, the detail drawer that holds each section's dense sourced data, sub-headings, fact lists with a
 * source trigger beside each value, and yes/no/unknown feature chips (unknown is never "no").
 */
import type { ReactNode } from 'react'
import { Check, CircleHelp, Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { SourceDrawer, type SourceItem } from '@/components/ui/source-drawer'

export function ResortSection({
  id,
  index,
  title,
  headline,
  meta,
  lead,
  actions,
  children,
  className,
  header = 'default',
}: {
  id: string
  index: number
  /** Short section name, shown as the mono eyebrow ("03 · LIFTS AND RUNS"). */
  title: string
  /** The story line: one big, calm sentence built from real data (defaults to the title). */
  headline?: ReactNode
  meta?: ReactNode
  lead?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** 'none': the section draws its own header (it must render an h2 with id `${id}-title`). */
  header?: 'default' | 'none'
}) {
  const headingId = `${id}-title`
  return (
    <section id={id} aria-labelledby={headingId} data-section={id} className={cn('scroll-mt-[124px] md:scroll-mt-[88px]', className)}>
      <style href="resort-rise" precedence="default">
        {RISE_CSS}
      </style>
      {header === 'none' ? null : (
      <header className="mb-7 flex flex-col gap-3 md:mb-9">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <p className="hud m-0 tracking-[0.16em] text-teal">
            <span className="tnum">{String(index).padStart(2, '0')}</span> · {title}
            {meta ? <span className="text-ink-2"> · {meta}</span> : null}
          </p>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        <h2 id={headingId} className="m-0 max-w-[920px] text-[clamp(32px,4.6vw,64px)] leading-[1.02] font-light tracking-[-0.04em] text-ink">
          {headline ?? title}
        </h2>
        {lead ? <p className="m-0 max-w-[68ch] text-[16px] leading-[1.55] text-ink-2 md:text-[17px]">{lead}</p> : null}
      </header>
      )}
      {children}
    </section>
  )
}

/**
 * Chapter entrance: chapters below the fold are marked by <ChapterReveal> after hydration and rise in (opacity and
 * transform, staggered) as they scroll into view. Server-rendered content is visible until then, so nothing waits on
 * hydration; reduced motion skips it entirely. The hero's art eases in once on load.
 */
const RISE_CSS = `
@keyframes resort-hero-in { from { opacity: 0; transform: translateY(18px) scale(0.985); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: no-preference) {
  .piste-hero-in { animation: resort-hero-in 700ms cubic-bezier(0.22, 0.8, 0.26, 1) 60ms both; }
  [data-reveal] > :not(style) { transition: opacity 520ms cubic-bezier(0.22, 0.8, 0.26, 1), transform 620ms cubic-bezier(0.22, 0.8, 0.26, 1); }
  [data-reveal='wait'] > :not(style) { opacity: 0; transform: translateY(16px); }
  [data-reveal='in'] > :nth-child(3) { transition-delay: 90ms; }
  [data-reveal='in'] > :nth-child(4) { transition-delay: 180ms; }
}
`

/** A glass story card with a mono HUD title (the mockups' 28–32px radius cards). */
export function GlassCard({
  title,
  aside,
  children,
  className,
  as: Tag = 'section',
  strong,
}: {
  title?: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article'
  strong?: boolean
}) {
  return (
    <Tag className={cn(strong ? 'glass-strong' : 'glass', 'flex min-w-0 flex-col gap-3.5 rounded-[28px] p-5 md:p-[22px]', className)}>
      {title || aside ? (
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {title ? <h3 className="hud m-0 tracking-[0.14em] text-ink-2">{title}</h3> : <span />}
          {aside ? <div className="hud min-w-0 text-right text-ink-2">{aside}</div> : null}
        </div>
      ) : null}
      {children}
    </Tag>
  )
}

/**
 * "Story first, data in a drawer": the dense, sourced detail of a section behind one glass disclosure. A native
 * <details>, so it works without JavaScript, find-in-page and links into it still open it.
 */
export function DetailDrawer({ summary, hint, children, id, defaultOpen }: { summary: ReactNode; hint?: ReactNode; children: ReactNode; id?: string; defaultOpen?: boolean }) {
  return (
    <details id={id} open={defaultOpen} className="group/drawer mt-5 scroll-mt-[124px] md:scroll-mt-[88px]">
      <summary className="glass-strong flex min-h-12 w-fit max-w-full cursor-pointer list-none items-center gap-3 rounded-full py-2 pr-3 pl-5 select-none hover:text-teal [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-[14px] font-medium text-ink">{summary}</span>
          {hint ? <span className="block text-[12.5px] leading-snug text-ink-2">{hint}</span> : null}
        </span>
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink-chip text-on-ink-chip transition-transform duration-200 group-open/drawer:rotate-45">
          <Plus className="size-4" strokeWidth={2} />
        </span>
      </summary>
      <div className="glass mt-3 rounded-[28px] p-4 md:p-6">{children}</div>
    </details>
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

/** Inline source trigger (small "i") for one or more facts. Facts with no source behind them list nothing. */
export function Src({ title, items, className }: { title: string; items: SourceItem[]; className?: string }) {
  const shown = items.filter((it) => it.prov && it.prov.verification !== 'unverified')
  if (!shown.length) return null
  return <SourceDrawer title={title} items={shown} className={cn('-my-1 shrink-0 align-middle', className)} />
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

