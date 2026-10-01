'use client'
/**
 * One trip component as a row: type icon, title (opens the editor), booking status (menu), what kind of price it
 * is, per-person vs shared, dates, quote expiry, and optional move up/down controls for reordering within a day.
 */
import type { ReactNode } from 'react'
import { DropdownMenu } from 'radix-ui'
import { ArrowDown, ArrowUp, Check, ChevronDown, Clock3, GripVertical, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import type { TripItemRow } from '@/lib/db/rows'
import { setTripItemStatus } from '@/lib/actions/trips'
import { ITEM_STATUS_LABEL, itemCost, itemFacts, quoteState, rangeText, spanLabel, dayLabel, dayLabelYear } from './format'
import { CostKindTag, ItemIcon, ItemStatusChip, PrivateTag } from './bits'
import { useTripUi } from './trip-ui'

export interface ReorderControls {
  index: number
  count: number
  onMove: (dir: -1 | 1) => void
  /** Pointer drag handle (Motion Reorder); hidden from assistive tech — the buttons are the accessible path. */
  onPointerDownHandle?: (e: React.PointerEvent) => void
}

export function ItemRow({ item, reorder, showDates = true, hideFacts = false, extra, className }: { item: TripItemRow; reorder?: ReorderControls; showDates?: boolean; hideFacts?: boolean; extra?: ReactNode; className?: string }) {
  const { data, openEditor } = useTripUi()
  const cost = itemCost(item)
  const facts = itemFacts(item)
  const q = quoteState(item, data.today)
  const span = spanLabel(item.date, item.endDate)
  const multi = !!item.endDate && !!item.date && item.endDate !== item.date
  const party = data.partySize
  const conv = data.conversions[String(item.id)] ?? null
  return (
    <div className={cn('group/row relative flex gap-3 rounded-[10px] px-2 py-2.5 transition-colors duration-150 hover:bg-surface-2 md:px-3', className)}>
      {reorder?.onPointerDownHandle && reorder.count > 1 ? (
        <span
          aria-hidden
          onPointerDown={reorder.onPointerDownHandle}
          className="absolute top-1/2 -left-4 hidden h-8 w-4 -translate-y-1/2 cursor-grab touch-none items-center justify-center text-ink-3 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 active:cursor-grabbing md:flex"
        >
          <GripVertical className="size-4" />
        </span>
      ) : null}
      <span aria-hidden className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[8px] border', item.status === 'booked' ? 'border-positive/30 bg-positive-bg text-positive' : 'border-divider bg-surface text-ink-2')}>
        <ItemIcon type={item.type} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <button
            type="button"
            onClick={() => openEditor({ mode: 'edit', item })}
            className="min-w-0 text-left text-[14.5px] leading-snug font-medium text-ink underline-offset-2 hover:text-teal hover:underline"
          >
            {item.title}
          </button>
          {cost ? (
            <span className="shrink-0 text-right text-[14.5px] font-semibold text-ink tnum">
              {rangeText(cost.range)}
              <span className="ml-1 text-[12px] font-normal text-ink-3">{cost.basis === 'per-person' ? (party > 1 ? `pp × ${party}` : 'pp') : party > 1 ? `shared ÷ ${party}` : 'shared'}</span>
            </span>
          ) : item.type !== 'resort-day' ? (
            <span className="shrink-0 text-[13px] text-ink-3 italic">No price yet</span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-ink-2">
          <StatusMenu item={item} />
          {cost ? <CostKindTag kind={cost.kind} short /> : null}
          {cost ? <PrivateTag className="max-sm:hidden" label="Private" /> : null}
          {showDates && span && (multi || !item.date) ? <span className="tnum">{span}</span> : null}
          {!showDates && multi && span ? <span className="tnum">{span}</span> : null}
          {q?.state === 'expired' ? (
            <span className="inline-flex items-center gap-1 font-medium text-critical">
              <TriangleAlert aria-hidden className="size-3.5" /> Quote expired {dayLabel(q.date)}
            </span>
          ) : q?.state === 'soon' ? (
            <span className="inline-flex items-center gap-1 font-medium text-caution">
              <Clock3 aria-hidden className="size-3.5" /> Quote expires {q.days === 0 ? 'today' : q.days === 1 ? 'tomorrow' : `in ${q.days} days`}
            </span>
          ) : q ? (
            <span className="inline-flex items-center gap-1 text-ink-3">
              <Clock3 aria-hidden className="size-3.5" /> Quote valid to {dayLabel(q.date)}
            </span>
          ) : null}
        </div>
        {conv ? (
          conv.converted ? (
            <p className="mt-1 text-[12.5px] text-ink-2 tnum">
              ≈ {rangeText(conv.display)} {conv.to} · 1 {conv.from} = {Number(conv.rate).toFixed(4)} {conv.to}
              {conv.rateDate ? `, ${dayLabelYear(conv.rateDate.slice(0, 10))}` : ''} ({conv.source}
              {conv.provider ? `, ${conv.provider}` : ''})
            </p>
          ) : (
            <p className="mt-1 text-[12.5px] font-medium text-caution">
              Kept in {conv.from} — no {conv.from}→{conv.to} rate yet, so it is left out of the totals
            </p>
          )
        ) : null}
        {facts.length && !hideFacts ? <p className="mt-1 text-[12.5px] text-ink-3">{facts.join(' · ')}</p> : null}
        {extra}
      </div>
      {reorder && reorder.count > 1 ? (
        <div className="flex shrink-0 flex-col items-center justify-center gap-0.5 self-center">
          <button
            type="button"
            aria-label={`Move ${item.title} up`}
            title="Move up"
            disabled={reorder.index === 0}
            onClick={() => reorder.onMove(-1)}
            className="inline-flex size-9 items-center justify-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-surface-3 hover:text-ink disabled:opacity-30 md:size-7"
          >
            <ArrowUp aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            aria-label={`Move ${item.title} down`}
            title="Move down"
            disabled={reorder.index === reorder.count - 1}
            onClick={() => reorder.onMove(1)}
            className="inline-flex size-9 items-center justify-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-surface-3 hover:text-ink disabled:opacity-30 md:size-7"
          >
            <ArrowDown aria-hidden className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** Booking status chip that opens a small menu (Idea / Draft / Booked). */
export function StatusMenu({ item }: { item: TripItemRow }) {
  const { data, run } = useTripUi()
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Status: ${ITEM_STATUS_LABEL[item.status]}. Change status of ${item.title}`}
        className="group/st inline-flex items-center gap-0.5 rounded-sm outline-offset-2"
      >
        <ItemStatusChip status={item.status} />
        <ChevronDown aria-hidden className="size-3.5 text-ink-3 transition-transform duration-150 group-data-[state=open]/st:rotate-180" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} className="z-50 min-w-[168px] rounded-[10px] border border-divider bg-surface p-1 text-[14px] shadow-overlay">
          <DropdownMenu.Label className="px-2.5 pt-1.5 pb-1 text-[12px] font-semibold text-ink-3">Booking status</DropdownMenu.Label>
          {(['idea', 'draft', 'booked'] as const).map((st) => (
            <DropdownMenu.Item
              key={st}
              onSelect={() => {
                if (st !== item.status) run(() => setTripItemStatus({ tripId: data.tripId, itemId: item.id, status: st }), { success: `${item.title}: ${ITEM_STATUS_LABEL[st].toLowerCase()}` })
              }}
              className="flex h-9 cursor-pointer items-center justify-between gap-3 rounded-[8px] px-2.5 text-ink outline-none data-[highlighted]:bg-surface-3"
            >
              <ItemStatusChip status={st} />
              {st === item.status ? <Check aria-hidden className="size-4 text-teal" /> : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
