'use client'
/**
 * Date-range selector in Today's header: Today · Tomorrow · This weekend (radio group, arrow keys) and "Pick dates"
 * (an inline from/to form, ≤ 14 days, never in the past). The selection glides between chips (shared layoutId) the
 * moment it is chosen; the ranking below dims until the server has re-ranked.
 */
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import { motion } from 'motion/react'
import { CalendarRange, X } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { ScrollRow } from '@/components/ui/scroll-row'
import { t } from '@/lib/ui/motion'
import { addDays, daysBetween, formatLocalDate } from '@/lib/domain/time'
import { useTodayNav } from './nav'
import { datesPatch, formatDates, MAX_RANGE_DAYS, quickPatch, quickRangeOf, weekendOf, type QuickRange } from './params'

const chip =
  'relative inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[14px] font-medium whitespace-nowrap transition-colors duration-150 md:h-10'

export function DateChips({ className }: { className?: string }) {
  const { today, dates, navigate } = useTodayNav()
  const quick = quickRangeOf(dates, today)
  const [open, setOpen] = useState(false)
  const formId = useId()
  const weekend = weekendOf(today)
  const radios: {
    key: Exclude<QuickRange, 'custom'>
    label: string
    short: string
    sub: string
  }[] = [
    {
      key: 'today',
      label: 'Today',
      short: 'Today',
      sub: formatLocalDate(today, 'ccc d'),
    },
    {
      key: 'tomorrow',
      label: 'Tomorrow',
      short: 'Tomorrow',
      sub: formatLocalDate(addDays(today, 1), 'ccc d'),
    },
    {
      key: 'weekend',
      label: weekend.from === weekend.to ? 'This Sunday' : 'This weekend',
      short: weekend.from === weekend.to ? 'Sunday' : 'Weekend',
      sub: formatDates(weekend.from === weekend.to ? [weekend.from] : [weekend.from, weekend.to]),
    },
  ]
  const pick = (k: Exclude<QuickRange, 'custom'>) => {
    setOpen(false)
    navigate(quickPatch(k, today))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = radios.findIndex((r) => r.key === quick)
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = radios[((i === -1 ? 0 : i) + step + radios.length) % radios.length]
    pick(next.key)
    const el = e.currentTarget.querySelector<HTMLButtonElement>(`[data-key="${next.key}"]`)
    el?.focus()
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <ScrollRow className="-mx-4 flex items-center gap-2 px-4 pb-0.5 scrollbar-thin md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        <div role="radiogroup" aria-label="Dates to rank" className="flex items-center gap-2" onKeyDown={onKey}>
          {radios.map((r) => {
            const on = quick === r.key
            return (
              <button
                key={r.key}
                type="button"
                role="radio"
                data-key={r.key}
                aria-checked={on}
                tabIndex={on || (quick === 'custom' && r.key === 'today') ? 0 : -1}
                onClick={() => pick(r.key)}
                className={cn(chip, on ? 'border-teal text-teal' : 'border-divider-strong bg-surface text-ink-2 hover:border-teal hover:text-ink')}
              >
                {on ? <motion.span layoutId="today-date-chip" transition={t.select} aria-hidden className="absolute inset-0 rounded-full bg-glacier" /> : null}
                <span className="relative lg:hidden">{r.short}</span>
                <span className="relative hidden lg:inline">{r.label}</span>
                <span className={cn('tnum relative hidden text-[12.5px] font-normal lg:inline', on ? 'text-teal' : 'text-ink-3')}>{r.sub}</span>
              </button>
            )
          })}
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? formId : undefined}
          onClick={() => setOpen((v) => !v)}
          className={cn(chip, quick === 'custom' ? 'border-teal text-teal' : 'border-divider-strong bg-surface text-ink-2 hover:border-teal hover:text-ink')}
        >
          {quick === 'custom' ? (
            <motion.span layoutId="today-date-chip" transition={t.select} aria-hidden className="absolute inset-0 rounded-full bg-glacier" />
          ) : null}
          <CalendarRange aria-hidden className="relative size-4" />
          <span className="tnum relative">{quick === 'custom' ? formatDates(dates) : 'Pick dates'}</span>
          {quick === 'custom' ? <span className="sr-only"> (change dates)</span> : null}
        </button>
      </ScrollRow>
      {open ? (
        <RangeForm
          id={formId}
          key={dates.join()}
          today={today}
          dates={dates}
          onDone={() => setOpen(false)}
          onApply={(from, to) => navigate(datesPatch(from, to, today))}
        />
      ) : null}
    </div>
  )
}

function RangeForm({
  id,
  today,
  dates,
  onDone,
  onApply,
}: {
  id: string
  today: string
  dates: string[]
  onDone: () => void
  onApply: (from: string, to: string) => void
}) {
  const [from, setFrom] = useState(dates[0])
  const [to, setTo] = useState(dates[dates.length - 1])
  const [error, setError] = useState<string | null>(null)
  const max = addDays(today, 365)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!from || from < today) return setError('Choose today or a later day')
    const end = to && to >= from ? to : from
    if (daysBetween(from, end) >= MAX_RANGE_DAYS) return setError(`Keep the range to ${MAX_RANGE_DAYS} days or fewer`)
    setError(null)
    onApply(from, end)
    onDone()
  }
  return (
    <form
      id={id}
      onSubmit={submit}
      aria-label="Pick dates"
      className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-[12px] border border-divider bg-surface p-3"
    >
      <label className="flex flex-col gap-1 text-[12.5px] font-medium text-ink-2">
        From
        <input
          type="date"
          required
          value={from}
          min={today}
          max={max}
          onChange={(e) => {
            setFrom(e.target.value)
            if (to < e.target.value) setTo(e.target.value)
          }}
          className="tnum h-11 rounded-md border border-divider-strong bg-surface px-3 text-[15px] text-ink md:h-10"
        />
      </label>
      <label className="flex flex-col gap-1 text-[12.5px] font-medium text-ink-2">
        To
        <input
          type="date"
          value={to}
          min={from || today}
          max={from ? addDays(from, MAX_RANGE_DAYS - 1) : max}
          onChange={(e) => setTo(e.target.value)}
          className="tnum h-11 rounded-md border border-divider-strong bg-surface px-3 text-[15px] text-ink md:h-10"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="inline-flex h-11 items-center rounded-md border border-teal bg-teal px-4 text-[14px] font-medium text-on-teal hover:bg-teal-strong md:h-10"
        >
          Rank these dates
        </button>
        <button
          type="button"
          onClick={onDone}
          aria-label="Close date picker"
          className="inline-flex size-11 items-center justify-center rounded-md text-ink-2 hover:bg-surface-3 md:size-10"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <p className={cn('basis-full text-[12.5px]', error ? 'font-medium text-critical' : 'text-ink-3')} role={error ? 'alert' : undefined}>
        {error ?? `One day or a range of up to ${MAX_RANGE_DAYS} days. Each resort is ranked on its best day in the range.`}
      </p>
    </form>
  )
}
