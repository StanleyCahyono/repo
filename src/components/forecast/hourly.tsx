'use client'
/**
 * Next 48 hours for the focus resort at the chosen point: snowfall, temperature + feels-like, rain, wind/gusts,
 * visibility and freezing level on one time axis with a single scrubber (pointer, touch drag, ←/→, PageUp/PageDown,
 * Home/End). The readout gives exact values for the scrubbed hour, including the accumulation interval of snowfall
 * and rain under the provider's documented semantics. "Show as table" lists every hour.
 * Variables the source did not return read "Not provided" — never zero.
 */
import { useMemo, useState } from 'react'
import { MoveHorizontal } from 'lucide-react'
import { ChartFrame } from '@/components/charts/chart-frame'
import { SnowfallBars, WindBand } from '@/components/charts/presets'
import { dayMarks, hourInterval, hourTicks, runsOf, tickStep, type DayMark, type LocalStamp } from '@/components/charts/scale'
import { TimeAxis, TimeChart, TimePanel, type TimeBar, type TimePoint, type TimeShade } from '@/components/charts/time-chart'
import { chartUnits } from '@/components/charts/units'
import { Missing } from '@/components/ui/provenance'
import type { HourView, ResortForecast } from '@/lib/data/forecast'
import type { ResortInfo, WeatherHealth } from '@/lib/data/forecast-screen'
import { zoneAbbrev } from '@/lib/domain/time'
import type { UnitPrefs } from '@/lib/domain/types'
import { dayMedium, dayShort, intervalLabel, ms, POINT_LABEL, pointElevation, provided, summarizeHours, zoneLabel } from './model'
import { RunDetails } from './run-details'

type Q = ReturnType<typeof chartUnits>

const TICK_STEPS = [1, 2, 3, 6, 12] as const

