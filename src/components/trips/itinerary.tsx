'use client'
/**
 * Day-by-day timeline. Every date of the trip is a day (ski / travel / free) with its pass access, conditions and
 * day basket, where you sleep that night, and its items. Items reorder within a day by dragging the handle (Motion
 * Reorder, short spring) or with the move up / move down buttons (keyboard and screen readers; announced politely).
 */
import { useState } from 'react'
import Link from 'next/link'
import { DropdownMenu } from 'radix-ui'
import { Reorder, useDragControls } from 'motion/react'
import { BedDouble, CalendarX2, CircleDashed, PencilLine, Plus } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import type { TripItemRow } from '@/lib/db/rows'
import type { TripItemType } from '@/lib/db/schema'
import type { TripDayView } from '@/lib/data/trip-plan'
import type { UnitPrefs } from '@/lib/domain/types'
import { formatLocalDate } from '@/lib/domain/time'
import { reorderTripItems } from '@/lib/actions/trips'
import { ITEM_LABEL, dayLabel } from './format'
import { ItemIcon } from './bits'
import { ItemRow, StatusMenu } from './item-row'
import { DayResortFacts } from './day-facts'
import { useTripUi } from './trip-ui'

const KIND_LABEL: Record<TripDayView['kind'], string> = { ski: 'Ski day', travel: 'Travel day', free: 'Free day' }
const QUICK_ADD: TripItemType[] = ['resort-day', 'lift-ticket', 'lesson', 'rental', 'food', 'event', 'flight', 'drive', 'transfer', 'parking', 'lodging', 'other']

export function Itinerary({
  days,
  unscheduled,
  outside,
  units,
  now,
  chosenName,
}: {
  days: TripDayView[]
  unscheduled: TripItemRow[]
  outside: TripItemRow[]
  units: UnitPrefs
  now: string
  chosenName: string | null
}) {
  const [announce, setAnnounce] = useState('')
  return (
    <div>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <ol className="flex flex-col">
        {days.map((d, k) => (
          <DayBlock key={d.date} day={d} last={k === days.length - 1 && !unscheduled.length && !outside.length} units={units} now={now} chosenName={chosenName} onAnnounce={setAnnounce} />
        ))}
        {outside.length ? (
          <ExtraBlock
            title="Outside the trip dates"
            note="These items are dated before or after the trip. Move them, or change the trip dates."
            Icon={CalendarX2}
            items={outside}
            date={undefined}
            last={!unscheduled.length}
            onAnnounce={setAnnounce}
          />
        ) : null}
        {unscheduled.length ? (
          <ExtraBlock title="Not scheduled" note="No date yet — for example an event whose date is not announced." Icon={CircleDashed} items={unscheduled} date={null} last onAnnounce={setAnnounce} />
        ) : null}
      </ol>
    </div>
  )
}

function DateColumn({ date, n }: { date: string; n: number }) {
  return (
    <div aria-hidden className="hidden pt-0.5 text-left sm:block">
      <p className="eyebrow">{formatLocalDate(date, 'ccc')}</p>
      <p className="font-light tracking-[-0.03em] text-[32px] leading-none text-ink tnum md:text-[38px]">{formatLocalDate(date, 'd')}</p>
      <p className="mt-1 text-[12px] text-ink-3">
        {formatLocalDate(date, 'LLL')} · Day {n}
      </p>
    </div>
  )
}

