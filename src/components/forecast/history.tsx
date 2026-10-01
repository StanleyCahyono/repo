'use client'
/**
 * Daily history calendar for the focus resort (resort-local days). Each tracked day carries two markers — the
 * snowfall reported that day and the score Piste estimated before it — and opens a sheet comparing what was forecast
 * then, what was reported and what Piste estimated then. Days before tracking started are shown as such (nothing is
 * reconstructed), tracked days with nothing stored are marked as gaps, and the tracking start is stated.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { motion } from 'motion/react'
import { BadgeCheck, ChevronLeft, ChevronRight, Flag } from 'lucide-react'
import { chartUnits } from '@/components/charts/units'
import type { HistoryCalendar as Calendar, HistoryDay } from '@/lib/data/forecast'
import type { ResortInfo } from '@/lib/data/forecast-screen'
import { SCORING_MODE_LABEL, type AppMode, type UnitPrefs } from '@/lib/domain/types'
import { EmptyState, Notice } from '@/components/ui/states'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { addMonths, dayLong, dayYear, headlineSnow, monthLong, WINDOW_LABEL } from './model'
import { HistoryDaySheet } from './history-sheet'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HATCH = 'repeating-linear-gradient(135deg, var(--divider) 0 1px, transparent 1px 8px)'

const interactive = (d: HistoryDay) => d.state === 'tracked' || d.state === 'today'

export function HistoryCalendarView({
  calendar,
  info,
  month,
  openDate,
  units,
  now,
  appMode,
  stale,
  onOpenDay,
  onClose,
  onMonth,
}: {
  calendar: Calendar
  info: ResortInfo | undefined
  /** Month shown ('YYYY-MM'). */
  month: string
  /** Day whose sheet is open. */
  openDate: string | null
  units: UnitPrefs
  now: string
  appMode: AppMode
  /** The calendar data is for another resort/month than requested (a navigation is pending). */
  stale: boolean
  onOpenDay: (date: string) => void
  onClose: () => void
  onMonth: (month: string) => void
}) {
  const q = useMemo(() => chartUnits(units), [units])
  const today = info?.today ?? now.slice(0, 10)
  const days = calendar.days
  const lead = (days[0]?.weekday ?? 1) - 1
  const openDay = openDate ? (days.find((d) => d.date === openDate && interactive(d)) ?? null) : null
  const trackingMonth = calendar.trackingStart?.slice(0, 7) ?? null
  const canPrev = trackingMonth !== null && addMonths(month, -1) >= trackingMonth
  const canNext = addMonths(month, 1) <= today.slice(0, 7)
  const started = calendar.trackingStart
  const counts = {
    tracked: days.filter((d) => d.state === 'tracked' || (d.state === 'today' && !!started && d.date >= started)).length,
    reported: days.filter((d) => d.report).length,
    gaps: calendar.gaps.length,
  }
  const inches = units.snow === 'in'

  // Roving focus across interactive days.
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const idx = days.map((d, i) => (interactive(d) ? i : -1)).filter((i) => i >= 0)
  const initial = openDay
    ? days.indexOf(openDay)
    : days.findIndex((d) => d.state === 'today') >= 0
      ? days.findIndex((d) => d.state === 'today')
      : (idx[idx.length - 1] ?? -1)
  const [cursor, setCursor] = useState<number | null>(null)
  // The sheet opens programmatically (from the URL), so focus returns to the day it shows when it closes.
  const lastOpened = useRef<string | null>(null)
  useEffect(() => {
    if (openDay) lastOpened.current = openDay.date
  }, [openDay])
  const restoreFocus = (e: Event) => {
    const el = lastOpened.current ? refs.current.get(lastOpened.current) : null
    if (el) {
      e.preventDefault()
      el.focus()
    }
  }
  const active = cursor !== null && idx.includes(cursor) ? cursor : initial
  const move = (from: number, delta: number | 'home' | 'end') => {
    if (!idx.length) return
    let target: number
    if (delta === 'home') target = idx[0]
    else if (delta === 'end') target = idx[idx.length - 1]
    else {
      // Step by a day (←/→) or a week (↑/↓), skipping days that cannot open; stop at the month's edges.
      target = from + delta
      while (target >= 0 && target < days.length && !interactive(days[target])) target += delta
      if (target < 0 || target >= days.length) return
    }
    setCursor(target)
    refs.current.get(days[target].date)?.focus()
  }
  const onKey = (e: KeyboardEvent, i: number) => {
    const map: Record<string, number | 'home' | 'end'> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7, Home: 'home', End: 'end' }
    if (e.key in map) {
      e.preventDefault()
      move(i, map[e.key])
    }
  }

  if (!started) {
    return (
      <div className={cn('transition-opacity duration-200', stale && 'pointer-events-none opacity-55')} aria-busy={stale || undefined}>
        <EmptyState
          seed={`history-${calendar.resortId}`}
          title={`No history yet for ${info?.name ?? calendar.name}`}
          body={
            <>
              History begins on the first day Piste stores a forecast, report or estimate for this resort. Earlier days are never reconstructed from later data,
              so nothing is shown before then.
            </>
          }
        />
      </div>
    )
  }
  const jumpedBefore = openDate && openDate < started && openDate.slice(0, 7) === month

  return (
    <div
      className={cn(
        'grid gap-5 transition-opacity duration-200 lg:grid-cols-[minmax(0,1fr)_minmax(260px,300px)] lg:gap-8',
        stale && 'pointer-events-none opacity-55',
      )}
      aria-busy={stale || undefined}
    >
      <div className="min-w-0">
        {jumpedBefore ? (
          <Notice tone="info" title={`${dayYear(openDate)} is before tracking started`} className="mb-3">
            Piste began tracking {info?.name ?? calendar.name} on {dayYear(started)}. No forecast, report or estimate exists for earlier days, and none is
            reconstructed.
          </Notice>
        ) : null}
        <div className="mb-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onMonth(addMonths(month, -1))}
            disabled={!canPrev}
            aria-label={`Previous month, ${monthLong(addMonths(month, -1))}`}
            className="inline-flex size-11 items-center justify-center rounded-[10px] border border-divider-strong bg-surface text-ink-2 transition-colors duration-150 hover:border-teal hover:text-teal disabled:opacity-40 disabled:hover:border-divider-strong disabled:hover:text-ink-2 md:size-9"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </button>
          <h3 className="text-[16px] font-semibold text-ink" aria-live="polite">
            {monthLong(month)}
          </h3>
          <button
            type="button"
            onClick={() => onMonth(addMonths(month, 1))}
            disabled={!canNext}
            aria-label={`Next month, ${monthLong(addMonths(month, 1))}`}
            className="inline-flex size-11 items-center justify-center rounded-[10px] border border-divider-strong bg-surface text-ink-2 transition-colors duration-150 hover:border-teal hover:text-teal disabled:opacity-40 disabled:hover:border-divider-strong disabled:hover:text-ink-2 md:size-9"
          >
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </div>

        <div role="grid" aria-label={`History for ${info?.name ?? calendar.name}, ${monthLong(month)}`} className="flex flex-col gap-1">
          <div role="row" className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                role="columnheader"
                className={cn('pb-1 text-center text-[12px] font-semibold', w === 'Sat' || w === 'Sun' ? 'text-ink' : 'text-ink-2')}
              >
                {w}
              </div>
            ))}
          </div>
          {chunkWeeks(lead, days).map((week, wi) => (
            <div key={wi} role="row" className="grid grid-cols-7 gap-1">
              {week.map((d, di) =>
                d === null ? (
                  <div
                    key={`b${di}`}
                    role="gridcell"
                    aria-hidden
                    className={week.every((x) => !x || x.state === 'future') ? 'min-h-[36px] md:min-h-[44px]' : 'min-h-[64px] md:min-h-[82px]'}
                  />
                ) : (
                  <DayCell
                    key={d.date}
                    day={d}
                    index={days.indexOf(d)}
                    isOpen={openDay?.date === d.date}
                    isStart={calendar.trackingStart === d.date}
                    tabbable={days.indexOf(d) === active}
                    q={q}
                    inches={inches}
                    onOpen={() => {
                      setCursor(days.indexOf(d))
                      onOpenDay(d.date)
                    }}
                    onKey={onKey}
                    onFocus={() => setCursor(days.indexOf(d))}
                    register={(el) => {
                      if (el) refs.current.set(d.date, el)
                      else refs.current.delete(d.date)
                    }}
                  />
                ),
              )}
            </div>
          ))}
        </div>
      </div>

      <aside aria-label="About this history" className="flex flex-col gap-4 text-[13.5px]">
        <div className="rounded-[12px] border border-divider bg-surface-2 px-4 py-3">
          <p className="eyebrow mb-1">Tracking</p>
          {calendar.trackingStart ? (
            <>
              <p className="text-ink">
                Tracking started <span className="font-semibold tnum">{dayYear(calendar.trackingStart)}</span>
                <span className="text-ink-3"> · {calendar.trackingStartBasis === 'recorded' ? 'recorded start' : 'first stored data'}</span>
              </p>
              <p className="mt-1 text-[12.5px] text-ink-3">Days before it show no history — none is reconstructed from later data.</p>
            </>
          ) : (
            <p className="text-ink-2">
              Tracking hasn’t started for {info?.name ?? calendar.name}. History begins on the first day Piste stores a forecast, report or estimate for it.
            </p>
          )}
          {counts.tracked ? (
            <p className="mt-2 border-t border-divider pt-2 text-[13px] text-ink-2 tnum">
              {monthLong(month)}: {counts.tracked} tracked {counts.tracked === 1 ? 'day' : 'days'} · {counts.reported} with a report · {counts.gaps}{' '}
              {counts.gaps === 1 ? 'gap' : 'gaps'}
            </p>
          ) : null}
        </div>

        <div>
          <p className="eyebrow mb-2">Key</p>
          <ul className="flex flex-col gap-2 text-[13px] text-ink-2">
            <li className="flex items-center gap-2.5">
              <span className="inline-flex w-12 shrink-0 items-center gap-0.5 text-[12px] font-semibold text-ink tnum">
                <BadgeCheck aria-hidden className="size-3.5 text-teal" />
                {inches ? '4″' : '10'}
              </span>
              Snowfall reported that morning ({units.snow}) — 24 h, else overnight
            </li>
            <li className="flex items-center gap-2.5">
              <span className="inline-flex w-12 shrink-0 text-[12px] font-semibold text-copper underline decoration-dashed underline-offset-2 tnum">72*</span>
              Piste estimate made before the day ({SCORING_MODE_LABEL[calendar.mode]})
            </li>
            <li className="flex items-center gap-2.5">
              <span aria-hidden className="h-5 w-12 shrink-0 rounded-[5px] border border-dashed border-divider-strong" />
              Tracked, but nothing stored — a gap
            </li>
            <li className="flex items-center gap-2.5">
              <span aria-hidden className="h-5 w-12 shrink-0 rounded-[5px]" style={{ backgroundImage: HATCH }} />
              Before tracking started
            </li>
            <li className="flex items-center gap-2.5">
              <span aria-hidden className="inline-flex w-12 shrink-0 justify-start">
                <Flag className="size-3.5 text-teal" />
              </span>
              First tracked day
            </li>
          </ul>
        </div>
        <ul className="flex flex-col gap-1 text-[12.5px] text-ink-3">
          {calendar.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </aside>

      <HistoryDaySheet
        day={openDay}
        calendar={calendar}
        info={info}
        units={units}
        now={now}
        appMode={appMode}
        onClose={onClose}
        onCloseAutoFocus={restoreFocus}
      />
    </div>
  )
}

