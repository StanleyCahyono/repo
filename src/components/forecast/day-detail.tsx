'use client'
/**
 * The selected outlook day for the focus resort: the modeled weather for that resort-local day (left) and Piste's
 * stored weather-potential estimate for it (right). Future days never show a full conditions score; a confirmed
 * closure shows "Closed" instead of any score. Nothing here is recomputed in the browser.
 */
import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Ban, ChevronDown, CloudSun } from 'lucide-react'
import { chartUnits } from '@/components/charts/units'
import { Missing } from '@/components/ui/provenance'
import { ConfidenceTag, ScoreBreakdown, ScoreChip } from '@/components/ui/score'
import { SourceDrawer } from '@/components/ui/source-drawer'
import type { DayView, ResortForecast } from '@/lib/data/forecast'
import type { DayPotential, ResortInfo } from '@/lib/data/forecast-screen'
import { SCORING_MODE_LABEL, type ScoringMode, type UnitPrefs } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { Evidence } from './evidence'
import { dayLong, displayPotential, instantLocal, POINT_LABEL, pointElevation } from './model'

type Q = ReturnType<typeof chartUnits>

export function DayDetail({
  forecast,
  day,
  date,
  potential,
  info,
  units,
  scoringMode,
}: {
  forecast: ResortForecast
  day: DayView | undefined
  date: string
  potential: DayPotential | undefined
  info: ResortInfo | undefined
  units: UnitPrefs
  scoringMode: ScoringMode
}) {
  const q = chartUnits(units)
  const tz = forecast.timezone
  const isToday = date === forecast.today
  const isFuture = date > forecast.today
  const dayNo = day ? day.dayIndex + 1 : null
  const shown = forecast.shownPoint ?? forecast.point
  const elev = forecast.run?.requested.elevationM ?? pointElevation(info, shown)
  const titleId = `day-${date}`

  return (
    <article aria-labelledby={titleId} className="overflow-hidden rounded-[12px] border border-divider bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-divider px-4 pt-3.5 pb-3 md:px-5">
        <div className="min-w-0">
          <p className="eyebrow">
            {info?.name ?? forecast.name} · {POINT_LABEL[shown]}
            {elev !== null ? ` ${q.elevation.format(elev)}` : ''}
          </p>
          <h3 id={titleId} className="mt-1 font-display text-[26px] leading-none text-ink md:text-[30px]">
            {dayLong(date).replace(/ \d{4}$/, '')}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
          {isToday ? (
            <span className="rounded-full bg-glacier px-2 py-0.5 font-medium text-teal">Today</span>
          ) : dayNo ? (
            <span className="tnum">Day {dayNo} of the forecast</span>
          ) : null}
          {day?.trend ? (
            <span className="rounded-full border border-dashed border-caution/60 px-2 py-0.5 font-medium text-caution">Less certain trend</span>
          ) : null}
        </div>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Modeled weather */}
        <section aria-label="Modeled weather" className="px-4 py-4 md:px-5 lg:border-r lg:border-divider">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[13.5px] font-semibold text-ink">Weather model</p>
            {forecast.run ? <Evidence kind="modeled" demo={forecast.run.kind === 'demo'} /> : null}
          </div>
          {day ? <WeatherFacts day={day} q={q} elevationM={elev} /> : <p className="text-[14px] text-ink-3 italic">The stored run does not cover this day.</p>}
          {day && !day.complete ? (
            <p className="mt-3 text-[12.5px] text-ink-3 tnum">
              Covers {day.hoursCovered} of {day.expectedHours} hours — totals are lower bounds (≥).
            </p>
          ) : null}
          {day?.trend ? (
            <p className="mt-2 text-[12.5px] text-ink-3">Days 8–16 are shown only because the provider returned them. Treat them as a trend, not a plan.</p>
          ) : null}
        </section>

        {/* Piste estimate */}
        <section aria-label="Weather potential (Piste estimate)" className="border-t border-divider px-4 py-4 md:px-5 lg:border-t-0">
          <Potential potential={potential} isFuture={isFuture} isToday={isToday} scoringMode={scoringMode} tz={tz} />
        </section>
      </div>
    </article>
  )
}

