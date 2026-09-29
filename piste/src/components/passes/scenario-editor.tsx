'use client'
/**
 * Planned resort-days for the pass calculator: upcoming trip days (on/off as a group) plus days you add here. The
 * added days live in the URL (?days=alta.2027-02-14,…) so a scenario survives reloads and can be shared.
 */
import { useId, useState, type FormEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, TextInput } from '@/components/ui/form'
import { Segmented } from '@/components/ui/segmented'
import type { ResortOption } from '@/lib/data/passes-screen'
import { cn } from '@/lib/ui/cn'
import { dayMonth, dayNumber } from './format'
import { usePassesNav } from './nav'
import { saturdayFrom, serializeDays, shiftDate, type CompareView, type ScenarioDayParam } from './params'

export function AddDayForm({ added, resorts, today, seasonEnd }: { added: ScenarioDayParam[]; resorts: ResortOption[]; today: string; seasonEnd: string }) {
  const id = useId()
  const { navigate, pending } = usePassesNav()
  const [resortId, setResortId] = useState('')
  const [date, setDate] = useState(saturdayFrom(today))
  const [error, setError] = useState<string | null>(null)
  const favorites = resorts.filter((r) => r.isFavorite)
  const sorted = [...resorts].sort((a, b) => a.name.localeCompare(b.name))

  const add = (days: ScenarioDayParam[]) => {
    const next = [...added]
    for (const d of days) if (!next.some((x) => x.resortId === d.resortId && x.date === d.date)) next.push(d)
    navigate({ days: serializeDays(next) || null })
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!resortId) return setError('Choose a resort')
    if (!date || date < today || date > seasonEnd) return setError(`Pick a date from ${today} to ${seasonEnd}`)
    setError(null)
    add([{ resortId, date }])
  }

  const sat = saturdayFrom(today)
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <label htmlFor={`${id}-resort`} className="text-[13.5px] font-medium text-ink">
            Resort
          </label>
          <Select id={`${id}-resort`} value={resortId} onChange={(e) => setResortId(e.target.value)} aria-invalid={!!error && !resortId}>
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
        <div className="flex w-[176px] flex-col gap-1.5">
          <label htmlFor={`${id}-date`} className="text-[13.5px] font-medium text-ink">
            Date
          </label>
          <TextInput id={`${id}-date`} type="date" value={date} min={today} max={seasonEnd} onChange={(e) => setDate(e.target.value)} />
        </div>
        <Button type="submit" variant="primary" disabled={pending} className="max-md:min-h-11">
          <Plus aria-hidden className="size-4" /> Add day
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] font-medium text-critical">
          {error}
        </p>
      ) : null}
      {favorites.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12.5px] text-ink-3">Quick add:</span>
          {favorites.slice(0, 3).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => add([{ resortId: r.id, date: sat }, { resortId: r.id, date: shiftDate(sat, 1) }].filter((d) => d.date <= seasonEnd))}
              className="inline-flex h-9 items-center rounded-full border border-divider bg-surface px-3 text-[13px] font-medium text-ink-2 transition-colors hover:border-teal hover:text-teal max-md:h-11"
            >
              {r.shortName}, Sat–Sun {weekend(sat)}
            </button>
          ))}
        </div>
      ) : null}
    </form>
  )
}

/** "3–4 Oct" / "31 Oct–1 Nov". */
function weekend(sat: string): string {
  const sun = shiftDate(sat, 1)
  return sat.slice(5, 7) === sun.slice(5, 7) ? `${dayNumber(sat)}–${dayMonth(sun)}` : `${dayMonth(sat)}–${dayMonth(sun)}`
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
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-3 hover:text-critical disabled:opacity-50 max-md:size-11"
    >
      <X aria-hidden className="size-4" />
    </button>
  )
}

export function ClearAddedDays({ className }: { className?: string }) {
  const { navigate, pending } = usePassesNav()
  return (
    <button type="button" disabled={pending} onClick={() => navigate({ days: null })} className={cn('text-[13px] font-medium text-teal hover:underline max-md:min-h-11', className)}>
      Clear added days
    </button>
  )
}

export function TripDaysToggle({ include, count }: { include: boolean; count: number }) {
  const { navigate } = usePassesNav()
  return (
    <label className={cn('inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-[13.5px] text-ink md:min-h-0', !count && 'cursor-not-allowed opacity-60')}>
      <input type="checkbox" className="size-5 accent-[var(--teal)]" checked={include && count > 0} disabled={!count} onChange={(e) => navigate({ trips: e.target.checked ? null : '0' })} />
      Include upcoming trip days <span className="text-ink-3 tnum">({count})</span>
    </label>
  )
}

export function ViewSwitch({ value }: { value: CompareView }) {
  const { navigate } = usePassesNav()
  return (
    <Segmented
      label="Count the pass as"
      hideLabel={false}
      value={value}
      onChange={(v) => navigate({ view: v === 'incremental' ? null : v })}
      options={[
        { value: 'incremental', label: 'What it still costs', hint: 'Already-paid passes count as sunk' },
        { value: 'season', label: 'Season total', hint: 'Includes what you already paid' },
      ]}
    />
  )
}
