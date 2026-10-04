'use client'
/**
 * Trip header: status, dates and countdown, the name, who/where, and the trip actions — edit (name, dates with the
 * option to move every dated item, party size), status changes, export to calendar, duplicate (never copies a
 * booking) and delete with Undo.
 */
import { useId, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { DropdownMenu } from 'radix-ui'
import { ArrowLeft, Ban, CalendarPlus, Check, CircleCheck, Copy, Ellipsis, Flag, PencilLine, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DemoBadge } from '@/components/ui/badge'
import { Sheet } from '@/components/ui/sheet'
import { Checkbox, Field, TextInput } from '@/components/ui/form'
import { DatePicker } from '@/components/ui/date-picker'
import { Notice } from '@/components/ui/states'
import { addDays, daysBetween } from '@/lib/domain/time'
import type { TripRow } from '@/lib/db/rows'
import { deleteTrip, duplicateTrip, restoreTrip, updateTrip } from '@/lib/actions/trips'
import { useToast } from '@/components/ui/toast'
import { TripStatusBadge } from './bits'
import { TRIP_STATUS_LABEL, countdown, icsUrl, plural, tripDateLabel } from './format'
import { RangeCalendar } from './range-calendar'
import type { SeasonTrack } from '@/lib/data/trip-seasons'
import { useTripUi } from './trip-ui'

export function TripHeader({
  trip,
  resorts,
  lead,
  tracks = [],
}: {
  trip: Pick<TripRow, 'id' | 'name' | 'status' | 'startDate' | 'endDate' | 'partySize' | 'notes'>
  resorts: { id: string; name: string }[]
  lead: string
  /** Season windows of the trip's resorts, for the edit sheet's calendar. */
  tracks?: SeasonTrack[]
}) {
  const { data, run, pending } = useTripUi()
  const router = useRouter()
  const toast = useToast()
  const [editOpen, setEditOpen] = useState(false)
  const [dupOpen, setDupOpen] = useState(false)

  const setStatus = (status: TripRow['status']) => run(() => updateTrip({ tripId: trip.id, status }), { success: status === 'cancelled' ? 'Trip cancelled — its items are kept' : `Marked ${TRIP_STATUS_LABEL[status].toLowerCase()}` })

  const remove = () =>
    run(() => deleteTrip({ tripId: trip.id }), {
      success: false,
      onDone: (d) => {
        router.push('/trips')
        toast.show(`${d.name} deleted`, {
          undo: async () => {
            const r = await restoreTrip({ snapshot: d.snapshot })
            if (r.ok) router.push(`/trips/${r.data.tripId}`)
            else toast.show(r.error, { tone: 'error' })
          },
          durationMs: 8000,
        })
      },
    })

  return (
    <header className="mb-6 md:mb-8">
      <Link href="/trips" className="hud -ml-1 inline-flex h-10 items-center gap-1.5 rounded-full px-1 text-ink-2 hover:text-teal">
        <ArrowLeft aria-hidden className="size-4" /> All trips
      </Link>
      <div className="mt-2 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="hud tracking-[0.16em] text-teal">Trip planner</span>
            <TripStatusBadge status={trip.status} />
            <span className="hud text-ink-2 tnum">{tripDateLabel(trip.startDate, trip.endDate)}</span>
            {trip.status !== 'cancelled' ? <span className="hud text-ink-2 tnum">{countdown(trip, data.today)}</span> : null}
            {data.demo ? <DemoBadge /> : null}
          </div>
          <h1 className="m-0 text-[clamp(38px,5vw,72px)] leading-[1] font-light tracking-[-0.04em] text-balance text-ink">{trip.name}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {resorts.length ? (
              resorts.map((r) => (
                <Link key={r.id} href={`/resorts/${r.id}`} className="inline-flex min-h-10 items-center rounded-full bg-ink-chip px-4 text-[13.5px] font-medium text-on-ink-chip transition-transform duration-150 hover:-translate-y-px">
                  {r.name}
                </Link>
              ))
            ) : (
              <span className="glass-strong inline-flex min-h-10 items-center rounded-full px-4 text-[13.5px] text-ink-2">No resort yet</span>
            )}
            {lead ? <span className="text-[14.5px] text-ink-2">{lead}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" className="h-11" onClick={() => setEditOpen(true)}>
            <PencilLine aria-hidden className="size-4" /> Edit trip
          </Button>
          <a href={icsUrl(trip.id)} download className="glass-strong inline-flex h-11 items-center gap-2 rounded-full px-4 text-[14.5px] font-medium text-ink transition-colors duration-150 hover:text-teal">
            <CalendarPlus aria-hidden className="size-4" /> Export .ics
          </a>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger aria-label="More trip actions" disabled={pending} className="glass-strong inline-flex size-11 items-center justify-center rounded-full text-ink transition-colors duration-150 hover:text-teal">
              <Ellipsis aria-hidden className="size-5" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={6} className="glass-strong z-50 min-w-[220px] rounded-[16px] p-1 text-[14px] shadow-overlay">
                <DropdownMenu.Label className="hud px-2.5 pt-1.5 pb-1 text-ink-3">Trip status</DropdownMenu.Label>
                {(
                  [
                    ['draft', 'Draft — still planning', PencilLine],
                    ['booked', 'Booked', CircleCheck],
                    ['done', 'Done', Flag],
                  ] as const
                ).map(([st, text, Icon]) => (
                  <MenuItem key={st} onSelect={() => st !== trip.status && setStatus(st)}>
                    <Icon aria-hidden className="size-4 text-ink-2" />
                    <span className="flex-1">{text}</span>
                    {trip.status === st ? <Check aria-hidden className="size-4 text-teal" /> : null}
                  </MenuItem>
                ))}
                {trip.status === 'cancelled' ? (
                  <MenuItem onSelect={() => setStatus('draft')}>
                    <RotateCcw aria-hidden className="size-4 text-ink-2" /> Reopen as draft
                  </MenuItem>
                ) : (
                  <MenuItem onSelect={() => setStatus('cancelled')}>
                    <Ban aria-hidden className="size-4 text-ink-2" /> Cancel trip
                  </MenuItem>
                )}
                <DropdownMenu.Separator className="my-1 h-px bg-divider" />
                <MenuItem onSelect={() => setDupOpen(true)}>
                  <Copy aria-hidden className="size-4 text-ink-2" /> Duplicate…
                </MenuItem>
                <MenuItem onSelect={remove} danger>
                  <Trash2 aria-hidden className="size-4" /> Delete trip
                </MenuItem>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
      {trip.status === 'cancelled' ? (
        <Notice tone="info" title="This trip is cancelled" className="mt-4">
          Its plan is kept for reference and it no longer counts toward planned spending. Reopen it from the ⋯ menu.
        </Notice>
      ) : null}
      <EditTripSheet open={editOpen} onOpenChange={setEditOpen} trip={trip} tracks={tracks} />
      <DuplicateSheet open={dupOpen} onOpenChange={setDupOpen} trip={trip} />
    </header>
  )
}

function MenuItem({ children, onSelect, danger }: { children: React.ReactNode; onSelect: () => void; danger?: boolean }) {
  return (
    <DropdownMenu.Item onSelect={onSelect} className={`flex h-10 cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 outline-none data-[highlighted]:bg-ink/[0.06] ${danger ? 'text-critical' : 'text-ink'}`}>
      {children}
    </DropdownMenu.Item>
  )
}

function EditTripSheet({ open, onOpenChange, trip, tracks }: { open: boolean; onOpenChange: (o: boolean) => void; trip: Pick<TripRow, 'id' | 'name' | 'startDate' | 'endDate' | 'partySize'>; tracks: SeasonTrack[] }) {
  const { data, run, pending } = useTripUi()
  const uid = useId()
  const [name, setName] = useState(trip.name)
  const [start, setStart] = useState<string | null>(trip.startDate)
  const [end, setEnd] = useState<string | null>(trip.endDate)
  const [shift, setShift] = useState(true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const moved = start !== trip.startDate || end !== trip.endDate
  const delta = start && trip.startDate ? daysBetween(trip.startDate, start) : 0
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setName(trip.name)
          setStart(trip.startDate)
          setEnd(trip.endDate)
          setErrors({})
        }
        onOpenChange(o)
      }}
      title="Edit trip"
      description="Name and dates. Party size and companions are under People & notes."
      widthClass="md:w-[520px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="h-11 md:h-10" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="h-11 md:h-10"
            disabled={pending || !name.trim() || !start || !end}
            onClick={() =>
              run(() => updateTrip({ tripId: trip.id, name: name.trim(), ...(moved && start && end ? { startDate: start, endDate: end, shiftItems: shift && delta !== 0 } : {}) }), {
                success: (d) => (d.shifted ? `Saved · moved ${plural(d.shifted, 'item')} by ${plural(Math.abs(delta), 'day')}` : 'Trip saved'),
                onDone: () => onOpenChange(false),
                onError: (r) => setErrors(r.fieldErrors ?? {}),
              })
            }
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" htmlFor={`${uid}-n`} error={errors.name}>
          <TextInput id={`${uid}-n`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="glass rounded-[24px] p-4">
          <RangeCalendar
            start={start}
            end={end}
            onChange={(a, b) => {
              setStart(a)
              setEnd(b)
            }}
            today={data.today}
            min={trip.startDate < data.today ? trip.startDate : data.today}
            maxDays={30}
            tracks={tracks}
            initialMonth={trip.startDate.slice(0, 7)}
            label="Dates"
          />
          {errors.startDate || errors.endDate ? <p className="mt-2 text-[12.5px] font-medium text-critical">{errors.startDate ?? errors.endDate}</p> : null}
        </div>
        {moved && delta !== 0 ? (
          <Checkbox label={`Move every dated item by ${plural(Math.abs(delta), 'day')} ${delta > 0 ? 'later' : 'earlier'}`} hint="Ski days, bookings and events keep their place in the plan." checked={shift} onChange={(e) => setShift(e.target.checked)} />
        ) : null}
        {moved && !shift ? <p className="text-[12.5px] text-caution">Items dated outside the new dates will be listed separately until you move them.</p> : null}
      </div>
    </Sheet>
  )
}

