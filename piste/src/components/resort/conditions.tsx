/**
 * 02 Conditions — what was reported, what the weather model says, and what Piste estimates, kept apart.
 *
 * Hard rules are visible before any number: a confirmed closure replaces the score with "Closed"; an unknown
 * operating status is called out and never treated as open; official alerts stand on their own and cannot be
 * offset by good component values. "Limited data" is a designed state, not a grey number.
 */
import Link from 'next/link'
import { AlertTriangle, ArrowRight, Ban, ChevronDown, CircleHelp, ClipboardPen, CloudOff, ExternalLink, FlaskConical, NotebookPen, Snowflake } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { ChartFrame, chartUnits, DailyBars, type DailyBarDatum } from '@/components/charts'
import { Disclosure } from '@/components/ui/disclosure'
import { ConfidenceTag, ScoreBreakdown, ScoreChip } from '@/components/ui/score'
import { Freshness, KindTag, Missing } from '@/components/ui/provenance'
import { StatusPill } from '@/components/ui/status'
import type { ResortDetail } from '@/lib/data/resort-detail'
import type { RefreshHealthView, ResortPageExtras } from '@/lib/data/resort-page'
import type { ReportView } from '@/lib/data/views'
import { CONDITIONS_CONFIG_V1 } from '@/lib/domain/conditions/config.v1'
import { formatLocalDate } from '@/lib/domain/time'
import { COMPONENT_LABEL, SCORING_MODE_LABEL, SURFACE_LABEL, type SnowfallReading } from '@/lib/domain/types'
import { ModeSwitch } from './mode-switch'
import { RefreshNow } from './refresh-now'
import { ObservationSheet, ReportEntrySheet } from './report-entry'
import { ResortSection, Src, SubHead } from './section'
import {
  ago,
  dayLabel,
  dayLabelYear,
  dotJoin,
  groupErrors,
  instantLabel,
  plural,
  pointTitle,
  REPORT_ORIGIN_LABEL,
  shortDate,
  src,
  units,
  WINDOW_LABEL,
  WINDOW_ORDER,
  type PageView,
} from './format'

const GATE = Math.round(CONDITIONS_CONFIG_V1.gate.minCoverage * 100)

