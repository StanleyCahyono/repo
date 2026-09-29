'use client'
/**
 * Toolbars for the matrix, day-cost and calculator routes: a date (inside the season) with quick shortcuts, filter
 * chips and a display-currency switch. Every change writes to the URL through PassesNav.
 */
import { useId } from 'react'
import { cn } from '@/lib/ui/cn'
import { Select, TextInput } from '@/components/ui/form'
import { usePassesNav } from './nav'
import { saturdayFrom, shiftDate } from './params'

export function DateField({
  param = 'date',
  value,
  today,
  season,
  label = 'Date',
  shortcuts = true,
}: {
  param?: string
  value: string
  today: string
  season: { start: string; end: string }
  label?: string
  shortcuts?: boolean
}) {
  const id = useId()
  const { navigate } = usePassesNav()
  const base = today < season.start ? season.start : today
  const sat = saturdayFrom(base)
  const presets = [
    { label: 'Today', date: base },
    { label: 'Saturday', date: sat },
    { label: 'Sunday', date: shiftDate(sat, 1) },
  ].filter((p, i, xs) => p.date >= season.start && p.date <= season.end && xs.findIndex((x) => x.date === p.date) === i)
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13.5px] font-medium text-ink">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-[176px] shrink-0">
          <TextInput id={id} type="date" value={value} min={season.start} max={season.end} onChange={(e) => e.target.value && navigate({ [param]: e.target.value })} />
        </div>
        {shortcuts ? (
          <div role="group" aria-label="Date shortcuts" className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                aria-pressed={p.date === value}
                onClick={() => navigate({ [param]: p.date })}
                className={cn(
                  'inline-flex h-9 items-center rounded-full border px-3 text-[13px] font-medium transition-colors duration-150 max-md:h-11',
                  p.date === value ? 'border-teal bg-glacier text-teal' : 'border-divider bg-surface text-ink-2 hover:border-teal hover:text-teal',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function ChipFilter<T extends string>({
  label,
  param,
  value,
  options,
  defaultValue,
}: {
  label: string
  param: string
  value: T
  options: { value: T; label: string; count?: number }[]
  defaultValue: T
}) {
  const { navigate } = usePassesNav()
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13.5px] font-medium text-ink" id={`${param}-label`}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={`${param}-label`} className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => navigate({ [param]: o.value === defaultValue ? null : o.value })}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 max-md:h-11',
                on ? 'border-teal bg-glacier text-teal' : 'border-divider bg-surface text-ink-2 hover:border-teal hover:text-teal',
              )}
            >
              {o.label}
              {o.count != null ? <span className={cn('tnum text-[12px]', on ? 'text-teal' : 'text-ink-3')}>{o.count}</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function CurrencySelect({ value, choices, preferred, note }: { value: string; choices: string[]; preferred: string; note?: string }) {
  const id = useId()
  const { navigate } = usePassesNav()
  const only = choices.length <= 1
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13.5px] font-medium text-ink">
        Show amounts in
      </label>
      <div className="w-[148px]">
        <Select id={id} value={value} disabled={only} onChange={(e) => navigate({ cur: e.target.value === preferred ? null : e.target.value })} aria-describedby={`${id}-note`}>
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
              {c === preferred ? ' (yours)' : ''}
            </option>
          ))}
        </Select>
      </div>
      <p id={`${id}-note`} className="max-w-[30ch] text-[12px] text-ink-3">
        {note ?? (only ? 'No stored exchange rates — amounts stay in their own currency.' : 'Display only — stored prices keep their own currency.')}
      </p>
    </div>
  )
}

