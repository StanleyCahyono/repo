'use client'
/**
 * Forecast hero (Glass HUD): a mono eyebrow that says what this is (modeled, not observed), the answer for the focus
 * resort in one big light line — "Greek Peak: likely 12 cm over 16 days", counting up — and the fetch status in HUD
 * type. The resort pills sit beside it. Without a stored forecast the line says so; nothing is estimated.
 */
import type { ReactNode } from 'react'
import { DemoBadge } from '@/components/ui/badge'
import { chartUnits } from '@/components/charts/units'
import type { ResortForecast } from '@/lib/data/forecast'
import type { WeatherHealth } from '@/lib/data/forecast-screen'
import { relativeLabel } from '@/lib/domain/time'
import type { AppMode, UnitPrefs } from '@/lib/domain/types'
import { CountUp } from './hud'
import { instantLocal, outlookTotal } from './model'

export function ForecastHero({
  name,
  forecast,
  health,
  units,
  mode,
  now,
  pills,
  actions,
}: {
  /** Short name of the focus resort (null: none selected). */
  name: string | null
  forecast: ResortForecast | null
  health: WeatherHealth | undefined
  units: UnitPrefs
  mode: AppMode
  now: string
  pills?: ReactNode
  actions?: ReactNode
}) {
  const q = chartUnits(units)
  const run = forecast?.run ?? null
  const total = run ? outlookTotal(forecast!.daily, (cm) => q.snow.toDisplay(cm)) : null
  const inches = q.snow.unit === 'in'
  // "Meaningful" snow: at least 1 cm (0.4 in) over the period.
  const some = total !== null && total.total >= (inches ? 0.4 : 1)
  const days = forecast?.daily.length ?? 0
  const fmt = (v: number) => (inches ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v)))

  const status = run
    ? `${run.kind === 'demo' ? 'Demo · simulated' : `Modeled · ${run.provider === 'nws-grid' ? 'NWS' : 'Open-Meteo'}`} · fetched ${instantLocal(run.fetchedAt, forecast!.timezone, 'HH:mm')} · ${relativeLabel(run.fetchedAt, now)}`
    : health?.lastFailure
      ? `Not fetched · last attempt ${relativeLabel(health.lastFailure.at, now)} failed`
      : 'No model output stored · nothing estimated'

  return (
    <section aria-labelledby="forecast-title" className="flex flex-col gap-5 pt-2 md:pt-4">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="flex min-w-0 max-w-[820px] flex-col gap-2.5">
          <p className="hud m-0 flex flex-wrap items-center gap-2 tracking-[0.16em] text-teal">
            <span>Forecast · modeled, not observed</span>
            {mode === 'demo' ? <DemoBadge /> : null}
          </p>
          <h1 id="forecast-title" className="m-0 text-[clamp(38px,5vw,72px)] leading-[1] font-light tracking-[-0.04em] text-ink">
            {name ? (
              run ? (
                some ? (
                  <>
                    {name}: likely {total!.atLeast ? 'at least ' : ''}
                    <CountUp value={Number(fmt(total!.total))} format={fmt} />
                    {inches ? '″' : ' cm'} over {days} {days === 1 ? 'day' : 'days'}
                  </>
                ) : (
                  <>{name}: little or no snow likely</>
                )
              ) : (
                <>
                  {name}: <span className="text-ink-3">not fetched yet</span>
                </>
              )
            ) : (
              'Forecast'
            )}
          </h1>
          <p className="hud m-0 text-copper" role="status">
            {status}
          </p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {pills}
    </section>
  )
}