function Stat({ label, value, sub, big }: { label: string; value: string | null; sub?: ReactNode; big?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] text-ink-2">{label}</dt>
      <dd className="mt-0.5">
        {value === null ? (
          <Missing kind="unavailable" label="Not provided" />
        ) : (
          <span className={cn('tnum text-ink', big ? 'font-display text-[30px] leading-none' : 'text-[16px] font-semibold')}>{value}</span>
        )}
        {sub ? <span className="mt-0.5 block text-[12.5px] text-ink-3 tnum">{sub}</span> : null}
      </dd>
    </div>
  )
}

function WeatherFacts({ day, q, elevationM }: { day: DayView; q: Q; elevationM: number | null }) {
  const ge = day.partial ? '≥ ' : ''
  const snow = q.snow.format(day.snowfallCm)
  const hi = q.temp.format(day.tempMaxC)
  const lo = q.temp.format(day.tempMinC)
  const fzMin = q.elevation.format(day.freezingLevelMinM)
  const fzMax = q.elevation.format(day.freezingLevelMaxM)
  const freezing = fzMin && fzMax ? (fzMin === fzMax ? fzMin : `${q.elevation.short(day.freezingLevelMinM)}–${fzMax}`) : null
  const aboveFreezing = elevationM !== null && day.freezingLevelMaxM !== null && day.freezingLevelMaxM > elevationM
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
      <Stat big label="Snowfall" value={snow === null ? null : `${ge}${snow}`} sub="new snow, day total" />
      <Stat
        big
        label="High / low"
        value={hi && lo ? `${hi.replace(/°[CF]$/, '°')} / ${lo}` : (hi ?? lo)}
        sub={day.apparentMinC !== null ? `feels like ${q.temp.format(day.apparentMinC)} at coldest` : undefined}
      />
      <Stat
        big
        label="Wind"
        value={q.speed.format(day.windMaxKmh)}
        sub={day.gustMaxKmh !== null ? `gusts to ${q.speed.format(day.gustMaxKmh)}` : 'gusts not provided'}
      />
      <Stat label="Rain" value={day.rainMm === null ? null : `${ge}${q.precip.format(day.rainMm)}`} sub="liquid, never counted as snow" />
      <Stat label="Visibility (lowest)" value={q.visibility.format(day.visibilityMinM)} />
      <Stat
        label="Freezing level"
        value={freezing}
        sub={
          freezing && elevationM !== null
            ? aboveFreezing
              ? `rises above this point (${q.elevation.format(elevationM)})`
              : `stays below this point (${q.elevation.format(elevationM)})`
            : undefined
        }
      />
      {day.hoursBelowFreezing !== null ? <Stat label="Hours below freezing" value={`${day.hoursBelowFreezing} of ${day.hoursCovered}`} /> : null}
    </dl>
  )
}

