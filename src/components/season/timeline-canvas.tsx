'use client'
/**
 * The drawing of the season timeline, in the calendar's language: month columns with Geist Mono labels and soft
 * alternating bands, trips as range pills (booked: the calendar's teal band; draft: its dashed preview band), ski days
 * as round day dots (pass days ringed, pass days not yet in the journal hollow), lessons as small copper tiles, and
 * today as a teal rule under a "Today" chip that has its own row — so no label ever sits on another label or on the
 * today rule. Trip names go inside their pill when they fit, else into a label row under the lane (two rows at most,
 * placed so they never collide), linked to their pill by a short tick.
 *
 * Decorative (aria-hidden): the figure's list carries every fact. Phones scroll it sideways (it keeps a readable
 * minimum width) and start scrolled to today. Entrances: pills grow from their first day, dots pop in, the today rule
 * draws down — once, when the timeline scrolls into view; reduced motion shows it all at once.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { GraduationCap } from 'lucide-react'
import type { SeasonTimeline as Timeline } from '@/lib/data/season-screen'
import { addDays, daysBetween, formatLocalDate } from '@/lib/domain/time'
import { cn } from '@/lib/ui/cn'
import { EASE_OUT, t } from '@/lib/ui/motion'
import { useWidth } from '@/components/charts/use-width'
import { useScrollEdges } from '@/lib/ui/use-scroll-edges'
import { dayLabel, rangeLabel } from './format'
import { useReveal } from './reveal'

const MIN_W = 620
/** Row geometry (px). */
const ROW = { today: 26, months: 22, trips: 26, labels: 20, days: 26, lessons: 26 }
const GAP = 6

function monthStarts(from: string, to: string): string[] {
  const out: string[] = []
  let m = `${from.slice(0, 7)}-01`
  while (m <= to) {
    out.push(m)
    m = `${addDays(m, 32).slice(0, 7)}-01`
  }
  return out
}

let measureCtx: CanvasRenderingContext2D | null | undefined
function textWidth(s: string, font: string): number {
  if (measureCtx === undefined) measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  if (!measureCtx) return s.length * 6.8
  measureCtx.font = font
  return measureCtx.measureText(s).width
}

interface PlacedTrip {
  id: string
  name: string
  left: number
  width: number
  booked: boolean
  past: boolean
  range: string
  label: { where: 'inside' } | { where: 'row'; row: 0 | 1; x: number; w: number; text: string } | null
}

