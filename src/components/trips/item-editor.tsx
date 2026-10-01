'use client'
/**
 * Add / edit one trip component. Fields adapt to the type: ski day, flight (manual itinerary, ticketing, ski bag,
 * buffers), drive, transfer, lodging, lesson planner (focus skills from your skills checklist), rental, lift ticket,
 * parking, food, event, other.
 *
 * Prices are always yours: an estimate, a quote (with an expiry) or an actual, as a single amount or a min–max
 * range, per person or shared by the party, in any currency. A foreign-currency price converts with a stored rate,
 * or a rate you lock yourself (shown with its date); without either it stays in its own currency and out of totals.
 */
import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from 'lucide-react'
import { Sheet } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Select, TextInput, Textarea, Checkbox } from '@/components/ui/form'
import { Segmented } from '@/components/ui/segmented'
import { Notice } from '@/components/ui/states'
import { cn } from '@/lib/ui/cn'
import type { TripItemRow } from '@/lib/db/rows'
import type { TripItemType } from '@/lib/db/schema'
import { currencyChoicesFor } from '@/lib/domain/money'
import { addTripItem, removeTripItem, restoreTripItem, updateTripItem, type AddTripItemInput } from '@/lib/actions/trips'
import {
  ITEM_LABEL,
  LESSON_KIND_LABEL,
  SKILL_STATUS_LABEL,
  TRANSFER_LABEL,
  dayLabel,
  detailBool,
  detailNumber,
  detailNumbers,
  detailString,
  majorString,
  tripDays,
} from './format'
import { DEFAULT_AIRPORT_BUFFER_MIN, DEFAULT_ARRIVAL_BUFFER_MIN } from './model'
import type { EditorTarget, TripUiData } from './trip-ui'
import type { Run } from './use-run'

const TYPES: TripItemType[] = ['resort-day', 'flight', 'drive', 'transfer', 'lodging', 'lesson', 'rental', 'lift-ticket', 'parking', 'food', 'event', 'other']
const RESORT_TYPES = new Set<TripItemType>(['resort-day', 'lift-ticket', 'lesson', 'rental', 'parking', 'food', 'drive', 'transfer'])
const RANGE_TYPES = new Set<TripItemType>(['flight', 'drive', 'transfer', 'lodging', 'rental', 'lift-ticket', 'parking', 'food', 'event', 'other'])
const TITLE_HINT: Partial<Record<TripItemType, string>> = {
  flight: 'e.g. Flights SYR ⇄ SLC',
  lodging: 'e.g. Alta Peruvian Lodge — 4 nights',
  lesson: 'e.g. Group lesson, morning',
  rental: 'e.g. Ski package for me, 3 days',
  'lift-ticket': 'e.g. Adult 3-day ticket',
  food: 'e.g. Lunch on the mountain',
  parking: 'e.g. SYR economy parking',
  transfer: 'e.g. Rental car from SLC',
  drive: 'e.g. Drive from Ithaca',
  event: 'e.g. Torchlight parade',
  other: 'e.g. Tire chains',
}
const DATE_LABEL: Partial<Record<TripItemType, [string, string]>> = {
  flight: ['Outbound', 'Return'],
  lodging: ['Check-in', 'Check-out'],
  rental: ['First day', 'Last day'],
  'lift-ticket': ['First day', 'Last day'],
  drive: ['Leave', 'Return'],
}

interface Seg {
  carrier: string
  flightNumber: string
  from: string
  to: string
  departLocal: string
  arriveLocal: string
}

interface Draft {
  type: TripItemType
  title: string
  refId: string
  date: string
  endDate: string
  status: TripItemRow['status']
  priced: boolean
  min: string
  max: string
  isRange: boolean
  currency: string
  kind: 'estimate' | 'quote' | 'actual'
  basis: TripItemRow['costBasis']
  quoteExpiresAt: string
  lockRate: boolean
  fxRate: string
  fxDate: string
  // details
  note: string
  origin: string
  ticketing: '' | 'single' | 'separate'
  segments: Seg[]
  skiBag: string
  fareNotes: string
  airportBufferMin: string
  arrivalBufferMin: string
  transferType: string
  from: string
  to: string
  minutes: string
  km: string
  where: string
  reservationRequired: '' | 'yes' | 'no'
  occupancy: string
  room: string
  fees: string
  lessonKind: string
  instructor: string
  focusSkills: number[]
  bookingRef: string
  bookingUrl: string
  url: string
  shop: string
  package: string
  ticketType: string
  venue: string
  startTime: string
}

const DEFAULT_BASIS: Record<TripItemType, TripItemRow['costBasis']> = {
  'resort-day': 'per-person',
  flight: 'per-person',
  drive: 'shared',
  transfer: 'shared',
  lodging: 'shared',
  lesson: 'per-person',
  rental: 'per-person',
  'lift-ticket': 'per-person',
  parking: 'shared',
  food: 'per-person',
  event: 'per-person',
  other: 'shared',
}

const s = (v: string | null | undefined) => v ?? ''
const n = (v: number | null | undefined) => (typeof v === 'number' ? String(v) : '')

