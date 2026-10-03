'use client'
/**
 * Calendar primitives shared by every calendar in Piste (ui/date-picker and trips/range-calendar), so they all speak
 * one visual language: round day pills, a dark HUD-chip knob that glides to the picked day (shared layoutId), a soft
 * teal range band that springs between days, today ringed in teal, disabled days dimmed and struck, marks drawn
 * under the number (with their text in the day's accessible name and in a legend), Geist Mono weekday labels, and
 * months that slide sideways when you page through them.
 *
 * Semantics: role="grid" per month, a header row of columnheaders, role="row"/"gridcell", aria-selected on the cell,
 * aria-current="date" on today. The caller owns the roving tab stop (`tabbable`) and the key handling. Everything
 * here is transform/opacity motion and collapses under reduced motion (MotionConfig in the shell).
 *
 * No Next-only APIs: this file is bundled into the single-file build too.
 */
import { useMemo, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { AnimatePresence, LayoutGroup, motion, useIsPresent, type PanInfo } from 'motion/react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import {
  addMonths,
  bandSegment,
  formatDate,
  monthGrid,
  monthName,
  weekdayHeaders,
  type DateMark,
  type MarkTone,
  type MarkVariant,
  type WeekStart,
} from './calendar-model'

/** compact: 40px pills (popovers) · regular: 44px (inline calendars) · large: 48px (phone sheets). */
export type CalendarDensity = 'compact' | 'regular' | 'large'

export const DENSITY: Record<CalendarDensity, { px: number; pill: string; row: string; text: string; head: string }> = {
  compact: { px: 40, pill: 'size-10', row: 'h-10', text: 'text-[14px]', head: 'h-8' },
  regular: { px: 44, pill: 'size-11', row: 'h-11', text: 'text-[14.5px]', head: 'h-8' },
  large: { px: 48, pill: 'size-12', row: 'h-12', text: 'text-[16px]', head: 'h-9' },
}

/** The knob and band glide (selection glide ≈ 200ms; a spring so it settles softly). */
export const GLIDE = t.spring

const TONE: Record<MarkTone, string> = {
  teal: 'var(--teal)',
  copper: 'var(--copper)',
  positive: 'var(--positive)',
  caution: 'var(--caution)',
  critical: 'var(--critical)',
  info: 'var(--info)',
  demo: 'var(--demo)',
  ink: 'var(--ink-3)',
}

/** The small glyph of a mark: a dot, a rule or a dashed rule (also used in legends). */
export function MarkGlyph({ tone = 'teal', variant = 'dot', soft, inverted, className }: { tone?: MarkTone; variant?: MarkVariant; soft?: boolean; inverted?: boolean; className?: string }) {
  const color = inverted ? 'var(--on-ink-chip-accent)' : TONE[tone]
  return (
    <i
      aria-hidden
      className={cn('block shrink-0 rounded-full', variant === 'dot' ? 'size-[5px]' : 'h-[3px] w-3.5', soft && 'opacity-50', className)}
      style={{ background: variant === 'dashed' ? `repeating-linear-gradient(90deg, ${color} 0 2px, transparent 2px 4px)` : color }}
    />
  )
}

/** Legend of the marks in view — marks never rely on colour alone. */
export function MarkLegend({ marks, className, extra }: { marks: readonly Pick<DateMark, 'label' | 'tone' | 'variant' | 'soft'>[]; className?: string; extra?: ReactNode }) {
  if (!marks.length && !extra) return null
  return (
    <ul className={cn('flex min-w-0 flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] leading-snug text-ink-2', className)}>
      {marks.map((m) => (
        <li key={`${m.label}|${m.tone}|${m.variant}|${m.soft}`} className="flex min-w-0 items-center gap-2">
          <MarkGlyph tone={m.tone} variant={m.variant} soft={m.soft} />
          <span className="min-w-0">{m.label}</span>
        </li>
      ))}
      {extra}
    </ul>
  )
}

