'use client'
/**
 * Synchronised time-series panels with one precise scrubber.
 *
 *   <TimeChart times={stamps} ticks={ticks} days={days} active={i} onActiveChange={setI}
 *              label="48-hour forecast, Alta" valueText={(i) => '…'}>
 *     <TimePanel title="Snowfall" unit="in" series={[{ type: 'bars', … }]} />
 *     <TimePanel title="Temperature" unit="°F" series={[{ type: 'line', … }]} refLines={[…]} />
 *     <TimeAxis />
 *   </TimeChart>
 *
 * - TimeChart measures its width once for all panels, owns the shared x-scale (UTC ms) and renders ONE scrubber over
 *   the stack: an ARIA slider operable by pointer (hover, drag, touch drag — vertical page scroll still works) and
 *   keyboard (←/→ one step, PageUp/PageDown `pageStep`, Home/End). `valueText(i)` is what screen readers announce.
 * - Each panel has its own y-scale and unit (one unit per panel — never a dual axis). Axes stay put: moving the
 *   scrubber only glides the crosshair and markers (t.select, 200 ms; instant under reduced motion).
 * - Unknown values (null) break lines and show as hatched "not provided" slots under bars; a panel whose series are
 *   all unknown renders its `empty` message instead of an empty plot. Unknown is never drawn as zero.
 * - Bars reveal once (t.bars) on first paint only.
 */
import { createContext, useContext, useEffect, useId, useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { area as d3Area, curveMonotoneX, line as d3Line } from 'd3-shape'
import { scaleLinear, type ScaleLinear } from 'd3-scale'
import type { DataKind } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'
import { t as motionT } from '@/lib/ui/motion'
import { Legend, type LegendItem, type SwatchShape } from './legend'
import { clampIndex, linearTicks, nearestIndex, placeDayLabels, placeTickLabels, valueDomain, type DayMark, type DomainOptions, type TimeTick } from './scale'
import { DASH, TONES, type LineStyle, type Tone } from './tones'
import { useWidth } from './use-width'

// ---------------------------------------------------------------------------
// Types

export interface TimePoint {
  /** UTC ms. */
  t: number
  /** Display-unit value; null = not provided (never plotted as 0). */
  v: number | null
}

export interface TimeBar {
  /** Interval [t0, t1) in UTC ms the value accumulates over (see `hourInterval`). */
  t0: number
  t1: number
  v: number | null
  /** Snap stamp the bar belongs to (highlighted when the scrubber sits on it). Default `t1`. */
  at?: number
}

interface SeriesBase {
  id: string
  label: string
  tone: Tone
  /** Evidence kind — shown in the legend. */
  kind?: DataKind
}

export interface LineSeries extends SeriesBase {
  type: 'line'
  points: TimePoint[]
  style?: LineStyle
  /** Draw points only (reported observations: no invented line between them). */
  pointsOnly?: boolean
}

export interface AreaSeries extends SeriesBase {
  type: 'area'
  points: TimePoint[]
  style?: LineStyle
}

export interface BandSeries extends SeriesBase {
  type: 'band'
  lower: TimePoint[]
  upper: TimePoint[]
  /** Label of the upper edge (e.g. "Gusts") for legends and markers. */
  upperLabel?: string
}

export interface BarSeries extends SeriesBase {
  type: 'bars'
  bars: TimeBar[]
}

export type TimeSeries = LineSeries | AreaSeries | BandSeries | BarSeries

export interface TimeShade {
  from: number
  to: number
  /**
   * night: darker hours band (canvas tone — place charts on a surface panel so it shows in both themes) ·
   * trend: hatched, less certain · past: already happened.
   */
  kind: 'night' | 'trend' | 'past'
}

export interface RefLine {
  value: number
  label: string
  /** Extend the y-domain so the line is always visible. Default true. */
  include?: boolean
  tone?: Extract<Tone, 'ink-3' | 'teal' | 'copper'>
  style?: LineStyle
}

export interface YOptions extends DomainOptions {
  /** Fixed domain (skips auto-ranging). */
  domain?: [number, number]
  ticks?: number
  format?: (v: number) => string
}

// ---------------------------------------------------------------------------
// Context

interface ChartCtx {
  width: number
  left: number
  right: number
  x: ScaleLinear<number, number>
  times: readonly number[]
  active: number | null
  shades: readonly TimeShade[]
  days: readonly DayMark[]
  ticks: readonly TimeTick[]
  now: number | null
  reveal: boolean
  uid: string
}

const Ctx = createContext<ChartCtx | null>(null)
const NO_TICKS: readonly TimeTick[] = []

export function useTimeChart(): ChartCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('TimePanel/TimeAxis must be rendered inside <TimeChart>')
  return c
}

