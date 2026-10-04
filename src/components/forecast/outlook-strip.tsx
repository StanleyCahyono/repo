'use client'
/**
 * The 16-day glass strip for the focus resort: modeled snowfall bars that grow in, the daily high/low lines drawn
 * over a temperature band with the freezing line, and day labels. Hover or focus a day to lift it and read the detail
 * line; click (Enter/Space) selects it for the day detail below. Days 8–16 sit on a hatched "less certain trend"
 * band. A Chart/Table toggle swaps in the data table; a 7/16 range toggle zooms.
 *
 * Without a stored forecast the same frame shows the real dates as empty columns under a "Not fetched yet" card —
 * nothing is drawn that the model did not return.
 */
import { useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CloudOff } from 'lucide-react'
import { ChartTable } from '@/components/charts/chart-table'
import { chartUnits } from '@/components/charts/units'
import type { DayView, ResortForecast } from '@/lib/data/forecast'
import type { ResortInfo, WeatherHealth } from '@/lib/data/forecast-screen'
import { addDays, formatLocalDate, relativeLabel } from '@/lib/domain/time'
import type { UnitPrefs } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'
import { EASE_OUT } from '@/lib/ui/motion'
import { DetailLine, GlassPanel, HATCH, PillToggle } from './hud'
import { dayMedium, instantLocal, POINT_LABEL, pointElevation, tempGeometry, type PointKey } from './model'

const W = 1000
const H = 300
const BARS_H = 120
const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

type Range = '7' | '16'

const PHONE = '(max-width: 639px)'
const subscribePhone = (cb: () => void) => {
  const m = window.matchMedia(PHONE)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}
const isPhone = () => window.matchMedia(PHONE).matches