/** Round prev/next month button (glass-strong pill). */
export function NavButton({ dir, disabled, onClick, label, density = 'compact' }: { dir: -1 | 1; disabled?: boolean; onClick: () => void; label?: string; density?: CalendarDensity }) {
  const Icon = dir < 0 ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      aria-label={label ?? (dir < 0 ? 'Previous month' : 'Next month')}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'glass-strong inline-flex shrink-0 items-center justify-center rounded-full text-ink transition-[transform,opacity,box-shadow] duration-150 ease-[var(--ease-out-soft)]',
        'not-disabled:hover:-translate-y-px not-disabled:active:scale-95 disabled:opacity-35 disabled:shadow-none',
        density === 'large' ? 'size-11' : 'size-9',
      )}
    >
      <Icon aria-hidden className={density === 'large' ? 'size-5' : 'size-[18px]'} />
    </button>
  )
}

/**
 * Month title in Geist Light ("January 2027"). With `onClick` it is a button that opens the month / year chooser; the
 * chevron turns while it is open.
 */
export function MonthTitle({ month, id, onClick, expanded, density = 'compact', className }: { month: string; id?: string; onClick?: () => void; expanded?: boolean; density?: CalendarDensity; className?: string }) {
  const text = (
    <>
      <span className="text-ink">{monthName(month)}</span> <span className="text-ink-3">{month.slice(0, 4)}</span>
    </>
  )
  const size = density === 'large' ? 'text-[22px]' : 'text-[19px]'
  if (!onClick) {
    return (
      <p id={id} className={cn('font-display leading-none font-light tracking-[-0.02em] tnum', size, className)}>
        {text}
      </p>
    )
  }
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      aria-expanded={expanded}
      className={cn(
        'group/title -mx-2 inline-flex h-9 items-center gap-1.5 rounded-full px-2 font-display leading-none font-light tracking-[-0.02em] tnum transition-colors duration-150 hover:bg-chip-hover',
        size,
        className,
      )}
    >
      <span>{text}</span>
      <ChevronDown aria-hidden className={cn('size-4 text-ink-3 transition-transform duration-200 ease-[var(--ease-out-soft)]', expanded && 'rotate-180')} />
    </button>
  )
}

/** Weekday header row (Geist Mono HUD labels; weekend columns in teal). Lives inside the grid. */
function WeekdayRow({ weekStartsOn, density }: { weekStartsOn: WeekStart; density: CalendarDensity }) {
  const heads = weekdayHeaders(weekStartsOn)
  return (
    <div role="row" className="grid grid-cols-7">
      {heads.map((h) => (
        <span key={h.long} role="columnheader" aria-label={h.long} className={cn('hud flex items-center justify-center', DENSITY[density].head, h.weekend ? 'text-teal' : 'text-ink-3')}>
          {h.short}
        </span>
      ))}
    </div>
  )
}

export interface DayState {
  today: boolean
  disabled: boolean
  /** The single selected day, or either end of a range. */
  selected: boolean
  rangeStart: boolean
  rangeEnd: boolean
  /** Inside a complete range (ends included). */
  inRange: boolean
}

export interface MonthGridProps {
  /** 'YYYY-MM'. */
  month: string
  weekStartsOn?: WeekStart
  today?: string | null
  /** Single-date selection. */
  selected?: string | null
  /** Range selection (start may be set alone while the end is being picked). */
  range?: { start: string | null; end: string | null }
  /** Band to draw: the range, or a dashed preview while choosing the end. */
  band?: { from: string; to: string; preview: boolean } | null
  /** The day holding the roving tab stop, when it is in this month. */
  tabbable?: string | null
  isDisabled: (day: string) => boolean
  marksFor?: (day: string) => readonly DateMark[]
  /** Extra words for a day's accessible name ("trip start", "Alta: season opened"). */
  describeDay?: (day: string, state: DayState) => (string | null | undefined)[] | null
  onPick: (day: string) => void
  onDayKeyDown?: (e: KeyboardEvent<HTMLButtonElement>, day: string) => void
  onDayFocus?: (day: string) => void
  onDayHover?: (day: string | null) => void
  density?: CalendarDensity
  /** id of the month title that labels the grid. */
  labelledBy: string
  /** Always draw six week rows so the panel never changes height between months. */
  fixedRows?: boolean
  className?: string
}