// ---------------------------------------------------------------------------
// TimeChart

export interface TimeChartProps {
  /** Snap positions for the scrubber (UTC ms, ascending), e.g. hourly stamps. */
  times: readonly number[]
  /** x-domain; defaults to [first − pad, last] where pad covers a preceding-hour bar. */
  domain?: [number, number]
  /** Hour ticks for the axis (see `hourTicks`). */
  ticks?: readonly TimeTick[]
  /**
   * Ticks as a function of the measured plot width (px) — preferred, since only the chart knows its width:
   * `tickFor={(w) => hourTicks(stamps, tickStep(w, 48))}`. Wins over `ticks`.
   */
  tickFor?: (plotWidth: number) => readonly TimeTick[]
  /** Local day starts, including the first day at the domain start, e.g. { t, label: 'Sat 16' }. */
  days?: readonly DayMark[]
  shades?: readonly TimeShade[]
  /** Draw a "Now" rule at this instant. */
  now?: number | null
  /** Active (scrubbed) index — controlled. */
  active: number | null
  onActiveChange?: (i: number) => void
  /** Accessible name of the scrubber, e.g. "Hour, 48-hour forecast for Alta". */
  label: string
  /** Spoken value for an index, e.g. "Sat 16 Jan 14:00 — temperature −6°F, snowfall 0.3 in". */
  valueText?: (i: number) => string
  /** Steps for PageUp/PageDown. Default 6. */
  pageStep?: number
  /** Plot margins (px): left holds y tick labels. */
  margin?: { left?: number; right?: number }
  className?: string
  children: ReactNode
}

