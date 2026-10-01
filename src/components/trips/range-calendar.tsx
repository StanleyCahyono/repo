'use client'
/**
 * Range calendar (Glass HUD): tap a start day, then an end day. The range band springs between days, the start and
 * end knobs glide to the day you tap, nights are counted, and each day carries the season marker of the resorts in
 * view — solid teal for an opened season, light teal for an announced one, a dashed copper rule after a Piste-estimated
 * opening. Markers always come with text (legend + each day's accessible name), never colour alone.
 *
 * Keyboard: arrow keys move by day / week, PageUp / PageDown by month, Home / End to the week's edges; Enter or Space
 * picks. Reduced motion: the band and knobs jump instead of springing (MotionConfig in the shell).
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { addDays, formatLocalDate } from '@/lib/domain/time'
import { markOn, type SeasonTrack, type SeasonWindowKind } from '@/lib/data/trip-seasons'
import { addMonths, bandSegment, monthGrid, monthOf, nightsOf, pickDay } from './calendar-model'

const SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 } as const
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const DOW_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export const MARK_TEXT: Record<SeasonWindowKind, string> = {
  opened: 'season opened',
  announced: 'announced season',
  estimate: 'after estimated opening (Piste estimate)',
}

/** The little rule drawn under a day number (also used by legends). */
export function SeasonMark({ kind, className, inverted }: { kind: SeasonWindowKind; className?: string; inverted?: boolean }) {
  return (
    <i
      aria-hidden
      className={cn('block h-[3px] w-3.5 rounded-full', kind === 'opened' ? (inverted ? 'bg-on-ink-chip-accent' : 'bg-teal') : kind === 'announced' ? (inverted ? 'bg-on-ink-chip-accent/60' : 'bg-teal/45') : null, className)}
      style={kind === 'estimate' ? { background: `repeating-linear-gradient(90deg, ${inverted ? 'var(--on-ink-chip-accent)' : 'var(--copper)'} 0 2px, transparent 2px 4px)` } : undefined}
    />
  )
}

export interface RangeCalendarProps {
  start: string | null
  end: string | null
  onChange: (start: string | null, end: string | null) => void
  today: string
  /** Earliest selectable day (default: today). */
  min?: string
  /** Longest range allowed, in days; longer picks are refused with a note. */
  maxDays?: number
  /** Resorts whose season windows mark the days. */
  tracks?: SeasonTrack[]
  /** Month shown first (default: the start's month, else today's). */
  initialMonth?: string
  label?: string
  className?: string
}

