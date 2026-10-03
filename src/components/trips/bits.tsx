/**
 * Small presentational pieces for the Trips screens (server-safe: no hooks). Every state carries text and an icon,
 * never colour alone.
 */
import type { ReactNode } from 'react'
import {
  Ban,
  Calculator,
  CircleCheck,
  FileText,
  Flag,
  Lightbulb,
  Lock,
  PencilLine,
  Receipt,
  BedDouble,
  Backpack,
  BusFront,
  CalendarHeart,
  Car,
  GraduationCap,
  MountainSnow,
  Plane,
  SquareParking,
  StickyNote,
  Ticket,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import type { TripItemRow, TripRow } from '@/lib/db/rows'
import type { TripItemType } from '@/lib/db/schema'
import { COST_KIND_LABEL, ITEM_STATUS_LABEL, TRIP_STATUS_LABEL } from './format'

export const ITEM_ICON: Record<TripItemType, LucideIcon> = {
  'resort-day': MountainSnow,
  drive: Car,
  flight: Plane,
  transfer: BusFront,
  lodging: BedDouble,
  lesson: GraduationCap,
  rental: Backpack,
  'lift-ticket': Ticket,
  parking: SquareParking,
  food: UtensilsCrossed,
  event: CalendarHeart,
  other: StickyNote,
}

export function ItemIcon({ type, className }: { type: TripItemType; className?: string }) {
  const Icon = ITEM_ICON[type] ?? StickyNote
  return <Icon aria-hidden className={cn('size-4 shrink-0', className)} strokeWidth={1.8} />
}

const tripStatus: Record<TripRow['status'], { cls: string; Icon: LucideIcon }> = {
  draft: { cls: 'border-divider-strong bg-surface-2 text-ink-2', Icon: PencilLine },
  booked: { cls: 'border-transparent bg-positive-bg text-positive', Icon: CircleCheck },
  done: { cls: 'border-transparent bg-glacier text-teal', Icon: Flag },
  cancelled: { cls: 'border-transparent bg-critical-bg text-critical', Icon: Ban },
}

export function TripStatusBadge({ status, className }: { status: TripRow['status']; className?: string }) {
  const { cls, Icon } = tripStatus[status]
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[12px] font-semibold tracking-normal normal-case whitespace-nowrap', cls, className)}>
      <Icon aria-hidden className="size-3.5" strokeWidth={2} />
      {TRIP_STATUS_LABEL[status]}
    </span>
  )
}

const itemStatus: Record<TripItemRow['status'], { cls: string; Icon: LucideIcon }> = {
  idea: { cls: 'border-dashed border-divider-strong bg-surface text-ink-2', Icon: Lightbulb },
  draft: { cls: 'border-divider bg-surface-2 text-ink-2', Icon: PencilLine },
  booked: { cls: 'border-transparent bg-positive-bg text-positive', Icon: CircleCheck },
}

export function ItemStatusChip({ status, className }: { status: TripItemRow['status']; className?: string }) {
  const { cls, Icon } = itemStatus[status]
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-sm border px-1.5 text-[12px] font-medium whitespace-nowrap', cls, className)}>
      <Icon aria-hidden className="size-3.5" strokeWidth={2} />
      {ITEM_STATUS_LABEL[status]}
    </span>
  )
}

const costKind: Record<NonNullable<TripItemRow['costKind']>, { cls: string; Icon: LucideIcon; title: string }> = {
  estimate: { cls: 'text-copper', Icon: Calculator, title: 'Your own estimate — not a quote or a live price' },
  quote: { cls: 'text-info', Icon: FileText, title: 'A quote you recorded — check its expiry before relying on it' },
  actual: { cls: 'text-positive', Icon: Receipt, title: 'What you actually paid' },
}

/** Estimate / Quote / Actual — what kind of number a price is. */
export function CostKindTag({ kind, className, short }: { kind: TripItemRow['costKind']; className?: string; short?: boolean }) {
  if (!kind) return null
  const k = costKind[kind]
  return (
    <span title={k.title} className={cn('inline-flex items-center gap-1 text-[12px] font-medium whitespace-nowrap', k.cls, className)}>
      <k.Icon aria-hidden className="size-3.5" strokeWidth={2} />
      {short && kind === 'estimate' ? 'Estimate' : COST_KIND_LABEL[kind]}
    </span>
  )
}

/** User-entered prices and bookings are private and identified as yours. */
export function PrivateTag({ className, label = 'Your entry · private' }: { className?: string; label?: string }) {
  return (
    <span title="Entered by you. Kept in your personal records; never treated as a sourced or live price." className={cn('inline-flex items-center gap-1 text-[12px] text-ink-3 whitespace-nowrap', className)}>
      <Lock aria-hidden className="size-3" strokeWidth={2} />
      {label}
    </span>
  )
}

/** Numbered glass section: mono HUD index, a big light title, optional meta, lead and actions. */
export function TripSection({
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
    <section id={id} aria-labelledby={headingId} data-section={id} className={cn('glass scroll-mt-[136px] rounded-[28px] px-4 py-5 sm:px-6 sm:py-6 md:scroll-mt-[84px] lg:px-7', className)}>
      <header className="mb-5">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <p aria-hidden className="hud flex items-center gap-2.5 text-teal tnum">
              {String(index).padStart(2, '0')}
              <span className="h-px w-10 bg-teal/40" />
            </p>
            <h2 id={headingId} tabIndex={-1} className="mt-1 text-[28px] leading-[1.05] font-light tracking-[-0.03em] text-ink outline-none md:text-[34px]">
              {title}
            </h2>
            {meta ? <p className="mt-1.5 text-[13.5px] text-ink-2">{meta}</p> : null}
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
      <h3 id={id} className="text-[17px] leading-snug font-semibold tracking-[-0.01em] text-ink">
        {children}
      </h3>
      {aside ? <div className="text-[12.5px] text-ink-3">{aside}</div> : null}
    </div>
  )
}

/** Dashed empty slot with a short explanation and an action. */
export function EmptySlot({ title, body, action, className }: { title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-[20px] border border-dashed border-divider-strong bg-surface/40 px-4 py-4 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="min-w-0">
        <p className="text-[14.5px] font-semibold text-ink">{title}</p>
        {body ? <div className="mt-0.5 text-[13.5px] text-ink-2">{body}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </div>
  )
}

/** External link with an explicit "opens in a new tab" label for screen readers. */
export function ExtLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn('font-medium text-teal underline-offset-2 hover:underline', className)}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