export function HourlyForecast({
  forecast,
  info,
  units,
  now,
  health,
}: {
  forecast: ResortForecast
  info: ResortInfo | undefined
  units: UnitPrefs
  now: string
  health: WeatherHealth | undefined
}) {
  const q = useMemo(() => chartUnits(units), [units])
  const sem = forecast.run?.intervalSemantics ?? 'preceding-hour'
  const tz = forecast.timezone
  const hourly = forecast.hourly
  const name = info?.name ?? forecast.name
  const shown = forecast.shownPoint ?? forecast.point
  const elevationM = forecast.run?.requested.elevationM ?? pointElevation(info, shown)
  const [active, setActive] = useState(0)

  const m = useMemo(() => build(hourly, sem, q), [hourly, sem, q])
  const summary = useMemo(() => summarizeHours(hourly, 48, sem), [hourly, sem])
  const zone = zoneLabel(
    tz,
    hourly.map((h) => h.validTime),
  )
  const cur = hourly[Math.min(active, hourly.length - 1)]

  if (!hourly.length) return null

  const valueText = (i: number) => {
    const h = hourly[i]
    const parts = [
      `snowfall ${q.snow.format(h.snowfallCm) ?? 'not provided'} (${intervalLabel(h, sem, tz)})`,
      `temperature ${q.temp.format(h.temperatureC) ?? 'not provided'}`,
      `feels like ${q.temp.format(h.apparentTemperatureC) ?? 'not provided'}`,
      `rain ${q.precip.format(h.rainMm) ?? 'not provided'}`,
      `wind ${q.speed.format(h.windKmh) ?? 'not provided'}${h.gustKmh !== null ? ` gusting ${q.speed.format(h.gustKmh)}` : ''}`,
      `visibility ${q.visibility.format(h.visibilityM) ?? 'not provided'}`,
      `freezing level ${q.elevation.format(h.freezingLevelM) ?? 'not provided'}`,
    ]
    return `${dayMedium(h.localDate)} ${h.localTime} ${zoneAbbrev(h.validTime, tz)}: ${parts.join(', ')}`
  }

  const ge = (complete: boolean) => (complete ? '' : '≥ ')
  const snowTotal = summary.snow.sum !== null ? `${ge(summary.snow.complete)}${q.snow.format(summary.snow.sum)}` : null
  const rainTotal = summary.rain.sum !== null ? `${ge(summary.rain.complete)}${q.precip.format(summary.rain.sum)}` : null
  const tempRange = summary.tempMin !== null && summary.tempMax !== null ? `${q.temp.short(summary.tempMin)} to ${q.temp.format(summary.tempMax)}` : null
  const fzRange =
    summary.freezingMin !== null && summary.freezingMax !== null ? `${q.elevation.short(summary.freezingMin)}–${q.elevation.format(summary.freezingMax)}` : null
  const pointLabel = `${POINT_LABEL[shown]}${elevationM !== null ? ` ${q.elevation.format(elevationM)}` : ''}`

  const table = {
    caption: `Hourly forecast for ${name}, ${pointLabel} (weather-model output, times in ${zone})`,
    rowHeader: `Time (${zone})`,
    columns: [
      { key: 'snow', label: 'Snowfall', unit: q.snow.unit },
      { key: 'temp', label: 'Temperature', unit: q.temp.unit },
      { key: 'feels', label: 'Feels like', unit: q.temp.unit },
      { key: 'rain', label: 'Rain', unit: q.precip.unit },
      { key: 'wind', label: 'Wind', unit: q.speed.unit },
      { key: 'gust', label: 'Gusts', unit: q.speed.unit },
      { key: 'vis', label: 'Visibility', unit: q.visibility.unit },
      { key: 'fz', label: 'Freezing level', unit: q.elevation.unit },
    ],
    rows: hourly.map((h, i) => ({
      key: h.validTime,
      header: `${dayShort(h.localDate)} · ${h.localTime}`,
      tone: i === active ? ('selected' as const) : ('default' as const),
      cells: {
        snow: q.snow.short(h.snowfallCm),
        temp: q.temp.short(h.temperatureC),
        feels: q.temp.short(h.apparentTemperatureC),
        rain: q.precip.short(h.rainMm),
        wind: q.speed.short(h.windKmh),
        gust: q.speed.short(h.gustKmh),
        vis: q.visibility.short(h.visibilityM),
        fz: q.elevation.short(h.freezingLevelM),
      },
    })),
    maxHeight: 460,
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[12px] border border-divider bg-surface px-3 pt-3 pb-3.5 md:px-5 md:pt-4 md:pb-4">
        <ChartFrame
          title="Hourly model forecast"
          titleAs="h3"
          subtitle={`Times in ${zone} (resort local). Snowfall and rain are totals for ${sem === 'preceding-hour' ? 'the hour before' : sem === 'following-hour' ? 'the hour after' : 'the hour around'} each time.`}
          kind="modeled"
          demo={forecast.run?.kind === 'demo'}
          table={table}
          footer={
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1">
                <MoveHorizontal aria-hidden className="size-3.5" /> Drag across the chart, or focus it and use ← → (PageUp/PageDown jump 6 h).
              </span>
              {m.shades.length ? <span>Shaded columns: night, from the provider’s day/night flag.</span> : null}
              <span>Dashed rule: now.</span>
            </span>
          }
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_236px] lg:gap-6">
            <div className="min-w-0">
              {cur ? <CompactReadout h={cur} sem={sem} tz={tz} q={q} now={now} /> : null}
              <TimeChart
                times={m.times}
                domain={m.domain}
                tickFor={(w) => hourTicks(m.stamps, tickStep(w, 48, 46, TICK_STEPS))}
                days={m.days}
                shades={m.shades}
                now={ms(now)}
                active={active}
                onActiveChange={setActive}
                label={`Hour in the 48-hour forecast for ${name}, ${POINT_LABEL[shown].toLowerCase()}`}
                valueText={valueText}
                margin={{ left: 46, right: 12 }}
              >
                <SnowfallBars
                  bars={m.snow}
                  unit={q.snow.unit}
                  floorMax={q.snow.floorMax}
                  format={q.snow.tick}
                  height={78}
                  summary={snowTotal ? `48 h: ${snowTotal}` : undefined}
                  kind={forecast.run?.kind}
                />
                <TimePanel
                  className="mt-3"
                  title="Temperature"
                  unit={q.temp.unit}
                  height={96}
                  series={[
                    { type: 'line', id: 'temp', label: 'Temperature', tone: 'ink', points: m.temp },
                    { type: 'line', id: 'feels', label: 'Feels like', tone: 'ink-3', style: 'dotted', points: m.feels },
                  ]}
                  y={{ minSpan: q.temp.unit === '°F' ? 12 : 6, format: q.temp.tick }}
                  refLines={[{ value: q.temp.toDisplay(0)!, label: 'Freezing', include: false, tone: 'teal' }]}
                  summary={tempRange ?? undefined}
                  empty="Temperature not provided by this source"
                />
                <TimePanel
                  className="mt-3"
                  title="Rain"
                  unit={q.precip.unit}
                  height={48}
                  series={[{ type: 'bars', id: 'rain', label: 'Rain', tone: 'ink-2', bars: m.rain }]}
                  y={{ includeZero: true, floorMax: q.precip.floorMax, format: q.precip.tick, ticks: 2 }}
                  summary={rainTotal ? `48 h: ${rainTotal}` : undefined}
                  note={summary.rain.sum === 0 ? 'None modeled' : undefined}
                  empty="Rain not provided by this source"
                />
                <WindBand
                  className="mt-3"
                  wind={m.wind}
                  gust={m.gust}
                  unit={q.speed.unit}
                  floorMax={q.speed.floorMax}
                  format={q.speed.tick}
                  height={78}
                  summary={
                    summary.gustMax !== null
                      ? `gusts to ${q.speed.format(summary.gustMax)}`
                      : summary.windMax !== null
                        ? `max ${q.speed.format(summary.windMax)}`
                        : undefined
                  }
                />
                <TimePanel
                  className="mt-3"
                  title="Visibility"
                  unit={q.visibility.unit}
                  height={48}
                  series={[{ type: 'line', id: 'vis', label: 'Visibility', tone: 'ink-3', points: m.vis }]}
                  y={{ domain: [0, q.visibility.cap ?? 16], ticks: 2, format: q.visibility.tick }}
                  summary={summary.visibilityMin !== null ? `lowest ${q.visibility.format(summary.visibilityMin)}` : undefined}
                  empty="Visibility not provided by this source"
                />
                <TimePanel
                  className="mt-3"
                  title="Freezing level"
                  unit={q.elevation.unit}
                  height={64}
                  series={[{ type: 'line', id: 'fz', label: 'Freezing level', tone: 'ink', points: m.fz }]}
                  y={{ minSpan: q.elevation.unit === 'ft' ? 2000 : 600, format: q.elevation.tick, ticks: 2 }}
                  refLines={
                    elevationM !== null && provided(hourly, 'freezingLevelM')
                      ? [{ value: q.elevation.toDisplay(elevationM)!, label: `${POINT_LABEL[shown]} ${q.elevation.format(elevationM)}`, tone: 'teal' }]
                      : []
                  }
                  summary={fzRange ?? undefined}
                  empty="Freezing level not provided by this source"
                />
                <TimeAxis className="mt-1" />
              </TimeChart>
            </div>
            <aside aria-label="Values at the selected hour" className="hidden lg:block">
              {cur ? <Readout h={cur} sem={sem} tz={tz} q={q} now={now} /> : null}
            </aside>
          </div>
        </ChartFrame>
      </div>
      {forecast.run ? <RunDetails forecast={forecast} info={info} units={units} now={now} health={health} /> : null}
    </div>
  )
}