export function RangeCalendar({ start, end, onChange, today, min, maxDays, tracks = [], initialMonth, label = 'Trip dates', className }: RangeCalendarProps) {
  const uid = useId()
  const floor = min ?? today
  const [month, setMonth] = useState(initialMonth ?? monthOf(start ?? (today > floor ? today : floor)))
  const [dir, setDir] = useState(1)
  const [hover, setHover] = useState<string | null>(null)
  const [focus, setFocus] = useState<string>(start ?? (today >= floor ? today : floor))
  const [note, setNote] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const minMonth = monthOf(floor)
  const maxMonth = addMonths(monthOf(today), 18)
  const weeks = useMemo(() => monthGrid(month), [month])
  const monthDays = weeks.flat().filter(Boolean) as string[]

  const go = (n: number) => {
    const next = addMonths(month, n)
    if (next < minMonth || next > maxMonth) return
    setDir(n)
    setMonth(next)
    setHover(null)
  }

  const pick = (day: string) => {
    if (day < floor) return
    const next = pickDay(start, end, day)
    if (next.end && maxDays && nightsOf(next.start, next.end).days > maxDays) {
      setNote(`Keep a trip to ${maxDays} days or fewer`)
      return
    }
    setNote(null)
    onChange(next.start, next.end)
  }

  const moveFocus = (to: string) => {
    if (to < floor) to = floor
    const m = monthOf(to)
    if (m > maxMonth) return
    if (m !== month) {
      setDir(m > month ? 1 : -1)
      setMonth(m)
    }
    setFocus(to)
    // Focus after the grid re-renders with the new month.
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${to}"]`)?.focus())
  }

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, day: string) => {
    const wd = (weeks.flat().indexOf(day) + 7) % 7
    const map: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, PageUp: -28, PageDown: 28, Home: -wd, End: 6 - wd }
    if (!(e.key in map)) return
    e.preventDefault()
    moveFocus(addDays(day, map[e.key]))
  }

  // The band: the chosen range, or a preview while choosing the end day.
  const preview = start && !end && hover && hover > start ? hover : null
  const bandEnd = end ?? preview
  const focusable = monthDays.includes(focus) ? focus : (monthDays.find((d) => d >= floor) ?? monthDays[0])
  const visibleKinds = new Map<string, { kind: SeasonWindowKind; label: string; name: string }>()
  for (const d of monthDays) {
    const m = markOn(tracks, d)
    if (m) visibleKinds.set(`${m.track.resortId}|${m.window.from}`, { kind: m.kind, label: m.window.label, name: m.track.name })
  }
  const multiTrack = tracks.filter((t) => t.windows.length).length > 1

  const counts = start && end ? nightsOf(start, end) : null
  const status = counts
    ? `${formatLocalDate(start!, 'ccc d LLL')} – ${formatLocalDate(end!, 'ccc d LLL')}`
    : start
      ? `${formatLocalDate(start, 'ccc d LLL')} – pick the last day`
      : 'Pick your dates'

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="hud text-ink-2">{label}</p>
          <p aria-live="polite" className="mt-0.5 text-[22px] leading-tight font-light tracking-[-0.02em] text-ink tnum md:text-[24px]">
            {status}
            {counts ? (
              <span className="mt-0.5 block text-[13px] font-normal tracking-normal text-ink-2">
                {counts.nights ? `${counts.nights} ${counts.nights === 1 ? 'night' : 'nights'} · ` : 'Day trip · '}
                {counts.days} {counts.days === 1 ? 'day' : 'days'}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" aria-label="Previous month" disabled={month <= minMonth} onClick={() => go(-1)} className="glass-strong flex size-11 items-center justify-center rounded-full text-ink transition-transform duration-150 hover:-translate-y-px disabled:opacity-35 disabled:hover:translate-y-0">
            <ChevronLeft aria-hidden className="size-[18px]" />
          </button>
          <button type="button" aria-label="Next month" disabled={month >= maxMonth} onClick={() => go(1)} className="glass-strong flex size-11 items-center justify-center rounded-full text-ink transition-transform duration-150 hover:-translate-y-px disabled:opacity-35 disabled:hover:translate-y-0">
            <ChevronRight aria-hidden className="size-[18px]" />
          </button>
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <p id={`${uid}-month`} className="text-[15px] font-semibold text-ink">
          {formatLocalDate(`${month}-01`, 'LLLL yyyy')}
        </p>
        <p className="text-right text-[12.5px] text-ink-2">{start && !end ? 'Now tap the last day' : 'Tap a start day, then an end day'}</p>
      </div>

      <div className="relative overflow-hidden">
        <div className="grid grid-cols-7 pb-1" aria-hidden>
          {DOW.map((d, i) => (
            <span key={i} className={cn('text-center font-mono text-[12px] tracking-[0.1em]', i >= 5 ? 'text-teal' : 'text-ink-3')}>
              {d}
            </span>
          ))}
        </div>
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={month}
            ref={gridRef}
            role="grid"
            aria-labelledby={`${uid}-month`}
            custom={dir}
            initial={{ opacity: 0, x: dir * 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -28 }}
            transition={{ duration: 0.22, ease: [0.22, 0.8, 0.26, 1] }}
            className="flex flex-col gap-1"
            onMouseLeave={() => setHover(null)}
          >
            <LayoutGroup id={`${uid}-band`}>
              {weeks.map((week, wi) => {
                const seg = bandSegment(week, start, bandEnd)
                return (
                  <div key={wi} role="row" className="relative grid grid-cols-7">
                    {seg ? (
                      <motion.span
                        layout
                        layoutId={`${uid}-band-${wi}`}
                        aria-hidden
                        transition={SPRING}
                        className={cn('absolute inset-y-0', end ? 'bg-teal/15' : 'border border-dashed border-teal/45 bg-teal/[0.07]')}
                        style={{
                          left: `calc(${(seg.c0 / 7) * 100}% + 2px)`,
                          width: `calc(${((seg.c1 - seg.c0 + 1) / 7) * 100}% - 4px)`,
                          borderRadius: 22,
                        }}
                      />
                    ) : null}
                    {week.map((day, ci) => {
                      if (!day) return <span key={ci} role="gridcell" aria-hidden className="h-11" />
                      const off = day < floor
                      const isStart = day === start
                      const isEnd = day === end
                      const sel = isStart || isEnd
                      const mark = markOn(tracks, day)
                      const isToday = day === today
                      const aria = [
                        `${DOW_LONG[ci]} ${formatLocalDate(day, 'd LLLL yyyy')}`,
                        isToday ? 'today' : null,
                        isStart ? 'trip start' : null,
                        isEnd ? 'trip end' : null,
                        mark ? `${mark.track.name}: ${MARK_TEXT[mark.kind]}` : null,
                      ]
                        .filter(Boolean)
                        .join(', ')
                      return (
                        <span key={ci} role="gridcell" className="relative flex justify-center">
                          <button
                            type="button"
                            data-day={day}
                            tabIndex={day === focusable ? 0 : -1}
                            disabled={off}
                            aria-label={aria}
                            aria-pressed={sel}
                            onClick={() => pick(day)}
                            onKeyDown={(e) => onKey(e, day)}
                            onFocus={() => setFocus(day)}
                            onMouseEnter={() => setHover(day)}
                            className={cn(
                              'group/day relative flex h-11 w-full max-w-[52px] flex-col items-center justify-center rounded-full text-[14px] font-medium outline-offset-2 transition-colors duration-150 tnum',
                              off ? 'cursor-default text-ink-3/55' : sel ? 'text-on-ink-chip' : 'text-ink hover:bg-ink/[0.06]',
                            )}
                          >
                            {sel ? <motion.span layoutId={`${uid}-${isStart ? 'start' : 'end'}`} transition={SPRING} aria-hidden className="absolute inset-0 rounded-full bg-ink-chip shadow-[0_8px_18px_-6px_rgb(19_32_44/0.45)]" /> : null}
                            <span className={cn('relative', sel && 'font-semibold')}>{Number(day.slice(8))}</span>
                            {mark ? <SeasonMark kind={mark.kind} inverted={sel} className={cn('absolute bottom-[6px] left-1/2 -translate-x-1/2', off && 'opacity-50')} /> : null}
                            {isToday ? <i aria-hidden className={cn('absolute top-[6px] right-[calc(50%-12px)] size-1 rounded-full', sel ? 'bg-on-ink-chip' : 'bg-teal')} /> : null}
                          </button>
                        </span>
                      )
                    })}
                  </div>
                )
              })}
            </LayoutGroup>
          </motion.div>
        </AnimatePresence>
      </div>

      {note ? (
        <p role="alert" className="text-[12.5px] font-medium text-caution">
          {note}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-ink-2">
          {[...visibleKinds.values()].map((v) => (
            <li key={`${v.name}${v.label}`} className="flex items-center gap-2">
              <SeasonMark kind={v.kind} />
              <span>
                {multiTrack ? <span className="font-medium text-ink">{v.name}: </span> : null}
                {v.label}
              </span>
            </li>
          ))}
          {!visibleKinds.size && tracks.length ? <li className="text-ink-3">No season dates on file for this month{tracks.length === 1 ? ` at ${tracks[0].name}` : ''}</li> : null}
          <li className="flex items-center gap-2 text-ink-3">
            <i aria-hidden className="size-1 rounded-full bg-teal" /> Today
          </li>
        </ul>
        {start ? (
          <button type="button" onClick={() => onChange(null, null)} className="inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-ink-2 hover:bg-ink/[0.06] hover:text-ink">
            <X aria-hidden className="size-3.5" /> Clear
          </button>
        ) : null}
      </div>
    </div>
  )
}