function DuplicateSheet({ open, onOpenChange, trip }: { open: boolean; onOpenChange: (o: boolean) => void; trip: Pick<TripRow, 'id' | 'name' | 'startDate' | 'endDate'> }) {
  const { data, run, pending } = useTripUi()
  const today = data.today
  const router = useRouter()
  const uid = useId()
  const [name, setName] = useState(`${trip.name} (copy)`)
  const [start, setStart] = useState(trip.startDate)
  const len = daysBetween(trip.startDate, trip.endDate)
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      side="center"
      title="Duplicate trip"
      description="A new draft with the same plan. Bookings are not copied: booked items become drafts and actual or quoted prices become estimates."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="h-11 md:h-10" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="h-11 md:h-10"
            disabled={pending || !name.trim() || !start}
            onClick={() =>
              run(() => duplicateTrip({ tripId: trip.id, name: name.trim(), startDate: start }), {
                onDone: (d) => {
                  onOpenChange(false)
                  router.push(`/trips/${d.tripId}`)
                },
              })
            }
          >
            <Copy aria-hidden className="size-4" /> Duplicate
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" htmlFor={`${uid}-n`}>
          <TextInput id={`${uid}-n`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Starts" htmlFor={`${uid}-s`} hint={start ? `Ends ${tripDateLabel(addDays(start, len), addDays(start, len))} · every dated item moves with it` : 'Pick the new first day'}>
          <DatePicker
            id={`${uid}-s`}
            value={start}
            onChange={setStart}
            today={today}
            openTo={trip.startDate}
            presets={[{ label: 'Same dates', date: trip.startDate }, { label: 'A week later', date: addDays(trip.startDate, 7) }, { label: 'Next year, same weekday', date: addDays(trip.startDate, 364) }]}
            marks={[{ date: trip.startDate, to: trip.endDate, label: 'Original trip', tone: 'ink', variant: 'rule', soft: true }]}
          />
        </Field>
      </div>
    </Sheet>
  )
}
