'use client'
/**
 * Live mode before any weather is stored for the compared resorts: per resort, what Piste will request (configured
 * points) and what happened so far (never fetched / last attempt failed — with the error), plus the weather job's
 * state. The call to action (refresh, Sources & Sync) sits in the 16-day strip's "Not fetched yet" card above.
 * Nothing is estimated in the meantime.
 */
import { CircleDashed, CircleX } from 'lucide-react'
import { chartUnits } from '@/components/charts/units'
import type { JobHealth, ResortInfo, WeatherHealth } from '@/lib/data/forecast-screen'
import { relativeLabel } from '@/lib/domain/time'
import type { UnitPrefs } from '@/lib/domain/types'
import { GlassPanel } from './hud'
import { POINT_LABEL, type PointKey } from './model'

export function NotFetched({
  selected,
  resorts,
  health,
  weatherJob,
  units,
  now,
}: {
  selected: string[]
  resorts: Record<string, ResortInfo>
  health: Record<string, WeatherHealth>
  weatherJob: JobHealth
  units: UnitPrefs
  now: string
}) {
  const q = chartUnits(units)
  return (
    <GlassPanel aria-labelledby="not-fetched-title" className="flex flex-col gap-3 px-0 py-0 md:px-0 md:py-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5 md:px-6">
        <h2 id="not-fetched-title" className="m-0 text-[16px] font-semibold text-ink">
          Weather sources
        </h2>
        <span className="hud text-ink-2">What Piste will request</span>
      </div>
      <ul className="m-0 list-none divide-y divide-[color-mix(in_srgb,var(--ink)_7%,transparent)] p-0">
        {selected.map((id) => {
          const info = resorts[id]
          const h = health[id]
          const points = (info?.points ?? []).filter((p) => p.key === 'base' || p.key === 'summit')
          return (
            <li key={id} className="grid gap-x-6 gap-y-1 px-5 py-3 md:grid-cols-[minmax(160px,0.6fr)_minmax(0,1fr)_minmax(0,1.3fr)] md:px-6">
              <p className="m-0 text-[15px] font-semibold text-ink">{info?.name ?? id}</p>
              <p className="m-0 font-mono text-[12.5px] text-ink-2 tnum">
                {points.length
                  ? points.map((p) => `${POINT_LABEL[p.key as PointKey]}${p.elevationM !== null ? ` ${q.elevation.format(p.elevationM)}` : ''}`).join(' · ')
                  : 'No weather points configured'}
              </p>
              {h?.lastFailure ? (
                <p className="m-0 flex items-start gap-1.5 text-[13px] text-ink">
                  <CircleX aria-hidden className="mt-0.5 size-4 shrink-0 text-critical" />
                  <span>
                    Last attempt {relativeLabel(h.lastFailure.at, now)} failed
                    {h.lastFailure.error ? <span className="block text-[12.5px] text-ink-2">{h.lastFailure.error.replace(/^http:\s*/, '')}</span> : null}
                  </span>
                </p>
              ) : (
                <p className="m-0 flex items-start gap-1.5 text-[13px] text-ink-2">
                  <CircleDashed aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
                  Not fetched yet
                </p>
              )}
            </li>
          )
        })}
      </ul>
      <p className="m-0 rounded-b-[28px] border-t border-[color-mix(in_srgb,var(--ink)_7%,transparent)] px-5 py-3 text-[12.5px] text-ink-2 md:rounded-b-[32px] md:px-6">
        Weather job:{' '}
        {weatherJob.lastAttemptAt
          ? `last scheduled run ${relativeLabel(weatherJob.lastAttemptAt, now)} (${weatherJob.lastAttemptStatus ?? 'unknown'})${weatherJob.lastSuccessAt ? `, last success ${relativeLabel(weatherJob.lastSuccessAt, now)}` : ', no success yet'}`
          : 'no scheduled run recorded — start the worker (npm run worker) or refresh manually'}
        . Sources: Open-Meteo (modeled forecast) and the National Weather Service (US gridpoints and official alerts).
      </p>
    </GlassPanel>
  )
}