/** Ends a stored note with a full stop so it can be followed by another sentence. */
const sentence = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`)

function ErrorList({ errors, className }: { errors: readonly { source: string; message: string }[]; className?: string }) {
  const groups = groupErrors(errors)
  if (!groups.length) return null
  return (
    <ul className={cn('flex flex-col gap-1 text-[12.5px] text-ink-2', className)}>
      {groups.map((g) => (
        <li key={g.message} className="flex gap-2">
          <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-critical" />
          <span className="min-w-0 break-words">
            {g.message}
            {g.where.length ? <span className="text-ink-3"> — {g.where.join(' and ')}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function ConditionsSection({ d, x, v, preferredMode }: { d: ResortDetail; x: ResortPageExtras; v: PageView; preferredMode: typeof v.mode }) {
  const reportUrl = d.links.find((l) => l.key === 'snowReport')?.url ?? x.refresh.reportAdapter?.sourceUrl ?? x.catalog.reportSource?.url ?? null
  const when = v.date === v.today ? 'today' : v.date < v.today ? 'past' : 'future'
  return (
    <ResortSection
      id="conditions"
      index={2}
      title="Conditions"
      meta={`${dayLabelYear(v.date)}${when === 'today' ? ' (today)' : ''} · ${SCORING_MODE_LABEL[v.mode]}`}
      actions={<ModeSwitch mode={v.mode} preferred={preferredMode} />}
    >
      <div className="flex flex-col gap-8">
        <HardRules d={d} v={v} when={when} />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <ScorePanel d={d} x={x} v={v} />
          <SnowReportPanel d={d} x={x} v={v} reportUrl={reportUrl} />
        </div>
        <SurfaceTrio d={d} v={v} />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] xl:items-start">
          <WeatherPanel d={d} x={x} v={v} />
          <div className="flex min-w-0 flex-col gap-6">
            <FeedHealth x={x} v={v} reportUrl={reportUrl} weatherShown={!!(d.summary.weather.baseRun || d.summary.weather.summitRun)} />
            <ManualEntry d={d} x={x} v={v} reportUrl={reportUrl} />
          </div>
        </div>
        <HistoryStrip x={x} v={v} />
        <div className="grid gap-6 lg:grid-cols-2">
          <ReportHistory d={d} v={v} />
          <MyObservations x={x} />
        </div>
      </div>
    </ResortSection>
  )
}

// ---------------------------------------------------------------------------
// Hard rules

function HardRules({ d, v, when }: { d: ResortDetail; v: PageView; when: 'today' | 'past' | 'future' }) {
  const r = d.summary
  const alerts = r.officialAlerts
  const items: React.ReactNode[] = []
  if (r.closure) {
    items.push(
      <div key="closed" role="status" className="flex gap-3 rounded-[12px] border border-critical/40 bg-critical-bg px-4 py-3">
        <Ban aria-hidden className="mt-0.5 size-5 shrink-0 text-critical" />
        <div className="min-w-0 text-[14px] text-ink">
          <p className="font-semibold">Closed on {dayLabelYear(v.date)}</p>
          <p className="mt-0.5 text-ink-2">
            {r.closure.reason}. A confirmed closure overrides any score: no ski-day score is shown, and the day is not recommended.
            {r.closure.statedAt ? ` Stated ${instantLabel(r.closure.statedAt, v.tz, v.now)}.` : ''}
          </p>
        </div>
        {r.closure.prov ? <Src title="Closure" items={[src('Closure', r.closure.prov, r.closure.reason)]} /> : null}
      </div>,
    )
  } else if (r.status.status === 'not-yet-open') {
    const o = r.opening
    items.push(
      <div key="not-open" role="status" className="flex gap-3 rounded-[12px] border border-divider-strong bg-surface-2 px-4 py-3">
        <CircleHelp aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-2" />
        <div className="min-w-0 text-[14px] text-ink">
          <p className="font-semibold">Not open yet for the season — not treated as open</p>
          <p className="mt-0.5 text-ink-2">
            {r.status.localDate ? `Last stated ${dayLabel(r.status.localDate)}. ` : ''}
            {o.label === 'announced' && o.daysAway !== null && o.daysAway < 0
              ? `The announced target (${dayLabel(o.date!)}) has passed without an opening — an announced date never turns into “Open” on its own.`
              : 'A day here is not a ski day until the resort reports that it has opened.'}
          </p>
        </div>
        {r.status.prov ? <Src title="Operating status" items={[src('Operating status', r.status.prov, r.status.label)]} /> : null}
      </div>,
    )
  } else if (r.status.status === 'unknown') {
    items.push(
      <div key="unknown" role="status" className="flex gap-3 rounded-[12px] border border-dashed border-caution/60 bg-caution-bg px-4 py-3">
        <CircleHelp aria-hidden className="mt-0.5 size-5 shrink-0 text-caution" />
        <div className="min-w-0 text-[14px] text-ink">
          <p className="font-semibold">Operating status unknown — not treated as open</p>
          <p className="mt-0.5 text-ink-2">
            {sentence(r.status.note ?? 'Nothing is recorded')} Any score below is at most a weather estimate; check the official snow report before you go.
          </p>
        </div>
      </div>,
    )
  }
  if (alerts.length) {
    items.push(
      <div key="alerts" role="status" className="rounded-[12px] border border-critical/40 bg-surface px-4 py-3">
        <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <AlertTriangle aria-hidden className="size-4 text-critical" /> Official alerts ({alerts.length})
        </p>
        <p className="mt-0.5 text-[12.5px] text-ink-3">Shown separately from the score — good component values never offset an official warning.</p>
        <ul className="mt-2 flex flex-col divide-y divide-divider">
          {alerts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-[13.5px]">
              <span className="font-semibold text-critical">{a.event}</span>
              {a.severity ? <span className="text-ink-2">{a.severity}</span> : null}
              <span className="text-ink-3 tnum">
                {dotJoin(a.onset ? `${a.upcoming ? 'From' : 'Since'} ${instantLabel(a.onset, v.tz, v.now)}` : null, a.ends ? `until ${instantLabel(a.ends, v.tz, v.now)}` : 'no end time given')}
              </span>
              {a.headline ? <span className="basis-full text-ink-2">{a.headline}</span> : null}
              <span className="flex items-center gap-2">
                <KindTag kind="official" />
                <span className="text-[12px] text-ink-3">{a.provider}</span>
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-teal hover:underline">
                    Details <ExternalLink aria-hidden className="size-3" />
                  </a>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </div>,
    )
  }
  if (when !== 'today') {
    items.push(
      <p key="when" className="text-[13px] text-ink-2">
        {when === 'past'
          ? `Viewing a past day. The score is the latest assessment stored for ${dayLabel(v.date)}; what was forecast and estimated beforehand is in the daily history below.`
          : `Viewing a future day. Only weather potential can be estimated — open terrain and operating status for ${dayLabel(v.date)} are unknown, and no forecast is invented beyond the provider’s horizon.`}
      </p>,
    )
  }
  return items.length ? <div className="flex flex-col gap-3">{items}</div> : null
}

// ---------------------------------------------------------------------------
// Score

function CoverageMeter({ coverage }: { coverage: number }) {
  const pct = Math.round(coverage * 100)
  return (
    <div>
      <div className="relative h-2 rounded-full bg-surface-3" aria-hidden>
        <span className={cn('block h-full rounded-full', pct >= GATE ? 'bg-teal' : 'bg-caution')} style={{ width: `${Math.max(2, pct)}%` }} />
        <span className="absolute -top-1 h-4 w-0.5 rounded-full bg-ink" style={{ left: `${GATE}%` }} />
      </div>
      <p className="mt-1.5 text-[12.5px] text-ink-2 tnum">
        Inputs cover <span className="font-semibold text-ink">{pct}%</span> of the weighted model · {GATE}% needed for a full score
      </p>
    </div>
  )
}

function ScorePanel({ d, x, v }: { d: ResortDetail; x: ResortPageExtras; v: PageView }) {
  const r = d.summary
  const s = r.score
  const weights = CONDITIONS_CONFIG_V1.weights[v.mode]
  const weatherMissing = !r.weather.baseRun && !r.weather.summitRun

  if (r.closure) {
    return (
      <section aria-labelledby="score-title" className="flex min-w-0 flex-col gap-4 rounded-[12px] border border-critical/35 bg-surface p-5">
        <SubHead id="score-title" className="mb-0">
          Piste Conditions
        </SubHead>
        <div className="flex items-center gap-3">
          <Ban aria-hidden className="size-9 text-critical" strokeWidth={1.6} />
          <div>
            <p className="font-display text-[40px] leading-none text-critical">Closed</p>
            <p className="mt-1 text-[13px] text-ink-2">{r.closure.reason}</p>
          </div>
        </div>
        <p className="text-[13.5px] text-ink-2">
          No ski-day score is shown for a closed resort — the model’s own estimate for this day is withheld so it can’t be mistaken for a reason to go.
        </p>
      </section>
    )
  }

  if (!s) {
    return (
      <section aria-labelledby="score-title" className="flex min-w-0 flex-col gap-3 rounded-[12px] border border-dashed border-divider-strong bg-surface-2 p-5">
        <SubHead id="score-title" className="mb-0">
          Piste Conditions
        </SubHead>
        <p className="flex items-center gap-2 font-display text-[30px] leading-none text-ink-3">
          <CircleHelp aria-hidden className="size-7" strokeWidth={1.6} /> No score yet
        </p>
        <p className="text-[13.5px] text-ink-2">
          {weatherMissing
            ? x.refresh.weather.lastAttemptOutcome === 'failed'
              ? 'The weather fetch failed and no forecast has been stored yet, so there is nothing to score — Piste shows no score rather than a guess.'
              : 'Weather has not been fetched for this resort yet, so there is nothing to score — Piste shows no score rather than a guess.'
            : `No assessment is stored for ${dayLabel(v.date)} in ${SCORING_MODE_LABEL[v.mode].toLowerCase()} mode — dates beyond the forecast horizon are never scored.`}
        </p>
        <p className="text-[12.5px] text-ink-3">
          A full score needs surface evidence, terrain status, wind and at least {GATE}% of the weighted inputs. Scores describe suitability, not safety.
        </p>
      </section>
    )
  }

  const limited = s.scoreKind === 'limited'
  const potential = s.scoreKind === 'weather-potential'
  const componentNotes = new Set(s.components.map((c) => c.note))
  const why = s.explanation.filter((l) => !componentNotes.has(l) && !l.startsWith('Not scored —') && !/^Inputs cover \d+%/.test(l))
  const excluded = s.components.filter((c) => !c.included)

  return (
    <section
      aria-labelledby="score-title"
      className={cn('flex min-w-0 flex-col gap-4 rounded-[12px] border bg-surface p-5', limited ? 'border-dashed border-caution/60' : 'border-divider')}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <SubHead id="score-title" className="mb-0">
            Piste Conditions
          </SubHead>
          <p className="text-[12.5px] text-ink-3">{SCORING_MODE_LABEL[v.mode]} · suitability, not safety</p>
        </div>
        <div className="flex items-center gap-1">
          <KindTag kind={s.kind === 'demo' ? 'demo' : 'derived'} />
          <Src title="Conditions score" items={[src('Conditions score', s.prov, s.score !== null ? `${s.score} ${s.descriptor ?? ''}` : (s.descriptor ?? 'Limited data'))]} />
        </div>
      </div>

      {limited ? (
        <div>
          <p className="font-display text-[34px] leading-none text-caution">Limited data</p>
          <p className="mt-1.5 text-[13.5px] text-ink-2">
            Not a full conditions score.{' '}
            {s.score !== null ? (
              <>
                The available inputs suggest about <span className="font-semibold text-ink tnum">{s.score}</span> — an estimate, not a day score.
              </>
            ) : (
              'Too little is known for an overall estimate; the available components are shown below.'
            )}
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
          <ScoreChip scoreKind={s.scoreKind} score={s.score} coverage={s.coverage} size="lg" />
          <ConfidenceTag confidence={s.confidence} className="pb-1" />
        </div>
      )}
      {potential ? (
        <p className="rounded-[10px] bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
          <span className="font-semibold text-ink">Weather potential only.</span> Assumes the resort operates; open terrain and status for this date are unknown and not
          projected.
        </p>
      ) : null}

      <CoverageMeter coverage={s.coverage} />
      {limited || excluded.length ? (
        <p className="text-[12.5px] text-ink-2">
          {excluded.length ? (
            <>
              Excluded (no data, never filled with a neutral value): <span className="font-medium text-ink">{excluded.map((c) => COMPONENT_LABEL[c.key]).join(', ')}</span>.
            </>
          ) : null}{' '}
          {limited ? <span className="font-medium text-caution">{s.confidence === 'low' ? 'Low' : s.confidence} confidence.</span> : null}
        </p>
      ) : null}

      {s.components.length ? (
        <Disclosure
          id="score-breakdown"
          variant="row"
          className="scroll-mt-[124px] border-y border-divider md:scroll-mt-[84px]"
          summary={`How the score adds up · ${s.components.filter((c) => c.included).length} of ${s.components.length} factors`}
        >
          <ScoreBreakdown components={s.components} className="pt-1 pb-3" />
        </Disclosure>
      ) : null}

      {why.length ? (
        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-ink">Why</p>
          <ul className="flex flex-col gap-1 text-[13px] text-ink-2">
            {why.map((l) => (
              <li key={l} className="flex gap-2">
                <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-3" />
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {s.confidenceReasons.length ? (
        <p className="text-[12.5px] text-ink-3">
          Confidence: {s.confidence} — {s.confidenceReasons.join('; ')}. A qualitative evidence label, not a probability.
        </p>
      ) : null}
      <p className="mt-auto border-t border-divider pt-3 text-[12px] text-ink-3 tnum">
        {dotJoin(
          s.modelVersion,
          `computed ${instantLabel(s.computedAt, v.tz, v.now)}`,
          s.leadDays !== null && s.leadDays > 0 ? `${plural(s.leadDays, 'day')} ahead` : null,
          `weights S${weights.S} T${weights.T} W${weights.W} V${weights.V} C${weights.C}`,
          'not yet calibrated',
        )}
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Snow report

function windowText(sf: SnowfallReading, tz: string): string | null {
  if (!sf.startAt || !sf.endAt) return null
  return `${instantLabel(sf.startAt, tz)} → ${instantLabel(sf.endAt, tz).replace(/^\w{3} \d{1,2} \w{3}, /, '')}`
}

function Meter({ label, open, total }: { label: string; open: number | null; total: number | null }) {
  const pct = open !== null && total ? Math.min(100, (open / total) * 100) : null
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-ink-2">{label}</span>
        <span className="text-[14px] font-semibold text-ink tnum">
          {open === null ? <Missing label="Not reported" className="font-normal" /> : total !== null ? `${open} / ${total}` : `${open} open`}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        {pct !== null ? <span className="block h-full rounded-full bg-positive/80" style={{ width: `${Math.max(2, pct)}%` }} /> : null}
      </div>
    </div>
  )
}

function SnowReportPanel({ d, x, v, reportUrl }: { d: ResortDetail; x: ResortPageExtras; v: PageView; reportUrl: string | null }) {
  const r = d.summary
  const rep = r.snow.report
  const u = units(v.units)
  const fc = r.snow.forecast
  return (
    <section aria-labelledby="report-title" className="flex min-w-0 flex-col gap-4 rounded-[12px] border border-divider bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <SubHead id="report-title" className="mb-0">
            Snow report
          </SubHead>
          {rep ? (
            <p className="text-[12.5px] text-ink-2 tnum">
              {dotJoin(REPORT_ORIGIN_LABEL[rep.origin], rep.reportedAt ? `published ${instantLabel(rep.reportedAt, v.tz, v.now)} ${v.zone}` : `for ${dayLabel(rep.localDate)} (publish time not stated)`)}
              {rep.revision > 1 ? ` · revision ${rep.revision}` : ''}
            </p>
          ) : null}
        </div>
        {rep ? (
          <div className="flex items-center gap-2">
            <KindTag kind={rep.kind} />
            <Freshness at={rep.reportedAt ?? rep.fetchedAt} now={v.now} staleHours={24} prefix={rep.reportedAt ? 'Published' : 'Fetched'} />
            <Src title="Snow report" items={[src(`Report for ${dayLabelYear(rep.localDate)}`, rep.prov)]} />
          </div>
        ) : null}
      </div>

      {rep ? (
        <>
          {rep.localDate !== v.date ? (
            <p className="rounded-[10px] border border-caution/40 bg-caution-bg px-3 py-2 text-[13px] text-ink">
              Latest report on or before {dayLabel(v.date)} is from <span className="font-semibold">{dayLabelYear(rep.localDate)}</span>
              {v.date > rep.localDate ? ` — ${plural(Math.round((Date.parse(v.date) - Date.parse(rep.localDate)) / 86_400_000), 'day')} earlier` : ''}.
            </p>
          ) : null}
          <div>
            <p className="mb-1.5 text-[13px] font-semibold text-ink">Reported snowfall</p>
            {rep.snowfall.length ? (
              <table className="w-full text-left text-[13.5px]">
                <caption className="sr-only">Reported snowfall by accumulation window, with the source wording</caption>
                <thead>
                  <tr className="border-b border-divider text-[12px] text-ink-3">
                    <th scope="col" className="py-1.5 pr-2 font-medium">
                      Window
                    </th>
                    <th scope="col" className="py-1.5 pr-2 text-right font-medium">
                      Amount
                    </th>
                    <th scope="col" className="hidden py-1.5 pr-2 font-medium sm:table-cell">
                      Period stated
                    </th>
                    <th scope="col" className="py-1.5 font-medium">
                      As written
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...rep.snowfall]
                    .sort((a, b) => WINDOW_ORDER.indexOf(a.window) - WINDOW_ORDER.indexOf(b.window))
                    .map((sf) => (
                      <tr key={sf.window} className="border-b border-divider last:border-b-0">
                        <th scope="row" className="py-2 pr-2 font-normal text-ink-2">
                          {WINDOW_LABEL[sf.window] ?? sf.window}
                          <span className="block text-[11.5px] text-ink-3 tnum sm:hidden">{windowText(sf, v.tz) ?? 'Period not stated'}</span>
                        </th>
                        <td className="py-2 pr-2 text-right font-display text-[20px] leading-none text-ink tnum">{sf.amountCm !== null ? u.snow(sf.amountCm) : <Missing />}</td>
                        <td className="hidden py-2 pr-2 text-[12.5px] text-ink-3 tnum sm:table-cell">{windowText(sf, v.tz) ?? 'Not stated'}</td>
                        <td className="py-2 font-mono text-[12px] text-ink-2">{sf.sourceText ?? <span className="font-sans text-ink-3 italic">—</span>}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : (
              <p className="text-[13px] text-ink-3 italic">This report states no snowfall amounts.</p>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-divider pt-3">
            <div>
              <dt className="text-[12.5px] text-ink-3">Base depth</dt>
              <dd className={rep.baseDepthCm !== null ? 'font-display text-[26px] leading-tight text-ink tnum' : 'py-1.5'}>{rep.baseDepthCm !== null ? u.snow(rep.baseDepthCm) : <Missing label="Not reported" />}</dd>
              {rep.baseDepthLocation ? <dd className="text-[12.5px] text-ink-2">{rep.baseDepthLocation}</dd> : null}
            </div>
            <div>
              <dt className="text-[12.5px] text-ink-3">Summit depth</dt>
              <dd className={rep.summitDepthCm !== null ? 'font-display text-[26px] leading-tight text-ink tnum' : 'py-1.5'}>{rep.summitDepthCm !== null ? u.snow(rep.summitDepthCm) : <Missing label="Not reported" />}</dd>
            </div>
          </dl>
          <div className="grid gap-3 border-t border-divider pt-3 sm:grid-cols-3">
            <Meter label="Trails" open={rep.openTrails} total={rep.totalTrails} />
            <Meter label="Beginner trails" open={rep.openBeginnerTrails} total={rep.totalBeginnerTrails} />
            <Meter label="Lifts" open={rep.openLifts} total={rep.totalLifts} />
          </div>
          {rep.openAcres !== null ? <p className="-mt-1 text-[12.5px] text-ink-2 tnum">{rep.openAcres.toLocaleString('en-US')} acres open</p> : null}
          {rep.status ? (
            <p className="flex items-center gap-2 text-[13px] text-ink-2">
              Status in this report: <StatusPill status={rep.status} size="sm" />
            </p>
          ) : null}
          {rep.notes ? <p className="text-[12.5px] text-ink-3">{rep.notes}</p> : null}
        </>
      ) : (
        <div className="flex flex-col gap-3 rounded-[10px] border border-dashed border-divider-strong bg-surface-2 p-4">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <CloudOff aria-hidden className="size-4 text-ink-3" /> No snow report on file
          </p>
          <p className="text-[13.5px] text-ink-2">
            {x.refresh.reportAdapter
              ? `Piste has an ${x.refresh.reportAdapter.state === 'unverified' ? 'unverified ' : ''}reader for “${x.refresh.reportAdapter.label}”, but it has not stored a report${x.refresh.reports?.lastAttemptOutcome === 'failed' ? ' — the last fetch failed' : ''}.`
              : 'No official report reader exists for this resort — reports come from manual entries only.'}{' '}
            Snowfall, base depth, open terrain and grooming stay unknown until a report is read or entered.
          </p>
          <div className="flex flex-wrap gap-2">
            {reportUrl ? (
              <a
                href={reportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-md border border-divider-strong bg-surface px-3.5 text-[14px] font-medium text-ink hover:border-teal hover:text-teal"
              >
                Official snow report <ExternalLink aria-hidden className="size-3.5" />
              </a>
            ) : null}
            <a href="#manual-entry" className="inline-flex h-10 items-center gap-2 rounded-md px-2 text-[14px] font-medium text-teal hover:underline">
              Enter what it says <ArrowRight aria-hidden className="size-4" />
            </a>
          </div>
        </div>
      )}

      <div className="rounded-[10px] bg-surface-2 px-3 py-2.5">
        <p className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
          Model estimate, not a report <KindTag kind={fc.base?.run.kind === 'demo' || fc.summit?.run.kind === 'demo' ? 'demo' : 'modeled'} />
        </p>
        {fc.base || fc.summit ? (
          <dl className="mt-1.5 grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-0.5 text-[12.5px] tnum">
            <span />
            <span className="text-ink-3">Next 72 h</span>
            <span className="text-ink-3">Next 7 days</span>
            {(['base', 'summit'] as const).map((k) => {
              const f = fc[k]
              return (
                <div key={k} className="contents">
                  <dt className="text-ink-2">{pointTitle(k)}</dt>
                  <dd className="text-ink">{f ? (f.next72h.sumCm !== null ? `${u.snow(f.next72h.sumCm)}${f.next72h.complete ? '' : ' (partial)'}` : 'Not provided') : '—'}</dd>
                  <dd className="text-ink">{f ? (f.next7d.sumCm !== null ? `${u.snow(f.next7d.sumCm)}${f.next7d.complete ? '' : ' (partial)'}` : 'Not provided') : '—'}</dd>
                </div>
              )
            })}
          </dl>
        ) : (
          <p className="mt-1 text-[12.5px] text-ink-3">No modeled snowfall — weather has not been fetched.</p>
        )}
        <p className="mt-1.5 text-[12px] text-ink-3">Modeled snowfall from now; never added to a reported base depth.</p>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Surface · grooming · snowmaking

function SurfaceTrio({ d, v }: { d: ResortDetail; v: PageView }) {
  const r = d.summary
  const rep = r.snow.report
  const interp = r.score?.surface ?? null
  const reportedSurface = rep && (rep.surfaceTags.length || rep.surfaceText)
  const snowmakingPct = r.features?.snowmakingPct ?? null
  const cell = 'flex min-w-0 flex-col gap-2 p-4 md:p-5'
  return (
    <div>
      <SubHead aside="Kept separate on purpose">Surface, grooming and snowmaking</SubHead>
      <div className="grid overflow-hidden rounded-[12px] border border-divider bg-surface md:grid-cols-3 md:divide-x md:divide-divider max-md:divide-y max-md:divide-divider">
        <div className={cell}>
          <p className="eyebrow">Surface</p>
          {reportedSurface ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {rep!.surfaceTags.map((t) => (
                  <span key={t} className="inline-flex h-6 items-center rounded-full border border-divider-strong px-2 text-[12.5px] font-medium text-ink">
                    {SURFACE_LABEL[t]}
                  </span>
                ))}
              </div>
              {rep!.surfaceText ? (
                <p className="text-[14px] text-ink">
                  <q>{rep!.surfaceText}</q>
                </p>
              ) : null}
              <p className="text-[12.5px] text-ink-3">Reported {dayLabel(rep!.localDate)} — the source wording is kept as written.</p>
            </>
          ) : interp && interp.basis !== 'none' ? (
            <>
              <p className="text-[14px] text-ink">{interp.text}</p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3">
                <span className="shrink-0 whitespace-nowrap">
                  <KindTag kind={interp.basis === 'personal' ? 'manual' : 'derived'} />
                </span>
                <span>{interp.basis === 'inferred' ? 'Inferred from modeled weather — “likely”, not observed' : 'From your own observation'}</span>
              </p>
            </>
          ) : (
            <p className="text-[14px] text-ink-3 italic">Unknown — no recent surface report, and no inference from the weather.</p>
          )}
        </div>
        <div className={cell}>
          <p className="eyebrow">Grooming</p>
          {rep?.groomingText || rep?.groomedRuns !== null && rep?.groomedRuns !== undefined ? (
            <>
              {rep.groomedRuns !== null ? (
                <p className="font-display text-[28px] leading-none text-ink tnum">
                  {rep.groomedRuns} <span className="font-sans text-[13px] font-normal text-ink-2">runs groomed</span>
                </p>
              ) : null}
              {rep.groomingText ? (
                <p className="text-[14px] text-ink">
                  <q>{rep.groomingText}</q>
                </p>
              ) : null}
              <p className="text-[12.5px] text-ink-3">A management action — it says nothing about snow origin.</p>
            </>
          ) : (
            <p className="text-[14px] text-ink-3 italic">Not reported{rep ? ' in the latest report' : ''}.</p>
          )}
        </div>
        <div className={cell}>
          <p className="eyebrow">Snowmaking</p>
          {rep?.snowmakingText ? (
            <p className="text-[14px] text-ink">
              <q>{rep.snowmakingText}</q>
            </p>
          ) : (
            <p className="text-[14px] text-ink-3 italic">Not reported{rep ? ' in the latest report' : ''}.</p>
          )}
          <p className="text-[12.5px] text-ink-3">
            {snowmakingPct !== null ? `Catalog: snowmaking covers about ${snowmakingPct}% of terrain (researched). ` : ''}Machine-made snow is an origin, not a surface.
          </p>
        </div>
      </div>
      {v.date !== v.today && rep && rep.localDate !== v.date ? <p className="mt-2 text-[12.5px] text-ink-3">From the report of {dayLabel(rep.localDate)}.</p> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Weather (base vs upper)

function WeatherPanel({ d, x, v }: { d: ResortDetail; x: ResortPageExtras; v: PageView }) {
  const r = d.summary
  const u = units(v.units)
  const w = r.weather
  const pts = x.catalog.weatherPoints
  const cols = (['base', 'summit'] as const).map((k) => ({
    key: k,
    agg: w[k],
    run: k === 'base' ? w.baseRun : w.summitRun,
    point: pts.find((p) => p.key === k) ?? null,
  }))
  const anyRun = cols.some((c) => c.run)
  const anyAgg = cols.some((c) => c.agg)
  const demo = cols.some((c) => c.run?.kind === 'demo')
  const limitations = [...new Set([...(d.weather.base?.limitations ?? []), ...(d.weather.summit?.limitations ?? [])])].filter(
    (l) => !/less certain trend|not fetched yet/.test(l),
  )
  const forecastHref = `/forecast?r=${v.id}&focus=${v.id}${v.date !== v.today ? `&date=${v.date}` : ''}#hourly`

  type Row = { label: string; get: (a: NonNullable<(typeof cols)[number]['agg']>) => React.ReactNode }
  const rows: Row[] = [
    { label: 'New snow', get: (a) => u.snow(a.snowfallCm) },
    { label: 'Rain', get: (a) => u.precip(a.rainMm) },
    { label: 'Temperature', get: (a) => (a.tempMinC !== null && a.tempMaxC !== null ? `${u.temp(a.tempMinC)} to ${u.temp(a.tempMaxC)}` : null) },
    { label: 'Feels like (lowest)', get: (a) => u.temp(a.apparentMinC) },
    { label: 'Wind (strongest)', get: (a) => u.speed(a.windMaxKmh) },
    { label: 'Gusts (strongest)', get: (a) => u.speed(a.gustMaxKmh) },
    { label: 'Visibility (lowest)', get: (a) => u.vis(a.visibilityMinM) },
    { label: 'Freezing level (highest)', get: (a) => u.elev(a.freezingLevelMaxM) },
    { label: 'Cloud cover (mean)', get: (a) => (a.cloudMeanPct !== null ? `${Math.round(a.cloudMeanPct)}%` : null) },
  ]

  return (
    <section aria-labelledby="weather-title" className="flex min-w-0 flex-col gap-4 rounded-[12px] border border-divider bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <SubHead id="weather-title" className="mb-0">
            Weather on {dayLabel(v.date)}
          </SubHead>
          <p className="text-[12.5px] text-ink-3">Base vs upper mountain · resort-local day ({v.zone})</p>
        </div>
        <div className="flex items-center gap-2">
          <KindTag kind={demo ? 'demo' : 'modeled'} />
          {anyRun ? (
            <Src
              title="Weather model runs"
              items={cols.filter((c) => c.run).map((c) => src(`${pointTitle(c.key)} run (${c.run!.provider}${c.run!.model ? ` · ${c.run!.model}` : ''})`, c.run!.prov, `Fetched ${instantLabel(c.run!.fetchedAt, v.tz, v.now)}`))}
            />
          ) : null}
        </div>
      </div>

      {!anyRun ? (
        <WeatherMissing h={x.refresh.weather} v={v} />
      ) : !anyAgg ? (
        <div className="rounded-[10px] border border-dashed border-divider-strong bg-surface-2 p-4 text-[13.5px] text-ink-2">
          <p className="font-semibold text-ink">No forecast for {dayLabelYear(v.date)}</p>
          <p className="mt-1">
            {v.date > v.today
              ? `The stored run${cols.filter((c) => c.run).length > 1 ? 's cover' : ' covers'} about ${Math.max(...cols.map((c) => c.run?.horizonDays ?? 0))} days from when it was fetched. Piste never invents a forecast beyond the provider’s horizon.`
              : 'This day is before the stored runs begin. What was forecast then (if anything) is in the Forecast calendar.'}
          </p>
        </div>
      ) : (
        <div className="relative -mx-1 overflow-x-auto px-1">
          <table className="w-full text-left text-[13.5px]">
            <caption className="sr-only">Modeled weather at the base and upper-mountain points on {dayLabelYear(v.date)}</caption>
            <thead>
              <tr className="border-b border-divider align-bottom">
                <th scope="col" className="w-[30%] py-2 pr-3 text-[12px] font-medium text-ink-3 sm:w-[34%]">
                  Model values
                </th>
                {cols.map((c) => (
                  <th key={c.key} scope="col" className="py-2 pr-3 font-normal">
                    <span className="block text-[14px] font-semibold text-ink">{pointTitle(c.key)}</span>
                    <span className="block text-[12px] text-ink-2 tnum">
                      {c.run?.requested.elevationM != null ? u.elev(c.run.requested.elevationM) : c.point?.elevationM != null ? u.elev(c.point.elevationM) : 'Elevation unknown'}
                      {c.run?.grid.elevationM != null && c.run.requested.elevationM != null && Math.abs(c.run.grid.elevationM - c.run.requested.elevationM) >= 50
                        ? ` · grid cell ${u.elev(c.run.grid.elevationM)}`
                        : ''}
                    </span>
                    <span className="block text-[12px] text-ink-3">
                      {c.run ? (
                        <>
                          {c.run.provider === 'demo' ? 'Demo model' : c.run.provider}
                          {c.run.model ? <span className="hidden sm:inline"> · {c.run.model}</span> : null} · fetched {ago(c.run.fetchedAt, v.now)}
                        </>
                      ) : (
                        'No run for this point'
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-divider last:border-b-0">
                  <th scope="row" className="py-1.5 pr-3 font-normal text-ink-2">
                    {row.label}
                  </th>
                  {cols.map((c) => {
                    const val = c.agg ? row.get(c.agg) : null
                    return (
                      <td key={c.key} className="py-1.5 pr-3 text-ink tnum">
                        {c.agg ? val ?? <Missing label="Not provided" /> : <span className="text-ink-3">—</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr>
                <th scope="row" className="py-2 pr-3 font-normal text-ink-3">
                  Hours covered
                </th>
                {cols.map((c) => (
                  <td key={c.key} className="py-2 pr-3 text-[12.5px] text-ink-3 tnum">
                    {c.agg ? `${c.agg.hoursCovered} of ${c.agg.expectedHours}${c.agg.complete ? '' : ' — partial day'}` : '—'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {anyRun ? <WeekOutlook d={d} v={v} /> : null}

      <div className="flex flex-col gap-1 border-t border-divider pt-3 text-[12.5px] text-ink-3">
        {anyRun ? <p>Elevation-adjusted model output, not a weather station.</p> : null}
        {/* Where the model points sit and what the runs can't do — kept, one click away. */}
        {cols.some((c) => c.point) || limitations.length ? (
          <Disclosure summary={`Model points and limitations (${cols.filter((c) => c.point).length + limitations.length})`}>
            <div className="mt-1 flex flex-col gap-1">
              {cols.map((c) =>
                c.point ? (
                  <p key={c.key}>
                    <span className="font-medium text-ink-2">{pointTitle(c.key)} point:</span> {c.point.label}
                  </p>
                ) : null,
              )}
              {limitations.map((l) => (
                <p key={l}>{l}</p>
              ))}
            </div>
          </Disclosure>
        ) : null}
        <Link href={forecastHref} className="mt-1 inline-flex items-center gap-1 self-start text-[13px] font-medium text-teal hover:underline">
          Hourly timeline and 16-day outlook <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>
    </section>
  )
}

/** Next 7 resort-local days of modeled new snow at base and upper mountain (the planning date highlighted). */
function WeekOutlook({ d, v }: { d: ResortDetail; v: PageView }) {
  const q = chartUnits(v.units).snow
  const base = (d.weather.base?.shownPoint === 'base' ? d.weather.base.daily : []).filter((x) => x.dayIndex < 7)
  const upper = (d.weather.summit?.shownPoint === 'summit' ? d.weather.summit.daily : []).filter((x) => x.dayIndex < 7)
  const dates = [...new Set([...base, ...upper].map((x) => x.date))].sort()
  if (!dates.length) return null
  const byDate = (list: typeof base) => new Map(list.map((x) => [x.date, x]))
  const b = byDate(base)
  const u = byDate(upper)
  const datum = (m: Map<string, (typeof base)[number]>, date: string): DailyBarDatum => {
    const x = m.get(date)
    return {
      key: date,
      label: formatLocalDate(date, 'ccc'),
      sublabel: formatLocalDate(date, 'd'),
      value: x ? q.toDisplay(x.snowfallCm) : null,
      display: x ? q.format(x.snowfallCm) : null,
      trend: x?.trend ?? false,
      partial: x?.partial ?? false,
    }
  }
  const baseDays = dates.map((dt) => datum(b, dt))
  const upperDays = dates.map((dt) => datum(u, dt))
  const max = Math.max(q.floorMax, ...[...baseDays, ...upperDays].map((x) => x.value ?? 0))
  const demo = d.weather.base?.kind === 'demo' || d.weather.summit?.kind === 'demo'
  return (
    <ChartFrame
      title="Next 7 days · modeled new snow"
      titleAs="h4"
      kind={demo ? 'demo' : 'modeled'}
      subtitle={`Per resort-local day from today${dates.includes(v.date) ? `; ${dayLabel(v.date)} highlighted` : ''}. A model, not a report.`}
      table={{
        caption: 'Modeled new snow by day at the base and upper-mountain points',
        rowHeader: 'Day',
        columns: [
          { key: 'base', label: 'Base', unit: q.unit },
          { key: 'upper', label: 'Upper mountain', unit: q.unit },
        ],
        rows: dates.map((dt) => ({
          key: dt,
          header: dayLabel(dt),
          tone: dt === v.date ? 'selected' : 'default',
          cells: { base: b.get(dt) ? q.short(b.get(dt)!.snowfallCm) : null, upper: u.get(dt) ? q.short(u.get(dt)!.snowfallCm) : null },
        })),
      }}
      className="border-t border-divider pt-4"
    >
      <div className="grid grid-cols-[64px_minmax(0,1fr)] items-end gap-x-2 gap-y-1 sm:grid-cols-[88px_minmax(0,1fr)]">
        <span className="pb-9 text-[12.5px] text-ink-2">Base</span>
        <DailyBars days={baseDays} label="Modeled new snow by day, base" max={max} height={40} selected={v.date} hideDayLabels showValues="all" />
        <span className="pb-12 text-[12.5px] text-ink-2">Upper mountain</span>
        <DailyBars days={upperDays} label="Modeled new snow by day, upper mountain" max={max} height={40} selected={v.date} showValues="all" tone="teal" />
      </div>
    </ChartFrame>
  )
}

function WeatherMissing({ h, v }: { h: RefreshHealthView; v: PageView }) {
  if (v.demo) {
    return (
      <p className="rounded-[10px] border border-dashed border-divider-strong bg-surface-2 p-4 text-[13.5px] text-ink-2">
        The demo has no simulated weather for this resort.
      </p>
    )
  }
  const failed = h.lastAttemptOutcome === 'failed' || h.lastAttemptOutcome === 'partial' || h.lastAttemptOutcome === 'nothing-fetched'
  return (
    <div className={cn('flex flex-col gap-2 rounded-[10px] border p-4', failed ? 'border-critical/40 bg-critical-bg' : 'border-dashed border-divider-strong bg-surface-2')}>
      <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        <CloudOff aria-hidden className={cn('size-4', failed ? 'text-critical' : 'text-ink-3')} />
        {failed ? 'Weather fetch failed' : 'Weather not fetched yet'}
      </p>
      <p className="text-[13.5px] text-ink-2">
        {failed
          ? `The last attempt (${h.lastAttemptAt ? instantLabel(h.lastAttemptAt, v.tz, v.now) : 'time unknown'}, ${h.lastAttemptScope === 'all' ? 'the all-resort refresh' : 'a refresh for this resort'}) failed. ${h.lastSuccessAt ? `The last good forecast is from ${instantLabel(h.lastSuccessAt, v.tz, v.now)}.` : 'No forecast has ever been stored, so nothing is shown rather than a guess.'}`
          : 'Forecasts appear after the weather refresh job runs. Until then nothing is shown rather than a guess.'}
      </p>
      <ErrorList errors={h.lastAttemptErrors} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Data feeds (refresh health)

function feedState(h: RefreshHealthView | null, demo: boolean, staleHours: number, now: string): { label: string; tone: 'positive' | 'caution' | 'critical' | 'neutral' | 'demo' } {
  if (demo) return { label: 'Simulated — never refreshed', tone: 'demo' }
  if (!h || (!h.lastAttemptAt && !h.lastSuccessAt)) return { label: 'Not fetched yet', tone: 'neutral' }
  if (h.lastAttemptOutcome === 'running') return { label: 'Refreshing now', tone: 'neutral' }
  if (h.lastAttemptOutcome === 'failed') return { label: h.lastSuccessAt ? 'Last fetch failed' : 'Failing — never succeeded', tone: 'critical' }
  if (h.lastAttemptOutcome === 'nothing-fetched') return { label: 'Nothing fetched', tone: 'caution' }
  if (h.lastAttemptOutcome === 'partial') return { label: 'Partly updated', tone: 'caution' }
  if (h.lastSuccessAt && (Date.parse(now) - Date.parse(h.lastSuccessAt)) / 3_600_000 > staleHours) return { label: 'Stale', tone: 'caution' }
  return { label: 'Up to date', tone: 'positive' }
}

const TONE: Record<string, string> = {
  positive: 'bg-positive-bg text-positive',
  caution: 'bg-caution-bg text-caution',
  critical: 'bg-critical-bg text-critical',
  neutral: 'bg-surface-3 text-ink-2',
  demo: 'bg-demo-bg text-demo',
}

function FeedRow({
  title,
  h,
  v,
  staleHours,
  note,
  showErrors = true,
}: {
  title: string
  h: RefreshHealthView | null
  v: PageView
  staleHours: number
  note?: React.ReactNode
  /** Off when the same errors are already shown beside the data they affect. */
  showErrors?: boolean
}) {
  const st = feedState(h, v.demo, staleHours, v.now)
  return (
    <div className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] font-medium text-ink">{title}</p>
        <span className={cn('inline-flex h-6 items-center rounded-full px-2 text-[12px] font-medium', TONE[st.tone])}>{st.label}</span>
      </div>
      {note ? <p className="text-[12.5px] text-ink-2">{note}</p> : null}
      {!v.demo && h ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px] tnum">
          <dt className="text-ink-3">Last success</dt>
          <dd className="text-ink-2">{h.lastSuccessAt ? `${instantLabel(h.lastSuccessAt, v.tz, v.now)} (${ago(h.lastSuccessAt, v.now)})` : 'Never'}</dd>
          <dt className="text-ink-3">Last attempt</dt>
          <dd className="text-ink-2">
            {h.lastAttemptAt
              ? `${instantLabel(h.lastAttemptAt, v.tz, v.now)} · ${h.lastAttemptScope === 'all' ? 'all-resort run' : 'this resort'}${h.lastAttemptTrigger === 'manual' ? ', manual' : ''}`
              : 'None yet'}
          </dd>
        </dl>
      ) : null}
      {showErrors && !v.demo && h?.lastAttemptErrors.length ? <ErrorList errors={h.lastAttemptErrors} className="rounded-md bg-surface-2 px-2.5 py-1.5" /> : null}
    </div>
  )
}

function FeedHealth({ x, v, reportUrl, weatherShown }: { x: ResortPageExtras; v: PageView; reportUrl: string | null; weatherShown: boolean }) {
  const adapter = x.refresh.reportAdapter
  return (
    <section aria-labelledby="feeds-title" className="rounded-[12px] border border-divider bg-surface p-5">
      <SubHead id="feeds-title" aside={<Link href="/sources" className="text-teal hover:underline">Sources &amp; Sync</Link>}>
        Data feeds
      </SubHead>
      <div className="flex flex-col divide-y divide-divider">
        <FeedRow title="Weather (Open-Meteo / NWS)" h={x.refresh.weather} v={v} staleHours={12} showErrors={weatherShown} />
        <FeedRow
          title={adapter ? `Official report — ${adapter.label}` : 'Official report'}
          h={x.refresh.reports}
          v={v}
          staleHours={24}
          note={
            adapter ? (
              <>
                Reader {adapter.state === 'unverified' ? 'unverified — the page layout may break it' : adapter.state}.{' '}
                {reportUrl ? (
                  <a href={reportUrl} target="_blank" rel="noopener noreferrer" className="text-teal hover:underline">
                    Open the page
                  </a>
                ) : null}
              </>
            ) : (
              'No automatic reader for this resort — manual entries only.'
            )
          }
        />
      </div>
      {v.demo ? (
        <p className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-2">
          <FlaskConical aria-hidden className="size-3.5 text-demo" /> Demo data is simulated for Fri 15 Jan 2027 and never fetched from live sources.
        </p>
      ) : (
        <RefreshNow resortId={v.id} jobs={adapter ? ['weather', 'reports'] : ['weather']} className="mt-3" />
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Manual entry

function ManualEntry({ d, x, v, reportUrl }: { d: ResortDetail; x: ResortPageExtras; v: PageView; reportUrl: string | null }) {
  const trigger = 'flex min-h-12 w-full items-center gap-3 rounded-[10px] border border-divider-strong bg-surface px-3.5 py-2.5 text-left transition-colors duration-150 hover:border-teal'
  return (
    <section id="manual-entry" aria-labelledby="manual-title" className="scroll-mt-[124px] rounded-[12px] border border-divider bg-surface-2 p-5 md:scroll-mt-[84px]">
      <SubHead id="manual-title">Add information</SubHead>
      <div className="flex flex-col gap-2">
        <ReportEntrySheet
          resortId={v.id}
          resortName={v.shortName}
          today={v.today}
          tz={v.tz}
          defaultUnit={v.units.snow}
          officialUrl={reportUrl}
          sourceNote={x.catalog.reportSource?.notes ?? null}
          demo={v.demo}
          triggerClassName={trigger}
          triggerContent={
            <>
              <ClipboardPen aria-hidden className="size-5 shrink-0 text-teal" />
              <span className="min-w-0">
                <span className="block text-[14.5px] font-medium text-ink">Enter an official report</span>
                <span className="block text-[12.5px] text-ink-3">Figures from the resort’s page — source link required</span>
              </span>
            </>
          }
        />
        <ObservationSheet
          resortId={v.id}
          resortName={v.shortName}
          today={v.today}
          demo={v.demo}
          triggerClassName={trigger}
          triggerContent={
            <>
              <NotebookPen aria-hidden className="size-5 shrink-0 text-copper" />
              <span className="min-w-0">
                <span className="block text-[14.5px] font-medium text-ink">Log my own observation</span>
                <span className="block text-[12.5px] text-ink-3">Surface I found — kept apart from official reports</span>
              </span>
            </>
          }
        />
      </div>
      <p className="mt-3 text-[12.5px] text-ink-3">
        The manual-edit route for official data Piste can’t read automatically. {d.reports.some((g) => g.revisions.some((r) => r.origin !== 'official-adapter' && r.origin !== 'demo')) ? 'Your earlier entries are listed under Report history.' : ''}
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Daily history strip

function snow24(rep: ReportView | null): number | null {
  if (!rep) return null
  const w = rep.snowfall.find((s) => s.window === '24h' && s.amountCm !== null) ?? rep.snowfall.find((s) => s.window === 'overnight' && s.amountCm !== null)
  return w?.amountCm ?? null
}

function HistoryStrip({ x, v }: { x: ResortPageExtras; v: PageView }) {
  const u = units(v.units)
  const days = x.historyWindow
  const href = (date: string) => `/forecast?r=${v.id}&focus=${v.id}&date=${date}#history`
  return (
    <section aria-labelledby="history-title">
      <SubHead
        id="history-title"
        aside={
          <Link href={`/forecast?r=${v.id}&focus=${v.id}#history`} className="inline-flex items-center gap-1 text-[13px] font-medium text-teal hover:underline">
            Forecast calendar <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        }
      >
        Last 14 days
      </SubHead>
      {days.length ? (
        <>
          <ol className="grid grid-cols-7 gap-1.5 lg:grid-cols-14">
            {days.map((day) => {
              const sn = snow24(day.report)
              const a = day.assessmentThen
              const selected = day.date === v.date
              const before = day.state === 'before-tracking'
              const label = [
                dayLabelYear(day.date),
                before ? 'before tracking began' : null,
                day.gap ? 'tracked, no data stored' : null,
                sn !== null ? `reported ${u.snow(sn)} new snow` : day.report ? 'report without new-snow figure' : null,
                a ? (a.score !== null ? `estimated then ${a.score}${a.scoreKind === 'conditions' ? '' : ' (weather potential or limited)'}` : a.scoreKind === 'closed' ? 'closed' : 'limited data then') : null,
              ]
                .filter(Boolean)
                .join(', ')
              return (
                <li key={day.date}>
                  <Link
                    href={href(day.date)}
                    aria-label={`${label}. Open in the Forecast calendar`}
                    aria-current={selected ? 'date' : undefined}
                    className={cn(
                      'flex h-[76px] flex-col justify-between rounded-[10px] border px-1.5 py-1.5 text-center transition-colors duration-150 hover:border-teal',
                      before && 'border-dashed border-divider bg-[repeating-linear-gradient(135deg,var(--surface-2)_0_6px,var(--surface-3)_6px_7px)]',
                      !before && day.gap && 'border-dashed border-divider-strong bg-surface',
                      !before && !day.gap && 'border-divider bg-surface',
                      selected && 'border-teal ring-1 ring-teal',
                    )}
                  >
                    <span className={cn('text-[11.5px] leading-none font-medium', day.state === 'today' ? 'text-teal' : 'text-ink-3')}>
                      {dayLabel(day.date).split(' ')[0]}
                      <span className="ml-0.5 text-ink-2 tnum">{day.date.slice(8).replace(/^0/, '')}</span>
                    </span>
                    <span className="flex items-center justify-center gap-0.5 text-[12.5px] leading-none font-semibold text-ink tnum">
                      {sn !== null && sn > 0 ? (
                        <>
                          <Snowflake aria-hidden className="size-3 text-info" />
                          {u.snow(sn)}
                        </>
                      ) : sn === 0 ? (
                        <span className="font-normal text-ink-3">0</span>
                      ) : (
                        <span className="font-normal text-ink-3">·</span>
                      )}
                    </span>
                    <span
                      className={cn(
                        'text-[12px] leading-none tnum',
                        a?.score == null ? 'text-ink-3' : a.scoreKind === 'conditions' ? 'font-semibold text-ink' : 'text-ink-2',
                      )}
                    >
                      {a ? (a.scoreKind === 'closed' ? 'Closed' : a.score !== null ? `${a.score}${a.scoreKind === 'conditions' ? '' : '*'}` : 'Ltd') : '—'}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ol>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
            <span>Middle: reported new snow (24 h)</span>
            <span>Bottom: what Piste estimated before the day — never recomputed (* weather potential or limited)</span>
            {x.trackingStart ? <span>Tracking started {shortDate(x.trackingStart)}</span> : <span>Tracking has not started — no history is invented</span>}
          </p>
        </>
      ) : (
        <p className="rounded-[10px] border border-dashed border-divider-strong bg-surface-2 p-4 text-[13.5px] text-ink-2">No days to show.</p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Report history and my observations

/** Report days shown before "N earlier report days". */
const REPORT_DAYS_SHOWN = 3

function ReportHistory({ d, v }: { d: ResortDetail; v: PageView }) {
  const u = units(v.units)
  const item = (g: ResortDetail['reports'][number]) => {
    // Same order as "the latest report" everywhere else: highest revision, then newest row.
    const revisions = [...g.revisions].sort((a, b) => b.revision - a.revision || b.id - a.id)
    const latest = revisions[0]
    const sn = snow24(latest)
    return (
      <li key={g.date} className="px-4 py-3">
        <details className="group">
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 [&::-webkit-details-marker]:hidden">
            <span className="w-[92px] text-[14px] font-medium text-ink tnum">{dayLabel(g.date)}</span>
            {latest.status ? <StatusPill status={latest.status} size="sm" /> : null}
            <span className="text-[13px] text-ink-2 tnum">
              {dotJoin(
                sn !== null ? `${u.snow(sn)} new` : null,
                latest.baseDepthCm !== null ? `${u.snow(latest.baseDepthCm)} base` : null,
                latest.openTrails !== null ? `${latest.openTrails}${latest.totalTrails ? `/${latest.totalTrails}` : ''} trails` : null,
              ) || 'No figures'}
            </span>
            <span className="ml-auto flex items-center gap-2 text-[12px] text-ink-3">
              {revisions.length > 1 ? (new Set(revisions.map((x) => x.kind)).size > 1 ? `${revisions.length} reports` : `${revisions.length} revisions`) : null}
              <KindTag kind={latest.kind} compact />
              <ChevronDown aria-hidden className="size-4 transition-transform duration-150 group-open:rotate-180" />
            </span>
          </summary>
          <ol className="mt-2 flex flex-col gap-2 border-l border-divider-strong pl-3">
            {revisions.map((rv) => (
              <li key={rv.id} className="text-[12.5px] text-ink-2">
                <span className="font-medium text-ink">{REPORT_ORIGIN_LABEL[rv.origin]}</span>
                {rv.revision > 1 ? ` · revision ${rv.revision}` : ''} ·{' '}
                {rv.reportedAt ? `published ${instantLabel(rv.reportedAt, v.tz, v.now)}` : 'publish time not stated'}
                {rv.surfaceText ? <> · <q>{rv.surfaceText}</q></> : null}
                {rv.notes ? <span className="block text-ink-3">{rv.notes}</span> : null}
                <Src title={`Report revision ${rv.revision}`} items={[src(`Report ${dayLabelYear(rv.localDate)}, revision ${rv.revision}`, rv.prov)]} className="ml-1" />
              </li>
            ))}
          </ol>
        </details>
      </li>
    )
  }
  const fold = d.reports.length > REPORT_DAYS_SHOWN + 1
  const shown = fold ? d.reports.slice(0, REPORT_DAYS_SHOWN) : d.reports
  const older = fold ? d.reports.slice(REPORT_DAYS_SHOWN) : []
  return (
    <section aria-labelledby="reports-title" className="min-w-0">
      <SubHead id="reports-title" aside="Every revision kept">
        Report history
      </SubHead>
      {d.reports.length ? (
        <>
          <ul className="flex flex-col divide-y divide-divider rounded-[12px] border border-divider bg-surface">{shown.map(item)}</ul>
          {older.length ? (
            <Disclosure summary={`${older.length} earlier report days`} className="mt-2">
              <ul className="mt-2 flex flex-col divide-y divide-divider rounded-[12px] border border-divider bg-surface">{older.map(item)}</ul>
            </Disclosure>
          ) : null}
        </>
      ) : (
        <p className="rounded-[12px] border border-dashed border-divider-strong bg-surface-2 p-4 text-[13.5px] text-ink-2">No reports stored yet. History begins with the first report read or entered.</p>
      )}
    </section>
  )
}

function MyObservations({ x }: { x: ResortPageExtras }) {
  const list = x.personalReports
  return (
    <section aria-labelledby="mine-obs-title" className="min-w-0">
      <SubHead id="mine-obs-title" aside="Personal feedback, stored separately">
        My observations
      </SubHead>
      {list.length ? (
        <ul className="flex flex-col divide-y divide-divider rounded-[12px] border border-divider bg-surface">
          {list.map((o) => (
            <li key={o.id} className="flex flex-col gap-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium text-ink tnum">{dayLabelYear(o.localDate)}</span>
                <KindTag kind="manual" />
                {o.surfaceTags.map((t) => (
                  <span key={t} className="inline-flex h-6 items-center rounded-full border border-copper/40 px-2 text-[12px] text-ink">
                    {SURFACE_LABEL[t]}
                  </span>
                ))}
              </div>
              {o.surfaceText ? <p className="text-[13.5px] text-ink">{o.surfaceText}</p> : null}
              {o.notes ? <p className="text-[12.5px] text-ink-2">{o.notes}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-[12px] border border-dashed border-divider-strong bg-surface-2 p-4 text-[13.5px] text-ink-2">
          None yet. After a visit, log what you found — it can support the surface description, but never the operating status.
        </p>
      )}
    </section>
  )
}