function Potential({
  potential,
  isFuture,
  isToday,
  scoringMode,
  tz,
}: {
  potential: DayPotential | undefined
  isFuture: boolean
  isToday: boolean
  scoringMode: ScoringMode
  tz: string
}) {
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const shown = displayPotential(potential, isFuture)
  const heading = isToday && shown?.scoreKind === 'conditions' ? 'Conditions today' : 'Weather potential'
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13.5px] font-semibold text-ink">
          {heading} <span className="font-normal text-ink-3">· {SCORING_MODE_LABEL[scoringMode]}</span>
        </p>
        {potential ? <Evidence kind="derived" demo={potential.kind === 'demo'} /> : null}
      </div>
      {!potential || !shown ? (
        <p className="flex items-start gap-2 text-[14px] text-ink-2">
          <CloudSun aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
          <span>No estimate stored for this day. Piste computes weather potential after each weather refresh; nothing is guessed in the meantime.</span>
        </p>
      ) : shown.scoreKind === 'closed' ? (
        <div className="flex items-start gap-2 rounded-[10px] border border-critical/30 bg-critical-bg px-3 py-2.5">
          <Ban aria-hidden className="mt-0.5 size-4 shrink-0 text-critical" />
          <div className="text-[14px]">
            <p className="font-semibold text-critical">Closed</p>
            <p className="text-ink-2">{potential.closure?.reason ?? 'A confirmed closure overrides any ski-day score.'}</p>
          </div>
        </div>
      ) : shown.score === null ? (
        <p className="text-[14px] text-ink-2">
          {potential.scoreKind === 'conditions' || potential.scoreKind === 'limited'
            ? 'A full conditions score is never shown for a future day — terrain and surface reports for it do not exist yet.'
            : 'No score: the inputs for this day were not enough for an estimate.'}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ScoreChip scoreKind={shown.scoreKind} score={shown.score} coverage={potential.coverage} size="md" />
          <ConfidenceTag confidence={potential.confidence} />
        </div>
      )}
      {potential && shown && shown.scoreKind !== 'closed' ? (
        <>
          {potential.surface.text ? (
            <p className="text-[14px] text-ink">
              <span className="text-ink-2">
                {potential.surface.basis === 'inferred'
                  ? 'Surface (inferred): '
                  : potential.surface.basis === 'reported'
                    ? 'Surface (reported): '
                    : 'Surface: '}
              </span>
              {potential.surface.text}
            </p>
          ) : null}
          {potential.explanation.length ? (
            <ul className="flex list-disc flex-col gap-1 pl-4 text-[13.5px] text-ink-2 marker:text-ink-3">
              {(all ? potential.explanation : potential.explanation.slice(0, 4)).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {potential.explanation.length > 4 ? (
              <button type="button" onClick={() => setAll((v) => !v)} className="text-[13px] font-medium text-teal hover:underline">
                {all ? 'Show fewer reasons' : `Show all ${potential.explanation.length} reasons`}
              </button>
            ) : null}
            {potential.components.length ? (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-[13px] font-medium text-teal hover:underline"
              >
                Factor breakdown
                <ChevronDown aria-hidden className={cn('size-4 transition-transform duration-150', open && 'rotate-180')} />
              </button>
            ) : null}
          </div>
          <AnimatePresence initial={false}>
            {open ? (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={t.pageIn}>
                <ScoreBreakdown components={potential.components} className="rounded-[10px] bg-surface-2 p-3" />
                <p className="mt-2 text-[12.5px] text-ink-3 tnum">Inputs cover {Math.round(potential.coverage * 100)}% of the weighted model.</p>
              </motion.div>
            ) : null}
          </AnimatePresence>
          <div className="flex items-start justify-between gap-3 border-t border-divider pt-2.5">
            <p className="text-[12.5px] text-ink-3 tnum">
              Computed {instantLocal(potential.computedAt, tz)}
              {potential.leadDays !== null && potential.leadDays > 0
                ? ` · ${potential.leadDays} ${potential.leadDays === 1 ? 'day' : 'days'} ahead`
                : ''} · {potential.modelVersion}
            </p>
            <SourceDrawer
              title="Weather potential"
              className="shrink-0"
              items={[
                {
                  label: `${heading} (${SCORING_MODE_LABEL[scoringMode]})`,
                  value: shown.score !== null ? `${shown.score}${shown.scoreKind === 'conditions' ? '' : '*'} — ${shown.descriptor ?? ''}` : undefined,
                  prov: potential.prov,
                },
              ]}
            />
          </div>
          <p className="text-[12.5px] text-ink-3">Scores describe suitability, not safety.</p>
        </>
      ) : null}
    </div>
  )
}
