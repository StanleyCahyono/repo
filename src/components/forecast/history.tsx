'use client'
/**
 * The month calendar for the focus resort (resort-local days) — one glass card that joins three kinds of evidence:
 *
 * - upcoming days: the snowfall the CURRENT stored forecast models for them ("likely", tinted by amount);
 * - past tracked days: what was reported that morning next to what was forecast before the day (forecast-then) and
 *   Piste's estimate then — each opens a sheet comparing them; tracked days with nothing stored are gaps;
 * - season markers: openings and closings as announced, reported or estimated (estimates dashed copper).
 *
 * Days before tracking started are hatched "no record yet" — nothing is reconstructed. Hover or focus any day to read
 * it in the detail line; arrows move a single tab stop across the month.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { BadgeCheck, ChevronLeft, ChevronRight, Flag } from 'lucide-react'
import { chartUnits } from '@/components/charts/units'
import type { DayView, HistoryCalendar as Calendar, HistoryDay, ResortForecast } from '@/lib/data/forecast'
import type { ResortInfo, SeasonMarker } from '@/lib/data/forecast-screen'
import { SCORING_MODE_LABEL, type AppMode, type UnitPrefs } from '@/lib/domain/types'
import { Notice } from '@/components/ui/states'
import { cn } from '@/lib/ui/cn'
import { EASE_OUT } from '@/lib/ui/motion'
import { DetailLine, GlassPanel, HATCH } from './hud'
import { addMonths, dayLong, dayYear, headlineSnow, monthLong, WINDOW_LABEL } from './model'
import { HistoryDaySheet } from './history-sheet'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
const opensSheet = (d: HistoryDay) => d.state === 'tracked' || d.state === 'today'

/** How far the calendar browses ahead of the resort's current month (season markers can be months away). */
export const CALENDAR_MONTHS_AHEAD = 8

