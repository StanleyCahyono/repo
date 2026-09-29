'use client'
/**
 * Daily outlook matrix — the compared resorts (rows) × resort-local days (columns).
 *
 * - Days 1–7 in full; days 8–16 only when the provider returned them, on a hatched "less certain trend" band.
 * - One metric at a time (snowfall, weather potential, temperature range, wind) on a scale shared by all rows, so
 *   resorts compare at a glance. Unknown values render "–" with a hatched stub; partial days read "≥".
 * - An ARIA grid with one tab stop: arrows move between days and resorts, Enter/Space selects. The selection
 *   highlight glides between cells (shared layoutId, t.select). Selecting a cell in another resort's row makes that
 *   resort the focus.
 * - Everything plotted is weather-model output, except weather potential (a Piste estimate, copper).
 */
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { Ban, ChevronLeft, ChevronRight, CloudOff } from 'lucide-react'
import { ChartFrame } from '@/components/charts/chart-frame'
import { chartUnits } from '@/components/charts/units'
import { Freshness, KindTag } from '@/components/ui/provenance'
import { SourceDrawer } from '@/components/ui/source-drawer'
import type { ResortForecast, DayView } from '@/lib/data/forecast'
import type { DayPotential, ResortInfo, WeatherHealth } from '@/lib/data/forecast-screen'
import { isWeekend, relativeLabel } from '@/lib/domain/time'
import type { UnitPrefs } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { dayMedium, displayPotential, outlookColumns, POINT_LABEL, type PointKey } from './model'
import type { OutlookMetric } from './params'

export const METRIC_LABEL: Record<OutlookMetric, string> = { snow: 'Snowfall', potential: 'Potential', temp: 'Temperature', wind: 'Wind' }

const HATCH = 'repeating-linear-gradient(135deg, var(--divider) 0 1px, transparent 1px 6px)'
const BAR_H = 30
const known = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

export interface OutlookSelection {
  resortId: string
  date: string
}