/** One month: weekday row + week rows with the range band, knobs, today ring and marks. */
export function MonthGrid({
  month,
  weekStartsOn = 1,
  today,
  selected,
  range,
  band,
  tabbable,
  isDisabled,
  marksFor,
  describeDay,
  onPick,
  onDayKeyDown,
  onDayFocus,
  onDayHover,
  density = 'compact',
  labelledBy,
  fixedRows = true,
  className,
}: MonthGridProps) {
  const weeks = useMemo(() => monthGrid(month, weekStartsOn), [month, weekStartsOn])
  const d = DENSITY[density]
  const start = range ? range.start : (selected ?? null)
  const end = range ? range.end : (selected ?? null)
  const complete = !!(range?.start && range?.end)
  const inset = `(100% / 7 - ${d.px}px) / 2`
  return (
    <div role="grid" aria-labelledby={labelledBy} className={cn('flex flex-col gap-0.5', className)} onPointerLeave={() => onDayHover?.(null)}>
      <WeekdayRow weekStartsOn={weekStartsOn} density={density} />
      {weeks.map((week, wi) => {
        const seg = band && band.from !== band.to ? bandSegment(week, band.from, band.to) : null
        return (
          <div key={wi} role="row" className="relative grid grid-cols-7">
            {seg ? (
              <motion.span
                layout
                layoutId={`band-${month}-${wi}`}
                aria-hidden
                transition={GLIDE}
                className={cn('absolute inset-y-0', band!.preview ? 'border border-dashed border-teal/50 bg-teal/[0.07]' : 'bg-teal/[0.16]')}
                style={{
                  left: `calc(${seg.c0} * 100% / 7 + ${seg.startsHere ? inset : '0px'})`,
                  right: `calc(${6 - seg.c1} * 100% / 7 + ${seg.endsHere ? inset : '0px'})`,
                  // Round where the range starts / ends; a softer corner where it carries on to the next row.
                  borderTopLeftRadius: seg.startsHere ? d.px / 2 : 8,
                  borderBottomLeftRadius: seg.startsHere ? d.px / 2 : 8,
                  borderTopRightRadius: seg.endsHere ? d.px / 2 : 8,
                  borderBottomRightRadius: seg.endsHere ? d.px / 2 : 8,
                }}
              />
            ) : null}
            {week.map((day, ci) => {
              if (!day) return <span key={ci} role="gridcell" className={d.row} />
              const isStart = day === start
              const isEnd = day === end
              const state: DayState = {
                today: day === today,
                disabled: isDisabled(day),
                selected: isStart || isEnd,
                rangeStart: !!range && isStart,
                rangeEnd: !!range && isEnd,
                inRange: complete && day >= range!.start! && day <= range!.end!,
              }
              const marks = marksFor?.(day) ?? []
              const name = [
                formatDate(day, 'full'),
                state.today ? 'today' : null,
                range ? (isStart && isEnd && complete ? 'selected' : isStart ? (complete ? 'start of range' : 'start of range, choose the last day') : isEnd ? 'end of range' : state.inRange ? 'in range' : null) : state.selected ? 'selected' : null,
                ...(describeDay?.(day, state) ?? []),
                ...marks.map((m) => m.label),
                state.disabled ? 'unavailable' : null,
              ]
                .filter(Boolean)
                .join(', ')
              const knob = state.selected ? (isStart ? 'knob-a' : 'knob-b') : null
              return (
                <span key={day} role="gridcell" aria-selected={state.selected || state.inRange} className={cn('relative flex items-center justify-center', d.row)}>
                  <button
                    type="button"
                    data-day={day}
                    tabIndex={day === tabbable ? 0 : -1}
                    aria-label={name}
                    aria-current={state.today ? 'date' : undefined}
                    aria-disabled={state.disabled || undefined}
                    onClick={() => (state.disabled ? undefined : onPick(day))}
                    onKeyDown={onDayKeyDown ? (e) => onDayKeyDown(e, day) : undefined}
                    onFocus={onDayFocus ? () => onDayFocus(day) : undefined}
                    onPointerEnter={onDayHover ? () => onDayHover(day) : undefined}
                    className={cn(
                      'relative flex shrink-0 items-center justify-center rounded-full font-medium tnum outline-offset-2 select-none',
                      'transition-[background-color,color,transform,box-shadow] duration-150 ease-[var(--ease-out-soft)]',
                      d.pill,
                      d.text,
                      state.disabled
                        ? 'cursor-not-allowed text-ink-3/50 line-through decoration-ink-3/60 decoration-[1.5px]'
                        : state.selected
                          ? 'text-on-ink-chip active:scale-95'
                          : cn('active:scale-95', state.inRange ? 'text-ink hover:bg-teal/15' : 'text-ink hover:bg-chip-hover'),
                      state.today && !state.selected && !state.disabled && 'font-semibold text-teal shadow-[inset_0_0_0_1.5px_var(--teal)]',
                      state.today && !state.selected && state.disabled && 'shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--teal)_45%,transparent)]',
                    )}
                  >
                    {knob ? (
                      <motion.span
                        layoutId={knob}
                        aria-hidden
                        transition={GLIDE}
                        className={cn(
                          'absolute inset-0 rounded-full bg-ink-chip',
                          state.today ? 'shadow-[0_0_0_2px_var(--surface),0_0_0_3.5px_var(--teal),0_8px_18px_-8px_rgb(19_32_44/0.55)]' : 'shadow-[0_8px_18px_-8px_rgb(19_32_44/0.55)]',
                        )}
                        style={{ borderRadius: d.px / 2 }}
                      />
                    ) : null}
                    <span className={cn('relative', state.selected && 'font-semibold')}>{Number(day.slice(8))}</span>
                    {marks.length ? (
                      <span aria-hidden className={cn('absolute left-1/2 flex -translate-x-1/2 items-center gap-[3px]', density === 'large' ? 'bottom-[7px]' : 'bottom-[5px]', state.disabled && 'opacity-60')}>
                        {marks.slice(0, 3).map((m, i) => (
                          <MarkGlyph key={i} tone={m.tone} variant={m.variant} soft={m.soft} inverted={state.selected} className={marks.length > 1 && m.variant !== 'dot' ? 'w-2' : undefined} />
                        ))}
                      </span>
                    ) : null}
                  </button>
                </span>
              )
            })}
          </div>
        )
      })}
      {fixedRows ? Array.from({ length: 6 - weeks.length }, (_, i) => <div key={`pad${i}`} aria-hidden className={d.row} />) : null}
    </div>
  )
}

