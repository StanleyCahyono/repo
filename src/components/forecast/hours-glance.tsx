'use client'
/**
 * Next 48 hours at a glance (focus resort): the modeled temperature line drawn over a soft area, hourly snowfall as
 * thin bars along the floor, the freezing line, and a scrubber — hover, drag or ←/→ — that fills the detail line.
 * A Chart/Table toggle gives the hourly table. The full multi-variable timeline stays in "Hour by hour" below.
 */
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowDown, CloudOff } from 'lucide-react'
import { ChartTable } from '@/components/charts/chart-table'
import { chartUnits, minus } from '@/components/charts/units'
import type { ResortForecast } from '@/lib/data/forecast'
import type { ResortInfo } from '@/lib/data/forecast-screen'
import { zoneAbbrev } from '@/lib/domain/time'
import type { UnitPrefs } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'
import { EASE_OUT } from '@/lib/ui/motion'
import { CountUp, DetailLine, GlassPanel, PillToggle } from './hud'
import { dayShort, intervalLabel, POINT_LABEL, pointElevation, seriesGeometry, summarizeHours, windowHours } from './model'

const W = 1000
const H = 170
const FLOOR = 150
const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

export function HoursGlance({ forecast, info, units, now }: { forecast: ResortForecast | null; info: ResortInfo | undefined; units: UnitPrefs; now: string }) {
  const q = useMemo(() => chartUnits(units), [units])
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const sem = forecast?.run?.intervalSemantics ?? 'preceding-hour'
  const hourly = useMemo(() => (forecast?.run ? windowHours(forecast.hourly, 48, 'instant').slice(0, 49) : []), [forecast])
  const tz = forecast?.timezone ?? info?.timezone ?? 'UTC'
  const summary = useMemo(() => (forecast?.run ? summarizeHours(forecast.hourly, 48, sem) : null), [forecast, sem])
  const shown = forecast?.shownPoint ?? 'base'
  const elev = forecast?.run?.requested.elevationM ?? pointElevation(info, shown)
  const where = `${POINT_LABEL[shown].toLowerCase()}${elev !== null ? ` (${q.elevation.format(elev)})` : ''}`

  return (
    <GlassPanel aria-labelledby="glance-title" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="glance-title" className="m-0 text-[16px] font-semibold text-ink">
            Next 48 hours
          </h2>
          <span className="hud text-ink-2">Temperature {q.temp.unit} · snowfall · hourly</span>
        </div>
        {hourly.length ? (
          <PillToggle<'chart' | 'table'>
            label="Show as"
            value={view}
            onChange={setView}
            options={[
              { value: 'chart', label: 'Chart' },
              { value: 'table', label: 'Table' },
            ]}
          />
        ) : null}
      </div>

      {!hourly.length ? (
        <div className="relative">
          <div aria-hidden className="relative h-[170px]">
            <div className="absolute inset-x-0 top-[45%] border-t border-dashed border-ink-3/60" />
            <div className="absolute inset-x-0 bottom-[12%] border-t border-[color-mix(in_srgb,var(--ink)_10%,transparent)]" />
          </div>
          <Ticks />
          <div className="absolute inset-x-0 top-[30px] flex justify-center">
            <p className="glass-strong m-0 inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] text-ink-2">
              <CloudOff aria-hidden className="size-4 text-copper" />
              Not fetched yet — no hourly model output stored.
            </p>
          </div>
        </div>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          {view === 'chart' ? (
            <motion.div key="chart" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <GlanceChart hourly={hourly} q={q} tz={tz} sem={sem} now={now} name={info?.name ?? forecast?.name ?? ''} />
            </motion.div>
          ) : (
            <motion.div key="table" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2, ease: EASE_OUT }}>
              <ChartTable
                caption={`Hourly modeled temperature and snowfall, next 48 hours (${zoneAbbrev(hourly[0].validTime, tz)})`}
                rowHeader="Time"
                columns={[
                  { key: 'temp', label: 'Temperature', unit: q.temp.unit },
                  { key: 'snow', label: 'Snowfall', unit: q.snow.unit },
                  { key: 'wind', label: 'Gusts', unit: q.speed.unit },
                ]}
                rows={hourly.map((h) => ({
                  key: h.validTime,
                  header: `${dayShort(h.localDate)} · ${h.localTime}`,
                  cells: { temp: q.temp.short(h.temperatureC), snow: q.snow.short(h.snowfallCm), wind: q.speed.short(h.gustKmh) },
                }))}
                maxHeight={232}
                className="border-[color-mix(in_srgb,var(--ink)_8%,transparent)] bg-surface/60"
              />
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {summary && summary.tempMin !== null && summary.tempMax !== null ? (
        <p className="m-0 text-[13px] text-ink-2">
          Likely between{' '}
          <CountUp className="font-semibold text-ink" value={q.temp.toDisplay(summary.tempMin) ?? 0} format={roundTemp} /> and{' '}
          <CountUp className="font-semibold text-ink" value={q.temp.toDisplay(summary.tempMax) ?? 0} format={(v) => `${roundTemp(v)} ${q.temp.unit}`} /> at {where}
          {summary.snow.sum !== null
            ? summary.snow.sum > 0
              ? `, with ${summary.snow.complete ? '' : 'at least '}${q.snow.format(summary.snow.sum)} of snow.`
              : ', no snow modeled.'
            : '.'}
        </p>
      ) : null}
      {hourly.length ? (
        <a href="#hourly" className="hud inline-flex w-fit items-center gap-1 rounded-full text-teal hover:underline">
          Every variable, hour by hour <ArrowDown aria-hidden className="size-3.5" />
        </a>
      ) : null}
    </GlassPanel>
  )
}

/** Count-up frames are in display units already. */
const roundTemp = (v: number) => minus(String(Math.round(v) || 0))

function Ticks() {
  return (
    <div aria-hidden className="mt-1.5 flex justify-between font-mono text-[12px] text-ink-2">
      <span>NOW</span>
      <span>+12 H</span>
      <span>+24 H</span>
      <span>+36 H</span>
      <span>+48 H</span>
    </div>
  )
}

function GlanceChart({
  hourly,
  q,
  tz,
  sem,
  now,
  name,
}: {
  hourly: ResortForecast['hourly']
  q: ReturnType<typeof chartUnits>
  tz: string
  sem: 'preceding-hour' | 'following-hour' | 'instant'
  now: string
  name: string
}) {
  const reduce = useReducedMotion()
  const temps = hourly.map((h) => q.temp.toDisplay(h.temperatureC))
  const snows = hourly.map((h) => q.snow.toDisplay(h.snowfallCm))
  const geo = seriesGeometry(temps, { w: W, top: 14, bottom: FLOOR - 8, minSpan: q.temp.unit === '°F' ? 10 : 6 })
  const snowMax = Math.max(q.snow.floorMax * 2, ...snows.filter(finite))
  const freezing = q.temp.toDisplay(0) ?? 0
  const zeroY = geo && freezing >= geo.min && freezing <= geo.max ? geo.y(freezing) : null
  const n = hourly.length
  const [active, setActive] = useState<number | null>(null)
  const box = useRef<HTMLDivElement | null>(null)

  const at = (clientX: number) => {
    const r = box.current?.getBoundingClientRect()
    if (!r || n < 2) return
    const i = Math.round(((clientX - r.left) / r.width) * (n - 1))
    setActive(Math.max(0, Math.min(n - 1, i)))
  }
  const onPointer = (e: PointerEvent) => at(e.clientX)
  const onKey = (e: KeyboardEvent) => {
    const cur = active ?? 0
    const map: Record<string, number> = { ArrowRight: cur + 1, ArrowLeft: cur - 1, PageUp: cur - 6, PageDown: cur + 6, Home: 0, End: n - 1 }
    if (!(e.key in map)) return
    e.preventDefault()
    setActive(Math.max(0, Math.min(n - 1, map[e.key])))
  }
  const h = active !== null ? hourly[active] : null
  const rel = h ? Math.round((Date.parse(h.validTime) - Date.parse(now)) / 3_600_000) : 0
  const text = h
    ? `${dayShort(h.localDate)} ${h.localTime} ${zoneAbbrev(h.validTime, tz)} (${rel <= 0 ? 'now' : `in ${rel} h`}): likely ${q.temp.format(h.temperatureC) ?? 'temperature not provided'}${
        finite(h.snowfallCm) ? `, snowfall ${q.snow.format(h.snowfallCm)} (${intervalLabel(h, sem, tz)})` : ''
      }${finite(h.gustKmh) ? `, gusts ${q.speed.format(h.gustKmh)}` : ''}.`
    : 'Hover or drag across the chart — or focus it and use ← → — to read an hour.'

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={box}
        role="slider"
        tabIndex={0}
        aria-label={`Hour in the next 48 hours at ${name}`}
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={active ?? 0}
        aria-valuetext={text}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        className="relative h-[170px] touch-pan-y rounded-[12px] outline-offset-4"
      >
        <motion.svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden
          className="absolute inset-0 h-full w-full overflow-visible"
          initial={reduce ? false : { clipPath: 'inset(-10% 100% -10% 0)' }}
          animate={{ clipPath: 'inset(-10% 0% -10% 0)' }}
          transition={{ duration: 1.4, ease: EASE_OUT }}
        >
          <defs>
            <linearGradient id="glance-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--teal)" stopOpacity=".22" />
              <stop offset="1" stopColor="var(--teal)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" x2={W} y1={FLOOR} y2={FLOOR} stroke="var(--ink)" strokeOpacity=".1" vectorEffect="non-scaling-stroke" />
          {zeroY !== null ? <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="var(--teal)" strokeOpacity=".5" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" /> : null}
          {snows.map((v, i) =>
            finite(v) && v > 0 ? (
              <motion.rect
                key={i}
                x={(i / (n - 1)) * W - 5}
                width={10}
                y={FLOOR - Math.max(3, (v / snowMax) * 46)}
                height={Math.max(3, (v / snowMax) * 46)}
                rx={2}
                fill="var(--snow-top)"
                style={{ originY: 1, transformBox: 'fill-box' }}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ duration: 0.6, delay: 0.4 + i * 0.01 }}
              />
            ) : null,
          )}
          {geo ? (
            <>
              <motion.path d={geo.area} fill="url(#glance-area)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, delay: 0.4 }} />
              <motion.path
                d={geo.line}
                fill="none"
                stroke="var(--teal)"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : null}
        </motion.svg>
        {zeroY !== null ? (
          <span aria-hidden className="absolute right-0 -translate-y-[120%] font-mono text-[12px] text-teal" style={{ top: `${(zeroY / H) * 100}%` }}>
            {q.temp.format(0)}
          </span>
        ) : null}
        {h && geo ? (
          <>
            <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-ink-chip/50" style={{ left: `${(active! / (n - 1)) * 100}%` }} />
            {finite(temps[active!]) ? (
              <span
                aria-hidden
                className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center"
                style={{ left: `${(active! / (n - 1)) * 100}%`, top: `${(geo.y(temps[active!] as number) / H) * 100}%` }}
              >
                <span className="size-3 rounded-full bg-teal shadow-[0_0_0_3px_var(--surface),0_0_14px_var(--teal)]" />
                <span
                  className={cn(
                    'glass-strong absolute rounded-full px-2 py-0.5 font-mono text-[12px] whitespace-nowrap text-ink tnum',
                    active! > n * 0.8 ? 'right-4' : 'left-4',
                  )}
                >
                  {h.localTime} · {q.temp.format(h.temperatureC)}
                </span>
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      <Ticks />
      <DetailLine active={h !== null}>{text}</DetailLine>
    </div>
  )
}
