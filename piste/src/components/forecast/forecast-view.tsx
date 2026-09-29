'use client'
/**
 * The Forecast screen body. Server data arrives as one serialisable `ForecastScreen`; every choice lives in the URL
 * (see params.ts / nav.tsx) so a reload, a shared link or "back from a resort" restores the same view.
 *
 * Order: toolbar → official alerts → 01 daily outlook (all compared resorts; selected day / beyond-horizon panel)
 * → 02 next 48 hours (focus resort) → 03 history calendar (focus resort) → attribution. In live mode without any
 * stored weather, 01–02 become one designed "not fetched" state.
 */
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { Segmented } from '@/components/ui/segmented'
import { EmptyState, Notice } from '@/components/ui/states'
import type { ForecastScreen } from '@/lib/data/forecast-screen'
import { relativeLabel } from '@/lib/domain/time'
import { SCORING_MODES, SCORING_MODE_LABEL, type ScoringMode } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'
import { chartUnits } from '@/components/charts/units'
import { OfficialAlerts } from './alerts'
import { BeyondHorizon } from './beyond'
import { DayDetail } from './day-detail'
import { HistoryCalendarView } from './history'
import { HourlyForecast } from './hourly'
import { dateZone, lastForecastDate, POINT_LABEL, pointElevation, zoneLabel } from './model'
import { PendingVeil, useForecastNav } from './nav'
import { NotFetched } from './not-fetched'
import { METRIC_LABEL, OutlookMatrix } from './outlook'
import { OUTLOOK_METRICS, type OutlookMetric } from './params'
import { RefreshWeatherButton } from './refresh-button'
import { ResortPicker } from './resort-picker'
import { Rise } from './rise'
import { ForecastSection } from './section'
import { ForecastToolbar } from './toolbar'