const pageVariants = {
  enter: (dir: number) => ({ x: dir * 40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir * -40, opacity: 0 }),
}

function Page({ ref, dir, scope, children }: { ref?: Ref<HTMLDivElement>; dir: number; scope: string; children: ReactNode }) {
  const present = useIsPresent()
  return (
    <motion.div ref={ref} custom={dir} variants={pageVariants} initial="enter" animate="center" exit="exit" transition={t.pageIn} inert={!present} data-page={present ? 'active' : 'exiting'}>
      <LayoutGroup id={scope}>{children}</LayoutGroup>
    </motion.div>
  )
}

/**
 * Slides month pages sideways (direction-aware) when `pageKey` changes. Each page gets its own layout scope so knobs
 * and bands glide within a page but never across the outgoing and incoming months. On touch (`onSwipe`), a horizontal
 * swipe pages too; vertical scrolling stays native.
 */
export function SlidingMonths({ pageKey, dir, scope, children, onSwipe, className }: { pageKey: string; dir: number; scope: string; children: ReactNode; onSwipe?: (dir: -1 | 1) => void; className?: string }) {
  const onPanEnd = onSwipe
    ? (_: PointerEvent, info: PanInfo) => {
        if (Math.abs(info.offset.x) > 48 && Math.abs(info.offset.x) > Math.abs(info.offset.y) * 1.4) onSwipe(info.offset.x < 0 ? 1 : -1)
      }
    : undefined
  return (
    // Padding + negative margin keep the 2px focus ring of edge days inside the clip.
    <motion.div className={cn('relative -m-1.5 overflow-hidden p-1.5', className)} onPanEnd={onPanEnd} style={onSwipe ? { touchAction: 'pan-y' } : undefined}>
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <Page key={pageKey} dir={dir} scope={`${scope}-${pageKey}`}>
          {children}
        </Page>
      </AnimatePresence>
    </motion.div>
  )
}