function chunkWeeks(lead: number, days: HistoryDay[]): (HistoryDay | null)[][] {
  const cells: (HistoryDay | null)[] = [...Array.from({ length: lead }, () => null), ...days]
  while (cells.length % 7) cells.push(null)
  const out: (HistoryDay | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7))
  return out
}

function DayCell({
  day,
  index,
  isOpen,
  isStart,
  tabbable,
  q,
  inches,
  onOpen,
  onKey,
  onFocus,
  register,
}: {
  day: HistoryDay
  index: number
  isOpen: boolean
  isStart: boolean
  tabbable: boolean
  q: ReturnType<typeof chartUnits>
  inches: boolean
  onOpen: () => void
  onKey: (e: KeyboardEvent, i: number) => void
  onFocus: () => void
  register: (el: HTMLButtonElement | null) => void
}) {
  const n = Number(day.date.slice(8))
  const snow = headlineSnow(day.report)
  const a = day.assessmentThen
  const base = 'relative flex w-full flex-col items-start rounded-[8px] p-1.5 text-left md:p-2'
  const tall = 'min-h-[64px] md:min-h-[82px]'

  if (!interactive(day)) {
    const label = day.state === 'future' ? `${dayLong(day.date)}: in the future` : `${dayLong(day.date)}: before tracking started — no history`
    return (
      <div
        role="gridcell"
        aria-label={label}
        className={cn(base, 'text-ink-3', day.state === 'future' ? 'min-h-[36px] md:min-h-[44px]' : tall)}
        style={day.state === 'before-tracking' ? { backgroundImage: HATCH } : undefined}
      >
        <span className="text-[12px] tnum">{n}</span>
      </div>
    )
  }

  const bits: string[] = []
  if (snow) bits.push(`reported ${WINDOW_LABEL[snow.window].toLowerCase()} snowfall ${q.snow.format(snow.amountCm)}`)
  else if (day.report) bits.push('report stored, no snowfall amount stated')
  else bits.push('no report')
  if (a) bits.push(a.scoreKind === 'closed' ? 'estimated then: closed' : a.score !== null ? `estimated then ${a.score}` : 'estimate then: no score')
  if (day.gap) bits.push('gap: nothing stored')
  if (isStart) bits.push('first tracked day')
  const label = `${dayLong(day.date)}${day.state === 'today' ? ' (today)' : ''}: ${bits.join(', ')}`

  return (
    <div role="gridcell" aria-selected={isOpen}>
      <button
        ref={register}
        type="button"
        tabIndex={tabbable ? 0 : -1}
        aria-label={label}
        aria-haspopup="dialog"
        onClick={onOpen}
        onKeyDown={(e) => onKey(e, index)}
        onFocus={onFocus}
        className={cn(
          base,
          tall,
          'border transition-colors duration-150',
          day.gap ? 'border-dashed border-divider-strong bg-surface' : 'border-divider bg-surface hover:border-teal/60',
          day.state === 'today' && 'border-teal ring-1 ring-teal/40',
        )}
      >
        {isOpen ? <motion.span layoutId="history-open-day" transition={t.select} aria-hidden className="absolute inset-0 rounded-[8px] bg-glacier" /> : null}
        <span className="relative flex w-full items-center justify-between">
          <span className={cn('text-[12px] tnum', day.state === 'today' ? 'font-bold text-teal' : 'font-medium text-ink')}>{n}</span>
          {isStart ? <Flag aria-hidden className="size-3 text-teal" /> : null}
        </span>
        <span className="relative mt-auto flex w-full flex-col gap-0.5">
          {snow ? (
            <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-ink tnum">
              <BadgeCheck aria-hidden className="size-3 shrink-0 text-teal" />
              {q.snow.short(snow.amountCm)}
              {inches ? '″' : ''}
            </span>
          ) : null}
          {a && a.scoreKind === 'closed' ? (
            <span className="text-[12px] font-medium text-critical">Closed</span>
          ) : a && a.score !== null ? (
            <span className="text-[12px] font-semibold text-copper underline decoration-dashed underline-offset-2 tnum">
              {a.score}
              {a.scoreKind === 'conditions' ? '' : '*'}
            </span>
          ) : null}
          {day.gap ? <span className="text-[12px] text-ink-3 italic">gap</span> : null}
        </span>
      </button>
    </div>
  )
}
