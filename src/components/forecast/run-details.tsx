'use client'
/**
 * "About this forecast": provider and model, the point Piste requested vs the grid cell the model answered for
 * (an elevation-adjusted model, not a station), fetch time, the model run time only when the provider supplied it,
 * interval semantics, variables the source did not return, and the read model's own limitations.
 */
import type { ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { chartUnits, minus } from '@/components/charts/units'
import { Freshness } from '@/components/ui/provenance'
import { SourceDrawer, type SourceItem } from '@/components/ui/source-drawer'
import type { ResortForecast } from '@/lib/data/forecast'
import type { ResortInfo, WeatherHealth } from '@/lib/data/forecast-screen'
import type { RunMeta } from '@/lib/data/views'
import { relativeLabel } from '@/lib/domain/time'
import type { UnitPrefs } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'
import { Evidence } from './evidence'
import { instantLocal, POINT_LABEL, provided, type PointKey } from './model'

export function providerLabel(run: { provider: string; prov?: Pick<RunMeta['prov'], 'provider'> | null }): string {
  if (run.provider === 'demo') return 'Piste demo generator (simulated)'
  if (run.provider === 'open-meteo') return 'Open-Meteo'
  if (run.provider === 'nws-grid') return 'National Weather Service gridpoint forecast'
  return run.prov?.provider ?? run.provider
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const coord = (v: number | null, digits: number) => (v === null ? null : minus(v.toFixed(digits)))

const VARIABLES: {
  key: 'snowfallCm' | 'rainMm' | 'temperatureC' | 'apparentTemperatureC' | 'windKmh' | 'gustKmh' | 'visibilityM' | 'freezingLevelM'
  label: string
}[] = [
  { key: 'snowfallCm', label: 'snowfall' },
  { key: 'temperatureC', label: 'temperature' },
  { key: 'apparentTemperatureC', label: 'feels-like temperature' },
  { key: 'rainMm', label: 'rain' },
  { key: 'windKmh', label: 'wind' },
  { key: 'gustKmh', label: 'gusts' },
  { key: 'visibilityM', label: 'visibility' },
  { key: 'freezingLevelM', label: 'freezing level' },
]

export function RunDetails({
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
  const run = forecast.run
  if (!run) return null
  const q = chartUnits(units)
  const tz = forecast.timezone
  const shown = (forecast.shownPoint ?? forecast.point) as PointKey
  const other: RunMeta | null = shown === 'base' ? forecast.runs.summit : forecast.runs.base
  const missing = VARIABLES.filter((v) => !provided(forecast.hourly, v.key)).map((v) => v.label)
  const g = run.grid
  const r = run.requested
  const gridKnown = g.lat !== null && g.lon !== null
  const diff = g.elevationM !== null && r.elevationM !== null ? g.elevationM - r.elevationM : null
  const sem = run.intervalSemantics ?? 'preceding-hour'
  const sources: SourceItem[] = [
    { label: `${POINT_LABEL[shown]} forecast`, value: providerLabel(run), prov: run.prov },
    ...(other ? [{ label: `${POINT_LABEL[other.pointKey as PointKey] ?? other.pointKey} forecast`, value: providerLabel(other), prov: other.prov }] : []),
  ]
  const limitations = forecast.limitations.filter((l) => !/does not resolve individual slopes/.test(l))

  return (
    <section aria-labelledby={`run-${forecast.resortId}`} className="glass rounded-[24px] px-4 py-3.5 md:px-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id={`run-${forecast.resortId}`} className="text-[15px] font-semibold text-ink">
          About this forecast
        </h3>
        <span className="inline-flex items-center gap-2.5">
          <Evidence kind="modeled" demo={run.kind === 'demo'} />
          <SourceDrawer title="Forecast sources" items={sources} compact={false} label="Sources" />
        </span>
      </div>

      {health?.lastFailure ? (
        <p className="mb-3 flex items-start gap-2 rounded-[8px] border border-caution/40 bg-caution-bg px-3 py-2 text-[13px] text-ink">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-caution" />
          <span>
            A newer fetch {relativeLabel(health.lastFailure.at, now)} failed
            {health.lastFailure.error ? ` (${health.lastFailure.error.replace(/^http:\s*/, '')})` : ''}. What you see is the last successful forecast — a failed
            fetch never counts as an update.
          </span>
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13.5px] xl:grid-cols-3">
        <Item label="Source" wide>
          {providerLabel(run)}
          {run.model ? <span className="text-ink-3"> · model {run.model}</span> : null}
        </Item>
        <Item label="Fetched">
          <span className="tnum">{instantLocal(run.fetchedAt, tz)}</span>
          <Freshness at={run.fetchedAt} now={now} staleHours={12} prefix="" className="block" />
        </Item>
        {run.modelRunAt ? (
          <Item label="Model run (issued)">
            <span className="tnum">{instantLocal(run.modelRunAt, tz)}</span>
          </Item>
        ) : null}
        {run.horizonDays !== null ? (
          <Item label="Horizon requested">
            <span className="tnum">{run.horizonDays} days</span>
            <span className="block text-[12.5px] text-ink-3">days 8+ shown as a trend</span>
          </Item>
        ) : null}
        <Item label={`Requested point · ${POINT_LABEL[shown]}`}>
          <span className="tnum">
            {coord(r.lat, 4)}, {coord(r.lon, 4)}
            {r.elevationM !== null ? <span className="block">{q.elevation.format(r.elevationM)}</span> : null}
          </span>
        </Item>
        <Item label="Model grid cell">
          {gridKnown ? (
            <span className="tnum">
              {coord(g.lat, 3)}, {coord(g.lon, 3)}
              {g.elevationM !== null ? <span className="block">{q.elevation.format(g.elevationM)}</span> : null}
              {diff !== null && Math.abs(diff) >= 1 ? (
                <span className="block text-[12.5px] text-ink-3">
                  {q.elevation.format(Math.abs(diff))} {diff > 0 ? 'above' : 'below'} the point
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-ink-3 italic">Not reported by this source</span>
          )}
        </Item>
        <Item label="Resolution" wide>
          Elevation-adjusted model output for a grid cell — not a weather station, and it does not resolve individual slopes.
        </Item>
        <Item label="Accumulations" wide>
          Snowfall and rain are totals for{' '}
          {sem === 'preceding-hour' ? 'the hour before each time stamp' : sem === 'following-hour' ? 'the hour after each time stamp' : 'each hour'}.
        </Item>
        <Item label="Missing variables" wide>
          {missing.length ? (
            `${capitalize(missing.join(', '))} — not provided by this source`
          ) : (
            <span className="text-ink-3">None — every variable shown was returned</span>
          )}
        </Item>
        {info && info.points.length > 1 && !other ? (
          <Item label="Other point" wide>
            {POINT_LABEL[shown === 'base' ? 'summit' : 'base']} forecast not stored
          </Item>
        ) : null}
      </dl>

      {limitations.length ? (
        <ul className="mt-3 flex flex-col gap-1 border-t border-divider pt-3 text-[12.5px] text-ink-3">
          {limitations.map((l) => (
            <li key={l}>· {l}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function Item({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn('min-w-0', wide && 'col-span-2 xl:col-span-1')}>
      <dt className="text-[12.5px] text-ink-2">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  )
}