/**
 * Month / year chooser (opened from the month title): a year stepper and a 3 × 4 grid of months. Months outside
 * min/max are disabled; the current month is ringed, the selected month is the dark chip. Arrow keys move between
 * months.
 */
export function MonthYearChooser({
  year,
  onYear,
  canYear,
  isMonthDisabled,
  selectedMonth,
  currentMonth,
  onPick,
  density = 'compact',
}: {
  year: number
  onYear: (year: number) => void
  canYear: (year: number) => boolean
  isMonthDisabled: (ym: string) => boolean
  selectedMonth?: string | null
  currentMonth?: string | null
  onPick: (ym: string) => void
  density?: CalendarDensity
}) {
  const months = Array.from({ length: 12 }, (_, i) => addMonths(`${year}-01`, i))
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className={cn('font-display font-light tracking-[-0.02em] text-ink tnum', density === 'large' ? 'text-[26px]' : 'text-[22px]')} aria-live="polite">
          {year}
        </p>
        <div className="flex gap-1.5">
          <NavButton dir={-1} label="Previous year" disabled={!canYear(year - 1)} onClick={() => onYear(year - 1)} density={density} />
          <NavButton dir={1} label="Next year" disabled={!canYear(year + 1)} onClick={() => onYear(year + 1)} density={density} />
        </div>
      </div>
      <div
        role="group"
        aria-label={`Months of ${year}`}
        className="grid grid-cols-3 gap-2"
        onKeyDown={(e) => {
          const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[e.key]
          if (!step) return
          const btns = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
          const i = btns.indexOf(document.activeElement as HTMLButtonElement)
          if (i < 0) return
          e.preventDefault()
          btns[Math.max(0, Math.min(11, i + step))]?.focus()
        }}
      >
        {months.map((ym) => {
          const off = isMonthDisabled(ym)
          const on = ym === selectedMonth
          const now = ym === currentMonth
          return (
            <button
              key={ym}
              type="button"
              disabled={off}
              aria-pressed={on}
              aria-current={now ? 'date' : undefined}
              aria-label={`${monthName(ym)} ${year}`}
              onClick={() => onPick(ym)}
              className={cn(
                'inline-flex items-center justify-center rounded-full font-medium transition-[background-color,color,transform] duration-150 ease-[var(--ease-out-soft)] not-disabled:active:scale-95',
                density === 'large' ? 'h-14 text-[16px]' : 'h-12 text-[14.5px]',
                on ? 'bg-ink-chip text-on-ink-chip shadow-[0_8px_18px_-8px_rgb(19_32_44/0.55)]' : off ? 'text-ink-3/50 line-through' : 'bg-chip-track text-ink hover:bg-chip-hover',
                now && !on && 'text-teal shadow-[inset_0_0_0_1.5px_var(--teal)]',
              )}
            >
              {monthName(ym, 'short')}
            </button>
          )
        })}
      </div>
    </div>
  )
}
