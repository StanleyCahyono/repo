'use client'
/**
 * Live mode before any weather is stored for the compared resorts: explains where forecasts come from and when they
 * appear, offers the manual refresh (POST /api/refresh) and Sources & Sync, and lists per resort what Piste will
 * request (configured points) and what happened so far (never fetched / last attempt failed — with the error).
 * Nothing is estimated in the meantime.
 */
import { ArrowRight, CircleDashed, CircleX, CloudOff } from 'lucide-react'
import { ButtonLink } from '@/components/ui/button'
import { TopoArt } from '@/components/ui/topo'
import { chartUnits } from '@/components/charts/units'
import type { JobHealth, ResortInfo, WeatherHealth } from '@/lib/data/forecast-screen'
import { relativeLabel } from '@/lib/domain/time'
import type { UnitPrefs } from '@/lib/domain/types'
import { POINT_LABEL, type PointKey } from './model'
import { RefreshWeatherButton } from './refresh-button'

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
  const anyFailed = selected.some((id) => health[id]?.lastFailure)
  return (
    <section aria-labelledby="not-fetched-title" className="relative overflow-hidden rounded-[14px] border border-divider bg-surface">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[220px] opacity-70 [mask-image:linear-gradient(to_bottom,black,transparent)]">
        <TopoArt seed={`forecast-${selected.join('-')}`} density={0.8} />
      </div>
      <div className="relative px-5 pt-6 pb-5 md:px-7 md:pt-8">
        <span className="inline-flex size-10 items-center justify-center rounded-full border border-divider bg-surface text-ink-2">
          <CloudOff aria-hidden className="size-5" />
        </span>
        <h2 id="not-fetched-title" className="mt-3 font-display text-[28px] leading-[1.05] text-ink md:text-[34px]">
          No forecast stored yet
        </h2>
        <p className="mt-2 max-w-[64ch] text-[15px] text-ink-2">
          Forecasts appear here after the weather refresh job fetches modeled weather for your resorts — every 3 hours by default while the Piste worker runs.
          Nothing is estimated in the meantime{anyFailed ? ', and a failed fetch never counts as an update' : ''}.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <RefreshWeatherButton targets={selected.map((id) => ({ id, name: resorts[id]?.name ?? id }))} variant="primary" label="Try a refresh now" />
          <ButtonLink href="/sources" variant="secondary" className="min-h-11 md:min-h-0">
            Sources &amp; Sync <ArrowRight aria-hidden className="size-4" />
          </ButtonLink>
        </div>
      </div>

      <ul className="relative divide-y divide-divider border-t border-divider">
        {selected.map((id) => {
          const info = resorts[id]
          const h = health[id]
          const points = (info?.points ?? []).filter((p) => p.key === 'base' || p.key === 'summit')
          return (
            <li key={id} className="grid gap-x-6 gap-y-1 px-5 py-3.5 md:grid-cols-[minmax(160px,0.6fr)_minmax(0,1fr)_minmax(0,1.3fr)] md:px-7">
              <p className="text-[15px] font-semibold text-ink">{info?.name ?? id}</p>
              <p className="text-[13px] text-ink-2 tnum">
                {points.length
                  ? points.map((p) => `${POINT_LABEL[p.key as PointKey]}${p.elevationM !== null ? ` ${q.elevation.format(p.elevationM)}` : ''}`).join(' · ')
                  : 'No weather points configured'}
                <span className="block text-[12.5px] text-ink-3">Points Piste will request</span>
              </p>
              {h?.lastFailure ? (
                <p className="flex items-start gap-1.5 text-[13px] text-ink">
                  <CircleX aria-hidden className="mt-0.5 size-4 shrink-0 text-critical" />
                  <span>
                    Last attempt {relativeLabel(h.lastFailure.at, now)} failed
                    {h.lastFailure.error ? <span className="block text-[12.5px] text-ink-3">{h.lastFailure.error.replace(/^http:\s*/, '')}</span> : null}
                  </span>
                </p>
              ) : (
                <p className="flex items-start gap-1.5 text-[13px] text-ink-2">
                  <CircleDashed aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
                  Not fetched yet
                </p>
              )}
            </li>
          )
        })}
      </ul>
      <p className="relative border-t border-divider bg-surface-2 px-5 py-3 text-[12.5px] text-ink-3 md:px-7">
        Weather job:{' '}
        {weatherJob.lastAttemptAt
          ? `last scheduled run ${relativeLabel(weatherJob.lastAttemptAt, now)} (${weatherJob.lastAttemptStatus ?? 'unknown'})${weatherJob.lastSuccessAt ? `, last success ${relativeLabel(weatherJob.lastSuccessAt, now)}` : ', no success yet'}`
          : 'no scheduled run recorded — start the worker (npm run worker) or refresh manually'}
        . Sources: Open-Meteo (modeled forecast) and the National Weather Service (US gridpoints and official alerts).
      </p>
    </section>
  )
}
