'use client'
/**
 * "Add to trip" — plan ski days at this resort (or save one of its hotels) on an upcoming trip, or start a new
 * draft trip from dates + this resort. Nothing is booked or priced here. Success shows a checkmark with Undo and a
 * link to the trip.
 */
import { useId, useMemo, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import { CalendarPlus, Check, Route } from 'lucide-react'
import { Sheet } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, TextInput } from '@/components/ui/form'
import { Segmented } from '@/components/ui/segmented'
import { Notice } from '@/components/ui/states'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { addDays, dateRange, daysBetween } from '@/lib/domain/time'
import { addHotelToTrip, addResortDaysToTrip, createTripFromResort, undoNewTrip, undoTripItems, type ActionResult } from '@/lib/actions/resort'
import type { TripOption } from '@/lib/data/resort-page'
import { dayLabel, dayLabelYear, plural } from './format'

export type TripTarget =
  | { kind: 'resort'; resortId: string; resortName: string }
  | { kind: 'hotel'; resortId: string; resortName: string; hotelId: string; hotelName: string }

interface Done {
  tripId: string
  tripName: string
  text: string
  undo: () => Promise<ActionResult>
}

const STATUS_TEXT: Record<TripOption['status'], string> = { draft: 'Draft', booked: 'Booked', done: 'Done', cancelled: 'Cancelled' }

export function TripSheet({
  target,
  trips,
  date,
  today,
  flyIn,
  trigger,
  triggerContent,
  triggerClassName,
  demo,
}: {
  target: TripTarget
  trips: TripOption[]
  /** Planning date from the page (YYYY-MM-DD). */
  date: string
  /** Home-local today. */
  today: string
  flyIn: boolean
  /** A ready-made trigger element (client callers). */
  trigger?: ReactNode
  /** Or: content for a trigger button created here — use this from server components (Radix Slot needs a local element). */
  triggerContent?: ReactNode
  triggerClassName?: string
  demo: boolean
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'existing' | 'new'>(trips.length ? 'existing' : 'new')
  const [done, setDone] = useState<Done | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [pending, start] = useTransition()
  const [undone, setUndone] = useState(false)

  const reset = () => {
    setDone(null)
    setError(null)
    setFieldErrors({})
    setUndone(false)
    setTab(trips.length ? 'existing' : 'new')
  }

  const title = target.kind === 'hotel' ? `Save ${target.hotelName} to a trip` : `Add ${target.resortName} to a trip`
  const description =
    target.kind === 'hotel'
      ? 'Saved as a lodging idea for the trip’s nights — no price is recorded; check rates with the property.'
      : 'Plan ski days on a saved trip, or start a new draft trip. Nothing is booked.'

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) window.setTimeout(reset, 250)
      }}
      trigger={
        triggerContent !== undefined ? (
          <button type="button" className={triggerClassName}>
            {triggerContent}
          </button>
        ) : (
          trigger
        )
      }
      title={title}
      description={description}
    >
      {done ? (
        <SuccessPanel
          done={done}
          undone={undone}
          pending={pending}
          onUndo={() =>
            start(async () => {
              const r = await done.undo()
              if (r.ok) setUndone(true)
              else setError(r.error)
            })
          }
          onClose={() => setOpen(false)}
          error={error}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {demo ? (
            <p className="rounded-md border border-demo/30 bg-demo-bg px-3 py-2 text-[13px] text-ink">Demo mode — this is saved to the demo database only.</p>
          ) : null}
          {trips.length ? (
            <Segmented
              label="Trip"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'existing', label: `Upcoming trips (${trips.length})` },
                { value: 'new', label: 'New trip' },
              ]}
            />
          ) : null}
          {tab === 'existing' && trips.length ? (
            <ExistingTrip
              key="existing"
              target={target}
              trips={trips}
              date={date}
              pending={pending}
              error={error}
              fieldErrors={fieldErrors}
              onSubmit={(tripId, dates) =>
                start(async () => {
                  setError(null)
                  setFieldErrors({})
                  const r = target.kind === 'hotel' ? await addHotelToTrip({ tripId, hotelId: target.hotelId }) : await addResortDaysToTrip({ tripId, resortId: target.resortId, dates })
                  if (!r.ok) {
                    setError(r.error)
                    setFieldErrors(r.fieldErrors ?? {})
                    return
                  }
                  setDone({
                    tripId,
                    tripName: r.data.tripName,
                    text:
                      target.kind === 'hotel'
                        ? `${target.hotelName} saved to ${r.data.tripName}`
                        : `${plural(r.data.itemIds.length, 'ski day')} at ${target.resortName} added to ${r.data.tripName}`,
                    undo: () => undoTripItems({ tripId, itemIds: r.data.itemIds }),
                  })
                })
              }
            />
          ) : (
            <NewTrip
              key="new"
              target={target}
              date={date}
              today={today}
              flyIn={flyIn}
              pending={pending}
              error={error}
              fieldErrors={fieldErrors}
              noTrips={!trips.length}
              onSubmit={(v) =>
                start(async () => {
                  setError(null)
                  setFieldErrors({})
                  const r = await createTripFromResort({ resortId: target.resortId, ...v })
                  if (!r.ok) {
                    setError(r.error)
                    setFieldErrors(r.fieldErrors ?? {})
                    return
                  }
                  let text = `Draft trip “${r.data.tripName}” started with ${v.everyDay ? plural(daysBetween(v.startDate, v.endDate) + 1, 'ski day') : '1 ski day'} at ${target.resortName}`
                  if (target.kind === 'hotel') {
                    const h = await addHotelToTrip({ tripId: r.data.tripId, hotelId: target.hotelId })
                    text = h.ok ? `Draft trip “${r.data.tripName}” started, with ${target.hotelName} saved as a lodging idea` : `${text}. ${h.error}`
                  }
                  setDone({ tripId: r.data.tripId, tripName: r.data.tripName, text, undo: () => undoNewTrip({ tripId: r.data.tripId }) })
                })
              }
            />
          )}
        </div>
      )}
    </Sheet>
  )
}

