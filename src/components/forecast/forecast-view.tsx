'use client'
/**
 * The Forecast screen body. Server data arrives as one serialisable `ForecastScreen`; every choice lives in the URL
 * (see params.ts / nav.tsx) so a reload, a shared link or "back from a resort" restores the same view.
 *
 * Glass HUD order: hero (the answer for the focus resort + resort pills) → point / date controls and official alerts
 * → the 16-day strip (focus resort) → the selected day (or planning facts beyond the forecast) → next 48 hours beside
 * the month calendar → compare resorts (outlook matrix) → hour by hour → attribution. Without stored weather the
 * strip, the 48 hours and the calendar keep their structure in a designed "Not fetched yet" state, followed by what
 * Piste will request; nothing is estimated in its place.
 */
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { ButtonLink } from '@/components/ui/button'
import type { DateMark } from '@/components/ui/date-picker'
import { Select } from '@/components/ui/form'
import { Segmented } from '@/components/ui/segmented'
import { EmptyState, Notice } from '@/components/ui/states'
import type { ResortForecast } from '@/lib/data/forecast'
import type { ForecastScreen, ResortInfo } from '@/lib/data/forecast-screen'
import { relativeLabel } from '@/lib/domain/time'
import { SCORING_MODES, SCORING_MODE_LABEL, type ScoringMode } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'
import { chartUnits } from '@/components/charts/units'
import { OfficialAlerts } from './alerts'
import { BeyondHorizon } from './beyond'
import { DayDetail } from './day-detail'
import { HistoryCalendarView } from './history'
import { HourlyForecast } from './hourly'
import { ForecastHero } from './hero'
import { HoursGlance } from './hours-glance'
import { dateZone, lastForecastDate, POINT_LABEL, pointElevation, zoneLabel, type PointKey } from './model'
import { OutlookStrip } from './outlook-strip'
import { PendingVeil, useForecastNav } from './nav'
import { NotFetched } from './not-fetched'
import { METRIC_LABEL, OutlookMatrix } from './outlook'
import { OUTLOOK_METRICS, type OutlookMetric } from './params'
import { RefreshWeatherButton } from './refresh-button'
import { SeasonCard } from './season-card'
import { ResortPicker } from './resort-picker'
import { Rise } from './rise'
import { ForecastSection } from './section'
import { ForecastControls, ResortPills } from './toolbar'

