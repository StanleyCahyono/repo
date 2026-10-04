'use client'
/**
 * Your ski days for Pass vs tickets: upcoming trip days (on/off as a group) plus days you add here — a resort and one
 * day or a few (the shared range calendar). Added days live in the URL (?days=alta.2027-02-14,…) so a scenario survives
 * reloads and can be shared.
 */
import { useId, useState, type FormEvent } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DateRangePicker, type DateRangeValue } from '@/components/ui/date-picker'
import { Select } from '@/components/ui/form'
import type { ResortOption } from '@/lib/data/passes-screen'
import { cn } from '@/lib/ui/cn'
import { dayMonth, dayNumber, weekdayShort } from './format'
import { usePassesNav } from './nav'
import { saturdayFrom, serializeDays, shiftDate, type ScenarioDayParam } from './params'

/** Longest run of days one "Add" puts in. */
const MAX_ADD_DAYS = 14

function datesIn(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = start; d <= end && out.length < MAX_ADD_DAYS; d = shiftDate(d, 1)) out.push(d)
  return out
}

/** "Sat 16 Jan" for one day, "16–17 Jan" / "30 Jan – 1 Feb" for a few (no year: the season is known). */
function rangeText(start: string, end: string): string {
  if (start === end) return `${weekdayShort(start)} ${dayMonth(start)}`
  return start.slice(5, 7) === end.slice(5, 7) ? `${dayNumber(start)}–${dayMonth(end)}` : `${dayMonth(start)} – ${dayMonth(end)}`
}

/** "3–4 Oct" / "31 Oct–1 Nov". */
function weekend(sat: string): string {
  const sun = shiftDate(sat, 1)
  return sat.slice(5, 7) === sun.slice(5, 7) ? `${dayNumber(sat)}–${dayMonth(sun)}` : `${dayMonth(sat)}–${dayMonth(sun)}`
}

const CHIP =
  'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.97] disabled:opacity-50 max-md:h-11'
const CHIP_OFF = 'border-divider-strong/70 bg-glass-strong text-ink-2 hover:-translate-y-px hover:border-teal hover:text-teal'
const CHIP_ON = 'border-transparent bg-ink-chip text-on-ink-chip'