function initialDraft(target: EditorTarget, data: TripUiData): Draft {
  const item = target.mode === 'edit' ? target.item : null
  const type = target.mode === 'edit' ? target.item.type : target.type
  const d = (item?.details ?? (target.mode === 'add' ? target.defaults?.details : null) ?? {}) as Record<string, unknown>
  const defaults = target.mode === 'add' ? (target.defaults ?? {}) : {}
  // Planner fields for lessons recorded before the planner linked them (matched by trip, resort and date).
  const lesson =
    type === 'lesson' && item
      ? (data.lessons.find((l) => l.id === detailNumber(d, 'lessonId')) ?? data.lessons.find((l) => l.resortId === item.refId && l.date === item.date) ?? null)
      : null
  const segs = Array.isArray(d.segments) ? (d.segments as Record<string, unknown>[]) : []
  const firstResort = data.resorts.find((r) => r.onTrip)?.id ?? ''
  return {
    type,
    title: item?.title ?? defaults.title ?? '',
    refId: item?.refId ?? defaults.refId ?? (RESORT_TYPES.has(type) ? firstResort : ''),
    date: item?.date ?? defaults.date ?? (type === 'lodging' || type === 'flight' ? data.startDate : ''),
    endDate: item?.endDate ?? defaults.endDate ?? (type === 'lodging' || type === 'flight' ? (data.endDate > data.startDate ? data.endDate : '') : ''),
    status: item?.status ?? defaults.status ?? 'draft',
    priced: !!item && item.costMinor != null,
    min: item ? majorString(item.costMinor, item.currency) : '',
    max: item ? majorString(item.costMaxMinor, item.currency) : '',
    isRange: !!item && item.costMaxMinor != null,
    currency: item?.currency ?? data.currency,
    kind: item?.costKind ?? 'estimate',
    basis: item?.costBasis ?? defaults.costBasis ?? DEFAULT_BASIS[type],
    quoteExpiresAt: item?.quoteExpiresAt?.slice(0, 10) ?? '',
    lockRate: !!item?.fxRate,
    fxRate: s(item?.fxRate),
    fxDate: s(item?.fxDate),
    note: s(detailString(d, 'note')),
    origin: s(detailString(d, 'origin')) || (type === 'flight' ? (data.originAirport ?? 'ITH') : ''),
    ticketing: (detailString(d, 'ticketing') as Draft['ticketing']) ?? '',
    segments: segs.map((x) => ({
      carrier: s(x.carrier as string),
      flightNumber: s(x.flightNumber as string),
      from: s(x.from as string),
      to: s(x.to as string),
      departLocal: s(x.departLocal as string),
      arriveLocal: s(x.arriveLocal as string),
    })),
    skiBag: s(detailString(d, 'skiBag')),
    fareNotes: s(detailString(d, 'fareNotes')),
    airportBufferMin: n(detailNumber(d, 'airportBufferMin')),
    arrivalBufferMin: n(detailNumber(d, 'arrivalBufferMin')),
    transferType: s(detailString(d, 'transferType')),
    from: s(detailString(d, 'from')),
    to: s(detailString(d, 'to')),
    minutes: n(detailNumber(d, 'minutes')),
    km: n(detailNumber(d, 'km')),
    where: s(detailString(d, 'where')),
    reservationRequired: detailBool(d, 'reservationRequired') === true ? 'yes' : detailBool(d, 'reservationRequired') === false ? 'no' : '',
    occupancy: n(detailNumber(d, 'occupancy')),
    room: s(detailString(d, 'room')),
    fees: s(detailString(d, 'fees')),
    lessonKind: s(detailString(d, 'lessonKind') ?? lesson?.kind),
    instructor: s(detailString(d, 'instructor') ?? lesson?.instructor),
    focusSkills: detailNumbers(d, 'focusSkills').length ? detailNumbers(d, 'focusSkills') : (lesson?.focusSkills ?? []),
    bookingRef: s(detailString(d, 'bookingRef') ?? lesson?.bookingRef),
    bookingUrl: s(detailString(d, 'bookingUrl') ?? lesson?.bookingUrl),
    url: s(detailString(d, 'url')),
    shop: s(detailString(d, 'shop')),
    package: s(detailString(d, 'package')),
    ticketType: s(detailString(d, 'ticketType')),
    venue: s(detailString(d, 'venue')),
    startTime: s(detailString(d, 'startTime')),
  }
}

const orNull = (v: string) => (v.trim() ? v.trim() : null)
const intOrNull = (v: string) => (v.trim() && Number.isFinite(Number(v)) ? Math.round(Number(v)) : null)

function detailsOf(f: Draft): NonNullable<AddTripItemInput['details']> {
  const base = { note: orNull(f.note) }
  switch (f.type) {
    case 'flight':
      return {
        ...base,
        origin: orNull(f.origin),
        ticketing: f.ticketing || null,
        segments: f.segments
          .filter((x) => x.carrier || x.flightNumber || x.from || x.to || x.departLocal || x.arriveLocal)
          .map((x) => ({ carrier: orNull(x.carrier), flightNumber: orNull(x.flightNumber), from: orNull(x.from), to: orNull(x.to), departLocal: orNull(x.departLocal), arriveLocal: orNull(x.arriveLocal) })),
        skiBag: orNull(f.skiBag),
        fareNotes: orNull(f.fareNotes),
        airportBufferMin: intOrNull(f.airportBufferMin),
        arrivalBufferMin: intOrNull(f.arrivalBufferMin),
        bookingRef: orNull(f.bookingRef),
        url: orNull(f.url),
      }
    case 'drive':
      return { ...base, from: orNull(f.from), to: orNull(f.to), minutes: intOrNull(f.minutes), km: f.km.trim() ? Number(f.km) : null }
    case 'transfer':
      return { ...base, transferType: (f.transferType || null) as never, from: orNull(f.from), to: orNull(f.to), minutes: intOrNull(f.minutes), bookingRef: orNull(f.bookingRef), url: orNull(f.url) }
    case 'lodging':
      return { ...base, occupancy: intOrNull(f.occupancy), room: orNull(f.room), fees: orNull(f.fees), bookingRef: orNull(f.bookingRef), url: orNull(f.url) }
    case 'lesson':
      return { ...base, lessonKind: (f.lessonKind || null) as never, instructor: orNull(f.instructor), focusSkills: f.focusSkills, bookingRef: orNull(f.bookingRef), bookingUrl: orNull(f.bookingUrl) }
    case 'rental':
      return { ...base, package: orNull(f.package), shop: orNull(f.shop), bookingRef: orNull(f.bookingRef), url: orNull(f.url) }
    case 'lift-ticket':
      return { ...base, ticketType: orNull(f.ticketType), bookingRef: orNull(f.bookingRef), url: orNull(f.url) }
    case 'parking':
      return { ...base, where: orNull(f.where), reservationRequired: f.reservationRequired === '' ? null : f.reservationRequired === 'yes', url: orNull(f.url) }
    case 'event':
      return { ...base, venue: orNull(f.venue), startTime: orNull(f.startTime), url: orNull(f.url), bookingRef: orNull(f.bookingRef) }
    default:
      return { ...base, url: orNull(f.url), bookingRef: orNull(f.bookingRef) }
  }
}