export function ForecastView({ screen, actions }: { screen: ForecastScreen; actions?: ReactNode }) {
  const { params, navigate, replaceLocal, pending } = useForecastNav()
  const { selected, resorts, forecast } = screen

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
  const focusHealth = focus ? screen.health[focus] : undefined

  const requestedMonth = params.month ?? (urlDate && urlDate < focusToday ? urlDate.slice(0, 7) : focusToday.slice(0, 7))
  const historyStale = pending && (screen.history?.resortId !== focus || screen.historyMonth !== requestedMonth)
  const dataStale =
    pending &&
    (params.point !== screen.point ||
      (params.mode ?? screen.scoringMode) !== screen.scoringMode ||
      (params.resorts !== null && params.resorts.join(',') !== selected.join(',')) ||
      focusForecast?.resortId !== focus)
  const planningStale = pending && (Object.values(screen.planning)[0]?.date ?? null) !== (urlDate ?? screen.homeToday)
  const openHistoryDate = urlDate && (zone === 'past' || zone === 'today') ? urlDate : null

  const onSelectDay = ({ resortId, date: d }: { resortId: string; date: string }) => {
    const today = resorts[resortId]?.today
    const value = d === today ? null : d
    if (resortId !== focus) navigate({ focus: resortId, date: value })
    else replaceLocal({ date: value })
  }

  // The date jump's calendar shows what each day leads to: the modeled days, the less certain trend and season dates.
  const jumpMarks = dateJumpMarks(focusForecast, screen.seasonMarkers)

  const onMonth = (m: string) => navigate({ month: m === focusToday.slice(0, 7) ? null : m, date: zone === 'past' ? null : undefined })

  const hero = (
    <ForecastHero
      name={info ? (info.shortName ?? info.name) : null}
      forecast={focusForecast}
      health={focusHealth}
      units={screen.units}
      mode={screen.mode}
      now={screen.now}
      actions={actions}
      pills={
        selected.length ? <ResortPills catalog={screen.catalog} selected={selected} resorts={resorts} focus={focus} hasForecast={hasForecast} /> : null
      }
    />
  )

  if (!selected.length) {
    return (
      <div className="flex flex-col gap-6">
        {hero}
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

  const focusName = info?.name ?? focus ?? ''
  const refreshAll = live ? <RefreshWeatherButton targets={selected.map((id) => ({ id, name: resorts[id]?.name ?? id }))} variant="primary" label="Try a refresh now" /> : null
  const sources = (
    <ButtonLink href="/sources" variant="secondary" className="min-h-11 md:min-h-0">
      Sources &amp; Sync <ArrowRight aria-hidden className="size-4" />
    </ButtonLink>
  )
  const empty = !anyForecast
    ? {
        title: 'No forecast stored yet',
        body: (
          <>
            Forecasts appear after the weather job fetches modeled weather for your resorts — every 3 hours by default while the Piste worker runs.
            {focusHealth?.lastFailure
              ? ` The last attempt ${relativeLabel(focusHealth.lastFailure.at, screen.now)} failed${focusHealth.lastFailure.error ? ` (${focusHealth.lastFailure.error.replace(/^http:\s*/, '')})` : ''}, and a failed fetch never counts as an update.`
              : ''}{' '}
            Nothing is estimated in the meantime.
          </>
        ),
        actions: (
          <>
            {refreshAll}
            {sources}
          </>
        ),
      }
    : {
        title: `No forecast stored for ${focusName}`,
        body: focusHealth?.lastFailure
          ? `The last fetch ${relativeLabel(focusHealth.lastFailure.at, screen.now)} failed${focusHealth.lastFailure.error ? ` (${focusHealth.lastFailure.error.replace(/^http:\s*/, '')})` : ''}. Nothing is estimated in its place.`
          : 'Weather has not been fetched for this resort yet. Nothing is estimated in its place.',
        actions: live && focus ? <RefreshWeatherButton targets={[{ id: focus, name: focusName }]} variant="primary" /> : undefined,
      }

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <Rise index={0}>{hero}</Rise>

      <Rise index={1} className="flex flex-col gap-3">
        <ForecastControls resorts={resorts} focus={focus} point={params.point} units={screen.units} today={focusToday} marks={jumpMarks} />
        {screen.unknownIds.length ? <UnknownNotice ids={screen.unknownIds} /> : null}
        <OfficialAlerts alerts={screen.alerts} resorts={resorts} selected={selected} job={screen.alertsJob} now={screen.now} mode={screen.mode} />
      </Rise>

      <Rise index={2}>
        <div id="strip" className="scroll-mt-24">
          <PendingVeil when={dataStale}>
            <OutlookStrip
              key={`${focus}|${focusForecast?.shownPoint}`}
              forecast={focusForecast}
              info={info}
              point={params.point}
              units={screen.units}
              health={focusHealth}
              now={screen.now}
              selectedDate={zone === 'forecast' || zone === 'today' ? detailDate : null}
              onSelect={(d) => focus && onSelectDay({ resortId: focus, date: d })}
              empty={empty}
            />
          </PendingVeil>
        </div>
      </Rise>

      {zone === 'beyond' || zone === 'no-forecast' ? (
        <BeyondHorizon date={date} selected={selected} resorts={resorts} planning={screen.planning} forecasts={forecasts} now={screen.now} stale={planningStale} />
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

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] md:gap-6">
        <div className="flex min-w-0 flex-col gap-5 md:gap-6">
          <PendingVeil when={dataStale}>
            <HoursGlance key={`${focus}|${focusForecast?.shownPoint}`} forecast={focusForecast} info={info} units={screen.units} now={screen.now} />
          </PendingVeil>
          <PendingVeil when={historyStale}>
            <SeasonCard name={info?.shortName ?? focusName} markers={screen.seasonMarkers} today={focusToday} onMonth={onMonth} />
          </PendingVeil>
        </div>
        <div id="history" className="min-w-0 scroll-mt-24">
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
              forecast={screen.history.resortId === focusForecast?.resortId ? focusForecast : null}
              markers={historyStale ? [] : screen.seasonMarkers}
              selectedDate={zone === 'forecast' ? detailDate : null}
              onOpenDay={(d) => replaceLocal({ date: d })}
              onSelectDay={(d) => {
                if (focus) onSelectDay({ resortId: focus, date: d })
                document.getElementById('strip')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              onClose={() => replaceLocal({ date: null })}
              onMonth={onMonth}
            />
          ) : null}
        </div>
      </div>

      {!anyForecast ? (
        <NotFetched selected={selected} resorts={resorts} health={screen.health} weatherJob={screen.weatherJob} units={screen.units} now={screen.now} />
      ) : (
        <>
          <ForecastSection
            id="daily"
            index={1}
            eyebrow="Daily outlook"
            title={selected.length > 1 ? 'Compare resorts' : 'Day by day'}
            meta={`Model output per resort-local day${forecasts.some((f) => f.daily.some((d) => d.trend)) ? ' · days 8–16 as a less certain trend' : ''}`}
            actions={
              <ModeSelect value={screen.scoringMode} pendingValue={params.mode} onChange={(m) => navigate({ mode: m === screen.scoringMode && !params.mode ? null : m })} />
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
          </ForecastSection>

          {focusForecast?.run ? (
            <ForecastSection
              id="hourly"
              index={2}
              eyebrow="Hourly"
              title="Hour by hour"
              meta={
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span>
                    {focusName} · {pointLabelOf(focusForecast, info, params.point, screen)}
                    {focusForecast.hourly.length
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
                <HourlyForecast
                  key={`${focusForecast.resortId}|${focusForecast.shownPoint}`}
                  forecast={focusForecast}
                  info={info}
                  units={screen.units}
                  now={screen.now}
                  health={focusHealth}
                />
              </PendingVeil>
            </ForecastSection>
          ) : null}
        </>
      )}

      <Attribution screen={screen} />
    </div>
  )
}

function dateJumpMarks(f: ResortForecast | null, markers: ForecastScreen['seasonMarkers']): DateMark[] {
  const out: DateMark[] = []
  const days = f?.run ? f.daily : []
  const firm = days.filter((d) => !d.trend)
  const trend = days.filter((d) => d.trend)
  if (firm.length) out.push({ date: firm[0].date, to: firm[firm.length - 1].date, label: 'Forecast (modeled)', tone: 'teal', variant: 'rule' })
  if (trend.length) out.push({ date: trend[0].date, to: trend[trend.length - 1].date, label: 'Less certain trend', tone: 'teal', variant: 'dashed', soft: true })
  for (const m of markers) {
    out.push({
      date: m.date,
      to: m.to ?? undefined,
      label: m.basis === 'estimate' ? `${m.label} (Piste estimate)` : m.label,
      tone: m.basis === 'estimate' ? 'copper' : m.basis === 'actual' ? 'ink' : 'teal',
      variant: 'dot',
      soft: m.basis === 'estimate',
    })
  }
  return out
}

function pointLabelOf(f: ResortForecast, info: ResortInfo | undefined, point: PointKey, screen: ForecastScreen): string {
  const q = chartUnits(screen.units)
  const shown = f.shownPoint ?? point
  const elev = f.run?.requested.elevationM ?? pointElevation(info, shown)
  return `${POINT_LABEL[shown]}${elev !== null ? ` ${q.elevation.format(elev)}` : ''}`
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
    <label className="inline-flex items-center gap-2.5 text-[13px] text-ink-2">
      <span className="hud whitespace-nowrap text-ink-2">Score for</span>
      <Select value={pendingValue ?? value} onChange={(e) => onChange(e.target.value as ScoringMode)} className="w-auto min-w-[11.5rem] font-medium">
        {SCORING_MODES.map((m) => (
          <option key={m} value={m}>
            {SCORING_MODE_LABEL[m]}
          </option>
        ))}
      </Select>
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
