'use client'
/**
 * The Explore scenario: which day the date-specific facts describe (scores, confirmed closures, day-cost day type,
 * pass access, nearby events) and which scoring mode the conditions score uses. Both change the server data, so the
 * parent navigates; while that runs the day picker's icon turns into a spinner and "Updating" is announced.
 *
 * The day is one compact Glass HUD date picker ("Day · Today Sat 3 Oct") with quick picks for Today, Tomorrow and
 * the weekend; phones get the same picker as a bottom sheet. Phones set the scoring mode in the filter sheet.
 */
import { useId } from 'react'
import { ChevronDown, Gauge, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { DatePicker } from '@/components/ui/date-picker'
import { addDays, formatDate } from '@/components/ui/calendar-model'
import { SCORING_MODES, SCORING_MODE_LABEL, type ScoringMode } from '@/lib/domain/types'

const DAY_PRESETS = ['today', 'tomorrow', 'this-weekend', 'next-weekend'] as const

/** "Today" + "Sat 3 Oct", "Tomorrow" + "Sun 4 Oct", or just "Sat 10 Oct". */
export function scenarioDayText(date: string, today: string): { lead: string | null; day: string } {
  const day = formatDate(date, 'short')
  if (date === today) return { lead: 'Today', day }
  if (date === addDays(today, 1)) return { lead: 'Tomorrow', day }
  return { lead: null, day }
}

export function ScenarioBar({
  date,
  dateLabel,
  today,
  bounds,
  mode,
  pending,
  onDate,
  onMode,
  className,
}: {
  date: string
  dateLabel: string
  /** The app's today (ctx.today), so presets and "Today" follow the app clock (demo mode too). */
  today: string
  bounds: { min: string; max: string }
  mode: ScoringMode
  pending: boolean
  onDate: (date: string) => void
  onMode: (mode: ScoringMode) => void
  className?: string
}) {
  const id = useId()
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <DatePicker
        id={`${id}-day`}
        size="compact"
        label="Day for scores and costs"
        value={date}
        min={bounds.min}
        max={bounds.max}
        today={today}
        presets={DAY_PRESETS}
        align="end"
        onChange={(v) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== date) onDate(v)
        }}
        icon={pending ? <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-teal" /> : undefined}
        triggerClassName={cn('h-11 gap-2 pr-3 pl-3.5 md:h-10', date !== today && 'border-teal/60')}
        renderValue={(v) => {
          const t = scenarioDayText(v, today)
          return (
            <span className="inline-flex items-baseline gap-1.5">
              <span className="hud text-ink-3">Day</span>
              {t.lead ? <span className="font-semibold text-ink">{t.lead}</span> : null}
              <span className={t.lead ? 'text-ink-2' : 'font-semibold text-ink'}>{t.day}</span>
            </span>
          )
        }}
      />
      <span role="status" aria-live="polite" className="sr-only">
        {pending ? `Updating for ${dateLabel}` : ''}
      </span>

      {/* Phones set the scoring mode in the filter sheet (keeps this row to one line). */}
      <div className="relative flex shrink-0 items-center max-md:hidden">
        <label htmlFor={`${id}-mode`} className="pointer-events-none absolute left-3.5 z-10 inline-flex items-center gap-1.5">
          <Gauge aria-hidden className="size-4 text-ink-3" />
          <span className="hud text-ink-3">Score</span>
          <span className="sr-only">for</span>
        </label>
        <select
          id={`${id}-mode`}
          value={mode}
          onChange={(e) => onMode(e.target.value as ScoringMode)}
          className="glass-strong h-10 appearance-none rounded-full pr-9 pl-[6.1rem] text-[13.5px] font-semibold text-ink transition-[border-color,translate] duration-150 hover:-translate-y-px hover:border-teal/60 focus:border-teal focus-visible:outline-2 focus-visible:outline-offset-1"
        >
          {SCORING_MODES.map((m) => (
            <option key={m} value={m}>
              {SCORING_MODE_LABEL[m]}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute right-3 size-3.5 text-ink-2 opacity-70" />
      </div>
    </div>
  )
}