function SuccessPanel({ done, undone, pending, onUndo, onClose, error }: { done: Done; undone: boolean; pending: boolean; onUndo: () => void; onClose: () => void; error: string | null }) {
  return (
    <div className="flex flex-col items-start gap-4 py-2" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={t.favorite}
          className={cn('mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full', undone ? 'bg-surface-3 text-ink-2' : 'bg-positive text-surface')}
        >
          <Check aria-hidden className="size-4" strokeWidth={3} />
        </motion.span>
        <div>
          <p className="text-[15px] font-semibold text-ink">{undone ? 'Undone — nothing was changed' : 'Saved'}</p>
          <p className="mt-0.5 text-[14px] text-ink-2">{undone ? `The trip is back as it was.` : done.text}</p>
        </div>
      </div>
      {error ? <p className="text-[13px] font-medium text-critical">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {!undone ? (
          <Link href={`/trips/${done.tripId}`} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal px-4 text-[14.5px] font-medium text-on-teal hover:bg-teal-strong">
            <Route aria-hidden className="size-4" /> Open trip
          </Link>
        ) : null}
        {!undone ? (
          <Button onClick={onUndo} disabled={pending}>
            Undo
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  )
}

function ExistingTrip({
  target,
  trips,
  date,
  pending,
  error,
  fieldErrors,
  onSubmit,
}: {
  target: TripTarget
  trips: TripOption[]
  date: string
  pending: boolean
  error: string | null
  fieldErrors: Record<string, string>
  onSubmit: (tripId: string, dates: string[]) => void
}) {
  const group = useId()
  const initial = trips.find((tr) => date >= tr.startDate && date <= tr.endDate) ?? trips[0]
  const [tripId, setTripId] = useState(initial.id)
  const trip = trips.find((tr) => tr.id === tripId) ?? initial
  const days = useMemo(() => dateRange(trip.startDate, trip.endDate).slice(0, 21), [trip.startDate, trip.endDate])
  const [picked, setPicked] = useState<Set<string>>(() => new Set([date >= initial.startDate && date <= initial.endDate ? date : initial.startDate]))

  const choose = (id: string) => {
    setTripId(id)
    const tr = trips.find((x) => x.id === id)!
    setPicked(new Set([date >= tr.startDate && date <= tr.endDate ? date : tr.startDate]))
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(tripId, [...picked].sort())
      }}
    >
      <fieldset>
        <legend id={group} className="mb-2 text-[13.5px] font-medium text-ink">
          Trip
        </legend>
        <ul className="flex flex-col gap-2">
          {trips.map((tr) => {
            const selected = tr.id === tripId
            const already = tr.resortIds.includes(target.resortId)
            return (
              <li key={tr.id}>
                <label
                  className={cn(
                    'flex min-h-12 cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5 transition-colors duration-150',
                    selected ? 'border-teal bg-glacier/50' : 'border-divider hover:border-divider-strong',
                  )}
                >
                  <input type="radio" name={group} value={tr.id} checked={selected} onChange={() => choose(tr.id)} className="mt-1 size-4 accent-[var(--teal)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-medium text-ink">{tr.name}</span>
                    <span className="block text-[12.5px] text-ink-2 tnum">
                      {tr.startDate === tr.endDate ? dayLabelYear(tr.startDate) : `${dayLabel(tr.startDate)} – ${dayLabelYear(tr.endDate)}`} · {STATUS_TEXT[tr.status]}
                      {already ? ` · ${target.resortName} already planned` : ''}
                    </span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </fieldset>
      {target.kind === 'resort' ? (
        <fieldset>
          <legend className="mb-2 text-[13.5px] font-medium text-ink">Ski days at {target.resortName}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {days.map((d) => (
              <Checkbox
                key={d}
                label={<span className="tnum">{dayLabel(d)}</span>}
                checked={picked.has(d)}
                onChange={(e) => {
                  const next = new Set(picked)
                  if (e.currentTarget.checked) next.add(d)
                  else next.delete(d)
                  setPicked(next)
                }}
              />
            ))}
          </div>
          {fieldErrors.dates ? <p className="mt-1 text-[12.5px] font-medium text-critical">{fieldErrors.dates}</p> : null}
        </fieldset>
      ) : (
        <p className="text-[13.5px] text-ink-2 tnum">
          Nights: {dayLabel(trip.startDate)} – {dayLabel(trip.endDate)} (the trip’s dates; edit them on the trip).
        </p>
      )}
      {error ? <Notice tone="error" title={error} /> : null}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={pending || (target.kind === 'resort' && picked.size === 0)}>
          <CalendarPlus aria-hidden className="size-4" />
          {pending ? 'Saving…' : target.kind === 'hotel' ? 'Save to trip' : picked.size > 1 ? `Add ${picked.size} ski days` : 'Add ski day'}
        </Button>
      </div>
    </form>
  )
}

function NewTrip({
  target,
  date,
  today,
  flyIn,
  pending,
  error,
  fieldErrors,
  noTrips,
  onSubmit,
}: {
  target: TripTarget
  date: string
  today: string
  flyIn: boolean
  pending: boolean
  error: string | null
  fieldErrors: Record<string, string>
  noTrips: boolean
  onSubmit: (v: { name: string; startDate: string; endDate: string; partySize: number; everyDay: boolean }) => void
}) {
  const startDefault = date >= today ? date : today
  const [name, setName] = useState(flyIn ? `${target.resortName} trip` : `${target.resortName} day`)
  const [startDate, setStart] = useState(startDefault)
  const [endDate, setEnd] = useState(flyIn ? addDays(startDefault, 3) : startDefault)
  const [party, setParty] = useState(1)
  const [everyDay, setEveryDay] = useState(true)
  const ids = { name: useId(), start: useId(), end: useId(), party: useId() }
  const nDays = daysBetween(startDate, endDate) + 1

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({ name, startDate, endDate, partySize: party, everyDay })
      }}
    >
      {noTrips ? <p className="text-[13.5px] text-ink-2">No upcoming trips yet — start one from {target.resortName}.</p> : null}
      <Field label="Trip name" htmlFor={ids.name} error={fieldErrors.name}>
        <TextInput id={ids.name} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required aria-invalid={!!fieldErrors.name} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First day" htmlFor={ids.start} error={fieldErrors.startDate}>
          <TextInput
            id={ids.start}
            type="date"
            value={startDate}
            onChange={(e) => {
              const v = e.target.value
              setStart(v)
              if (v && endDate < v) setEnd(v)
            }}
            required
            className="tnum"
            aria-invalid={!!fieldErrors.startDate}
          />
        </Field>
        <Field label="Last day" htmlFor={ids.end} error={fieldErrors.endDate}>
          <TextInput id={ids.end} type="date" value={endDate} min={startDate} onChange={(e) => setEnd(e.target.value)} required className="tnum" aria-invalid={!!fieldErrors.endDate} />
        </Field>
      </div>
      <Field label="People" htmlFor={ids.party} hint="Used for per-person vs shared costs on the trip.">
        <TextInput id={ids.party} type="number" inputMode="numeric" min={1} max={20} value={party} onChange={(e) => setParty(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className="w-24 tnum" />
      </Field>
      {target.kind === 'resort' && nDays > 1 ? (
        <Checkbox
          label={`Plan a ski day at ${target.resortName} on each day (${nDays} days)`}
          hint="Otherwise only the first day is planned; travel days can be edited on the trip."
          checked={everyDay}
          onChange={(e) => setEveryDay(e.currentTarget.checked)}
        />
      ) : null}
      {error ? <Notice tone="error" title={error} /> : null}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={pending || !name.trim() || !startDate || !endDate}>
          <Route aria-hidden className="size-4" />
          {pending ? 'Creating…' : 'Start draft trip'}
        </Button>
      </div>
    </form>
  )
}
