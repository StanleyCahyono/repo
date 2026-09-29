'use client'
/**
 * One history day, three columns that never mix:
 *  - Forecast then: the stored run(s) fetched BEFORE the resort-local day started, aggregated for that day.
 *  - Reported: the operations report as published by the end of that day (source + time), plus values that were
 *    only reported later (next-morning windows, later revisions) — labelled as such.
 *  - Piste estimated then: the assessment computed before the day, with its model version.
 * Nothing is recomputed from later data.
 */
import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { chartUnits } from '@/components/charts/units'
import { Sheet } from '@/components/ui/sheet'
import { Missing } from '@/components/ui/provenance'
import { ConfidenceTag, ScoreChip } from '@/components/ui/score'
import { SourceDrawer } from '@/components/ui/source-drawer'
import { StatusPill } from '@/components/ui/status'
import type { DayForecastThen, HistoryCalendar, HistoryDay } from '@/lib/data/forecast'
import type { ResortInfo } from '@/lib/data/forecast-screen'
import { relativeLabel } from '@/lib/domain/time'
import { SCORING_MODE_LABEL, SURFACE_LABEL, type AppMode, type UnitPrefs } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'
import { Evidence } from './evidence'
import { dayMedium, dayYear, instantLocal, POINT_LABEL, WINDOW_LABEL } from './model'
import { providerLabel } from './run-details'

type Q = ReturnType<typeof chartUnits>