export function HistoryCalendarView({
  calendar,
  info,
  month,
  openDate,
  units,
  now,
  appMode,
  stale,
  forecast,
  markers = [],
  selectedDate = null,
  onOpenDay,
  onSelectDay,
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
  /** The focus resort's current stored forecast (modeled snow on upcoming days). */
  forecast?: ResortForecast | null
  markers?: SeasonMarker[]
  /** The day selected in the outlook (highlighted). */
  selectedDate?: string | null
  onOpenDay: (date: string) => void
  /** Select an upcoming day that has a forecast (the outlook and day detail follow). */
  onSelectDay?: (date: string) => void
  onClose: () => void
  onMonth: (month: string) => void
}) {
  const q = useMemo(() => chartUnits(units), [units])
  const name = info?.name ?? calendar.name
  const today = info?.today ?? now.slice(0, 10)
  const todayMonth = today.slice(0, 7)
  const days = calendar.days
  const lead = (days[0]?.weekday ?? 1) - 1
  const openDay = openDate ? (days.find((d) => d.date === openDate && opensSheet(d)) ?? null) : null
  const started = calendar.trackingStart
  const trackingMonth = started?.slice(0, 7) ?? null
  const minMonth = trackingMonth && trackingMonth < addMonths(todayMonth, -1) ? trackingMonth : addMonths(todayMonth, -1)
  const maxMonth = addMonths(todayMonth, CALENDAR_MONTHS_AHEAD)
  const canPrev = addMonths(month, -1) >= minMonth
  const canNext = addMonths(month, 1) <= maxMonth
  const inches = units.snow === 'in'

  const modeled = useMemo(() => new Map((forecast?.run ? forecast.daily : []).map((d) => [d.date, d])), [forecast])
  const markersOn = useMemo(() => {
    const m = new Map<string, SeasonMarker[]>()
    for (const k of markers) m.set(k.date, [...(m.get(k.date) ?? []), k])
    return m
  }, [markers])
  const inWindow = (date: string) => markers.find((k) => k.to && date > k.date && date <= k.to) ?? null
  const snowMax = Math.max(q.snow.floorMax * 4, ...[...modeled.values()].map((d) => q.snow.toDisplay(d.snowfallCm) ?? 0))

  const counts = {
    tracked: days.filter((d) => d.state === 'tracked' || (d.state === 'today' && !!started && d.date >= started)).length,
    reported: days.filter((d) => d.report).length,
    gaps: calendar.gaps.length,
  }

  // Month slide direction.
  const prevMonth = useRef(calendar.month)
  const [dir, setDir] = useState(1)
  useEffect(() => {
    if (prevMonth.current !== calendar.month) {
      setDir(calendar.month > prevMonth.current ? 1 : -1)
      prevMonth.current = calendar.month
    }
  }, [calendar.month])

  // Hover / focus detail and roving focus (one tab stop).
  const [hover, setHover] = useState<string | null>(null)
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const initial = openDay?.date ?? days.find((d) => d.state === 'today')?.date ?? days[0]?.date ?? null
  const [cursor, setCursor] = useState<string | null>(null)
  const active = cursor && days.some((d) => d.date === cursor) ? cursor : initial
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
  const onKey = (e: KeyboardEvent, i: number) => {
    const map: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + 7, ArrowUp: i - 7, Home: 0, End: days.length - 1 }
    if (!(e.key in map)) return
    e.preventDefault()
    const t = map[e.key]
    if (t < 0 || t >= days.length) return
    setCursor(days[t].date)
    refs.current.get(days[t].date)?.focus()
  }

  const describe = (d: HistoryDay): string => {
    const bits: string[] = []
    const f = modeled.get(d.date)
    const snow = headlineSnow(d.report)
    if (d.state === 'future' || d.state === 'today') {
      if (f && finite(f.snowfallCm))
        bits.push(
          f.snowfallCm > 0
            ? `likely ${f.partial ? 'at least ' : ''}${q.snow.format(f.snowfallCm)} of snow (modeled now${f.trend ? ', a less certain trend' : ''})`
            : 'little or no snow likely (modeled now)',
        )
      else if (d.state === 'future') bits.push(forecast?.run ? 'beyond the stored forecast' : 'no forecast stored')
    }
    if (d.state === 'before-tracking') bits.push('no record yet — before tracking started')
    if (opensSheet(d)) {
      if (snow) bits.push(`reported ${WINDOW_LABEL[snow.window].toLowerCase()} snowfall ${q.snow.format(snow.amountCm)}`)
      else if (d.report) bits.push('report stored, no snowfall stated')
      else if (d.state === 'tracked') bits.push('no report')
      const ft = d.forecastThen.base ?? d.forecastThen.summit
      if (ft && finite(ft.snowfallCm)) bits.push(`forecast then ${q.snow.format(ft.snowfallCm)}`)
      const a = d.assessmentThen
      if (a) bits.push(a.scoreKind === 'closed' ? 'estimated then: closed' : a.score !== null ? `Piste estimate then ${a.score}` : 'estimate then: no score')
      if (d.gap) bits.push('gap — nothing stored')
    }
    for (const k of markersOn.get(d.date) ?? []) bits.push(k.detail.replace(/\.$/, ''))
    if (inWindow(d.date)) bits.push('inside the estimated opening window (Piste estimate)')
    if (started === d.date) bits.push('first tracked day')
    return `${dayLong(d.date)}${d.state === 'today' ? ' (today)' : ''}: ${bits.join('; ') || 'nothing on record'}.`
  }

  const hovered = hover ? days.find((d) => d.date === hover) : null
  const jumpedBefore = openDate && started && openDate < started && openDate.slice(0, 7) === month
  const [mName, mYear] = monthLong(month).split(' ')

  return (
    <GlassPanel
      aria-labelledby="calendar-title"
      className={cn('flex min-w-0 flex-col gap-3.5 transition-opacity duration-200', stale && 'pointer-events-none opacity-55')}
      aria-busy={stale || undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="hud text-ink-2">Calendar · forecast then vs reported</span>
          <h2 id="calendar-title" className="m-0 text-[32px] leading-[1.05] font-light tracking-[-0.03em] text-ink md:text-[40px]" aria-live="polite">
            {mName} <span className="text-ink-3">{mYear}</span>
            <span className="sr-only"> — {name}</span>
          </h2>
        </div>
        <div className="flex gap-1.5">
          {(
            [
              [-1, canPrev, ChevronLeft, 'Previous month'],
              [1, canNext, ChevronRight, 'Next month'],
            ] as const
          ).map(([step, can, Icon, label]) => (
            <button
              key={step}
              type="button"
              onClick={() => onMonth(addMonths(month, step))}
              disabled={!can}
              aria-label={`${label}, ${monthLong(addMonths(month, step))}`}
              className="glass-strong inline-flex size-11 items-center justify-center rounded-full text-ink transition-[transform,opacity] duration-150 hover:-translate-y-px active:scale-95 disabled:pointer-events-none disabled:opacity-35"
            >
              <Icon aria-hidden className="size-[18px]" />
            </button>
          ))}
        </div>
      </div>

      {jumpedBefore ? (
        <Notice tone="info" title={`${dayYear(openDate)} is before tracking started`}>
          Piste began tracking {name} on {dayYear(started)}. No forecast, report or estimate exists for earlier days, and none is reconstructed.
        </Notice>
      ) : null}

      <div role="grid" aria-label={`Calendar for ${name}, ${monthLong(calendar.month)}`} className="flex flex-col gap-1 md:gap-1.5">
        <div role="row" className="grid grid-cols-7 gap-1 md:gap-1.5">
          {WEEKDAYS.map((w) => (
            <div key={w} role="columnheader" aria-label={w} className="pb-1 text-center font-mono text-[12px] tracking-[0.1em] text-ink-3 uppercase">
              <span className="max-sm:hidden">{w}</span>
              <span className="sm:hidden" aria-hidden>
                {w.slice(0, 1)}
              </span>
            </div>
          ))}
        </div>
        <div className="relative overflow-hidden p-1 -m-1">
          <AnimatePresence mode="popLayout" initial={false} custom={dir}>
            <motion.div
              key={calendar.month}
              custom={dir}
              variants={{
                enter: (d: number) => ({ opacity: 0, x: d * 28 }),
                show: { opacity: 1, x: 0 },
                exit: (d: number) => ({ opacity: 0, x: d * -28 }),
              }}
              initial="enter"
              animate="show"
              exit="exit"
              transition={{ duration: 0.26, ease: EASE_OUT }}
              className="flex flex-col gap-1 md:gap-1.5"
            >
              {chunkWeeks(lead, days).map((week, wi) => (
                <div key={wi} role="row" className="grid grid-cols-7 gap-1 md:gap-1.5">
                  {week.map((d, di) =>
                    d === null ? (
                      <div key={`b${di}`} role="gridcell" aria-hidden className="min-h-[58px] md:min-h-[78px]" />
                    ) : (
                      <DayCell
                        key={d.date}
                        day={d}
                        index={days.indexOf(d)}
                        modeled={modeled.get(d.date)}
                        markers={markersOn.get(d.date) ?? []}
                        windowDay={!!inWindow(d.date)}
                        isOpen={openDay?.date === d.date}
                        isSelected={selectedDate === d.date}
                        isStart={started === d.date}
                        tabbable={active === d.date}
                        q={q}
                        inches={inches}
                        snowMax={snowMax}
                        label={describe(d)}
                        onActivate={() => {
                          setCursor(d.date)
                          if (opensSheet(d)) onOpenDay(d.date)
                          else if (d.state === 'future' && modeled.has(d.date)) onSelectDay?.(d.date)
                          else setHover(d.date)
                        }}
                        onKey={onKey}
                        onHover={(on) => setHover((h) => (on ? d.date : h === d.date ? null : h))}
                        onFocus={() => {
                          setCursor(d.date)
                          setHover(d.date)
                        }}
                        register={(el) => {
                          if (el) refs.current.set(d.date, el)
                          else refs.current.delete(d.date)
                        }}
                      />
                    ),
                  )}
                </div>
              ))}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <DetailLine active={!!hovered}>
        {hovered
          ? describe(hovered)
          : started
            ? `Tracking since ${dayYear(started)} (${calendar.trackingStartBasis === 'recorded' ? 'recorded start' : 'first stored data'}). Hover or focus a day; past tracked days open what was forecast, reported and estimated.`
            : `Tracking hasn’t started for ${name}. Upcoming days show modeled snow once a forecast is stored; season dates show when on file.`}
      </DetailLine>

      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 border-t border-[color-mix(in_srgb,var(--ink)_7%,transparent)] p-0 pt-3 text-[12px] text-ink-2">
        <li className="flex items-center gap-1.5">
          <i aria-hidden className="size-2.5 rounded-full bg-teal" />
          Likely snow (modeled now)
        </li>
        <li className="flex items-center gap-1.5">
          <BadgeCheck aria-hidden className="size-3.5 text-teal" />
          Reported ({units.snow})
        </li>
        <li className="flex items-center gap-1.5">
          <i aria-hidden className="size-2.5 rounded-full border-[1.5px] border-teal" />
          Forecast then
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="font-semibold text-copper underline decoration-dashed underline-offset-2">72*</span>
          Piste estimate then ({SCORING_MODE_LABEL[calendar.mode]})
        </li>
        <li className="flex items-center gap-1.5">
          <i aria-hidden className="h-2.5 w-3.5 rounded-[4px]" style={{ backgroundImage: HATCH }} />
          Past · no record yet
        </li>
        <li className="flex items-center gap-1.5">
          <i aria-hidden className="h-2.5 w-3.5 rounded-[4px] border-[1.5px] border-dashed border-ink-3" />
          Gap
        </li>
        <li className="flex items-center gap-1.5">
          <i aria-hidden className="h-2.5 w-3.5 rounded-[4px] border-[1.5px] border-dashed border-copper" />
          Estimate
        </li>
        <li className="flex items-center gap-1.5">
          <i aria-hidden className="h-2.5 w-3.5 rounded-[4px] bg-teal" />
          Announced
        </li>
        <li className="flex items-center gap-1.5">
          <Flag aria-hidden className="size-3.5 text-teal" />
          First tracked day
        </li>
      </ul>
      <p className="m-0 text-[12.5px] leading-[1.45] text-ink-2">
        Piste saves each forecast it fetches. Once a resort reports snow, past days show what was forecast next to what was reported
        {counts.tracked
          ? ` — ${monthLong(calendar.month)}: ${counts.tracked} tracked ${counts.tracked === 1 ? 'day' : 'days'}, ${counts.reported} with a report, ${counts.gaps} ${counts.gaps === 1 ? 'gap' : 'gaps'}.`
          : '.'}
        {calendar.notes.length ? <span className="mt-1 block text-ink-3">{calendar.notes.join(' ')}</span> : null}
      </p>

      <HistoryDaySheet day={openDay} calendar={calendar} info={info} units={units} now={now} appMode={appMode} onClose={onClose} onCloseAutoFocus={restoreFocus} />
    </GlassPanel>
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
  modeled,
  markers,
  windowDay,
  isOpen,
  isSelected,
  isStart,
  tabbable,
  q,
  inches,
  snowMax,
  label,
  onActivate,
  onKey,
  onHover,
  onFocus,
  register,
}: {
  day: HistoryDay
  index: number
  modeled: DayView | undefined
  markers: SeasonMarker[]
  windowDay: boolean
  isOpen: boolean
  isSelected: boolean
  isStart: boolean
  tabbable: boolean
  q: ReturnType<typeof chartUnits>
  inches: boolean
  snowMax: number
  label: string
  onActivate: () => void
  onKey: (e: KeyboardEvent, i: number) => void
  onHover: (on: boolean) => void
  onFocus: () => void
  register: (el: HTMLButtonElement | null) => void
}) {
  const n = Number(day.date.slice(8))
  const isToday = day.state === 'today'
  const past = day.state === 'before-tracking' || day.state === 'tracked'
  const snow = headlineSnow(day.report)
  const a = day.assessmentThen
  const ft = day.forecastThen.base ?? day.forecastThen.summit
  const mv = modeled && !past ? q.snow.toDisplay(modeled.snowfallCm) : null
  const tint = finite(mv) && mv > 0 && !isToday ? Math.min(30, 6 + (mv / snowMax) * 26) : 0
  const dot = finite(mv) ? 6 + Math.min(10, (mv / snowMax) * 10) : 0
  const unit = inches ? '″' : ''

  const bg = isToday
    ? 'bg-ink-chip text-on-ink-chip border-ink-chip shadow-[0_10px_24px_rgb(19_32_44/0.25)]'
    : day.state === 'before-tracking'
      ? 'bg-glass-soft border-[color-mix(in_srgb,var(--ink)_6%,transparent)]'
      : day.gap
        ? 'bg-glass-soft border-dashed border-ink-3/70'
        : 'bg-glass-strong border-[color-mix(in_srgb,var(--ink)_7%,transparent)]'

  return (
    <div role="gridcell" aria-selected={isOpen || isSelected}>
      <button
        ref={register}
        type="button"
        tabIndex={tabbable ? 0 : -1}
        aria-label={label}
        aria-haspopup={opensSheet(day) ? 'dialog' : undefined}
        onClick={onActivate}
        onKeyDown={(e) => onKey(e, index)}
        onFocus={onFocus}
        onBlur={() => onHover(false)}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        className={cn(
          'group relative flex min-h-[58px] w-full flex-col items-stretch gap-1 overflow-hidden rounded-[12px] border p-1.5 text-left outline-offset-2 md:min-h-[78px] md:rounded-[14px] md:px-2 md:py-[7px]',
          'transition-[transform,box-shadow] duration-[350ms] ease-[cubic-bezier(.3,1.4,.5,1)] hover:z-[1] hover:-translate-y-[3px] focus-visible:-translate-y-[3px]',
          !isToday && 'hover:shadow-[0_12px_26px_rgb(19_32_44/0.14)]',
          bg,
          (isOpen || isSelected) && !isToday && 'ring-2 ring-teal',
        )}
        style={{
          backgroundImage: day.state === 'before-tracking' ? HATCH : undefined,
          backgroundColor: tint ? `color-mix(in srgb, var(--teal) ${tint}%, var(--glass-strong))` : undefined,
        }}
      >
        <span className="flex items-start justify-between gap-1">
          <span className={cn('text-[13px] leading-none tnum', isToday ? 'font-semibold' : past ? 'font-medium text-ink-3' : 'font-medium text-ink')}>{n}</span>
          {isToday ? <span className="hud text-[12px] leading-none tracking-[0.08em] text-on-ink-chip-accent max-md:hidden">Today</span> : null}
          {isStart && !isToday ? <Flag aria-hidden className="size-3 shrink-0 text-teal" /> : null}
        </span>

        <span className="mt-auto flex min-w-0 flex-col gap-0.5">
          {/* Upcoming / today: modeled now */}
          {finite(mv) ? (
            <span className="flex min-w-0 items-center gap-1">
              <motion.i
                aria-hidden
                className={cn('block shrink-0 rounded-full max-sm:hidden', isToday ? 'bg-on-ink-chip-accent' : mv > 0 ? 'bg-teal' : 'bg-ink-3/40')}
                style={{ width: dot, height: dot }}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 420, damping: 22, delay: 0.15 + index * 0.012 }}
              />
              <span className={cn('text-[12px] leading-none font-semibold whitespace-nowrap tnum max-sm:tracking-[-0.03em]', isToday ? 'text-on-ink-chip' : modeled?.trend ? 'text-ink-2' : 'text-ink')}>
                {mv > 0 ? `${modeled?.partial ? '≥' : ''}${q.snow.short(modeled?.snowfallCm)}${unit}` : '0'}
                <span className="font-normal max-md:hidden">{mv > 0 && !inches ? ' cm' : ''}</span>
              </span>
            </span>
          ) : null}
          {/* Past: reported vs forecast then */}
          {snow ? (
            <span className={cn('inline-flex items-center gap-0.5 text-[12px] leading-none font-semibold tnum', isToday ? 'text-on-ink-chip' : 'text-ink')}>
              <BadgeCheck aria-hidden className={cn('size-3 shrink-0', isToday ? 'text-on-ink-chip-accent' : 'text-teal')} />
              {q.snow.short(snow.amountCm)}
              {unit}
            </span>
          ) : null}
          {past && ft && finite(ft.snowfallCm) ? (
            <span className="inline-flex items-center gap-1 text-[12px] leading-none text-ink-2 tnum max-sm:hidden">
              <i aria-hidden className="size-2 shrink-0 rounded-full border-[1.5px] border-teal" />
              {q.snow.short(ft.snowfallCm)}
              {unit}
            </span>
          ) : null}
          {past && a ? (
            a.scoreKind === 'closed' ? (
              <span className="text-[12px] leading-none font-medium text-critical max-sm:hidden">Closed</span>
            ) : a.score !== null ? (
              <span className="text-[12px] leading-none font-semibold text-copper underline decoration-dashed underline-offset-2 tnum max-sm:hidden">
                {a.score}
                {a.scoreKind === 'conditions' ? '' : '*'}
              </span>
            ) : null
          ) : null}
          {day.gap ? <span className="text-[12px] leading-none text-ink-3 italic max-sm:hidden">gap</span> : null}
          {/* Season markers */}
          {markers.map((k) => (
            <span
              key={`${k.event}-${k.basis}`}
              className={cn(
                'max-w-full self-start rounded-[6px] px-1.5 py-[3px] text-[12px] leading-[1.1] font-semibold break-words max-sm:h-[5px] max-sm:w-full max-sm:p-0 max-sm:text-[0px]',
                k.basis === 'estimate'
                  ? 'border-[1.5px] border-dashed border-copper text-copper max-sm:border-0 max-sm:bg-copper'
                  : k.basis === 'actual'
                    ? 'bg-ink-chip text-on-ink-chip'
                    : 'bg-teal text-on-teal',
                isToday && 'bg-on-ink-chip text-ink-chip',
              )}
            >
              {k.label}
            </span>
          ))}
        </span>
        {windowDay && !markers.length ? <span aria-hidden className="absolute inset-x-1.5 bottom-1 border-t-[1.5px] border-dashed border-copper" /> : null}
      </button>
    </div>
  )
}
