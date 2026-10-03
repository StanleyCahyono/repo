'use client'
/**
 * Range calendar (Glass HUD): tap a start day, then an end day. Built on the shared calendar primitives
 * (ui/date-picker-grid) so it looks and moves like every other calendar in Piste: the range band springs between
 * days, the start and end knobs glide to the day you tap, months slide sideways, nights are counted, and each day
 * carries the season marker of the resorts in view — solid teal for an opened season, light teal for an announced
 * one, a dashed copper rule after a Piste-estimated opening. Markers always come with text (legend + each day's
 * accessible name), never colour alone.
 *
 * Keyboard: arrow keys move by day / week, PageUp / PageDown by month (Shift: year), Home / End to the week's edges;
 * Enter or Space picks. Reduced motion: the band and knobs jump instead of springing (MotionConfig in the shell).
 */
import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { markOn, type SeasonTrack, type SeasonWindowKind } from '@/lib/data/trip-seasons'
import { addMonths, bandRange, daysInMonth, formatDate, monthOf, navigateDate, nightsLabel, nightsOf, pickDay, windowFor, type DateMark } from '@/components/ui/calendar-model'
import { MarkGlyph, MonthGrid, MonthTitle, NavButton, SlidingMonths } from '@/components/ui/date-picker-grid'

export const MARK_TEXT: Record<SeasonWindowKind, string> = {
  opened: 'season opened',
  announced: 'announced season',
  estimate: 'after estimated opening (Piste estimate)',
}

const MARK_STYLE: Record<SeasonWindowKind, Pick<DateMark, 'tone' | 'variant' | 'soft'>> = {
  opened: { tone: 'teal', variant: 'rule' },
  announced: { tone: 'teal', variant: 'rule', soft: true },
  estimate: { tone: 'copper', variant: 'dashed' },
}

/** The little rule drawn under a day number (also used by legends). */
export function SeasonMark({ kind, className, inverted }: { kind: SeasonWindowKind; className?: string; inverted?: boolean }) {
  return <MarkGlyph {...MARK_STYLE[kind]} inverted={inverted} className={className} />
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
  const minMonth = monthOf(floor)
  const maxMonth = addMonths(monthOf(today), 18)
  const ceiling = `${maxMonth}-${String(daysInMonth(maxMonth)).padStart(2, '0')}`
  const [month, setMonth] = useState(initialMonth ?? monthOf(start ?? (today > floor ? today : floor)))
  const [dir, setDir] = useState(1)
  const [hover, setHover] = useState<string | null>(null)
  const [focus, setFocus] = useState<string>(start ?? (today >= floor ? today : floor))
  const [gridFocused, setGridFocused] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const monthDays = useMemo(() => Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`), [month])
  const isDisabled = useCallback((d: string) => d < floor, [floor])
  const marksFor = useCallback(
    (d: string): DateMark[] => {
      const m = markOn(tracks, d)
      return m ? [{ date: d, label: `${m.track.name}: ${MARK_TEXT[m.kind]}`, ...MARK_STYLE[m.kind] }] : []
    },
    [tracks],
  )

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
    setFocus(day)
    if (next.end) setHover(null)
    onChange(next.start, next.end)
  }

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, day: string) => {
    const to = navigateDate(day, e.key, { shift: e.shiftKey, min: floor, max: ceiling })
    if (!to) return
    e.preventDefault()
    const nv = windowFor(to, month, 1)
    if (nv !== month) {
      setDir(nv > month ? 1 : -1)
      setMonth(nv)
    }
    setFocus(to)
    // Focus after the grid re-renders with the new month.
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>(`[data-page="active"] [data-day="${to}"]`)?.focus())
  }

  // The band: the chosen range, or a preview while choosing the end day (pointer hover or keyboard focus).
  const band = bandRange({ start, end }, hover ?? (gridFocused && start && !end ? focus : null))
  const tabbable = monthDays.includes(focus) ? focus : (monthDays.find((d) => d >= floor) ?? monthDays[0])
  const visibleKinds = new Map<string, { kind: SeasonWindowKind; label: string; name: string }>()
  for (const d of monthDays) {
    const m = markOn(tracks, d)
    if (m) visibleKinds.set(`${m.track.resortId}|${m.window.from}`, { kind: m.kind, label: m.window.label, name: m.track.name })
  }
  const multiTrack = tracks.filter((t) => t.windows.length).length > 1

  // Each date stays on one line ("Thu 8 Oct – / Sun 11 Oct", never "Sun / 11 Oct").
  const day = (d: string) => <span className="whitespace-nowrap">{formatDate(d, 'short')}</span>
  const status =
    start && end ? (
      <>
        {day(start)} – {day(end)}
      </>
    ) : start ? (
      <>
        {day(start)} – pick the last day
      </>
    ) : (
      'Pick your dates'
    )

  return (
    <div ref={rootRef} className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="hud text-ink-2">{label}</p>
          <p aria-live="polite" className="mt-1 font-display text-[22px] leading-tight font-light tracking-[-0.02em] text-ink tnum md:text-[24px]">
            {status}
            {start && end ? <span className="mt-0.5 block font-sans text-[13px] font-normal tracking-normal text-ink-2">{nightsLabel(start, end)}</span> : null}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <NavButton dir={-1} disabled={month <= minMonth} onClick={() => go(-1)} density="large" />
          <NavButton dir={1} disabled={month >= maxMonth} onClick={() => go(1)} density="large" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <MonthTitle month={month} id={`${uid}-month`} />
        <p className="text-right text-[12.5px] text-ink-2">{start && !end ? 'Now tap the last day' : 'Tap a start day, then an end day'}</p>
      </div>

      <div
        onFocus={() => setGridFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setGridFocused(false)
        }}
      >
        <SlidingMonths pageKey={month} dir={dir} scope={uid}>
          <MonthGrid
            month={month}
            today={today}
            range={{ start, end }}
            band={band}
            tabbable={tabbable}
            isDisabled={isDisabled}
            marksFor={tracks.length ? marksFor : undefined}
            describeDay={(_, s) => [s.rangeStart ? 'trip start' : null, s.rangeEnd ? 'trip end' : null]}
            onPick={pick}
            onDayKeyDown={onKey}
            onDayFocus={setFocus}
            onDayHover={start && !end ? setHover : undefined}
            density="regular"
            labelledBy={`${uid}-month`}
            fixedRows={false}
          />
        </SlidingMonths>
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
            <i aria-hidden className="size-3 rounded-full shadow-[inset_0_0_0_1.5px_var(--teal)]" /> Today
          </li>
        </ul>
        {start ? (
          <button type="button" onClick={() => onChange(null, null)} className="inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-ink-2 hover:bg-chip-hover hover:text-ink">
            <X aria-hidden className="size-3.5" /> Clear
          </button>
        ) : null}
      </div>
    </div>
  )
}