export function TimelineCanvas({ tl }: { tl: Timeline }) {
  const [measureRef, measured] = useWidth<HTMLDivElement>()
  const scrollRef = useRef<HTMLDivElement>(null)
  useScrollEdges(scrollRef)
  const [revealRef, phase] = useReveal<HTMLDivElement>()
  const [font, setFont] = useState<string | null>(null)

  const total = daysBetween(tl.from, tl.to) + 1
  const frac = (d: string) => Math.min(Math.max(daysBetween(tl.from, d), 0), total - 1) / total
  const mid = (d: string) => frac(d) + 0.5 / total
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`
  const months = useMemo(() => monthStarts(tl.from, tl.to), [tl.from, tl.to])
  const days = tl.marks.filter((m) => m.kind === 'day')
  const lessons = tl.marks.filter((m) => m.kind === 'lesson')
  const showToday = tl.today >= tl.from && tl.today <= tl.to
  const width = measured ?? null

  // The page font, for measuring trip names (Geist is self-hosted, so read it from the element).
  useEffect(() => {
    const el = scrollRef.current
    if (el) setFont(`500 12px ${getComputedStyle(el).fontFamily}`)
  }, [])

  // Phones: start scrolled so today (or the first mark) is in view.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || el.scrollWidth <= el.clientWidth + 1) return
    const focus = showToday ? tl.today : (tl.marks[0]?.date ?? tl.trips[0]?.startDate ?? null)
    if (!focus) return
    el.scrollLeft = Math.max(0, mid(focus) * el.scrollWidth - el.clientWidth / 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, [])

  const trips: PlacedTrip[] = useMemo(() => {
    const sorted = [...tl.trips].sort((a, b) => a.startDate.localeCompare(b.startDate))
    const ends: [number, number] = [-Infinity, -Infinity]
    return sorted.map((tr) => {
      const left = frac(tr.startDate)
      const span = (Math.min(daysBetween(tr.startDate, tr.endDate), total - 1) + 1) / total
      const placed: PlacedTrip = {
        id: tr.id,
        name: tr.name,
        left,
        width: span,
        booked: tr.status === 'booked' || tr.status === 'done',
        past: tr.endDate < tl.today,
        range: rangeLabel(tr.startDate, tr.endDate),
        label: null,
      }
      if (!width || !font) return placed
      const x0 = left * width
      const barW = Math.max(10, span * width)
      const tw = Math.ceil(textWidth(tr.name, font)) + 14
      if (barW >= tw + 6) {
        placed.label = { where: 'inside' }
        return placed
      }
      // A label row: start at the pill, nudged right past the previous label and pulled back inside the edge.
      for (const row of [0, 1] as const) {
        let x = Math.max(x0, ends[row] + 8)
        if (x + tw > width) x = width - tw
        if (x >= ends[row] + 8 && x <= x0 + barW) {
          ends[row] = x + tw
          placed.label = { where: 'row', row, x: x / width, w: tw / width, text: tr.name }
          return placed
        }
      }
      // No clean room: a shortened name in the freer row, or none (the tooltip and the list still have it).
      const row: 0 | 1 = ends[0] <= ends[1] ? 0 : 1
      const x = Math.max(x0, ends[row] + 8)
      const room = Math.min(width - x, 220)
      if (room >= 56) {
        ends[row] = x + room
        placed.label = { where: 'row', row, x: x / width, w: room / width, text: tr.name }
      }
      return placed
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- frac/total derive from tl
  }, [tl.trips, tl.today, tl.from, tl.to, width, font])

  const labelRows = trips.some((p) => p.label?.where === 'row' && p.label.row === 1) ? 2 : trips.some((p) => p.label?.where === 'row') ? 1 : 0
  // The today chip has its own row only when today falls inside the season window.
  const todayRow = showToday ? ROW.today : 0
  const top = {
    months: todayRow,
    trips: todayRow + ROW.months + GAP,
  }
  const labelsTop = top.trips + ROW.trips + 4
  const daysTop = labelsTop + labelRows * ROW.labels + (labelRows ? GAP : 0)
  const lessonsTop = daysTop + ROW.days + GAP / 2
  const height = lessonsTop + ROW.lessons + 4
  const armed = phase === 'armed'
  const todayX = showToday ? mid(tl.today) : 0
  // Today chip: centred on the rule, kept inside the frame.
  const chipText = `Today · ${formatLocalDate(tl.today, 'd LLL')}`
  const chipW = width && font ? (textWidth(chipText, font.replace('500', '600')) + 22) / width : 0.1
  const chipLeft = Math.min(Math.max(todayX - chipW / 2, 0), 1 - chipW)
  // A month label the today rule would cross moves just past the rule.
  const monthLabelOffset = (l: number) => {
    if (!showToday || !width) return 8
    const x = l * width + 8
    const rule = todayX * width
    return rule >= x - 6 && rule <= x + 40 ? rule - l * width + 7 : 8
  }

  return (
    <div ref={revealRef} className="relative mt-4">
      <div ref={scrollRef} className="scroll-fade-x -mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div ref={measureRef} aria-hidden className="relative select-none" style={{ minWidth: MIN_W, height }}>
          {/* Month columns: alternating soft bands, a hairline at each month start, mono labels. */}
          {months.map((m, i) => {
            const l = Math.max(0, daysBetween(tl.from, m)) / total
            const next = months[i + 1]
            const r = next ? Math.max(0, daysBetween(tl.from, next)) / total : 1
            const current = m.slice(0, 7) === tl.today.slice(0, 7)
            return (
              <div key={m} className="absolute bottom-0" style={{ left: pct(l), width: pct(r - l), top: top.months }}>
                <div className={cn('absolute inset-0 rounded-[12px]', i % 2 ? 'bg-chip-track/45' : 'bg-transparent')} />
                <div className="absolute inset-y-0 left-0 w-px bg-divider" />
                <span className={cn('hud absolute top-1 whitespace-nowrap', current ? 'text-teal' : 'text-ink-3')} style={{ left: monthLabelOffset(l) }}>
                  {formatLocalDate(m, 'LLL')}
                </span>
              </div>
            )
          })}

          {/* Today: the rule under its chip (drawn first, so marks and labels sit above it). */}
          {showToday ? (
            <>
              <motion.div
                className="absolute w-[1.5px] origin-top rounded-full bg-teal"
                style={{ left: `calc(${pct(todayX)} - 0.75px)`, top: ROW.today - 2, bottom: 0 }}
                initial={false}
                animate={armed ? { scaleY: 0, opacity: 0 } : { scaleY: 1, opacity: 1 }}
                transition={armed ? { duration: 0 } : { duration: 0.5, ease: EASE_OUT, delay: 0.15 }}
              />
              <motion.span
                className="absolute top-0 inline-flex h-[22px] items-center justify-center rounded-full border border-teal/60 bg-surface px-2.5 text-[12px] font-semibold whitespace-nowrap text-teal tnum shadow-[0_4px_12px_-6px_rgb(19_32_44/0.35)]"
                style={{ left: pct(chipLeft), width: pct(chipW) }}
                initial={false}
                animate={armed ? { opacity: 0, y: -4 } : { opacity: 1, y: 0 }}
                transition={armed ? { duration: 0 } : { ...t.pageIn, delay: 0.1 }}
              >
                {chipText}
              </motion.span>
            </>
          ) : null}

          {/* Trips: range pills (the calendar's band), names inside or in the label rows below. */}
          {trips.map((p, i) => (
            <div key={p.id} title={`${p.name} · ${p.range}`}>
              <motion.div
                className={cn(
                  'absolute flex origin-left items-center overflow-hidden rounded-full px-2.5',
                  // Opaque tints (teal mixed into the surface), so the today rule never shows through a name.
                  p.booked
                    ? 'bg-[color-mix(in_srgb,var(--teal)_16%,var(--surface))] text-teal shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--teal)_45%,transparent)]'
                    : 'border border-dashed border-teal/50 bg-[color-mix(in_srgb,var(--teal)_6%,var(--surface))] text-ink-2',
                  p.past && 'opacity-70',
                )}
                style={{ left: pct(p.left), width: `max(10px, ${pct(p.width)})`, top: top.trips, height: ROW.trips }}
                initial={false}
                animate={armed ? { scaleX: 0, opacity: 0 } : { scaleX: 1, opacity: p.past ? 0.7 : 1 }}
                transition={armed ? { duration: 0 } : { duration: 0.45, ease: EASE_OUT, delay: 0.2 + i * 0.06 }}
              >
                {p.label?.where === 'inside' ? <span className="truncate text-[12px] font-medium whitespace-nowrap">{p.name}</span> : null}
              </motion.div>
              {p.label?.where === 'row' ? (
                <motion.div
                  className="absolute"
                  style={{ left: pct(p.label.x), width: pct(p.label.w), top: labelsTop + p.label.row * ROW.labels, height: ROW.labels }}
                  initial={false}
                  animate={armed ? { opacity: 0 } : { opacity: 1 }}
                  transition={armed ? { duration: 0 } : { duration: 0.25, delay: 0.45 + i * 0.06 }}
                >
                  {/* Tick from a first-row label up to its pill (second-row labels would cross the first row). */}
                  {p.label.row === 0 ? (
                    <span
                      className="absolute bottom-full h-1 w-px bg-teal/50"
                      style={{ left: `${((Math.min(Math.max(p.left + p.width / 2, p.label.x + 0.006), p.label.x + p.label.w - 0.006) - p.label.x) / p.label.w) * 100}%` }}
                    />
                  ) : null}
                  <span className={cn('relative inline-flex h-full max-w-full items-center rounded-full bg-surface px-1.5 text-[12px] font-medium whitespace-nowrap', p.booked ? 'text-teal' : 'text-ink-2')}>
                    <span className="truncate">{p.label.text}</span>
                  </span>
                </motion.div>
              ) : null}
            </div>
          ))}

          {/* Ski days lane. */}
          <div className="absolute inset-x-0 border-t border-dashed border-divider" style={{ top: daysTop + ROW.days / 2 }} />
          {days.map((d, i) => (
            <motion.span
              key={`${d.date}-${d.resortId}`}
              title={`${dayLabel(d.date)} · ${d.label}${d.kind === 'day' && d.pass ? ' · pass day' : ''}`}
              className={cn(
                'absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2',
                d.kind === 'day' && d.logId === null ? 'border-teal bg-surface' : 'border-surface bg-teal shadow-[0_2px_6px_-2px_rgb(19_32_44/0.4)]',
                d.kind === 'day' && d.pass && d.logId !== null && 'ring-2 ring-teal/35',
              )}
              style={{ left: pct(mid(d.date)), top: daysTop + ROW.days / 2 }}
              initial={false}
              animate={armed ? { scale: 0, opacity: 0 } : { scale: 1, opacity: 1 }}
              transition={armed ? { duration: 0 } : { ...t.spring, delay: 0.3 + Math.min(i, 12) * 0.04 }}
            />
          ))}

          {/* Lessons lane. */}
          {lessons.map((l, i) => (
            <motion.span
              key={`${l.date}-${l.resortId}`}
              title={`Lesson · ${dayLabel(l.date)} · ${l.label}`}
              className={cn(
                'absolute inline-flex size-[20px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[6px] border bg-surface text-copper',
                l.kind === 'lesson' && l.upcoming ? 'border-dashed border-copper' : 'border-copper/60',
              )}
              style={{ left: pct(mid(l.date)), top: lessonsTop + ROW.lessons / 2 }}
              initial={false}
              animate={armed ? { scale: 0, opacity: 0 } : { scale: 1, opacity: 1 }}
              transition={armed ? { duration: 0 } : { ...t.spring, delay: 0.4 + Math.min(i, 8) * 0.05 }}
            >
              <GraduationCap className="size-3" strokeWidth={2} />
            </motion.span>
          ))}
        </div>
      </div>
    </div>
  )
}