export function AddDayForm({
  added,
  resorts,
  today,
  seasonEnd,
  includeTrips,
  tripDayCount,
}: {
  added: ScenarioDayParam[]
  resorts: ResortOption[]
  today: string
  seasonEnd: string
  includeTrips: boolean
  tripDayCount: number
}) {
  const id = useId()
  const { navigate, pending } = usePassesNav()
  const sat = saturdayFrom(today)
  const [resortId, setResortId] = useState('')
  const [range, setRange] = useState<DateRangeValue>({ start: sat, end: shiftDate(sat, 1) <= seasonEnd ? shiftDate(sat, 1) : sat })
  const [error, setError] = useState<{ field: 'resort' | 'dates'; text: string } | null>(null)
  const favorites = resorts.filter((r) => r.isFavorite)
  const sorted = [...resorts].sort((a, b) => a.name.localeCompare(b.name))

  const add = (days: ScenarioDayParam[]) => {
    const next = [...added]
    for (const d of days) if (!next.some((x) => x.resortId === d.resortId && x.date === d.date)) next.push(d)
    navigate({ days: serializeDays(next) || null })
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!resortId) return setError({ field: 'resort', text: 'Choose a resort' })
    if (!range.start) return setError({ field: 'dates', text: 'Pick a day or a few days' })
    setError(null)
    add(datesIn(range.start, range.end || range.start).map((date) => ({ resortId, date })))
  }

  const weekendDays = [sat, shiftDate(sat, 1)].filter((d) => d <= seasonEnd)
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <div className="col-span-2 flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-resort`} className="hud tracking-[0.12em] text-ink-2">
            Resort
          </label>
          <Select id={`${id}-resort`} value={resortId} onChange={(e) => setResortId(e.target.value)} aria-invalid={error?.field === 'resort'} aria-describedby={error ? `${id}-error` : undefined}>
            <option value="">Choose a resort…</option>
            {favorites.length ? (
              <optgroup label="Favourites">
                {favorites.map((r) => (
                  <option key={`f-${r.id}`} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <optgroup label="All resorts">
              {sorted.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-dates`} className="hud tracking-[0.12em] text-ink-2">
            Day or days
          </label>
          <DateRangePicker
            id={`${id}-dates`}
            value={range}
            onChange={setRange}
            min={today}
            max={seasonEnd}
            today={today}
            maxDays={MAX_ADD_DAYS}
            presets={['this-weekend', 'next-weekend', { label: 'Today', date: today }, 'next-7-days']}
            aria-invalid={error?.field === 'dates'}
            renderValue={(v) => (v.start ? rangeText(v.start, v.end || v.start) : 'Pick days')}
          />
        </div>
        <Button type="submit" variant="primary" disabled={pending} className="max-md:min-h-11">
          <Plus aria-hidden className="size-4" /> Add
        </Button>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="m-0 text-[13px] font-medium text-critical">
          {error.text}
        </p>
      ) : null}
      {tripDayCount || favorites.length ? (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick add">
          {tripDayCount ? (
            <button type="button" aria-pressed={includeTrips} onClick={() => navigate({ trips: includeTrips ? '0' : null })} className={cn(CHIP, includeTrips ? CHIP_ON : CHIP_OFF)}>
              {includeTrips ? <Check aria-hidden className="size-3.5" strokeWidth={2.4} /> : <Plus aria-hidden className="size-3.5" />}
              Your trips <span className={cn('tnum text-[12px]', includeTrips ? 'text-on-ink-chip-2' : 'text-ink-3')}>{tripDayCount}</span>
            </button>
          ) : null}
          {weekendDays.length
            ? favorites.slice(0, 3).map((r) => (
                <button key={r.id} type="button" disabled={pending} onClick={() => add(weekendDays.map((date) => ({ resortId: r.id, date })))} className={cn(CHIP, CHIP_OFF)}>
                  <Plus aria-hidden className="size-3.5" />
                  {r.shortName} · {weekendDays.length === 2 ? `Sat–Sun ${weekend(sat)}` : dayMonth(sat)}
                </button>
              ))
            : null}
        </div>
      ) : null}
    </form>
  )
}

export function RemoveAddedDay({ added, day, label }: { added: ScenarioDayParam[]; day: ScenarioDayParam; label: string }) {
  const { navigate, pending } = usePassesNav()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => navigate({ days: serializeDays(added.filter((d) => !(d.resortId === day.resortId && d.date === day.date))) || null })}
      aria-label={`Remove ${label}`}
      title="Remove this day"
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-chip-hover hover:text-critical disabled:opacity-50 max-md:size-11"
    >
      <X aria-hidden className="size-4" />
    </button>
  )
}

export function ClearAddedDays({ className }: { className?: string }) {
  const { navigate, pending } = usePassesNav()
  return (
    <button type="button" disabled={pending} onClick={() => navigate({ days: null })} className={cn('inline-flex min-h-9 items-center text-[13px] font-medium text-teal hover:underline max-md:min-h-11', className)}>
      Clear the days you added
    </button>
  )
}

/** Compact "Amounts in [USD]" switch (display only). */
export function CurrencyPill({ value, choices, preferred }: { value: string; choices: string[]; preferred: string }) {
  const id = useId()
  const { navigate } = usePassesNav()
  if (choices.length <= 1) return null
  return (
    <label htmlFor={id} className="inline-flex items-center gap-2 text-[13px] text-ink-2">
      <span className="hud tracking-[0.12em]">Amounts in</span>
      <span className="inline-block w-[96px]">
        <Select id={id} value={value} onChange={(e) => navigate({ cur: e.target.value === preferred ? null : e.target.value })}>
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </span>
    </label>
  )
}