export function ForecastView({ screen }: { screen: ForecastScreen }) {
  const { params, navigate, replaceLocal, pending } = useForecastNav()
  const { selected, resorts, forecast } = screen
  const q = chartUnits(screen.units)

  // Optimistic focus/date/metric come from the URL; server-bound data is veiled while it reloads.
  const focus = params.focus && selected.includes(params.focus) ? params.focus : screen.focus
  const forecasts = forecast.resorts
  const focusForecast = forecasts.find((f) => f.resortId === focus) ?? null
  const info = focus ? resorts[focus] : undefined
  const focusToday = info?.today ?? screen.homeToday
  const urlDate = params.date
  const date = urlDate ?? focusToday
  const zone = dateZone(date, focusToday, lastForecastDate(focusForecast))
  const detailDate = zone === 'past' ? focusToday : date
  const anyForecast = forecasts.some((f) => f.run)
  const hasForecast = new Set(forecasts.filter((f) => f.run).map((f) => f.resortId))
  const live = screen.mode === 'live'

  const requestedMonth = params.month ?? (urlDate && urlDate < focusToday ? urlDate.slice(0, 7) : focusToday.slice(0, 7))
  const historyStale = pending && (screen.history?.resortId !== focus || screen.historyMonth !== requestedMonth)
  const dataStale =
    pending &&
    (params.point !== screen.point ||
      (params.mode ?? screen.scoringMode) !== screen.scoringMode ||
      (params.resorts !== null && params.resorts.join(',') !== selected.join(',')))
  const planningStale = pending && (Object.values(screen.planning)[0]?.date ?? null) !== (urlDate ?? screen.homeToday)
  const openHistoryDate = urlDate && (zone === 'past' || zone === 'today') ? urlDate : null

  const onSelectDay = ({ resortId, date: d }: { resortId: string; date: string }) => {
    const today = resorts[resortId]?.today
    const value = d === today ? null : d
    if (resortId !== focus) navigate({ focus: resortId, date: value })
    else replaceLocal({ date: value })
  }

  const pointLabel = (() => {
    const shown = focusForecast?.shownPoint ?? params.point
    const elev = focusForecast?.run?.requested.elevationM ?? pointElevation(info, shown)
    return `${POINT_LABEL[shown]}${elev !== null ? ` ${q.elevation.format(elev)}` : ''}`
  })()

  if (!selected.length) {
    return (
      <div className="flex flex-col gap-6">
        {screen.unknownIds.length ? <UnknownNotice ids={screen.unknownIds} /> : null}
        <EmptyState
          seed="forecast-empty"
          title="Choose resorts to compare"
          body={
            screen.selectionBasis === 'none' && screen.catalog.some((r) => r.isFavorite)
              ? 'No resorts are selected in this view. Pick up to four to see their forecasts side by side.'
              : 'You have no favourites yet, so nothing is preselected. Pick up to four resorts to see their forecasts side by side.'
          }
          action={<ResortPicker catalog={screen.catalog} selected={[]} onApply={(ids) => navigate({ r: ids.join(','), focus: ids[0] ?? null })} />}
        />
        <Attribution screen={screen} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <Rise index={0} className="flex flex-col gap-3">
        <ForecastToolbar
          catalog={screen.catalog}
          selected={selected}
          resorts={resorts}
          focus={focus}
          hasForecast={hasForecast}
          point={params.point}
          units={screen.units}
          today={focusToday}
        />
        {screen.unknownIds.length ? <UnknownNotice ids={screen.unknownIds} /> : null}
        <OfficialAlerts alerts={screen.alerts} resorts={resorts} selected={selected} job={screen.alertsJob} now={screen.now} mode={screen.mode} />
      </Rise>

      {anyForecast ? (
        <>
          <Rise index={1}>
            <ForecastSection
              id="daily"
              index={1}
              title="Daily outlook"
              meta={`Model output per resort-local day${forecasts.some((f) => f.daily.some((d) => d.trend)) ? ' · days 8–16 as a less certain trend' : ''}`}
              actions={
                <ModeSelect
                  value={screen.scoringMode}
                  pendingValue={params.mode}
                  onChange={(m) => navigate({ mode: m === screen.scoringMode && !params.mode ? null : m })}
                />
              }
            >
              <PendingVeil when={dataStale}>
                <OutlookMatrix
                  forecasts={forecasts}
                  resorts={resorts}
                  potentials={screen.potentials}
                  health={screen.health}
                  focus={focus}
                  selectedDate={zone === 'beyond' || zone === 'no-forecast' ? null : detailDate}
                  metric={params.metric}
                  units={screen.units}
                  now={screen.now}
                  point={params.point}
                  onSelect={onSelectDay}
                  actions={<MetricSwitch value={params.metric} onChange={(m) => replaceLocal({ metric: m === 'snow' ? null : m })} />}
                />
              </PendingVeil>
              <div className="mt-4">
                {zone === 'beyond' || zone === 'no-forecast' ? (
                  <BeyondHorizon
                    date={date}
                    selected={selected}
                    resorts={resorts}
                    planning={screen.planning}
                    forecasts={forecasts}
                    now={screen.now}
                    stale={planningStale}
                  />
                ) : focusForecast?.run ? (
                  <PendingVeil when={dataStale}>
                    <DayDetail
                      forecast={focusForecast}
                      day={focusForecast.daily.find((d) => d.date === detailDate)}
                      date={detailDate}
                      potential={screen.potentials[focusForecast.resortId]?.find((p) => p.date === detailDate)}
                      info={info}
                      units={screen.units}
                      scoringMode={screen.scoringMode}
                    />
                  </PendingVeil>
                ) : null}
              </div>
            </ForecastSection>
          </Rise>

          <Rise index={2}>
            <ForecastSection
              id="hourly"
              index={2}
              title="Next 48 hours"
              meta={
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span>
                    {info?.name ?? focus} · {pointLabel}
                    {focusForecast?.hourly.length
                      ? ` · times in ${zoneLabel(
                          focusForecast.timezone,
                          focusForecast.hourly.map((h) => h.validTime),
                        )}`
                      : ''}
                  </span>
                  {focus ? (
                    <Link href={`/resorts/${focus}`} className="inline-flex items-center gap-0.5 font-medium text-teal hover:underline">
                      Resort details <ArrowUpRight aria-hidden className="size-3.5" />
                    </Link>
                  ) : null}
                </span>
              }
            >
              <PendingVeil when={dataStale}>
                {focusForecast?.run ? (
                  <HourlyForecast
                    key={`${focusForecast.resortId}|${focusForecast.shownPoint}`}
                    forecast={focusForecast}
                    info={info}
                    units={screen.units}
                    now={screen.now}
                    health={focus ? screen.health[focus] : undefined}
                  />
                ) : (
                  <EmptyState
                    seed={`hourly-${focus}`}
                    title={`No forecast stored for ${info?.name ?? focus}`}
                    body={
                      focus && screen.health[focus]?.lastFailure
                        ? `The last fetch ${relativeLabel(screen.health[focus]!.lastFailure!.at, screen.now)} failed${screen.health[focus]!.lastFailure!.error ? ` (${screen.health[focus]!.lastFailure!.error!.replace(/^http:\s*/, '')})` : ''}. Nothing is estimated in its place.`
                        : 'Weather has not been fetched for this resort yet. Nothing is estimated in its place.'
                    }
                    action={live && focus ? <RefreshWeatherButton targets={[{ id: focus, name: info?.name ?? focus }]} /> : undefined}
                  />
                )}
              </PendingVeil>
            </ForecastSection>
          </Rise>
        </>
      ) : (
        <Rise index={1} className="flex flex-col gap-4">
          <NotFetched selected={selected} resorts={resorts} health={screen.health} weatherJob={screen.weatherJob} units={screen.units} now={screen.now} />
          {zone === 'beyond' || zone === 'no-forecast' ? (
            <BeyondHorizon
              date={date}
              selected={selected}
              resorts={resorts}
              planning={screen.planning}
              forecasts={forecasts}
              now={screen.now}
              stale={planningStale}
            />
          ) : null}
        </Rise>
      )}

      <ForecastSection
        id="history"
        index={anyForecast ? 3 : 2}
        title="History"
        meta={`${info?.name ?? focus} · what was forecast, reported and estimated on each resort-local day`}
      >
        {screen.history ? (
          <HistoryCalendarView
            calendar={screen.history}
            info={focus && screen.history.resortId === focus ? info : resorts[screen.history.resortId]}
            month={screen.historyMonth ?? requestedMonth}
            openDate={historyStale ? null : openHistoryDate}
            units={screen.units}
            now={screen.now}
            appMode={screen.mode}
            stale={historyStale}
            onOpenDay={(d) => replaceLocal({ date: d })}
            onClose={() => replaceLocal({ date: null })}
            onMonth={(m) => navigate({ month: m === focusToday.slice(0, 7) ? null : m, date: zone === 'past' ? null : undefined })}
          />
        ) : null}
      </ForecastSection>

      <Attribution screen={screen} />
    </div>
  )
}

function UnknownNotice({ ids }: { ids: string[] }) {
  return (
    <Notice tone="info" title="Some resorts in this link were not found">
      Ignored: {ids.join(', ')}. They may have been renamed or removed from the catalogue.
    </Notice>
  )
}

function MetricSwitch({ value, onChange }: { value: OutlookMetric; onChange: (m: OutlookMetric) => void }) {
  return (
    <Segmented<OutlookMetric>
      label="Outlook shows"
      value={value}
      onChange={onChange}
      size="sm"
      options={OUTLOOK_METRICS.map((m) => ({ value: m, label: m === 'temp' ? 'Temp' : METRIC_LABEL[m] }))}
      className="[&_[role=radio]]:h-11 md:[&_[role=radio]]:h-8"
    />
  )
}

function ModeSelect({ value, pendingValue, onChange }: { value: ScoringMode; pendingValue: ScoringMode | null; onChange: (m: ScoringMode) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-[13px] text-ink-2">
      <span>Score for</span>
      <select
        value={pendingValue ?? value}
        onChange={(e) => onChange(e.target.value as ScoringMode)}
        className="h-10 rounded-[10px] border border-divider-strong bg-surface px-2.5 text-[13.5px] font-medium text-ink transition-colors duration-150 hover:border-ink-3 focus:border-teal focus:outline-none md:h-9"
      >
        {SCORING_MODES.map((m) => (
          <option key={m} value={m}>
            {SCORING_MODE_LABEL[m]}
          </option>
        ))}
      </select>
    </label>
  )
}

function Attribution({ screen }: { screen: ForecastScreen }) {
  const runs = screen.forecast.resorts.flatMap((f) => [f.runs.base, f.runs.summit]).filter((r) => r !== null)
  const openMeteo = runs.some((r) => r.provider === 'open-meteo')
  const nws = runs.some((r) => r.provider === 'nws-grid') || screen.alerts.some((a) => /nws|weather\.gov/i.test(a.provider))
  const demo = screen.mode === 'demo'
  return (
    <footer className={cn('flex flex-col gap-1 border-t border-divider pt-4 text-[12.5px] text-ink-3')}>
      {openMeteo ? (
        <p>
          <a
            href="https://open-meteo.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-ink-2 underline-offset-2 hover:text-teal hover:underline"
          >
            Weather data by Open-Meteo.com
          </a>{' '}
          (
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:text-teal hover:underline"
          >
            CC BY 4.0
          </a>
          ).
        </p>
      ) : null}
      {nws ? (
        <p>
          Forecast data and official alerts from the{' '}
          <a
            href="https://www.weather.gov/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-ink-2 underline-offset-2 hover:text-teal hover:underline"
          >
            National Weather Service (weather.gov)
          </a>
          .
        </p>
      ) : null}
      {demo ? <p>Demo mode: all weather on this page is simulated for the demo — it is not Open-Meteo or NWS data.</p> : null}
      <p>Weather-model output is not an observation and does not resolve individual slopes. Scores describe suitability, not safety.</p>
    </footer>
  )
}