export function HistoryDaySheet({
  day,
  calendar,
  info,
  units,
  now,
  appMode,
  onClose,
  onCloseAutoFocus,
}: {
  day: HistoryDay | null
  calendar: HistoryCalendar
  info: ResortInfo | undefined
  units: UnitPrefs
  now: string
  appMode: AppMode
  onClose: () => void
  onCloseAutoFocus?: (event: Event) => void
}) {
  const q = chartUnits(units)
  const tz = calendar.timezone
  const name = info?.name ?? calendar.name
  return (
    <Sheet
      open={!!day}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title={day ? `${dayYear(day.date)} · ${name}` : name}
      description={
        day?.state === 'today'
          ? 'Today is still in progress: the forecast made before it, what has been reported so far, and what Piste estimated before it began.'
          : 'What was forecast before the day, what was reported, and what Piste estimated then — never recomputed from later data.'
      }
      widthClass="md:w-[min(94vw,900px)]"
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {day ? (
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 lg:grid-cols-3">
            <Column
              title="Forecast then"
              tags={day.forecastThen.base || day.forecastThen.summit ? <Evidence kind="modeled" demo={appMode === 'demo'} /> : null}
            >
              {day.forecastThen.base || day.forecastThen.summit ? (
                <div className="flex flex-col gap-4">
                  {(['base', 'summit'] as const).map((p) =>
                    day.forecastThen[p] ? <ForecastThen key={p} point={p} f={day.forecastThen[p]!} q={q} tz={tz} /> : null,
                  )}
                </div>
              ) : (
                <Empty>No stored forecast was fetched before this day began, so there is nothing to compare — none is reconstructed.</Empty>
              )}
            </Column>

            <Column
              title="Reported"
              tags={day.report ? <Evidence kind={day.report.kind === 'manual' ? 'manual' : 'official'} demo={day.report.kind === 'demo'} /> : null}
            >
              <Reported day={day} q={q} tz={tz} now={now} />
            </Column>

            <Column title="Piste estimated then" tags={day.assessmentThen ? <Evidence kind="derived" demo={appMode === 'demo'} /> : null}>
              {day.assessmentThen ? (
                <div className="flex flex-col gap-2.5">
                  <ScoreChip scoreKind={day.assessmentThen.scoreKind} score={day.assessmentThen.score} size="md" />
                  <ConfidenceTag confidence={day.assessmentThen.confidence} />
                  {day.assessmentThen.surface.text ? (
                    <p className="text-[13.5px] text-ink">
                      <span className="text-ink-2">{day.assessmentThen.surface.basis === 'inferred' ? 'Surface (inferred): ' : 'Surface: '}</span>
                      {day.assessmentThen.surface.text}
                    </p>
                  ) : null}
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
                    <dt className="text-ink-3">Computed</dt>
                    <dd className="text-ink-2 tnum">
                      {instantLocal(day.assessmentThen.computedAt, tz)}
                      {day.assessmentThen.leadDays !== null && day.assessmentThen.leadDays > 0
                        ? ` · ${day.assessmentThen.leadDays} ${day.assessmentThen.leadDays === 1 ? 'day' : 'days'} ahead`
                        : ''}
                    </dd>
                    <dt className="text-ink-3">Mode</dt>
                    <dd className="text-ink-2">{SCORING_MODE_LABEL[day.assessmentThen.mode]}</dd>
                    <dt className="text-ink-3">Model</dt>
                    <dd className="font-mono text-[12px] text-ink-2">{day.assessmentThen.modelVersion}</dd>
                  </dl>
                  <p className="text-[12.5px] text-ink-3">
                    The estimate as it stood before the day — later reports never rewrite it. Scores describe suitability, not safety.
                  </p>
                </div>
              ) : (
                <Empty>No estimate was computed before this day began.</Empty>
              )}
            </Column>
          </div>
          {day.notes.length || calendar.notes.length ? (
            <ul className="flex flex-col gap-1 border-t border-divider pt-3 text-[12.5px] text-ink-3">
              {[...day.notes, ...calendar.notes].map((n) => (
                <li key={n}>· {n}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  )
}

function Column({ title, tags, children }: { title: string; tags?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3 rounded-[12px] border border-divider bg-surface-2 p-3.5">
      <header className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-divider pb-2">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {tags}
      </header>
      {children}
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[13.5px] text-ink-3 italic">{children}</p>
}

function Row({ label, value, className }: { label: string; value: ReactNode | null; className?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1', className)}>
      <dt className="text-[12.5px] text-ink-2">{label}</dt>
      <dd className="text-right text-[13.5px] font-medium text-ink tnum">
        {value === null ? <Missing kind="unavailable" label="Not provided" className="text-[12.5px] font-normal" /> : value}
      </dd>
    </div>
  )
}

/** The source's own wording, verbatim (it may contain inch marks, so no quotation marks around it). */
function SourceWording({ text }: { text: string }) {
  return (
    <span title="Wording as published" className="ml-1.5 inline-block rounded-[4px] bg-surface-3 px-1 font-mono text-[12px] font-normal text-ink-2">
      {text}
    </span>
  )
}

function ForecastThen({ point, f, q, tz }: { point: 'base' | 'summit'; f: DayForecastThen; q: Q; tz: string }) {
  const ge = f.complete ? '' : '≥ '
  const lead = f.leadHours >= 48 ? `${Math.round(f.leadHours / 24)} days` : `${Math.round(f.leadHours)} h`
  return (
    <div>
      <p className="text-[13px] font-semibold text-ink">{POINT_LABEL[point]}</p>
      <p className="text-[12.5px] text-ink-3 tnum">
        {providerLabel({ provider: f.provider })} · fetched {instantLocal(f.fetchedAt, tz)} · {lead} before the day
        {f.modelRunAt ? ` · model run ${instantLocal(f.modelRunAt, tz)}` : ''}
      </p>
      <dl className="mt-1.5 divide-y divide-divider">
        <Row label="Snowfall" value={f.snowfallCm === null ? null : `${ge}${q.snow.format(f.snowfallCm)}`} />
        <Row label="High / low" value={f.tempMaxC === null || f.tempMinC === null ? null : `${q.temp.short(f.tempMaxC)} / ${q.temp.format(f.tempMinC)}`} />
        <Row label="Wind (max)" value={q.speed.format(f.windMaxKmh)} />
        <Row label="Gusts (max)" value={q.speed.format(f.gustMaxKmh)} />
        <Row label="Rain" value={f.rainMm === null ? null : `${ge}${q.precip.format(f.rainMm)}`} />
        <Row label="Hours covered" value={`${Math.round(f.coverage * 100)}%`} />
      </dl>
    </div>
  )
}

function Reported({ day, q, tz, now }: { day: HistoryDay; q: Q; tz: string; now: string }) {
  const r = day.report
  return (
    <div className="flex flex-col gap-3">
      {r ? (
        <>
          <div>
            <p className="text-[12.5px] text-ink-3 tnum">
              {r.prov.provider ?? 'Source not named'} · {r.reportedAt ? `published ${instantLocal(r.reportedAt, tz)}` : 'publish time not stated'}
              {day.revisions > 1 ? ` · revision ${r.revision} of ${day.revisions}` : ''}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {r.status ? <StatusPill status={r.status} size="sm" /> : null}
              {r.prov.sourceUrl ? (
                <a
                  href={r.prov.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12.5px] font-medium text-teal hover:underline"
                >
                  Source <ExternalLink aria-hidden className="size-3.5" />
                </a>
              ) : null}
              <SourceDrawer
                title={`Report for ${dayYear(day.date)}`}
                items={[{ label: 'Operations report', value: r.surfaceText ?? undefined, prov: r.prov }]}
              />
            </div>
          </div>
          <dl className="divide-y divide-divider">
            {r.snowfall.length ? (
              r.snowfall.map((s) => (
                <Row
                  key={s.window}
                  label={WINDOW_LABEL[s.window]}
                  value={
                    s.amountCm === null ? null : (
                      <span>
                        {q.snow.format(s.amountCm)}
                        {s.sourceText ? <SourceWording text={s.sourceText} /> : null}
                      </span>
                    )
                  }
                />
              ))
            ) : (
              <Row label="Snowfall" value={<span className="text-[12.5px] font-normal text-ink-3 italic">Not stated in the report</span>} />
            )}
            <Row label={`Base depth${r.baseDepthLocation ? ` (${r.baseDepthLocation})` : ''}`} value={q.snow.format(r.baseDepthCm)} />
            {r.summitDepthCm !== null ? <Row label="Summit depth" value={q.snow.format(r.summitDepthCm)} /> : null}
            <Row label="Open trails" value={r.openTrails !== null ? `${r.openTrails}${r.totalTrails !== null ? ` of ${r.totalTrails}` : ''}` : null} />
            <Row label="Open lifts" value={r.openLifts !== null ? `${r.openLifts}${r.totalLifts !== null ? ` of ${r.totalLifts}` : ''}` : null} />
          </dl>
          {r.surfaceText || r.surfaceTags.length ? (
            <p className="text-[13px] text-ink">
              <span className="text-ink-2">Surface: </span>
              {r.surfaceText ?? r.surfaceTags.map((tag) => SURFACE_LABEL[tag]).join(', ')}
            </p>
          ) : null}
          {r.groomingText ? (
            <p className="text-[13px] text-ink">
              <span className="text-ink-2">Grooming: </span>
              {r.groomingText}
            </p>
          ) : null}
          {r.snowmakingText ? (
            <p className="text-[13px] text-ink">
              <span className="text-ink-2">Snowmaking: </span>
              {r.snowmakingText}
            </p>
          ) : null}
        </>
      ) : (
        <Empty>No report stored for this day{day.laterReported.length ? ' as of the end of it' : ''}.</Empty>
      )}
      {day.laterReported.length ? (
        <div className="rounded-[10px] border border-dashed border-divider-strong px-3 py-2">
          <p className="text-[12.5px] font-semibold text-ink-2">Reported later</p>
          <ul className="mt-1 flex flex-col gap-1.5 text-[12.5px] text-ink-2">
            {day.laterReported.map((l, i) => (
              <li key={i}>
                {l.source === 'next-day-report' && l.window ? (
                  <>
                    <span className="font-semibold text-ink tnum">{l.amountCm !== null ? q.snow.format(l.amountCm) : 'Amount not stated'}</span> ·{' '}
                    {WINDOW_LABEL[l.window].toLowerCase()} snowfall in the next morning’s report ({dayMedium(l.localDate)}
                    {l.reportedAt ? `, ${instantLocal(l.reportedAt, tz, 'HH:mm')}` : ''}). Its window may not match this local day exactly.
                  </>
                ) : (
                  <>
                    {l.note}
                    {l.reportedAt ? <span className="text-ink-3"> · {relativeLabel(l.reportedAt, now)}</span> : null}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