function Readout({ h, sem, tz, q, now }: { h: HourView; sem: 'preceding-hour' | 'following-hour' | 'instant'; tz: string; q: Q; now: string }) {
  const rel = Math.round((ms(h.validTime) - ms(now)) / 3_600_000)
  const iv = intervalLabel(h, sem, tz)
  const rows: { label: string; value: string | null; note?: string }[] = [
    { label: 'Snowfall', value: q.snow.format(h.snowfallCm), note: iv },
    { label: 'Temperature', value: q.temp.format(h.temperatureC) },
    { label: 'Feels like', value: q.temp.format(h.apparentTemperatureC) },
    { label: 'Rain', value: q.precip.format(h.rainMm), note: iv },
    { label: 'Wind', value: q.speed.format(h.windKmh) },
    { label: 'Gusts', value: q.speed.format(h.gustKmh) },
    { label: 'Visibility', value: q.visibility.format(h.visibilityM) },
    { label: 'Freezing level', value: q.elevation.format(h.freezingLevelM) },
  ]
  return (
    <div className="sticky top-6 rounded-[12px] border border-divider bg-surface-2 px-3.5 py-3">
      <div className="flex flex-col items-start gap-0.5">
        <p className="text-[13px] font-medium text-ink-2">{dayMedium(h.localDate)}</p>
        <p className="flex items-baseline gap-1.5">
          <span className="font-display text-[34px] leading-none text-ink tnum">{h.localTime}</span>
          <span className="text-[12.5px] text-ink-3">
            {zoneAbbrev(h.validTime, tz)} · {rel <= 0 ? 'now' : `in ${rel} h`}
          </span>
        </p>
      </div>
      <dl className="mt-2.5 grid grid-cols-1 gap-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex min-w-0 items-baseline justify-between gap-3">
            <dt className="text-[12.5px] text-ink-2">{r.label}</dt>
            <dd className="text-right text-[14.5px] font-semibold text-ink tnum">
              {r.value === null ? <Missing kind="unavailable" label="Not provided" className="text-[12.5px] font-normal" /> : r.value}
              {r.note && r.value !== null ? <span className="ml-1.5 text-[12px] font-normal text-ink-3">{r.note}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** Small screens: the scrubbed hour as a compact strip that stays in view while scrolling through the panels. */
function CompactReadout({ h, sem, tz, q, now }: { h: HourView; sem: 'preceding-hour' | 'following-hour' | 'instant'; tz: string; q: Q; now: string }) {
  const rel = Math.round((ms(h.validTime) - ms(now)) / 3_600_000)
  const items: { label: string; value: string | null }[] = [
    { label: 'Snowfall', value: q.snow.format(h.snowfallCm) },
    { label: 'Temp', value: q.temp.format(h.temperatureC) },
    { label: 'Feels like', value: q.temp.format(h.apparentTemperatureC) },
    { label: 'Rain', value: q.precip.format(h.rainMm) },
    { label: 'Wind', value: q.speed.format(h.windKmh) },
    { label: 'Gusts', value: q.speed.format(h.gustKmh) },
    { label: 'Visibility', value: q.visibility.format(h.visibilityM) },
    { label: 'Freezing lvl', value: q.elevation.format(h.freezingLevelM) },
  ]
  return (
    <div className="sticky top-14 z-[2] mb-3 rounded-[10px] border border-divider bg-surface-2 px-3 py-2.5 shadow-lift md:top-2 lg:hidden">
      <p className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-ink-2 tnum">
        <span className="font-display text-[20px] leading-none text-ink">{h.localTime}</span>
        <span>
          {dayMedium(h.localDate)} · {zoneAbbrev(h.validTime, tz)} · {rel <= 0 ? 'now' : `in ${rel} h`}
        </span>
        <span className="text-ink-3">totals {intervalLabel(h, sem, tz)}</span>
      </p>
      <dl className="mt-2 grid grid-cols-4 gap-x-2 gap-y-1.5">
        {items.map((it) => (
          <div key={it.label} className="min-w-0">
            <dt className="truncate text-[12px] text-ink-3">{it.label}</dt>
            <dd className="text-[13.5px] font-semibold text-ink tnum">
              {it.value ?? <Missing kind="unavailable" label="Not provided" className="text-[12px] font-normal" />}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

interface Built {
  stamps: LocalStamp[]
  times: number[]
  domain: [number, number]
  days: DayMark[]
  shades: TimeShade[]
  snow: TimeBar[]
  rain: TimeBar[]
  temp: TimePoint[]
  feels: TimePoint[]
  wind: TimePoint[]
  gust: TimePoint[]
  vis: TimePoint[]
  fz: TimePoint[]
}

function build(hourly: readonly HourView[], sem: 'preceding-hour' | 'following-hour' | 'instant', q: Q): Built {
  const stamps: LocalStamp[] = hourly.map((h) => ({ t: ms(h.validTime), localDate: h.localDate, localTime: h.localTime }))
  const times = stamps.map((s) => s.t)
  const domain: [number, number] = times.length ? [times[0], times[times.length - 1]] : [0, 1]
  const first = stamps[0]
  const days: DayMark[] = first ? [{ t: first.t, date: first.localDate, label: dayShort(first.localDate) }, ...dayMarks(stamps, dayShort)] : []
  // Accumulation bars cover the interval the provider documents; bars outside the plotted 48 h are dropped.
  const bars = (pick: (h: HourView) => number | null): TimeBar[] =>
    hourly
      .map((h) => {
        const t = ms(h.validTime)
        const [t0, t1] = hourInterval(t, sem)
        return { t0, t1, v: pick(h), at: t }
      })
      .filter((b) => b.t0 >= domain[0] && b.t1 <= domain[1])
  const pts = (pick: (h: HourView) => number | null): TimePoint[] => hourly.map((h) => ({ t: ms(h.validTime), v: pick(h) }))
  const cap = q.visibility.cap ?? Infinity
  const shades: TimeShade[] = runsOf(
    hourly,
    (h) => h.isDay === false,
    (h) => [ms(h.validTime) - 1_800_000, ms(h.validTime) + 1_800_000],
  ).map((r) => ({ ...r, kind: 'night' as const }))
  return {
    stamps,
    times,
    domain,
    days,
    shades,
    snow: bars((h) => q.snow.toDisplay(h.snowfallCm)),
    rain: bars((h) => q.precip.toDisplay(h.rainMm)),
    temp: pts((h) => q.temp.toDisplay(h.temperatureC)),
    feels: pts((h) => q.temp.toDisplay(h.apparentTemperatureC)),
    wind: pts((h) => q.speed.toDisplay(h.windKmh)),
    gust: pts((h) => q.speed.toDisplay(h.gustKmh)),
    vis: pts((h) => {
      const v = q.visibility.toDisplay(h.visibilityM)
      return v === null ? null : Math.min(v, cap)
    }),
    fz: pts((h) => q.elevation.toDisplay(h.freezingLevelM)),
  }
}