export function TimeChart({
  times,
  domain,
  ticks: fixedTicks = NO_TICKS,
  tickFor,
  days = [],
  shades = [],
  now = null,
  active,
  onActiveChange,
  label,
  valueText,
  pageStep = 6,
  margin,
  className,
  children,
}: TimeChartProps) {
  const [ref, measured] = useWidth<HTMLDivElement>()
  const width = measured ?? 0
  const left = margin?.left ?? 40
  const right = margin?.right ?? 10
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    if (width > 0 && !revealed) {
      const id = window.setTimeout(() => setRevealed(true), 0)
      return () => window.clearTimeout(id)
    }
  }, [width, revealed])

  const dom = useMemo<[number, number]>(() => {
    if (domain) return domain
    if (!times.length) return [0, 1]
    return [times[0], times[times.length - 1]]
  }, [domain, times])
  const x = useMemo(
    () =>
      scaleLinear()
        .domain(dom)
        .range([left, Math.max(left + 1, width - right)]),
    [dom, left, right, width],
  )
  const plotWidth = Math.max(0, width - left - right)
  const ticks = useMemo(() => (tickFor ? (plotWidth > 0 ? tickFor(plotWidth) : []) : fixedTicks), [tickFor, plotWidth, fixedTicks])
  const act = clampIndex(active, times.length)

  const ctx: ChartCtx = { width, left, right: width - right, x, times, active: act, shades, days, ticks, now, reveal: !revealed, uid }

  const move = (i: number) => {
    const next = clampIndex(i, times.length)
    if (next !== null && next !== act) onActiveChange?.(next)
  }
  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    if (!width) return
    const rect = e.currentTarget.getBoundingClientRect()
    move(nearestIndex(times, x.invert(e.clientX - rect.left)))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = act ?? 0
    const map: Record<string, number> = {
      ArrowRight: i + 1,
      ArrowUp: i + 1,
      ArrowLeft: i - 1,
      ArrowDown: i - 1,
      PageUp: i + pageStep,
      PageDown: i - pageStep,
      Home: 0,
      End: times.length - 1,
    }
    if (e.key in map) {
      e.preventDefault()
      move(map[e.key])
    }
  }

  return (
    <div ref={ref} className={cn('relative select-none', className)}>
      <Ctx.Provider value={ctx}>{children}</Ctx.Provider>
      {onActiveChange && times.length ? (
        <div
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={times.length - 1}
          aria-valuenow={act ?? 0}
          aria-valuetext={valueText && act !== null ? valueText(act) : undefined}
          onPointerMove={fromPointer}
          onPointerDown={(e) => {
            if (e.pointerType !== 'mouse') e.currentTarget.setPointerCapture?.(e.pointerId)
            fromPointer(e)
          }}
          onKeyDown={onKey}
          className="absolute inset-0 z-[1] cursor-crosshair rounded-[6px] [touch-action:pan-y] focus-visible:outline-offset-4"
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TimePanel

export interface TimePanelProps {
  title: ReactNode
  /** Unit label beside the title ('in', '°F'). */
  unit?: string
  /** Plot height in px (excludes the title row). */
  height?: number
  series: TimeSeries[]
  y?: YOptions
  refLines?: RefLine[]
  /** Shown instead of the plot when no series has a known value. */
  empty?: ReactNode
  /** Right-aligned direct label (totals, extremes). */
  summary?: ReactNode
  /** Inline legend in the title row; default when there is more than one series. */
  legend?: boolean
  /** Extra legend entries (e.g. the hatched "not provided" key). */
  legendExtra?: LegendItem[]
  /** Quiet text centred in the plot, e.g. "None modeled" when every known value is zero. */
  note?: ReactNode
  className?: string
}

const PAD_TOP = 8
const PAD_BOTTOM = 4

const known = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

function seriesValues(s: TimeSeries): (number | null)[] {
  switch (s.type) {
    case 'bars':
      return s.bars.map((b) => b.v)
    case 'band':
      return [...s.lower.map((p) => p.v), ...s.upper.map((p) => p.v)]
    default:
      return s.points.map((p) => p.v)
  }
}

function swatchFor(s: TimeSeries): SwatchShape {
  if (s.type === 'bars') return 'bar'
  if (s.type === 'band') return 'band'
  if (s.type === 'line' && s.pointsOnly) return 'point'
  const style = s.type === 'line' || s.type === 'area' ? (s.style ?? 'solid') : 'solid'
  return style === 'dashed' ? 'dashed' : style === 'dotted' ? 'dotted' : 'line'
}

/** Rounded-top bar path: 4px data end, square at the baseline. */
function barPath(x0: number, x1: number, yTop: number, yBase: number): string {
  const w = x1 - x0
  const h = yBase - yTop
  if (h <= 0 || w <= 0) return ''
  const r = Math.min(4, w / 2, h)
  return `M${x0},${yBase}V${yTop + r}Q${x0},${yTop} ${x0 + r},${yTop}H${x1 - r}Q${x1},${yTop} ${x1},${yTop + r}V${yBase}Z`
}

export function TimePanel({ title, unit, height = 88, series, y, refLines = [], empty, summary, legend, legendExtra = [], note, className }: TimePanelProps) {
  const c = useTimeChart()
  const pid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const values = series.flatMap(seriesValues)
  const hasData = values.some(known)
  const refsIncluded = refLines.filter((r) => r.include !== false).map((r) => r.value)
  const dom = y?.domain ?? valueDomain(values, { ...y, extra: [...(y?.extra ?? []), ...refsIncluded] })
  const plotTop = PAD_TOP
  const plotBottom = PAD_TOP + height
  const ys = scaleLinear()
    .domain(dom ?? [0, 1])
    .range([plotBottom, plotTop])
  const yTicks = dom ? linearTicks(dom, y?.ticks ?? (height < 64 ? 2 : 3)) : []
  const fmt = y?.format ?? ((v: number) => String(v))
  const baseValue = dom ? (dom[0] <= 0 && dom[1] >= 0 ? 0 : dom[0]) : 0
  const yBase = ys(baseValue)
  const svgH = plotBottom + PAD_BOTTOM
  const showLegend = legend ?? series.length > 1
  const legendItems: LegendItem[] = [
    ...series.flatMap<LegendItem>((s) =>
      s.type === 'band'
        ? [
            { label: s.label, tone: s.tone, shape: 'line' },
            { label: s.upperLabel ?? 'Upper', tone: s.tone, shape: 'band' },
          ]
        : [{ label: s.label, tone: s.tone, shape: swatchFor(s) }],
    ),
    ...legendExtra,
  ]

  const activeT = c.active !== null ? c.times[c.active] : null
  const activeX = activeT !== null && c.width ? c.x(activeT) : null
  const lineGen = d3Line<TimePoint>()
    .defined((p) => known(p.v))
    .x((p) => c.x(p.t))
    .y((p) => ys(p.v as number))
    .curve(curveMonotoneX)
  const areaGen = d3Area<TimePoint>()
    .defined((p) => known(p.v))
    .x((p) => c.x(p.t))
    .y0(yBase)
    .y1((p) => ys(p.v as number))
    .curve(curveMonotoneX)
  const bandGen = (lower: TimePoint[], upper: TimePoint[]) => {
    const byT = new Map(upper.map((p) => [p.t, p.v]))
    const pts = lower.map((p) => ({ t: p.t, lo: p.v, hi: byT.get(p.t) ?? null }))
    return d3Area<{ t: number; lo: number | null; hi: number | null }>()
      .defined((p) => known(p.lo) && known(p.hi))
      .x((p) => c.x(p.t))
      .y0((p) => ys(p.lo as number))
      .y1((p) => ys(p.hi as number))
      .curve(curveMonotoneX)(pts)
  }
  const valueAt = (pts: TimePoint[], t: number) => pts.find((p) => p.t === t)?.v ?? null
  const clipId = `clip-${pid}`
  const hatchId = `hatch-${pid}`

  return (
    <div className={cn('relative', className)}>
      <div
        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 pb-1"
        style={{ paddingLeft: c.left, paddingRight: c.width ? c.width - c.right : 10 }}
      >
        <p className="text-[12.5px] font-semibold text-ink">
          {title}
          {unit ? <span className="ml-1.5 font-normal text-ink-3">{unit}</span> : null}
        </p>
        {showLegend && hasData ? <Legend items={legendItems} className="order-3 w-full gap-x-3 text-[12px] sm:order-none sm:w-auto" /> : null}
        {summary ? <p className="text-[12.5px] text-ink-2 tnum">{summary}</p> : null}
      </div>
      {!hasData && empty ? (
        <div
          className="flex items-center rounded-[8px] border border-dashed border-divider-strong bg-surface-2 px-3 text-[13px] text-ink-3 italic"
          style={{ marginLeft: c.left, marginRight: c.width ? c.width - c.right : 10, height: Math.min(height, 44) }}
        >
          {empty}
        </div>
      ) : (
        <svg width={c.width || '100%'} height={svgH} className="block overflow-visible" aria-hidden>
          {c.width ? (
            <>
              <defs>
                <clipPath id={clipId}>
                  <rect x={c.left} y={0} width={Math.max(0, c.right - c.left)} height={svgH} />
                </clipPath>
                <pattern id={hatchId} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="5" className="stroke-divider-strong" strokeWidth="1.2" />
                </pattern>
              </defs>
              {/* Shades: night, trend, past. */}
              {c.shades.map((s, i) => (
                <rect
                  key={i}
                  x={Math.max(c.left, c.x(s.from))}
                  y={plotTop}
                  width={Math.max(0, Math.min(c.right, c.x(s.to)) - Math.max(c.left, c.x(s.from)))}
                  height={height}
                  className={s.kind === 'night' ? 'fill-canvas' : s.kind === 'past' ? 'fill-surface-3/60' : undefined}
                  fill={s.kind === 'trend' ? `url(#${hatchId})` : undefined}
                />
              ))}
              {/* Grid + y ticks. */}
              {yTicks.map((v) => (
                <g key={v}>
                  <line
                    x1={c.left}
                    x2={c.right}
                    y1={Math.round(ys(v)) + 0.5}
                    y2={Math.round(ys(v)) + 0.5}
                    className={v === 0 ? 'stroke-divider-strong' : 'stroke-divider'}
                    shapeRendering="crispEdges"
                  />
                  <text x={c.left - 6} y={ys(v)} dy="0.32em" textAnchor="end" className="fill-ink-3 text-[12px] tnum">
                    {fmt(v)}
                  </text>
                </g>
              ))}
              {/* Day boundaries. */}
              {c.days.map((d) =>
                c.x(d.t) > c.left + 1 ? (
                  <line
                    key={d.t}
                    x1={Math.round(c.x(d.t)) + 0.5}
                    x2={Math.round(c.x(d.t)) + 0.5}
                    y1={plotTop}
                    y2={plotBottom}
                    className="stroke-divider-strong"
                    shapeRendering="crispEdges"
                  />
                ) : null,
              )}
              {c.now !== null && c.x(c.now) >= c.left && c.x(c.now) <= c.right ? (
                <line x1={c.x(c.now)} x2={c.x(c.now)} y1={plotTop} y2={plotBottom} className="stroke-ink-3" strokeDasharray="2 3" />
              ) : null}
              <g clipPath={`url(#${clipId})`}>
                {series.map((s) => {
                  const tone = TONES[s.tone]
                  if (s.type === 'bars') {
                    return (
                      <g key={s.id}>
                        {s.bars.map((b) => {
                          const x0 = c.x(b.t0)
                          const x1 = c.x(b.t1)
                          const slot = x1 - x0
                          const gap = slot > 6 ? 2 : slot > 3 ? 1 : 0
                          const w = Math.min(24, slot - gap)
                          const bx0 = x0 + (slot - w) / 2
                          const isActive = activeT !== null && (b.at ?? b.t1) === activeT
                          if (!known(b.v)) {
                            return <rect key={b.t0} x={bx0} y={yBase - 4} width={Math.max(1, w)} height={4} fill={`url(#${hatchId})`} />
                          }
                          if (b.v === 0) return null
                          const d = barPath(bx0, bx0 + Math.max(1, w), Math.min(yBase - 1, ys(b.v)), yBase)
                          return (
                            <motion.path
                              key={b.t0}
                              d={d}
                              className={cn(isActive ? tone.active : tone.fill, 'transition-[fill] duration-150')}
                              initial={c.reveal ? { scaleY: 0 } : false}
                              animate={{ scaleY: 1 }}
                              transition={motionT.bars}
                              style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }}
                            />
                          )
                        })}
                      </g>
                    )
                  }
                  if (s.type === 'band') {
                    return (
                      <g key={s.id}>
                        <path d={bandGen(s.lower, s.upper) ?? ''} className={tone.wash} />
                        <path
                          d={lineGen(s.upper) ?? ''}
                          fill="none"
                          className={tone.stroke}
                          strokeWidth={1}
                          strokeOpacity={0.55}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path d={lineGen(s.lower) ?? ''} fill="none" className={tone.stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                      </g>
                    )
                  }
                  if (s.type === 'area') {
                    return (
                      <g key={s.id}>
                        <path d={areaGen(s.points) ?? ''} className={tone.wash} />
                        <path
                          d={lineGen(s.points) ?? ''}
                          fill="none"
                          className={tone.stroke}
                          strokeWidth={2}
                          strokeDasharray={DASH[s.style ?? 'solid']}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </g>
                    )
                  }
                  if (s.pointsOnly) {
                    return (
                      <g key={s.id}>
                        {s.points
                          .filter((p) => known(p.v))
                          .map((p) => (
                            <circle key={p.t} cx={c.x(p.t)} cy={ys(p.v as number)} r={4} className={cn(tone.fill, 'stroke-surface')} strokeWidth={2} />
                          ))}
                      </g>
                    )
                  }
                  return (
                    <path
                      key={s.id}
                      d={lineGen(s.points) ?? ''}
                      fill="none"
                      className={tone.stroke}
                      strokeWidth={2}
                      strokeDasharray={DASH[s.style ?? 'solid']}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )
                })}
              </g>
              {refLines.map((r) => {
                const yy = ys(r.value)
                if (yy < plotTop - 0.5 || yy > plotBottom + 0.5) return null
                return (
                  <g key={r.label}>
                    <line
                      x1={c.left}
                      x2={c.right}
                      y1={yy}
                      y2={yy}
                      className={TONES[r.tone ?? 'ink-3'].stroke}
                      strokeWidth={1}
                      strokeDasharray={DASH[r.style ?? 'dashed']}
                    />
                    <text
                      x={c.right - 4}
                      y={yy - 4}
                      textAnchor="end"
                      className="fill-ink-2 text-[12px] font-medium"
                      paintOrder="stroke"
                      stroke="var(--surface)"
                      strokeWidth={3}
                      strokeLinejoin="round"
                    >
                      {r.label}
                    </text>
                  </g>
                )
              })}
              {note ? (
                <text
                  x={(c.left + c.right) / 2}
                  y={plotTop + height / 2}
                  dy="0.32em"
                  textAnchor="middle"
                  className="fill-ink-3 text-[12px] italic"
                  paintOrder="stroke"
                  stroke="var(--surface)"
                  strokeWidth={4}
                  strokeLinejoin="round"
                >
                  {note}
                </text>
              ) : null}
              {/* Crosshair + markers glide together; axes never move. */}
              {activeX !== null && activeT !== null ? (
                <motion.g initial={false} animate={{ x: activeX }} transition={motionT.select}>
                  <line x1={0} x2={0} y1={plotTop - 4} y2={plotBottom} className="stroke-ink-2" strokeWidth={1} />
                  {series.map((s) => {
                    if (s.type === 'bars') return null
                    const tone = TONES[s.tone]
                    const pts = s.type === 'band' ? [s.lower, s.upper] : [s.points]
                    return pts.map((p, j) => {
                      const v = valueAt(p, activeT)
                      if (!known(v)) return null
                      return (
                        <motion.circle
                          key={`${s.id}-${j}`}
                          cx={0}
                          initial={false}
                          animate={{ cy: ys(v) }}
                          transition={motionT.select}
                          r={j === 1 ? 3 : 4}
                          className={cn(tone.fill, 'stroke-surface')}
                          strokeWidth={2}
                        />
                      )
                    })
                  })}
                </motion.g>
              ) : null}
            </>
          ) : null}
        </svg>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TimeAxis

/** Hour ticks and local day labels under the panels. Labels stay inside the plot edges. */
export function TimeAxis({ className }: { className?: string }) {
  const c = useTimeChart()
  const h = 38
  const activeT = c.active !== null ? c.times[c.active] : null
  const visible = c.width ? c.ticks.map((tk) => ({ tk, xx: c.x(tk.t) })).filter(({ xx }) => xx >= c.left - 1 && xx <= c.right + 1) : []
  const tickSlots = placeTickLabels(
    visible.map((v) => v.xx),
    visible.map((v) => v.tk.label),
    c.left,
    c.right,
  )
  const ticks = visible.map((v, i) => ({ ...v, slot: tickSlots[i] }))
  const dayList = c.width ? c.days.filter((d) => c.x(d.t) <= c.right) : []
  const daySlots = placeDayLabels(
    dayList.map((d) => c.x(d.t)),
    dayList.map((d) => d.label),
    c.left,
    c.right,
  )
  const days = dayList.map((d, i) => ({ d, slot: daySlots[i] }))
  return (
    <svg width={c.width || '100%'} height={h} className={cn('block overflow-visible', className)} aria-hidden>
      {c.width ? (
        <>
          <line x1={c.left} x2={c.right} y1={0.5} y2={0.5} className="stroke-divider-strong" shapeRendering="crispEdges" />
          {ticks.map(({ tk, xx, slot }) => (
            <g key={tk.t}>
              <line
                x1={Math.round(xx) + 0.5}
                x2={Math.round(xx) + 0.5}
                y1={0}
                y2={tk.major ? 6 : 4}
                className="stroke-divider-strong"
                shapeRendering="crispEdges"
              />
              {slot.show ? (
                <text x={xx} y={17} textAnchor={slot.anchor} className="fill-ink-3 text-[12px] tnum">
                  {tk.label}
                </text>
              ) : null}
            </g>
          ))}
          {days.map(({ d, slot }) =>
            slot.show ? (
              <text key={d.t} x={slot.x} y={34} className="fill-ink text-[12px] font-semibold">
                {d.label}
              </text>
            ) : null,
          )}
          {activeT !== null ? (
            <motion.g initial={false} animate={{ x: c.x(activeT) }} transition={motionT.select}>
              <path d="M-4,0 L4,0 L0,5 Z" className="fill-ink-2" />
            </motion.g>
          ) : null}
        </>
      ) : null}
    </svg>
  )
}