function DayBlock({ day, last, units, now, chosenName, onAnnounce }: { day: TripDayView; last: boolean; units: UnitPrefs; now: string; chosenName: string | null; onAnnounce: (s: string) => void }) {
  const { openEditor } = useTripUi()
  const headingId = `day-${day.date}`
  const resortNames = [...new Map(day.resorts.map((r) => [r.resortId, r])).values()]
  // The ski-day item anchors the day: its status and edit live with the day's facts, not in the reorderable list.
  const anchorIds = new Set(day.resorts.map((r) => r.itemId))
  const anchor = (r: TripDayView['resorts'][number]) => day.items.find((i) => i.id === r.itemId) ?? null
  const single = day.resorts.length === 1 ? anchor(day.resorts[0]) : null
  const items = day.items.filter((i) => !anchorIds.has(i.id))
  return (
    <li aria-labelledby={headingId} className="grid grid-cols-1 sm:grid-cols-[76px_minmax(0,1fr)] sm:gap-x-5">
      <DateColumn date={day.date} n={day.n} />
      <div className={cn('relative min-w-0 border-l pb-9 pl-4 sm:pl-6', last ? 'border-transparent' : 'border-divider')}>
        <span
          aria-hidden
          className={cn(
            'absolute top-2 -left-[6px] size-[11px] rounded-full border-2 border-canvas',
            day.kind === 'ski' ? 'bg-teal' : day.kind === 'travel' ? 'bg-copper' : 'bg-divider-strong',
          )}
        />
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <p aria-hidden className="mb-1 flex items-baseline gap-2 sm:hidden">
              <span className="font-light tracking-[-0.03em] text-[26px] leading-none text-ink tnum">{formatLocalDate(day.date, 'd')}</span>
              <span className="eyebrow">
                {formatLocalDate(day.date, 'ccc · LLL')} · Day {day.n}
              </span>
            </p>
            <h3 id={headingId} className="text-[16px] leading-snug font-semibold text-ink">
              <span className="sr-only">{dayLabel(day.date)}: </span>
              {KIND_LABEL[day.kind]}
              {resortNames.length ? (
                <>
                  <span className="text-ink-3"> · </span>
                  {resortNames.map((r, k) => (
                    <span key={r.resortId}>
                      {k ? <span className="text-ink-3"> + </span> : null}
                      {r.inCatalog ? (
                        <Link href={`/resorts/${r.resortId}`} className="underline-offset-2 hover:text-teal hover:underline">
                          {r.name}
                        </Link>
                      ) : (
                        r.name
                      )}
                    </span>
                  ))}
                </>
              ) : null}
            </h3>
            {day.holidayName ? <p className="mt-0.5 text-[12.5px] font-medium text-copper">{day.holidayName} — holiday pricing and crowds likely</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {single ? (
              <>
                <StatusMenu item={single} />
                <IconEdit label={`Edit ${single.title}`} onClick={() => openEditor({ mode: 'edit', item: single })} />
              </>
            ) : null}
            <AddToDay date={day.date} resortId={day.resorts[0]?.resortId ?? null} />
          </div>
        </div>

        {day.resorts.length ? (
          <div className="mt-3 flex flex-col gap-2.5">
            {day.resorts.map((r) => {
              const a = day.resorts.length > 1 ? anchor(r) : null
              return (
                <DayResortFacts
                  key={r.itemId}
                  r={r}
                  units={units}
                  date={day.date}
                  now={now}
                  chosenName={chosenName}
                  header={
                    a ? (
                      <>
                        <p className="text-[13.5px] font-semibold text-ink">{r.name}</p>
                        <span className="flex items-center gap-2">
                          <StatusMenu item={a} />
                          <IconEdit label={`Edit ${a.title}`} onClick={() => openEditor({ mode: 'edit', item: a })} />
                        </span>
                      </>
                    ) : undefined
                  }
                />
              )
            })}
          </div>
        ) : null}

        {day.staying.length || day.endings.length ? (
          <ul className="mt-2.5 flex flex-col gap-1">
            {day.endings.map((e) => (
              <li key={`e${e.itemId}`} className="flex items-start gap-1.5 text-[12.5px] text-ink-2">
                <ItemIcon type={e.type} className="mt-0.5 size-3.5 text-copper" />
                <span>
                  <span className="font-medium text-ink">{e.label}</span> · {e.title}
                </span>
              </li>
            ))}
            {day.staying.map((st) => (
              <li key={`s${st.itemId}`} className="flex items-start gap-1.5 text-[12.5px] text-ink-2">
                <BedDouble aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
                <span>
                  Night {st.night} of {st.nights} · {st.title}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <DayItems items={items} date={day.date} onAnnounce={onAnnounce} anchorIds={anchorIds} />
      </div>
    </li>
  )
}

function IconEdit({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="inline-flex size-9 items-center justify-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-surface-3 hover:text-teal">
      <PencilLine aria-hidden className="size-4" />
    </button>
  )
}

function ExtraBlock({ title, note, Icon, items, date, last, onAnnounce }: { title: string; note: string; Icon: typeof CircleDashed; items: TripItemRow[]; date: string | null | undefined; last: boolean; onAnnounce: (s: string) => void }) {
  return (
    <li className="grid grid-cols-1 sm:grid-cols-[76px_minmax(0,1fr)] sm:gap-x-5">
      <div aria-hidden className="hidden pt-1 text-ink-3 sm:block">
        <Icon aria-hidden className="size-6" strokeWidth={1.6} />
      </div>
      <div className={cn('relative min-w-0 border-l pb-9 pl-4 sm:pl-6', last ? 'border-transparent' : 'border-divider')}>
        <span aria-hidden className="absolute top-2 -left-[6px] size-[11px] rounded-full border-2 border-dashed border-divider-strong bg-canvas" />
        <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
        <p className="mt-0.5 text-[12.5px] text-ink-3">{note}</p>
        {/* Unscheduled items reorder among themselves; outside-the-dates items keep their dates' order. */}
        {date === null ? <DayItems items={items} date={null} onAnnounce={onAnnounce} /> : <StaticItems items={items} />}
      </div>
    </li>
  )
}

function StaticItems({ items }: { items: TripItemRow[] }) {
  return (
    <ul className="mt-2 flex flex-col">
      {items.map((i) => (
        <li key={i.id}>
          <ItemRow item={i} />
        </li>
      ))}
    </ul>
  )
}

/** Items of one day, reorderable. Local order follows the server's whenever the server's list changes. */
function DayItems({ items, date, onAnnounce, anchorIds }: { items: TripItemRow[]; date: string | null; onAnnounce: (s: string) => void; anchorIds?: Set<number> }) {
  const { data, run } = useTripUi()
  const sig = items.map((i) => i.id).join(',')
  const [state, setState] = useState({ sig, ids: items.map((i) => i.id) })
  let ids = state.ids
  if (state.sig !== sig) {
    ids = items.map((i) => i.id)
    setState({ sig, ids })
  }
  const byId = new Map(items.map((i) => [i.id, i]))
  const visible = ids.filter((id) => byId.has(id))
  if (!visible.length) return null

  const persist = (next: number[]) => {
    if (next.join(',') === sig) return
    // The day's ski-day anchors keep the first slots; the server expects every item of the day.
    const anchors = [...(anchorIds ?? [])]
    run(() => reorderTripItems({ tripId: data.tripId, date, itemIds: [...anchors, ...next] }), { success: false })
  }
  const move = (id: number, dir: -1 | 1) => {
    const k = visible.indexOf(id)
    const j = k + dir
    if (j < 0 || j >= visible.length) return
    const next = [...visible]
    ;[next[k], next[j]] = [next[j], next[k]]
    setState({ sig, ids: next })
    onAnnounce(`Moved ${byId.get(id)!.title} to position ${j + 1} of ${visible.length}`)
    persist(next)
  }

  return (
    <Reorder.Group as="ol" axis="y" values={visible} onReorder={(next: number[]) => setState({ sig, ids: next })} className="mt-2 flex flex-col">
      {visible.map((id, k) => (
        <DayItem key={id} item={byId.get(id)!} index={k} count={visible.length} onMove={(dir) => move(id, dir)} onDrop={() => persist(state.ids)} />
      ))}
    </Reorder.Group>
  )
}

function DayItem({ item, index, count, onMove, onDrop }: { item: TripItemRow; index: number; count: number; onMove: (dir: -1 | 1) => void; onDrop: () => void }) {
  const controls = useDragControls()
  return (
    <Reorder.Item as="li" value={item.id} dragListener={false} dragControls={controls} onDragEnd={onDrop} transition={t.spring} className="relative list-none rounded-[10px] bg-canvas data-[dragging=true]:shadow-lift">
      <ItemRow item={item} showDates={false} reorder={{ index, count, onMove, onPointerDownHandle: (e) => controls.start(e) }} />
    </Reorder.Item>
  )
}

function AddToDay({ date, resortId }: { date: string; resortId: string | null }) {
  const { data, openEditor } = useTripUi()
  if (data.status === 'cancelled') return null
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-divider-strong bg-surface px-2.5 text-[13.5px] font-medium text-ink transition-colors duration-150 hover:border-teal hover:text-teal data-[state=open]:border-teal data-[state=open]:text-teal">
        <Plus aria-hidden className="size-4" />
        Add<span className="sr-only"> to {dayLabel(date)}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 max-h-[min(70dvh,440px)] min-w-[200px] overflow-y-auto glass-strong rounded-[16px] p-1 text-[14px] shadow-overlay">
          <DropdownMenu.Label className="px-2.5 pt-1.5 pb-1 text-[12px] font-semibold text-ink-3">Add to {dayLabel(date)}</DropdownMenu.Label>
          {QUICK_ADD.map((type) => (
            <DropdownMenu.Item
              key={type}
              onSelect={() => openEditor({ mode: 'add', type, defaults: { date, refId: type === 'flight' || type === 'lodging' || type === 'event' || type === 'other' ? undefined : (resortId ?? undefined) } })}
              className="flex h-10 cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 text-ink outline-none data-[highlighted]:bg-ink/[0.06]"
            >
              <ItemIcon type={type} className="text-ink-2" />
              {ITEM_LABEL[type]}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