export function ItemEditor({
  target,
  open,
  onOpenChange,
  data,
  run,
}: {
  target: EditorTarget
  open: boolean
  onOpenChange: (o: boolean) => void
  data: TripUiData
  run: Run
}) {
  const [f, setF] = useState<Draft>(() => initialDraft(target, data))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const errorRef = useRef<HTMLDivElement>(null)
  const uid = useId()
  const id = (k: string) => `${uid}-${k}`
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((p) => ({ ...p, [k]: v }))
  const editing = target.mode === 'edit'
  const item = editing ? target.item : null
  const days = useMemo(() => tripDays(data.startDate, data.endDate), [data.startDate, data.endDate])
  const [d1, d2] = DATE_LABEL[f.type] ?? ['Date', 'Until']
  const foreign = f.priced && f.currency && f.currency !== data.currency
  const stored = foreign ? data.rates.find((r) => r.currency === f.currency) : undefined
  const err = (k: string) => errors[k] ?? errors[`cost.${k}`] ?? errors[`details.${k}`]
  const fromCatalog = (f.type === 'lodging' || f.type === 'event') && !!f.refId

  const submit = () => {
    setErrors({})
    setFormError(null)
    const cost = f.priced
      ? {
          min: f.min.trim(),
          max: f.isRange && f.max.trim() ? f.max.trim() : null,
          currency: f.currency,
          kind: f.kind,
          basis: f.basis,
          quoteExpiresAt: f.kind === 'quote' && f.quoteExpiresAt ? f.quoteExpiresAt : null,
          fxRate: foreign && f.lockRate && f.fxRate.trim() ? f.fxRate.trim() : null,
          fxDate: foreign && f.lockRate && f.fxDate ? f.fxDate : null,
          fxQuote: foreign && f.lockRate && f.fxRate.trim() ? data.currency : null,
        }
      : f.basis !== (item?.costBasis ?? DEFAULT_BASIS[f.type])
        ? { min: null, basis: f.basis }
        : null
    const common = {
      tripId: data.tripId,
      refId: fromCatalog ? undefined : RESORT_TYPES.has(f.type) || f.type === 'flight' ? orNull(f.refId) : undefined,
      title: f.title.trim() || undefined,
      date: f.date || null,
      endDate: f.endDate && f.endDate !== f.date ? f.endDate : null,
      status: f.status,
      details: detailsOf(f),
    }
    setSaving(true)
    const onError = (r: { error: string; fieldErrors?: Record<string, string> }) => {
      setSaving(false)
      setErrors(r.fieldErrors ?? {})
      setFormError(r.error)
      // The message sits at the top of a long form: bring it into view and move focus to it.
      requestAnimationFrame(() => {
        errorRef.current?.scrollIntoView({ block: 'start' })
        errorRef.current?.focus({ preventScroll: true })
      })
    }
    if (editing && item) {
      run(() => updateTripItem({ ...common, itemId: item.id, cost: f.priced ? cost : item.costMinor != null ? { min: null, basis: f.basis } : cost ?? undefined }), {
        success: 'Saved',
        onDone: () => {
          setSaving(false)
          onOpenChange(false)
        },
        onError,
      })
    } else {
      run(() => addTripItem({ ...common, type: f.type, refId: fromCatalog ? f.refId : common.refId, cost: cost ?? undefined }), {
        success: (d) => `${d.title} added`,
        onDone: () => {
          setSaving(false)
          onOpenChange(false)
        },
        onError,
      })
    }
  }

  const remove = () => {
    if (!item) return
    run(() => removeTripItem({ tripId: data.tripId, itemId: item.id }), {
      success: (d) => `Removed ${d.title}`,
      undo: (d) => restoreTripItem({ snapshot: d.snapshot }),
      onDone: () => onOpenChange(false),
    })
  }

  const title = editing ? `Edit ${ITEM_LABEL[f.type].toLowerCase()}` : `Add ${ITEM_LABEL[f.type].toLowerCase()}`
  const resortOptions = (
    <>
      <option value="">{f.type === 'resort-day' || f.type === 'lesson' ? 'Choose a resort' : 'Not tied to a resort'}</option>
      {data.resorts.some((r) => r.onTrip) ? (
        <optgroup label="On this trip">
          {data.resorts
            .filter((r) => r.onTrip)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </optgroup>
      ) : null}
      <optgroup label="Catalog">
        {data.resorts
          .filter((r) => !r.onTrip)
          .map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
      </optgroup>
    </>
  )

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={editing ? item?.title : `Part of ${data.tripName}. Nothing is booked from here — prices are yours.`}
      widthClass="md:w-[540px]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          {editing ? (
            <Button variant="danger" size="md" onClick={remove} className="h-11 md:h-10">
              <Trash2 aria-hidden className="size-4" /> Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-11 md:h-10">
              Cancel
            </Button>
            <Button type="submit" form={id('form')} variant="primary" disabled={saving} className="h-11 min-w-24 md:h-10">
              {saving ? 'Saving…' : editing ? 'Save' : 'Add to trip'}
            </Button>
          </div>
        </div>
      }
    >
      <form
        id={id('form')}
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {formError ? (
          <div ref={errorRef} tabIndex={-1} className="scroll-mt-4 outline-none">
            <Notice tone="error" title={formError}>
              {Object.keys(errors).length ? 'Check the fields marked below.' : null}
            </Notice>
          </div>
        ) : null}

        <Group title="What">
          {!editing && target.mode === 'add' && !target.defaults?.refId ? (
            <Field label="Type" htmlFor={id('type')}>
              <Select
                id={id('type')}
                value={f.type}
                onChange={(e) => {
                  const t = e.target.value as TripItemType
                  setF((p) => ({ ...initialDraft({ mode: 'add', type: t }, data), title: p.title, date: p.date, endDate: p.endDate, status: p.status }))
                }}
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ITEM_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Title" htmlFor={id('title')} error={err('title')} optional={f.type === 'resort-day' || RESORT_TYPES.has(f.type) || fromCatalog} hint={fromCatalog ? 'Filled from the catalog when left empty' : undefined}>
            <TextInput id={id('title')} value={f.title} maxLength={200} placeholder={TITLE_HINT[f.type] ?? ''} onChange={(e) => set('title', e.target.value)} aria-invalid={!!err('title')} />
          </Field>
          {RESORT_TYPES.has(f.type) ? (
            <Field label="Resort" htmlFor={id('ref')} error={errors.refId} optional={f.type !== 'resort-day' && f.type !== 'lesson'}>
              <Select id={id('ref')} value={f.refId} onChange={(e) => set('refId', e.target.value)} aria-invalid={!!errors.refId}>
                {resortOptions}
              </Select>
            </Field>
          ) : null}
          <div>
            <Segmented
              label="Booking status"
              hideLabel={false}
              value={f.status}
              onChange={(v) => set('status', v)}
              options={[
                { value: 'idea', label: 'Idea', hint: 'Considering it' },
                { value: 'draft', label: 'Draft', hint: 'Planned, not booked' },
                { value: 'booked', label: 'Booked', hint: 'Confirmed by you' },
              ]}
            />
          </div>
        </Group>

        <Group title="When">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={d1} htmlFor={id('date')} error={err('date')} optional={f.type !== 'resort-day'}>
              <DateInput id={id('date')} value={f.date} onChange={(v) => set('date', v)} days={days} invalid={!!err('date')} />
            </Field>
            {f.type !== 'resort-day' && f.type !== 'lesson' ? (
              <Field label={d2} htmlFor={id('end')} error={err('endDate')} optional>
                <DateInput id={id('end')} value={f.endDate} onChange={(v) => set('endDate', v)} days={days} min={f.date} invalid={!!err('endDate')} />
              </Field>
            ) : null}
          </div>
          {f.date && (f.date < data.startDate || f.date > data.endDate) ? (
            <p className="text-[12.5px] font-medium text-caution">Outside the trip dates ({dayLabel(data.startDate)} – {dayLabel(data.endDate)}) — it will be listed separately.</p>
          ) : null}
          {f.type === 'event' && !f.date ? <p className="text-[12.5px] text-ink-3">No date: kept unscheduled until the organiser announces one.</p> : null}
        </Group>

        {f.type === 'flight' ? <FlightFields f={f} set={set} id={id} err={err} data={data} /> : null}
        {f.type === 'lesson' ? <LessonFields f={f} set={set} id={id} err={err} data={data} /> : null}
        <TypeFields f={f} set={set} id={id} err={err} />

        <Group title="Cost" aside={<span className="inline-flex items-center gap-1"><Lock aria-hidden className="size-3" /> Private — your own numbers</span>}>
          <Checkbox
            label={f.type === 'resort-day' ? 'This day has its own price' : 'Add a price'}
            hint={f.priced ? undefined : f.type === 'resort-day' ? 'Usually priced by a lift-ticket item or covered by a pass.' : 'Without a price the item stays in the budget as missing — never as $0.'}
            checked={f.priced}
            onChange={(e) => set('priced', e.target.checked)}
          />
          {f.priced ? (
            <div className="flex flex-col gap-4">
              <Segmented
                label="What kind of number"
                hideLabel={false}
                value={f.kind}
                onChange={(v) => set('kind', v)}
                options={[
                  { value: 'estimate', label: 'Estimate', hint: 'Your own guess or range' },
                  { value: 'quote', label: 'Quote', hint: 'A price you were quoted — it can expire' },
                  { value: 'actual', label: 'Actual', hint: 'What you paid' },
                ]}
              />
              <div className={cn('grid gap-3', f.isRange ? 'grid-cols-[1fr_1fr_104px]' : 'grid-cols-[1fr_104px]')}>
                <Field label={f.isRange ? 'Low end' : 'Amount'} htmlFor={id('min')} error={err('min')}>
                  <TextInput id={id('min')} inputMode="decimal" className="tnum" value={f.min} placeholder="0.00" onChange={(e) => set('min', e.target.value.replace(/[^\d.]/g, ''))} aria-invalid={!!err('min')} />
                </Field>
                {f.isRange ? (
                  <Field label="High end" htmlFor={id('max')} error={err('max')}>
                    <TextInput id={id('max')} inputMode="decimal" className="tnum" value={f.max} placeholder="0.00" onChange={(e) => set('max', e.target.value.replace(/[^\d.]/g, ''))} aria-invalid={!!err('max')} />
                  </Field>
                ) : null}
                <Field label="Currency" htmlFor={id('cur')} error={err('currency')}>
                  <Select id={id('cur')} value={f.currency} onChange={(e) => set('currency', e.target.value)}>
                    {currencyChoicesFor(data.currency, ...data.rates.map((r) => r.currency), f.currency).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {RANGE_TYPES.has(f.type) || f.isRange ? <Checkbox label="It’s a range (min – max)" checked={f.isRange} onChange={(e) => set('isRange', e.target.checked)} /> : null}
              <Segmented
                label="Who pays"
                hideLabel={false}
                value={f.basis}
                onChange={(v) => set('basis', v)}
                options={[
                  { value: 'per-person', label: `Per person × ${data.partySize}`, hint: 'Each person pays this amount' },
                  { value: 'shared', label: `Shared ÷ ${data.partySize}`, hint: 'One amount split across the party' },
                ]}
              />
              {f.kind === 'quote' ? (
                <Field label="Quote valid until" htmlFor={id('qe')} optional hint="Piste warns you as it approaches and after it passes." error={err('quoteExpiresAt')}>
                  <TextInput id={id('qe')} type="date" value={f.quoteExpiresAt} onChange={(e) => set('quoteExpiresAt', e.target.value)} />
                </Field>
              ) : null}
              {foreign ? (
                <div className="rounded-[10px] border border-divider bg-surface-2 p-3">
                  <p className="text-[13.5px] font-medium text-ink">Conversion to {data.currency}</p>
                  {stored ? (
                    <p className="mt-0.5 text-[13px] text-ink-2">
                      Stored rate: 1 {stored.currency} = <span className="tnum">{stored.rate}</span> {data.currency} ({stored.rateDate}, {stored.provider}).
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[13px] text-ink-2">No {f.currency}→{data.currency} rate is stored. Without a rate this price stays in {f.currency} and out of the trip totals.</p>
                  )}
                  <Checkbox className="mt-2" label="Use a rate I choose" checked={f.lockRate} onChange={(e) => set('lockRate', e.target.checked)} />
                  {f.lockRate ? (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <Field label={`1 ${f.currency} = ? ${data.currency}`} htmlFor={id('fx')} error={err('fxRate')}>
                        <TextInput id={id('fx')} inputMode="decimal" className="tnum" value={f.fxRate} placeholder="0.7300" onChange={(e) => set('fxRate', e.target.value.replace(/[^\d.]/g, ''))} />
                      </Field>
                      <Field label="Rate date" htmlFor={id('fxd')} optional>
                        <TextInput id={id('fxd')} type="date" value={f.fxDate} onChange={(e) => set('fxDate', e.target.value)} />
                      </Field>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <Segmented
              label="When priced, who pays"
              hideLabel={false}
              size="sm"
              value={f.basis}
              onChange={(v) => set('basis', v)}
              options={[
                { value: 'per-person', label: 'Per person' },
                { value: 'shared', label: 'Shared' },
              ]}
            />
          )}
        </Group>

        <Group title="Notes">
          <Field label="Notes" htmlFor={id('note')} optional>
            <Textarea id={id('note')} value={f.note} maxLength={2000} rows={3} onChange={(e) => set('note', e.target.value)} />
          </Field>
        </Group>
      </form>
    </Sheet>
  )
}

function Group({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-2 flex w-full items-baseline justify-between gap-3">
        <span className="eyebrow">{title}</span>
        {aside ? <span className="text-[12px] text-ink-3">{aside}</span> : null}
      </legend>
      {children}
    </fieldset>
  )
}

function DateInput({ id, value, onChange, days, min, invalid }: { id: string; value: string; onChange: (v: string) => void; days: string[]; min?: string; invalid?: boolean }) {
  const listId = `${id}-days`
  return (
    <>
      <TextInput id={id} type="date" value={value} min={min || undefined} list={listId} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} />
      <datalist id={listId}>
        {days.map((d) => (
          <option key={d} value={d} label={dayLabel(d)} />
        ))}
      </datalist>
    </>
  )
}

type FieldsProps = { f: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void; id: (k: string) => string; err: (k: string) => string | undefined }

function FlightFields({ f, set, id, err, data }: FieldsProps & { data: TripUiData }) {
  const airports = data.airports
  const seg = (k: number, key: keyof Seg, v: string) => set('segments', f.segments.map((x, j) => (j === k ? { ...x, [key]: key === 'from' || key === 'to' || key === 'carrier' ? v.toUpperCase() : v } : x)))
  const move = (k: number, dir: -1 | 1) => {
    const next = [...f.segments]
    const [x] = next.splice(k, 1)
    next.splice(k + dir, 0, x)
    set('segments', next)
  }
  return (
    <Group title="Flight">
      <div className="grid grid-cols-2 gap-3">
        <Field label="From (airport)" htmlFor={id('orig')} error={err('origin')} hint="ITH, SYR, ELM, ROC, BUF…">
          <TextInput id={id('orig')} value={f.origin} maxLength={3} className="uppercase tnum" list={`${id('ap')}`} onChange={(e) => set('origin', e.target.value.toUpperCase())} />
        </Field>
        <Field label="To (airport)" htmlFor={id('dest')} error={err('refId')}>
          <TextInput id={id('dest')} value={f.refId} maxLength={3} className="uppercase tnum" list={`${id('ap')}`} onChange={(e) => set('refId', e.target.value.toUpperCase())} />
        </Field>
        <datalist id={id('ap')}>
          {airports.map((a) => (
            <option key={a.iata} value={a.iata} label={a.name} />
          ))}
        </datalist>
      </div>
      <Segmented
        label="Ticketing"
        hideLabel={false}
        value={f.ticketing || 'unset'}
        onChange={(v) => set('ticketing', v === 'unset' ? '' : (v as Draft['ticketing']))}
        options={[
          { value: 'unset', label: 'Not set' },
          { value: 'single', label: 'One ticket', hint: 'All segments on one booking — a missed connection is the airline’s problem' },
          { value: 'separate', label: 'Separate bookings', hint: 'Independently booked legs — a delay can strand you; leave extra time' },
        ]}
      />
      {f.ticketing === 'separate' ? <p className="text-[12.5px] font-medium text-caution">Separate bookings: a late first flight does not protect the next one — plan a longer connection.</p> : null}

      <div className="flex flex-col gap-2">
        <p className="text-[13.5px] font-medium text-ink">Itinerary (your entry)</p>
        <p className="-mt-1 text-[12.5px] text-ink-3">Airport-local times, as printed on the booking. Piste never looks up or invents flight numbers or schedules.</p>
        {f.segments.map((x, k) => (
          <div key={k} className="rounded-[10px] border border-divider bg-surface-2 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[12.5px] font-semibold text-ink-2">Segment {k + 1}</p>
              <div className="flex gap-1">
                <IconBtn label={`Move segment ${k + 1} up`} disabled={k === 0} onClick={() => move(k, -1)}>
                  <ArrowUp aria-hidden className="size-4" />
                </IconBtn>
                <IconBtn label={`Move segment ${k + 1} down`} disabled={k === f.segments.length - 1} onClick={() => move(k, 1)}>
                  <ArrowDown aria-hidden className="size-4" />
                </IconBtn>
                <IconBtn label={`Remove segment ${k + 1}`} onClick={() => set('segments', f.segments.filter((_, j) => j !== k))}>
                  <Trash2 aria-hidden className="size-4" />
                </IconBtn>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[80px_96px_1fr_1fr]">
              <Field label={<>Airline<span className="sr-only"> (segment {k + 1})</span></>} htmlFor={id(`c${k}`)} error={err(`segments.${k}.carrier`)}>
                <TextInput id={id(`c${k}`)} value={x.carrier} maxLength={40} className="uppercase" onChange={(e) => seg(k, 'carrier', e.target.value)} />
              </Field>
              <Field label={<>Flight no.<span className="sr-only"> (segment {k + 1})</span></>} htmlFor={id(`n${k}`)} error={err(`segments.${k}.flightNumber`)}>
                <TextInput id={id(`n${k}`)} value={x.flightNumber} maxLength={12} className="tnum" onChange={(e) => seg(k, 'flightNumber', e.target.value)} />
              </Field>
              <Field label={<>From<span className="sr-only"> airport (segment {k + 1})</span></>} htmlFor={id(`f${k}`)} error={err(`segments.${k}.from`)}>
                <TextInput id={id(`f${k}`)} value={x.from} maxLength={3} className="uppercase" list={id('ap')} onChange={(e) => seg(k, 'from', e.target.value)} aria-invalid={!!err(`segments.${k}.from`)} />
              </Field>
              <Field label={<>To<span className="sr-only"> airport (segment {k + 1})</span></>} htmlFor={id(`t${k}`)} error={err(`segments.${k}.to`)}>
                <TextInput id={id(`t${k}`)} value={x.to} maxLength={3} className="uppercase" list={id('ap')} onChange={(e) => seg(k, 'to', e.target.value)} aria-invalid={!!err(`segments.${k}.to`)} />
              </Field>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Field label={<>Departs (local)<span className="sr-only"> segment {k + 1}</span></>} htmlFor={id(`d${k}`)} error={err(`segments.${k}.departLocal`)}>
                <TextInput id={id(`d${k}`)} type="datetime-local" value={x.departLocal} onChange={(e) => seg(k, 'departLocal', e.target.value)} />
              </Field>
              <Field label={<>Arrives (local)<span className="sr-only"> segment {k + 1}</span></>} htmlFor={id(`a${k}`)} error={err(`segments.${k}.arriveLocal`)}>
                <TextInput id={id(`a${k}`)} type="datetime-local" value={x.arriveLocal} onChange={(e) => seg(k, 'arriveLocal', e.target.value)} />
              </Field>
            </div>
          </div>
        ))}
        <Button
          variant="secondary"
          className="h-11 self-start md:h-10"
          onClick={() => {
            const prev = f.segments[f.segments.length - 1]
            set('segments', [...f.segments, { carrier: prev?.carrier ?? '', flightNumber: '', from: prev?.to ?? f.origin, to: f.segments.length ? f.refId : '', departLocal: '', arriveLocal: '' }])
          }}
        >
          <Plus aria-hidden className="size-4" /> {f.segments.length ? 'Add a connection' : 'Add a segment'}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Airport buffer (min)" htmlFor={id('ab')} optional hint={`Arrive before departure. Default ${DEFAULT_AIRPORT_BUFFER_MIN}.`}>
          <TextInput id={id('ab')} inputMode="numeric" className="tnum" value={f.airportBufferMin} placeholder={String(DEFAULT_AIRPORT_BUFFER_MIN)} onChange={(e) => set('airportBufferMin', e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="Arrival buffer (min)" htmlFor={id('rb')} optional hint={`Bags and car pick-up. Default ${DEFAULT_ARRIVAL_BUFFER_MIN}.`}>
          <TextInput id={id('rb')} inputMode="numeric" className="tnum" value={f.arrivalBufferMin} placeholder={String(DEFAULT_ARRIVAL_BUFFER_MIN)} onChange={(e) => set('arrivalBufferMin', e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
      <Field label="Ski bag" htmlFor={id('bag')} optional hint="Fees and rules as the airline states them — Piste has no baggage data.">
        <TextInput id={id('bag')} value={f.skiBag} maxLength={300} placeholder="e.g. Ski bag counts as checked bag, $40 each way" onChange={(e) => set('skiBag', e.target.value)} />
      </Field>
      <Field label="Fare rules" htmlFor={id('fare')} optional>
        <TextInput id={id('fare')} value={f.fareNotes} maxLength={500} placeholder="e.g. Basic economy — no changes" onChange={(e) => set('fareNotes', e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Booking reference" htmlFor={id('bref')} optional>
          <TextInput id={id('bref')} value={f.bookingRef} maxLength={80} onChange={(e) => set('bookingRef', e.target.value)} />
        </Field>
        <Field label="Booking link" htmlFor={id('burl')} optional error={err('url')}>
          <TextInput id={id('burl')} type="url" value={f.url} placeholder="https://" onChange={(e) => set('url', e.target.value)} />
        </Field>
      </div>
    </Group>
  )
}

function LessonFields({ f, set, id, err, data }: FieldsProps & { data: TripUiData }) {
  const cats = [...new Set(data.skills.map((k) => k.category ?? 'Other'))]
  const toggle = (k: number) => set('focusSkills', f.focusSkills.includes(k) ? f.focusSkills.filter((x) => x !== k) : [...f.focusSkills, k])
  return (
    <Group title="Lesson planner">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind" htmlFor={id('lk')} optional>
          <Select id={id('lk')} value={f.lessonKind} onChange={(e) => set('lessonKind', e.target.value)}>
            <option value="">Not decided</option>
            {Object.entries(LESSON_KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Instructor" htmlFor={id('ins')} optional>
          <TextInput id={id('ins')} value={f.instructor} maxLength={120} onChange={(e) => set('instructor', e.target.value)} />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13.5px] font-medium text-ink">Focus skills</legend>
        <p className="-mt-1 text-[12.5px] text-ink-3">From your skills checklist (My Season). Progress stays self-reported or instructor-confirmed.</p>
        {cats.map((c) => (
          <div key={c}>
            <p className="mb-1 text-[12px] font-semibold tracking-wide text-ink-3 uppercase">{c}</p>
            <div className="flex flex-wrap gap-1.5">
              {data.skills
                .filter((k) => (k.category ?? 'Other') === c)
                .map((k) => {
                  const on = f.focusSkills.includes(k.id)
                  return (
                    <button
                      key={k.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(k.id)}
                      title={SKILL_STATUS_LABEL[k.status] ?? k.status}
                      className={cn(
                        'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-left text-[13px] transition-colors duration-150',
                        on ? 'border-teal bg-glacier text-teal' : 'border-divider-strong bg-surface text-ink-2 hover:border-teal hover:text-ink',
                      )}
                    >
                      {k.label}
                      {k.status !== 'not-started' ? <span className="text-[11.5px] text-ink-3">· {SKILL_STATUS_LABEL[k.status]}</span> : null}
                    </button>
                  )
                })}
            </div>
          </div>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Booking reference" htmlFor={id('lref')} optional>
          <TextInput id={id('lref')} value={f.bookingRef} maxLength={80} onChange={(e) => set('bookingRef', e.target.value)} />
        </Field>
        <Field label="Booking link" htmlFor={id('lurl')} optional error={err('bookingUrl')}>
          <TextInput id={id('lurl')} type="url" value={f.bookingUrl} placeholder="https://" onChange={(e) => set('bookingUrl', e.target.value)} />
        </Field>
      </div>
    </Group>
  )
}

function TypeFields({ f, set, id, err }: FieldsProps) {
  switch (f.type) {
    case 'drive':
      return (
        <Group title="Drive">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From" htmlFor={id('df')} optional>
              <TextInput id={id('df')} value={f.from} maxLength={120} onChange={(e) => set('from', e.target.value)} />
            </Field>
            <Field label="To" htmlFor={id('dt')} optional>
              <TextInput id={id('dt')} value={f.to} maxLength={120} onChange={(e) => set('to', e.target.value)} />
            </Field>
            <Field label="Minutes one way" htmlFor={id('dm')} optional hint="Your number — not live routing.">
              <TextInput id={id('dm')} inputMode="numeric" className="tnum" value={f.minutes} onChange={(e) => set('minutes', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="Distance (km)" htmlFor={id('dk')} optional>
              <TextInput id={id('dk')} inputMode="decimal" className="tnum" value={f.km} onChange={(e) => set('km', e.target.value.replace(/[^\d.]/g, ''))} />
            </Field>
          </div>
        </Group>
      )
    case 'transfer':
      return (
        <Group title="Transfer">
          <Field label="How" htmlFor={id('tt')} optional>
            <Select id={id('tt')} value={f.transferType} onChange={(e) => set('transferType', e.target.value)}>
              <option value="">Not decided</option>
              {Object.entries(TRANSFER_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From" htmlFor={id('tf')} optional>
              <TextInput id={id('tf')} value={f.from} maxLength={120} placeholder="e.g. SLC" onChange={(e) => set('from', e.target.value)} />
            </Field>
            <Field label="To" htmlFor={id('to')} optional>
              <TextInput id={id('to')} value={f.to} maxLength={120} onChange={(e) => set('to', e.target.value)} />
            </Field>
            <Field label="Minutes" htmlFor={id('tm')} optional>
              <TextInput id={id('tm')} inputMode="numeric" className="tnum" value={f.minutes} onChange={(e) => set('minutes', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="Booking reference" htmlFor={id('tr')} optional>
              <TextInput id={id('tr')} value={f.bookingRef} maxLength={80} onChange={(e) => set('bookingRef', e.target.value)} />
            </Field>
          </div>
          <Field label="Link" htmlFor={id('tu')} optional error={err('url')}>
            <TextInput id={id('tu')} type="url" value={f.url} placeholder="https://" onChange={(e) => set('url', e.target.value)} />
          </Field>
        </Group>
      )
    case 'lodging':
      return (
        <Group title="Stay">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Guests in the room(s)" htmlFor={id('oc')} optional>
              <TextInput id={id('oc')} inputMode="numeric" className="tnum" value={f.occupancy} onChange={(e) => set('occupancy', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="Room" htmlFor={id('rm')} optional>
              <TextInput id={id('rm')} value={f.room} maxLength={200} placeholder="e.g. Queen room, shared bath" onChange={(e) => set('room', e.target.value)} />
            </Field>
          </div>
          <Field label="Fees and taxes" htmlFor={id('fe')} optional hint="Say whether your price includes them.">
            <TextInput id={id('fe')} value={f.fees} maxLength={300} placeholder="e.g. Includes resort fee; excludes 12% tax" onChange={(e) => set('fees', e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Booking reference" htmlFor={id('lr')} optional>
              <TextInput id={id('lr')} value={f.bookingRef} maxLength={80} onChange={(e) => set('bookingRef', e.target.value)} />
            </Field>
            <Field label="Link" htmlFor={id('lu')} optional error={err('url')}>
              <TextInput id={id('lu')} type="url" value={f.url} placeholder="https://" onChange={(e) => set('url', e.target.value)} />
            </Field>
          </div>
        </Group>
      )
    case 'rental':
      return (
        <Group title="Rental">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="What" htmlFor={id('pk')} optional>
              <TextInput id={id('pk')} value={f.package} maxLength={120} placeholder="e.g. Skis, boots, poles" onChange={(e) => set('package', e.target.value)} />
            </Field>
            <Field label="Shop" htmlFor={id('sh')} optional>
              <TextInput id={id('sh')} value={f.shop} maxLength={120} onChange={(e) => set('shop', e.target.value)} />
            </Field>
            <Field label="Booking reference" htmlFor={id('rr')} optional>
              <TextInput id={id('rr')} value={f.bookingRef} maxLength={80} onChange={(e) => set('bookingRef', e.target.value)} />
            </Field>
            <Field label="Link" htmlFor={id('ru')} optional error={err('url')}>
              <TextInput id={id('ru')} type="url" value={f.url} placeholder="https://" onChange={(e) => set('url', e.target.value)} />
            </Field>
          </div>
        </Group>
      )
    case 'lift-ticket':
      return (
        <Group title="Ticket">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ticket type" htmlFor={id('tk')} optional>
              <TextInput id={id('tk')} value={f.ticketType} maxLength={80} placeholder="e.g. Adult, bought online" onChange={(e) => set('ticketType', e.target.value)} />
            </Field>
            <Field label="Booking reference" htmlFor={id('kr')} optional>
              <TextInput id={id('kr')} value={f.bookingRef} maxLength={80} onChange={(e) => set('bookingRef', e.target.value)} />
            </Field>
          </div>
          <Field label="Link" htmlFor={id('ku')} optional error={err('url')}>
            <TextInput id={id('ku')} type="url" value={f.url} placeholder="https://" onChange={(e) => set('url', e.target.value)} />
          </Field>
        </Group>
      )
    case 'parking':
      return (
        <Group title="Parking">
          <Field label="Where" htmlFor={id('wh')} optional>
            <TextInput id={id('wh')} value={f.where} maxLength={160} placeholder="e.g. SYR economy lot / resort main lot" onChange={(e) => set('where', e.target.value)} />
          </Field>
          <Segmented
            label="Reservation required?"
            hideLabel={false}
            value={f.reservationRequired || 'unknown'}
            onChange={(v) => set('reservationRequired', v === 'unknown' ? '' : (v as 'yes' | 'no'))}
            options={[
              { value: 'unknown', label: 'Unknown' },
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
          />
          <Field label="Link" htmlFor={id('pu')} optional error={err('url')}>
            <TextInput id={id('pu')} type="url" value={f.url} placeholder="https://" onChange={(e) => set('url', e.target.value)} />
          </Field>
        </Group>
      )
    case 'event':
      return (
        <Group title="Event">
          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <Field label="Venue" htmlFor={id('ve')} optional>
              <TextInput id={id('ve')} value={f.venue} maxLength={160} onChange={(e) => set('venue', e.target.value)} />
            </Field>
            <Field label="Starts (local)" htmlFor={id('st')} optional error={err('startTime')}>
              <TextInput id={id('st')} type="time" value={f.startTime} onChange={(e) => set('startTime', e.target.value)} />
            </Field>
          </div>
          <Field label="Link" htmlFor={id('eu')} optional error={err('url')}>
            <TextInput id={id('eu')} type="url" value={f.url} placeholder="https://" onChange={(e) => set('url', e.target.value)} />
          </Field>
        </Group>
      )
    case 'food':
    case 'other':
      return (
        <Group title="Link">
          <Field label="Link" htmlFor={id('ou')} optional error={err('url')}>
            <TextInput id={id('ou')} type="url" value={f.url} placeholder="https://" onChange={(e) => set('url', e.target.value)} />
          </Field>
        </Group>
      )
    default:
      return null
  }
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-9 items-center justify-center rounded-md text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink disabled:opacity-35"
    >
      {children}
    </button>
  )
}
