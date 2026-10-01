'use client'
/**
 * The Explore scenario: which day the date-specific facts describe (scores, confirmed closures, day-cost day type,
 * pass access, nearby events) and which scoring mode the conditions score uses. Both change the server data, so the
 * parent navigates; while that runs a quiet "Updating…" status is announced.
 *
 * Phones get one compact row (quick days + an "Other" date chip over the native picker) so the list starts above the
 * fold; there the scoring mode sits at the top of the filter sheet.
 */
import { useId } from 'react'
import { CalendarDays, Gauge, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { ScrollRow } from '@/components/ui/scroll-row'
import { SCORING_MODES, SCORING_MODE_LABEL, type ScoringMode } from '@/lib/domain/types'

const chip =
  'inline-flex h-11 shrink-0 items-center rounded-full border px-3.5 text-[13.5px] font-medium whitespace-nowrap transition-[background-color,color,border-color,transform] duration-150 active:scale-[0.97] md:h-10'
const chipOff = 'border-[var(--glass-edge)] bg-glass-strong text-ink-2 hover:text-ink'
const chipOn = 'border-transparent bg-ink-chip text-on-ink-chip'

export function ScenarioBar({
  date,
  dateLabel,
  quickDates,
  bounds,
  mode,
  pending,
  onDate,
  onMode,
  className,
}: {
  date: string
  dateLabel: string
  quickDates: { date: string; label: string }[]
  bounds: { min: string; max: string }
  mode: ScoringMode
  pending: boolean
  onDate: (date: string) => void
  onMode: (mode: ScoringMode) => void
  className?: string
}) {
  const id = useId()
  const custom = !quickDates.some((q) => q.date === date)
  const pick = (v: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== date) onDate(v)
  }
  return (
    <ScrollRow className={cn('-mx-4 px-4 scrollbar-thin md:mx-0 md:overflow-visible md:px-0', className)}>
      <div className="flex w-max items-center gap-2 py-0.5 md:w-auto md:flex-wrap md:gap-x-5 md:gap-y-3">
        <div role="group" aria-labelledby={`${id}-day`} className="flex items-center gap-2">
          <span id={`${id}-day`} className="inline-flex shrink-0 items-center gap-1.5 text-[13.5px] font-medium text-ink-2">
            <CalendarDays aria-hidden className="size-4 text-ink-3" />
            <span className="hud max-md:sr-only">Day</span>
            <span className="sr-only">: {dateLabel}</span>
          </span>
          {quickDates.map((q) => {
            const on = q.date === date
            return (
              <button
                key={q.date}
                type="button"
                aria-pressed={on}
                onClick={() => (on ? undefined : onDate(q.date))}
                className={cn(chip, on ? chipOn : chipOff)}
              >
                {q.label}
              </button>
            )
          })}
          {/* md+: a visible, typeable date field. Phones: a chip with the native picker laid over it (tap opens it). */}
          <label htmlFor={`${id}-date`} className="sr-only">
            Other date
          </label>
          <input
            id={`${id}-date`}
            type="date"
            min={bounds.min}
            max={bounds.max}
            value={date}
            onChange={(e) => pick(e.target.value)}
            className={cn(
              chip,
              'tnum w-[10.25rem] bg-glass-strong px-3 focus:border-teal focus-visible:outline-2 focus-visible:outline-offset-1 max-md:hidden',
              custom ? 'border-teal text-teal' : 'border-[var(--glass-edge)] text-ink-2',
            )}
          />
          <span
            className={cn(
              chip,
              'relative gap-1.5 px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus md:hidden',
              custom ? chipOn : chipOff,
            )}
          >
            <CalendarDays aria-hidden className="size-4" />
            <span aria-hidden className="tnum">
              {custom ? dateLabel.replace(/ \d{4}$/, '') : 'Other'}
            </span>
            <input
              type="date"
              min={bounds.min}
              max={bounds.max}
              value={date}
              aria-label={custom ? `Other date, ${dateLabel} selected` : 'Other date'}
              onChange={(e) => pick(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </span>
          <span role="status" aria-live="polite" className="inline-flex w-5 shrink-0 items-center text-ink-3">
            {pending ? (
              <>
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
                <span className="sr-only">Updating</span>
              </>
            ) : null}
          </span>
        </div>

        {/* Phones set the scoring mode in the filter sheet (keeps this row to one line). */}
        <div className="flex shrink-0 items-center gap-2 max-md:hidden">
          <label htmlFor={`${id}-mode`} className="inline-flex shrink-0 items-center gap-1.5 text-[13.5px] font-medium text-ink-2">
            <Gauge aria-hidden className="size-4 text-ink-3" />
            <span className="hud max-md:sr-only">Score for</span>
          </label>
          <select
            id={`${id}-mode`}
            value={mode}
            onChange={(e) => onMode(e.target.value as ScoringMode)}
            className="h-11 rounded-full border border-[var(--glass-edge)] bg-glass-strong pr-3 pl-3.5 text-[13.5px] font-medium text-ink transition-colors duration-150 hover:border-teal focus:border-teal focus-visible:outline-2 focus-visible:outline-offset-1 md:h-10"
          >
            {SCORING_MODES.map((m) => (
              <option key={m} value={m}>
                {SCORING_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </ScrollRow>
  )
}