export function OutlookMatrix({
  forecasts,
  resorts,
  potentials,
  health,
  focus,
  selectedDate,
  metric,
  units,
  now,
  point,
  onSelect,
  actions,
}: {
  forecasts: ResortForecast[]
  resorts: Record<string, ResortInfo>
  potentials: Record<string, DayPotential[]>
  health: Record<string, WeatherHealth>
  focus: string | null
  /** Selected date in the focus resort's calendar (null: none highlighted). */
  selectedDate: string | null
  metric: OutlookMetric
  units: UnitPrefs
  now: string
  point: PointKey
  onSelect: (sel: OutlookSelection) => void
  actions?: ReactNode
}) {
  const q = useMemo(() => chartUnits(units), [units])
  const refToday = (focus && resorts[focus]?.today) || forecasts[0]?.today || now.slice(0, 10)
  const cols = useMemo(() => outlookColumns(forecasts, refToday), [forecasts, refToday])
  const near = cols.filter((c) => !c.trend)
  const trend = cols.filter((c) => c.trend)
  const rows = forecasts

  // Shared scales across the matrix (display units).
  const scale = useMemo(() => {
    const all = rows.flatMap((f) => f.daily)
    const snowMax = Math.max(q.snow.floorMax * 4, ...all.map((d) => q.snow.toDisplay(d.snowfallCm) ?? 0))
    const temps = all.flatMap((d) => [q.temp.toDisplay(d.tempMinC), q.temp.toDisplay(d.tempMaxC)]).filter(known)
    const gustMax = Math.max(q.speed.floorMax, ...all.map((d) => q.speed.toDisplay(d.gustMaxKmh ?? d.windMaxKmh) ?? 0))
    return { snowMax, tempLo: temps.length ? Math.min(...temps) : 0, tempHi: temps.length ? Math.max(...temps) : 1, gustMax }
  }, [rows, q])

  // Grid geometry: near days, a narrow gutter, then trend days. Each row is its own grid on the same template.
  const template = [...near.map(() => 'minmax(44px,1fr)'), ...(trend.length ? ['10px'] : []), ...trend.map(() => 'minmax(42px,0.8fr)')].join(' ')
  const minWidth = near.length * 44 + (trend.length ? 10 + trend.length * 42 : 0)
  const colIndex = (i: number) => (i < near.length ? i + 1 : i + 2) // 1-based grid column, skipping the gutter

  // Edge fades show that the matrix scrolls sideways (days 8–16 on small screens).
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [edges, setEdges] = useState({ start: true, end: true })
  const updateEdges = () => {
    const el = scrollRef.current
    if (!el) return
    const next = { start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 }
    setEdges((e) => (e.start === next.start && e.end === next.end ? e : next))
  }
  const scrollable = !(edges.start && edges.end)
  const jump = () => {
    const el = scrollRef.current
    if (!el) return
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ left: edges.end ? 0 : el.scrollWidth, behavior: reduce ? 'auto' : 'smooth' })
  }
  useEffect(() => {
    updateEdges()
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => updateEdges())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Roving focus over (row, column). Rows without a stored run have no cells and are skipped.
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const hasCells = (r: number) => !!rows[r]?.run
  const focusRow = rows.findIndex((f) => f.resortId === focus)
  const defaultRow = hasCells(focusRow)
    ? focusRow
    : Math.max(
        0,
        rows.findIndex((f) => !!f.run),
      )
  const selCol = cols.findIndex((c) => c.date === selectedDate)
  const [cursor, setCursor] = useState<{ r: number; c: number } | null>(null)
  const active = cursor && hasCells(cursor.r) && cursor.c < cols.length ? cursor : { r: defaultRow, c: Math.max(0, selCol) }
  const move = (r: number, c: number) => {
    const step = Math.sign(r - active.r)
    let rr = Math.min(rows.length - 1, Math.max(0, r))
    while (step !== 0 && rr >= 0 && rr < rows.length && !hasCells(rr)) rr += step
    if (!hasCells(rr)) return
    const cc = Math.min(cols.length - 1, Math.max(0, c))
    setCursor({ r: rr, c: cc })
    refs.current.get(`${rr}|${cc}`)?.focus()
  }
  const onKey = (e: KeyboardEvent, r: number, c: number) => {
    const map: Record<string, [number, number]> = {
      ArrowRight: [r, c + 1],
      ArrowLeft: [r, c - 1],
      ArrowDown: [r + 1, c],
      ArrowUp: [r - 1, c],
      Home: [r, 0],
      End: [r, cols.length - 1],
    }
    if (e.key in map) {
      e.preventDefault()
      move(...map[e.key])
    }
  }

  const potentialFor = (id: string, date: string) => potentials[id]?.find((p) => p.date === date)
  const describe = (f: ResortForecast, d: DayView | undefined, date: string): string => {
    const name = resorts[f.resortId]?.name ?? f.name
    if (!d) return `${name}, ${dayMedium(date)}: no forecast for this day`
    const bits = [
      `snowfall ${d.partial ? 'at least ' : ''}${q.snow.format(d.snowfallCm) ?? 'not provided'}`,
      `high ${q.temp.format(d.tempMaxC) ?? 'not provided'}, low ${q.temp.format(d.tempMinC) ?? 'not provided'}`,
      `gusts to ${q.speed.format(d.gustMaxKmh) ?? 'not provided'}`,
    ]
    const p = displayPotential(potentialFor(f.resortId, date), date > f.today)
    if (p?.scoreKind === 'closed') bits.push('closed')
    else if (p?.score != null)
      bits.push(
        `${p.scoreKind === 'weather-potential' ? 'weather potential' : p.scoreKind === 'limited' ? 'limited-data score' : 'conditions score'} ${p.score}`,
      )
    return `${name}, ${dayMedium(date)}${d.trend ? ' (less certain trend)' : ''}: ${bits.join('; ')}`
  }

  const table = {
    caption: 'Daily outlook by resort (weather-model output per resort-local day)',
    rowHeader: 'Resort · day',
    columns: [
      { key: 'snow', label: 'Snowfall', unit: q.snow.unit },
      { key: 'rain', label: 'Rain', unit: q.precip.unit },
      { key: 'hi', label: 'High', unit: q.temp.unit },
      { key: 'lo', label: 'Low', unit: q.temp.unit },
      { key: 'feels', label: 'Feels like (min)', unit: q.temp.unit },
      { key: 'wind', label: 'Wind (max)', unit: q.speed.unit },
      { key: 'gust', label: 'Gusts (max)', unit: q.speed.unit },
      { key: 'vis', label: 'Visibility (min)', unit: q.visibility.unit },
      { key: 'pot', label: 'Weather potential' },
      { key: 'cov', label: 'Hours covered' },
    ],
    rows: rows.flatMap((f) =>
      f.daily.map((d) => {
        const p = displayPotential(potentialFor(f.resortId, d.date), d.date > f.today)
        return {
          key: `${f.resortId}|${d.date}`,
          header: `${resorts[f.resortId]?.name ?? f.name} · ${dayMedium(d.date)}${d.trend ? ' (trend)' : ''}`,
          tone: d.trend ? ('muted' as const) : f.resortId === focus && d.date === selectedDate ? ('selected' as const) : ('default' as const),
          cells: {
            snow: known(d.snowfallCm) ? `${d.partial ? '≥ ' : ''}${q.snow.short(d.snowfallCm)}` : null,
            rain: q.precip.short(d.rainMm),
            hi: q.temp.short(d.tempMaxC),
            lo: q.temp.short(d.tempMinC),
            feels: q.temp.short(d.apparentMinC),
            wind: q.speed.short(d.windMaxKmh),
            gust: q.speed.short(d.gustMaxKmh),
            vis: q.visibility.short(d.visibilityMinM),
            pot: !p ? null : p.scoreKind === 'closed' ? 'Closed' : p.score === null ? null : `${p.score}${p.scoreKind === 'conditions' ? '' : '*'}`,
            cov: `${d.hoursCovered} of ${d.expectedHours} h`,
          },
        }
      }),
    ),
    maxHeight: 440,
  }

  return (
    <div className="rounded-[12px] border border-divider bg-surface px-3 pt-3 pb-3.5 md:px-5 md:pt-4 md:pb-4">
      <ChartFrame
        title="Daily outlook by resort"
        titleAs="h3"
        hideTitle
        actions={actions}
        table={table}
        footer={<OutlookKey metric={metric} hasTrend={trend.length > 0} />}
      >
        {scrollable && trend.length ? (
          <div className="-mt-1 mb-1 flex justify-end">
            <button
              type="button"
              onClick={jump}
              className="inline-flex h-10 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-teal transition-colors duration-150 hover:bg-glacier/60 md:h-8"
            >
              {edges.end ? (
                <>
                  <ChevronLeft aria-hidden className="size-4" /> Next {near.length} days
                </>
              ) : (
                <>
                  Days {near.length + 1}–{near.length + trend.length} <ChevronRight aria-hidden className="size-4" />
                </>
              )}
            </button>
          </div>
        ) : null}
        <div className="relative">
          <div ref={scrollRef} onScroll={updateEdges} className="-mx-1 overflow-x-auto px-1 pb-1 scrollbar-thin">
            <div
              role="grid"
              aria-label={`Daily outlook: ${METRIC_LABEL[metric].toLowerCase()} by resort and day`}
              aria-rowcount={rows.length + 1}
              className="w-full"
              style={{ minWidth }}
            >
              {/* Column groups + day headers */}
              <div role="row" className="grid items-end" style={{ gridTemplateColumns: template }}>
                <div role="presentation" className="pb-1 text-[12px] font-semibold text-ink-2" style={{ gridColumn: `1 / span ${near.length}` }}>
                  Next {near.length} {near.length === 1 ? 'day' : 'days'}
                </div>
                {trend.length ? (
                  <div
                    role="presentation"
                    className="pb-1 text-[12px] font-semibold text-ink-3"
                    style={{ gridColumn: `${near.length + 2} / span ${trend.length}` }}
                  >
                    <span className="sticky left-0">
                      Days {near.length + 1}–{near.length + trend.length} · less certain trend
                    </span>
                  </div>
                ) : null}
                {cols.map((c, i) => {
                  const sel = c.date === selectedDate
                  return (
                    <div
                      key={c.date}
                      role="columnheader"
                      aria-label={dayMedium(c.date)}
                      className={cn('border-b border-divider pb-1.5 text-center leading-tight', c.trend && 'text-ink-3')}
                      style={{ gridColumn: colIndex(i), gridRow: 2 }}
                    >
                      <span className={cn('block text-[12px] font-medium', sel ? 'text-teal' : isWeekend(c.date) ? 'text-ink' : 'text-ink-2')}>
                        {c.date === refToday ? 'Today' : dayMedium(c.date).slice(0, 3)}
                      </span>
                      <span
                        className={cn('block text-[12px] tnum', sel ? 'font-semibold text-teal' : isWeekend(c.date) ? 'font-semibold text-ink' : 'text-ink-3')}
                      >
                        {Number(c.date.slice(8))}
                      </span>
                    </div>
                  )
                })}
              </div>

              {rows.map((f, r) => {
                const info = resorts[f.resortId]
                const h = health[f.resortId]
                const byDate = new Map(f.daily.map((d) => [d.date, d]))
                const isFocus = f.resortId === focus
                return (
                  <div key={f.resortId} role="row" className="grid border-b border-divider last:border-b-0" style={{ gridTemplateColumns: template }}>
                    <div role="rowheader" className="pt-3 pb-1.5" style={{ gridColumn: '1 / -1' }}>
                      <div className="sticky left-0 inline-flex max-w-[calc(100vw-64px)] flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-[14.5px] font-semibold text-ink">{info?.name ?? f.name}</span>
                        <RowMeta f={f} h={h} now={now} point={point} />
                      </div>
                    </div>
                    {f.run === null ? (
                      <div role="gridcell" className="pb-3" style={{ gridColumn: '1 / -1' }}>
                        <p className="sticky left-0 inline-flex items-center gap-2 rounded-[8px] border border-dashed border-divider-strong bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
                          <CloudOff aria-hidden className="size-4 text-ink-3" />
                          {h?.lastFailure
                            ? `No forecast stored — the last fetch ${relativeLabel(h.lastFailure.at, now)} failed.`
                            : 'No forecast stored — weather has not been fetched for this resort yet.'}
                        </p>
                      </div>
                    ) : (
                      cols.map((c, i) => {
                        const d = byDate.get(c.date)
                        const sel = isFocus && c.date === selectedDate
                        const inCol = !isFocus && c.date === selectedDate
                        const isActive = active.r === r && active.c === i
                        return (
                          <div key={c.date} role="gridcell" aria-selected={sel} className="relative pb-2" style={{ gridColumn: colIndex(i) }}>
                            <button
                              ref={(el) => {
                                if (el) refs.current.set(`${r}|${i}`, el)
                                else refs.current.delete(`${r}|${i}`)
                              }}
                              type="button"
                              tabIndex={isActive ? 0 : -1}
                              aria-label={describe(f, d, c.date)}
                              onClick={() => {
                                setCursor({ r, c: i })
                                onSelect({ resortId: f.resortId, date: c.date })
                              }}
                              onKeyDown={(e) => onKey(e, r, i)}
                              onFocus={() => setCursor({ r, c: i })}
                              className={cn(
                                'relative flex w-full flex-col items-center rounded-[8px] px-0.5 pt-1.5 pb-1 transition-colors duration-150',
                                !sel && 'hover:bg-surface-3/70',
                                inCol && 'bg-surface-2',
                              )}
                            >
                              {sel ? (
                                <motion.span
                                  layoutId="outlook-selection"
                                  transition={t.select}
                                  aria-hidden
                                  className="absolute inset-0 rounded-[8px] bg-glacier ring-1 ring-teal/40"
                                />
                              ) : null}
                              <Cell
                                metric={metric}
                                day={d}
                                date={c.date}
                                trend={c.trend}
                                potential={potentialFor(f.resortId, c.date)}
                                isFuture={c.date > f.today}
                                q={q}
                                scale={scale}
                              />
                            </button>
                          </div>
                        )
                      })
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          {edges.start ? null : <span aria-hidden className="pointer-events-none absolute inset-y-0 -left-1 w-6 bg-linear-to-r from-surface to-transparent" />}
          {edges.end ? null : <span aria-hidden className="pointer-events-none absolute inset-y-0 -right-1 w-8 bg-linear-to-l from-surface to-transparent" />}
        </div>
      </ChartFrame>
    </div>
  )
}

function RowMeta({ f, h, now, point }: { f: ResortForecast; h: WeatherHealth | undefined; now: string; point: PointKey }) {
  if (!f.run) {
    return <span className="text-[12.5px] text-ink-3">{h?.lastFailure ? 'Fetch failed' : 'Not fetched'}</span>
  }
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-ink-3">
      <span>{f.shownPoint ? POINT_LABEL[f.shownPoint] : POINT_LABEL[point]}</span>
      {f.fallbackFrom ? <span className="font-medium text-caution">{POINT_LABEL[f.fallbackFrom]} not stored</span> : null}
      <KindTag kind={f.run.kind} className="self-center" />
      <Freshness at={f.run.fetchedAt} now={now} staleHours={12} prefix="fetched" />
      {h?.lastFailure ? <span className="font-medium text-caution">· a newer fetch failed</span> : null}
      <SourceDrawer
        title={`Forecast sources — ${f.name}`}
        className="self-center"
        items={[f.runs.base, f.runs.summit]
          .filter((r) => r !== null)
          .map((r) => ({
            label: `${POINT_LABEL[r.pointKey as PointKey] ?? r.pointKey} forecast`,
            value: r.model ? `Model ${r.model}` : undefined,
            prov: r.prov,
          }))}
      />
    </span>
  )
}

type Q = ReturnType<typeof chartUnits>

function Cell({
  metric,
  day,
  date,
  trend,
  potential,
  isFuture,
  q,
  scale,
}: {
  metric: OutlookMetric
  day: DayView | undefined
  date: string
  trend: boolean
  potential: DayPotential | undefined
  isFuture: boolean
  q: Q
  scale: { snowMax: number; tempLo: number; tempHi: number; gustMax: number }
}) {
  const track = (children: ReactNode) => (
    <span className="relative mt-1 flex w-full items-end justify-center rounded-[4px]" style={{ height: BAR_H, backgroundImage: trend ? HATCH : undefined }}>
      {children}
    </span>
  )
  const stub = <span className="block h-2 w-[min(70%,22px)] rounded-t-[2px] border border-b-0 border-divider-strong" style={{ backgroundImage: HATCH }} />
  const dash = <span className="relative block h-4 text-[12.5px] leading-4 text-ink-3">–</span>

  if (!day) {
    return (
      <>
        {dash}
        {track(null)}
        <span className="sr-only">No forecast for {date}</span>
      </>
    )
  }

  if (metric === 'snow') {
    const v = q.snow.toDisplay(day.snowfallCm)
    if (!known(v))
      return (
        <>
          {dash}
          {track(stub)}
        </>
      )
    const pct = scale.snowMax > 0 ? Math.max(v > 0 ? 6 : 0, (v / scale.snowMax) * 100) : 0
    return (
      <>
        <span className={cn('relative block h-4 text-[12.5px] leading-4 tnum', v > 0 ? 'font-semibold text-ink' : 'text-ink-3')}>
          {day.partial ? '≥' : ''}
          {q.snow.short(day.snowfallCm)}
        </span>
        {track(
          v > 0 ? (
            <motion.span
              className={cn('block w-[min(70%,22px)] rounded-t-[4px]', trend ? 'bg-teal/60' : 'bg-teal')}
              style={{ height: `${pct}%`, originY: 1 }}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={t.bars}
            />
          ) : (
            <span className="block h-px w-[min(70%,22px)] bg-divider-strong" />
          ),
        )}
      </>
    )
  }

  if (metric === 'potential') {
    const p = displayPotential(potential, isFuture)
    if (!p)
      return (
        <>
          {dash}
          {track(null)}
          <span className="sr-only">No score stored</span>
        </>
      )
    if (p.scoreKind === 'closed')
      return (
        <>
          <span className="relative flex h-4 items-center gap-0.5 text-[12px] font-semibold text-critical">
            <Ban aria-hidden className="size-3.5" />
          </span>
          {track(<span className="mb-1 text-[12px] font-medium text-critical">Closed</span>)}
        </>
      )
    if (p.score === null)
      return (
        <>
          {dash}
          {track(null)}
        </>
      )
    const tone = p.scoreKind === 'conditions' ? (p.score >= 70 ? 'text-positive' : p.score >= 55 ? 'text-caution' : 'text-critical') : 'text-ink'
    return (
      <>
        <span className={cn('relative block h-4 font-display text-[19px] leading-4 tnum', tone)}>
          {p.score}
          {p.scoreKind !== 'conditions' ? <span className="align-top text-[11px] text-copper">*</span> : null}
        </span>
        {track(
          <span className="mb-1.5 block h-[4px] w-[min(78%,40px)] overflow-hidden rounded-full bg-surface-3">
            <motion.span
              className={cn('block h-full rounded-full', p.scoreKind === 'conditions' ? 'bg-ink-3' : 'bg-copper')}
              style={{ width: `${Math.max(4, p.score)}%`, originX: 0 }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={t.bars}
            />
          </span>,
        )}
      </>
    )
  }

  if (metric === 'temp') {
    const hi = q.temp.toDisplay(day.tempMaxC)
    const lo = q.temp.toDisplay(day.tempMinC)
    if (!known(hi) || !known(lo))
      return (
        <>
          {dash}
          {track(stub)}
        </>
      )
    const span = Math.max(1, scale.tempHi - scale.tempLo)
    const top = ((scale.tempHi - hi) / span) * 100
    const bottom = ((lo - scale.tempLo) / span) * 100
    const freezing = q.temp.toDisplay(0)!
    const fz = freezing >= scale.tempLo && freezing <= scale.tempHi ? ((scale.tempHi - freezing) / span) * 100 : null
    return (
      <>
        <span className="relative block h-4 text-[12.5px] leading-4 font-semibold text-ink tnum">{q.temp.short(day.tempMaxC)}</span>
        {track(
          <>
            {fz !== null ? <span aria-hidden className="absolute inset-x-1 border-t border-dashed border-teal/60" style={{ top: `${fz}%` }} /> : null}
            <span aria-hidden className="absolute w-[7px] rounded-full bg-ink-2/75" style={{ top: `${top}%`, bottom: `${bottom}%`, minHeight: 5 }} />
          </>,
        )}
        <span className="relative mt-0.5 block h-4 text-[12px] leading-4 text-ink-3 tnum">{q.temp.short(day.tempMinC)}</span>
      </>
    )
  }

  // wind
  const gust = q.speed.toDisplay(day.gustMaxKmh)
  const wind = q.speed.toDisplay(day.windMaxKmh)
  if (!known(gust) && !known(wind))
    return (
      <>
        {dash}
        {track(stub)}
      </>
    )
  const g = known(gust) ? gust : (wind as number)
  const pct = scale.gustMax > 0 ? Math.max(6, (g / scale.gustMax) * 100) : 0
  const wpct = known(wind) && scale.gustMax > 0 ? Math.max(4, (wind / scale.gustMax) * 100) : null
  return (
    <>
      <span className="relative block h-4 text-[12.5px] leading-4 font-semibold text-ink tnum">
        {known(gust) ? q.speed.short(day.gustMaxKmh) : q.speed.short(day.windMaxKmh)}
      </span>
      {track(
        <span className="relative block w-[min(70%,22px)]" style={{ height: `${pct}%` }}>
          <span aria-hidden className="absolute inset-0 rounded-t-[4px] bg-ink-2/25" />
          {wpct !== null ? (
            <span aria-hidden className="absolute inset-x-0 bottom-0 rounded-t-[3px] bg-ink-2/70" style={{ height: `${(wpct / pct) * 100}%` }} />
          ) : null}
        </span>,
      )}
      <span className="relative mt-0.5 block h-4 text-[12px] leading-4 text-ink-3 tnum">{known(wind) ? q.speed.short(day.windMaxKmh) : '–'}</span>
    </>
  )
}

function OutlookKey({ metric, hasTrend }: { metric: OutlookMetric; hasTrend: boolean }) {
  const items: ReactNode[] = []
  if (metric === 'snow') items.push('Modeled snowfall per resort-local day (not snow depth, not rain)')
  if (metric === 'potential')
    items.push(
      <Fragment key="p">
        <span className="font-semibold text-copper">*</span> Weather potential — a Piste estimate from weather-derived components only; open terrain and status
        for future days are unknown. Today may show the full conditions score.
      </Fragment>,
    )
  if (metric === 'temp') items.push('Daily high over low, with the range bar on a shared scale; dashed line = freezing')
  if (metric === 'wind') items.push('Strongest gust over strongest sustained wind (light bar = gusts)')
  items.push('≥ partial day (only some hours covered)')
  items.push('– not provided')
  if (hasTrend) items.push('Hatched: days 8–16, a less certain trend shown only because the provider returned it')
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {items.map((it, i) => (
        <span key={i}>{it}</span>
      ))}
    </span>
  )
}