export function OutlookStrip({
  forecast,
  info,
  point,
  units,
  health,
  now,
  selectedDate,
  onSelect,
  empty,
}: {
  forecast: ResortForecast | null
  info: ResortInfo | undefined
  point: PointKey
  units: UnitPrefs
  health: WeatherHealth | undefined
  now: string
  selectedDate: string | null
  onSelect: (date: string) => void
  /** The "not fetched" card shown over the empty frame (title, reason, actions). */
  empty: { title: string; body: ReactNode; actions?: ReactNode }
}) {
  const q = useMemo(() => chartUnits(units), [units])
  const [view, setView] = useState<'chart' | 'table'>('chart')
  // Phones open on the next 7 days, which fit without sideways scrolling; the 16-day view stays one tap away.
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false)
  const [picked, setRange] = useState<Range | null>(null)
  const range: Range = picked ?? (phone ? '7' : '16')
  const all = forecast?.run ? forecast.daily : []
  const days = range === '7' ? all.slice(0, 7) : all
  const has = days.length > 0
  const shown = forecast?.shownPoint ?? point
  const elev = forecast?.run?.requested.elevationM ?? pointElevation(info, shown)
  const elevText = `${POINT_LABEL[shown]}${elev !== null ? ` ${q.elevation.format(elev)}` : ''}`
  const today = info?.today ?? forecast?.today ?? now.slice(0, 10)
  const demo = forecast?.run?.kind === 'demo'

  const title = has ? `${days.length} days` : '16 days'
  const meta = `Snowfall (${q.snow.unit}) · high / low (${q.temp.unit}) · ${elevText}`

  const table = {
    caption: `Daily modeled weather for ${info?.name ?? forecast?.name ?? 'this resort'}, ${elevText}`,
    rowHeader: 'Day',
    columns: [
      { key: 'snow', label: 'Snowfall', unit: q.snow.unit },
      { key: 'hi', label: 'High', unit: q.temp.unit },
      { key: 'lo', label: 'Low', unit: q.temp.unit },
      { key: 'gust', label: 'Gusts (max)', unit: q.speed.unit },
      { key: 'cov', label: 'Hours covered' },
    ],
    rows: days.map((d) => ({
      key: d.date,
      header: `${dayMedium(d.date)}${d.trend ? ' (trend)' : ''}`,
      tone: d.date === selectedDate ? ('selected' as const) : d.trend ? ('muted' as const) : ('default' as const),
      cells: {
        snow: finite(d.snowfallCm) ? `${d.partial ? '≥ ' : ''}${q.snow.short(d.snowfallCm)}` : null,
        hi: q.temp.short(d.tempMaxC),
        lo: q.temp.short(d.tempMinC),
        gust: q.speed.short(d.gustMaxKmh),
        cov: `${d.hoursCovered} of ${d.expectedHours} h`,
      },
    })),
    maxHeight: 420,
  }

  return (
    <GlassPanel aria-labelledby="strip-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <h2 id="strip-title" className="m-0 text-[18px] font-semibold text-ink">
            {title}
          </h2>
          <span className="hud text-ink-2">{meta}</span>
        </div>
        {has ? (
          <div className="flex flex-wrap items-center gap-2">
            {all.length > 7 ? (
              <PillToggle<Range>
                label="Days shown"
                value={range}
                onChange={setRange}
                options={[
                  { value: '7', label: '7 d', aria: 'Next 7 days' },
                  { value: '16', label: `${all.length} d`, aria: `All ${all.length} days` },
                ]}
              />
            ) : null}
            <PillToggle<'chart' | 'table'>
              label="Show as"
              value={view}
              onChange={setView}
              options={[
                { value: 'chart', label: 'Chart' },
                { value: 'table', label: 'Table' },
              ]}
            />
          </div>
        ) : null}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {has && view === 'table' ? (
          <motion.div key="table" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2, ease: EASE_OUT }}>
            <ChartTable {...table} className="border-[color-mix(in_srgb,var(--ink)_8%,transparent)] bg-surface/60" />
          </motion.div>
        ) : (
          <motion.div key={`chart-${range}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            {has ? (
              <StripChart
                days={days}
                q={q}
                today={today}
                selectedDate={selectedDate}
                onSelect={onSelect}
                name={info?.name ?? forecast?.name ?? ''}
              />
            ) : (
              <EmptyStrip today={today} empty={empty} />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-2">
        {forecast?.run ? (
          <>
            <span className="hud text-copper">
              {demo ? 'Demo · simulated' : `Modeled · ${forecast.run.provider === 'nws-grid' ? 'NWS' : 'Open-Meteo'}`} · fetched{' '}
              {instantLocal(forecast.run.fetchedAt, forecast.timezone, 'ccc HH:mm')}
            </span>
            <span>
              {demo ? 'Simulated for the demo — not a real forecast. ' : ''}Read amounts as “likely”, not promised.
              {forecast.fallbackFrom ? ` ${POINT_LABEL[forecast.fallbackFrom]} not stored — showing ${POINT_LABEL[shown].toLowerCase()}.` : ''}
              {health?.lastFailure ? ` A newer fetch ${relativeLabel(health.lastFailure.at, now)} failed; this is the last successful one.` : ''}
            </span>
          </>
        ) : (
          <span>Weather-model output appears here once fetched. Nothing is estimated in its place.</span>
        )}
      </p>
    </GlassPanel>
  )
}

function StripChart({
  days,
  q,
  today,
  selectedDate,
  onSelect,
  name,
}: {
  days: readonly DayView[]
  q: ReturnType<typeof chartUnits>
  today: string
  selectedDate: string | null
  onSelect: (date: string) => void
  name: string
}) {
  const reduce = useReducedMotion()
  const n = days.length
  const [hover, setHover] = useState<number | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const freezing = q.temp.toDisplay(0) ?? 0
  const his = days.map((d) => q.temp.toDisplay(d.tempMaxC))
  const los = days.map((d) => q.temp.toDisplay(d.tempMinC))
  const snow = days.map((d) => q.snow.toDisplay(d.snowfallCm))
  const geo = tempGeometry(his, los, { w: W, top: 18, bottom: H - BARS_H - 26, freezing })
  const snowMax = Math.max(q.snow.floorMax * 4, ...snow.filter(finite))
  const firstTrend = days.findIndex((d) => d.trend)
  const selIdx = days.findIndex((d) => d.date === selectedDate)
  const focusIdx = cursor ?? (selIdx >= 0 ? selIdx : 0)
  const active = hover ?? (selIdx >= 0 ? selIdx : null)
  const leave = (i: number) => setHover((v) => (v === i ? null : v))

  const sentence = (d: DayView, i: number) => {
    const s = snow[i]
    const snowTxt = finite(s)
      ? s > 0
        ? `likely ${d.partial ? 'at least ' : ''}${q.snow.format(d.snowfallCm)} of snow`
        : d.partial
          ? 'no snow modeled in the hours covered'
          : 'little or no snow likely'
      : 'snowfall not provided'
    const t =
      finite(his[i]) && finite(los[i]) ? `, high ${q.temp.format(d.tempMaxC)} / low ${q.temp.format(d.tempMinC)}` : ', temperature not provided'
    return `${d.date === today ? 'Today, ' : ''}${formatLocalDate(d.date, 'cccc d LLL')}: ${snowTxt}${t}${d.trend ? ' — a less certain trend' : ''}. Modeled, not observed.`
  }

  const onKey = (e: KeyboardEvent, i: number) => {
    const map: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: n - 1 }
    if (!(e.key in map)) return
    e.preventDefault()
    const next = Math.max(0, Math.min(n - 1, map[e.key]))
    setCursor(next)
    refs.current[next]?.focus()
  }

  const pct = (y: number) => `${(y / H) * 100}%`
  const zeroLabel = q.temp.format(0)
  // The freezing label sits top-left on the dashed line; an active value label in the first columns near the line
  // would cover it, so it steps aside then (the legend still names the line).
  const zeroCrowded =
    !!geo &&
    geo.zeroY !== null &&
    active !== null &&
    active < Math.max(2, n * 0.15) &&
    [his[active], los[active]].some((v) => finite(v) && (Math.abs(geo.y(v) - geo.zeroY!) / H) * 260 < 30)

  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-1 overflow-x-auto px-1 pb-1 scrollbar-thin">
        <div className="relative" style={{ minWidth: n * 38 }}>
          <div className="relative h-[260px] md:h-[300px]">
            {/* Less-certain trend band */}
            {firstTrend > 0 ? (
              <div aria-hidden className="absolute inset-y-0 right-0 rounded-[16px]" style={{ left: `${(firstTrend / n) * 100}%`, backgroundImage: HATCH }}>
                <span className="hud glass-strong absolute top-1.5 right-2 z-[1] rounded-full px-2 py-0.5 text-ink-2 max-sm:hidden">Less certain trend</span>
              </div>
            ) : null}
            {/* Hovered / selected column */}
            {active !== null ? (
              <motion.div
                aria-hidden
                className="absolute inset-y-0 rounded-[14px] bg-[color-mix(in_srgb,var(--teal)_9%,transparent)]"
                initial={false}
                animate={{ left: `${(active / n) * 100}%` }}
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                style={{ width: `${100 / n}%` }}
              />
            ) : null}
            {geo ? (
              <motion.svg
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                aria-hidden
                className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                initial={reduce ? false : { clipPath: 'inset(-10% 100% -10% 0)' }}
                animate={{ clipPath: 'inset(-10% 0% -10% 0)' }}
                transition={{ duration: 1.3, ease: EASE_OUT }}
              >
                {geo.zeroY !== null ? (
                  <line x1="0" x2={W} y1={geo.zeroY} y2={geo.zeroY} stroke="var(--teal)" strokeOpacity=".45" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
                ) : null}
                <motion.path d={geo.band} fill="color-mix(in srgb, var(--teal) 11%, transparent)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.5 }} />
                <motion.path
                  d={geo.hi}
                  fill="none"
                  stroke="var(--copper)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                <motion.path
                  d={geo.lo}
                  fill="none"
                  stroke="var(--teal)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </motion.svg>
            ) : null}
            {geo && geo.zeroY !== null && !zeroCrowded ? (
              <span aria-hidden className="absolute left-1 -translate-y-[120%] font-mono text-[12px] text-teal" style={{ top: pct(geo.zeroY) }}>
                {zeroLabel}
              </span>
            ) : null}
            {/* Dots + values on the active day: labels sit beside the dot (to the left near the right edge) and are
                pushed apart when high and low are close, so the two values never overlap each other. */}
            {geo && active !== null
              ? (() => {
                  const vals = [
                    [his[active], 'bg-copper', q.temp.short(days[active].tempMaxC)],
                    [los[active], 'bg-teal', q.temp.short(days[active].tempMinC)],
                  ] as const
                  const gapPx = finite(his[active]) && finite(los[active]) ? (Math.abs(geo.y(his[active]) - geo.y(los[active])) / H) * 260 : 99
                  const push = gapPx < 24 ? (24 - gapPx) / 2 : 0
                  const leftSide = active >= n * 0.72
                  return vals.map(([v, tone, txt], k) =>
                    finite(v) ? (
                      <span
                        key={k}
                        aria-hidden
                        className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 transition-[left,top] duration-200"
                        style={{ left: `${((active + 0.5) / n) * 100}%`, top: pct(geo.y(v)) }}
                      >
                        <span className={cn('size-2.5 rounded-full shadow-[0_0_0_3px_var(--surface)]', tone)} />
                        <span
                          className={cn('glass-strong absolute rounded-full px-1.5 font-mono text-[12px] whitespace-nowrap text-ink tnum', leftSide ? 'right-3' : 'left-3')}
                          style={push ? { transform: `translateY(${k === 0 ? -push : push}px)` } : undefined}
                        >
                          {txt}
                        </span>
                      </span>
                    ) : null,
                  )
                })()
              : null}

            {/* Snowfall bars */}
            <div role="group" aria-label={`${n}-day modeled snowfall and temperature for ${name}. Use the arrow keys to move between days; Enter selects a day. A table view is available.`} className="absolute inset-x-0 bottom-0 grid" style={{ height: BARS_H, gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
              {days.map((d, i) => {
                const v = snow[i]
                const on = active === i
                const dim = hover !== null && hover !== i
                const h = finite(v) && v > 0 ? Math.max(4, (v / snowMax) * 100) : 0
                const sel = d.date === selectedDate
                return (
                  <button
                    key={d.date}
                    ref={(el) => {
                      refs.current[i] = el
                    }}
                    type="button"
                    tabIndex={i === focusIdx ? 0 : -1}
                    aria-pressed={sel}
                    aria-label={sentence(d, i)}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => leave(i)}
                    onFocus={() => {
                      setHover(i)
                      setCursor(i)
                    }}
                    onBlur={() => leave(i)}
                    onClick={() => onSelect(d.date)}
                    onKeyDown={(e) => onKey(e, i)}
                    className={cn(
                      'group relative flex h-full flex-col items-center justify-end gap-1 px-[3px] outline-offset-2 transition-[opacity,transform] duration-[350ms] ease-[cubic-bezier(.3,1.4,.5,1)] md:px-[5px]',
                      dim ? 'opacity-45' : 'opacity-100',
                      on && '-translate-y-1',
                    )}
                  >
                    <span className={cn('text-[12px] leading-none font-semibold tnum', finite(v) && v > 0 ? 'text-ink' : 'text-ink-3')}>
                      {finite(v) ? `${d.partial && v > 0 ? '≥' : ''}${q.snow.short(d.snowfallCm)}` : '–'}
                    </span>
                    {h > 0 ? (
                      <motion.span
                        className={cn(
                          'block w-full max-w-[34px] rounded-t-[8px] rounded-b-[3px] transition-shadow duration-200',
                          on && 'shadow-[0_10px_22px_color-mix(in_srgb,var(--teal)_35%,transparent)]',
                          d.trend && !on && 'opacity-60',
                        )}
                        style={{
                          height: `${h}%`,
                          originY: 1,
                          background: `linear-gradient(180deg, var(--snow-top), ${on || sel ? 'var(--ink-chip)' : 'var(--teal)'})`,
                        }}
                        initial={{ scaleY: 0 }}
                        animate={{ scaleY: 1 }}
                        transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1], delay: 0.1 + i * 0.035 }}
                      />
                    ) : (
                      <span className={cn('block h-[2px] w-full max-w-[34px] rounded-full', finite(v) ? 'bg-[color-mix(in_srgb,var(--ink)_18%,transparent)]' : 'border-t border-dashed border-ink-3')} />
                    )}
                    {sel ? <span aria-hidden className="absolute -bottom-1 h-[3px] w-4 rounded-full bg-ink-chip" /> : null}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Day labels */}
          <div aria-hidden className="mt-2 grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
            {days.map((d, i) => {
              const sel = d.date === selectedDate
              return (
                <div key={d.date} className={cn('flex flex-col items-center gap-0.5 transition-opacity duration-200', hover !== null && hover !== i && 'opacity-50')}>
                  <span className={cn('font-mono text-[12px] tracking-[0.06em]', d.date === today ? 'text-teal' : 'text-ink-2')}>
                    {d.date === today ? 'NOW' : formatLocalDate(d.date, 'ccc').toUpperCase()}
                  </span>
                  <span className={cn('flex size-7 items-center justify-center rounded-full text-[12.5px] font-semibold tnum', sel ? 'bg-ink-chip text-on-ink-chip' : 'text-ink')}>
                    {Number(d.date.slice(8))}
                  </span>
                  <span className={cn('font-mono text-[12px] whitespace-nowrap text-ink-2 tnum', n > 8 ? 'max-lg:hidden' : 'max-sm:hidden')}>
                    {finite(his[i]) && finite(los[i]) ? `${q.temp.short(d.tempMaxC)}/${q.temp.short(d.tempMinC)}` : '–'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <i aria-hidden className="h-2.5 w-3.5 rounded-[3px] bg-linear-to-b from-snow-top to-teal" />
          Snowfall
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i aria-hidden className="h-[2px] w-4 rounded-full bg-copper" />
          High
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i aria-hidden className="h-[2px] w-4 rounded-full bg-teal" />
          Low
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i aria-hidden className="w-4 border-t border-dashed border-teal" />
          Freezing
        </span>
        {firstTrend > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <i aria-hidden className="h-2.5 w-3.5 rounded-[3px]" style={{ backgroundImage: HATCH }} />
            Days {firstTrend + 1}–{n}: less certain trend
          </span>
        ) : null}
        <span>≥ partial day</span>
      </div>
      <DetailLine active={hover !== null}>
        {hover !== null
          ? sentence(days[hover], hover)
          : selIdx >= 0
            ? `${sentence(days[selIdx], selIdx)} Details below.`
            : 'Hover or focus a day for detail; select it to open the day below.'}
      </DetailLine>
    </div>
  )
}

/** Same frame, real dates, nothing plotted — and a glass card that says why. */
function EmptyStrip({ today, empty }: { today: string; empty: { title: string; body: ReactNode; actions?: ReactNode } }) {
  const dates = Array.from({ length: 16 }, (_, i) => addDays(today, i))
  return (
    <div className="relative">
      <div aria-hidden className="-mx-1 overflow-hidden px-1">
        <div className="relative h-[150px] md:h-[300px]">
          <div className="absolute inset-y-0 right-0 rounded-[16px]" style={{ left: `${(7 / 16) * 100}%`, backgroundImage: HATCH }} />
          <div className="absolute inset-x-0 top-[38%] border-t border-dashed border-[color-mix(in_srgb,var(--teal)_40%,transparent)]" />
          <div className="absolute inset-x-0 bottom-0 grid h-[80px] grid-cols-16 items-end md:h-[120px]">
            {dates.map((d) => (
              <div key={d} className="flex flex-col items-center gap-1 px-[3px] md:px-[5px]">
                <span className="text-[12px] text-ink-3">–</span>
                <span className="block h-[2px] w-full max-w-[34px] border-t border-dashed border-ink-3" />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-16">
          {dates.map((d) => (
            <div key={d} className="flex flex-col items-center gap-0.5 opacity-70">
              <span className="font-mono text-[12px] text-ink-3 max-sm:hidden">{d === today ? 'NOW' : formatLocalDate(d, 'ccc').toUpperCase()}</span>
              <span className="text-[12.5px] font-semibold text-ink-2 tnum">{Number(d.slice(8))}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="relative mt-3 flex justify-center md:absolute md:inset-0 md:mt-0 md:items-center md:p-2 md:pb-12">
        <div className="glass-strong flex max-w-[520px] flex-col items-start gap-2.5 rounded-[22px] px-5 py-4 md:px-6 md:py-5">
          <span className="hud inline-flex items-center gap-2 text-copper">
            <CloudOff aria-hidden className="size-4" />
            Not fetched yet
          </span>
          <h3 className="m-0 text-[22px] leading-tight font-light tracking-[-0.02em] text-ink md:text-[26px]">{empty.title}</h3>
          <div className="text-[13.5px] leading-[1.5] text-ink-2">{empty.body}</div>
          {empty.actions ? <div className="mt-1 flex flex-wrap gap-2">{empty.actions}</div> : null}
        </div>
      </div>
    </div>
  )
}
