/**
 * 01 Overview — what the place is (location, elevation, terrain, character, facilities), the three different
 * ratings (Fit for me · Conditions on the date · My rating), the season's opening/closing facts with sources, and
 * the operating status with its history. External review ratings are omitted: no permitted source supplies one.
 */
import Link from 'next/link'
import { ArrowDown, Ban, CalendarClock, Info, UserRound } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { ConfidenceTag, ScoreChip } from '@/components/ui/score'
import { KindTag, Missing } from '@/components/ui/provenance'
import { OpeningTag, StatusPill } from '@/components/ui/status'
import type { ResortDetail } from '@/lib/data/resort-detail'
import type { ResortPageExtras } from '@/lib/data/resort-page'
import { addDays, daysBetween, skiWindow, type Hemisphere } from '@/lib/domain/time'
import { SCORING_MODE_LABEL } from '@/lib/domain/types'
import { RatingEditor } from './rating-editor'
import { Reveal } from './reveal'
import { Disclosure } from '@/components/ui/disclosure'
import { ConfirmTag, FactRow, ResortSection, Src, SubHead, TriChip } from './section'
import { ago, confirmText, dayLabel, dayLabelYear, dotJoin, instantLabel, needsCheck, plural, seasonText, shortDate, src, units, type PageView } from './format'

const ABILITY_TEXT: Record<string, string> = { beginner: 'beginner', novice: 'novice', intermediate: 'intermediate', advanced: 'advanced', expert: 'expert' }

/** 'Alta, UT · Utah' — locality without its parenthetical, then region/state unless already named. */
function placeLine(locality: string | null, region: string, state: string | null): string {
  const parts: string[] = []
  for (const p of [locality ? locality.split('(')[0].trim() : null, region, state]) {
    if (!p) continue
    if (parts.some((x) => x.toLowerCase().includes(p.toLowerCase()))) continue
    parts.push(p)
  }
  return parts.join(' · ')
}

function coords(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`
}

export function OverviewSection({ d, x, v, ability }: { d: ResortDetail; x: ResortPageExtras; v: PageView; ability: string }) {
  const research = d.research
  const meta = research?.date
    ? `Catalog ${research.method === 'reference-only' ? 'reference data' : 'researched'} ${shortDate(research.date)} — confirm at source`
    : null
  return (
    <ResortSection id="overview" index={1} title="Overview" meta={meta} lead={x.catalog.character ?? undefined} rule={false}>
      <Reveal delay={0.06} className="flex flex-col gap-8">
        <RatingsTrio d={d} v={v} ability={ability} weatherFailed={x.refresh.weather.lastAttemptOutcome === 'failed'} />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10">
          <AtAGlance d={d} x={x} v={v} />
          <div className="flex min-w-0 flex-col gap-8">
            <SeasonBlock d={d} v={v} />
            <StatusBlock d={d} x={x} v={v} />
          </div>
        </div>
      </Reveal>
    </ResortSection>
  )
}

// ---------------------------------------------------------------------------
// Three ratings, three questions

function RatingsTrio({ d, v, ability, weatherFailed }: { d: ResortDetail; v: PageView; ability: string; weatherFailed: boolean }) {
  const r = d.summary
  const fit = r.fit
  const score = r.score
  const days = d.mySkiDays
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-[16px] font-semibold text-ink">Three ratings, three different questions</h3>
        <p className="text-[12.5px] text-ink-3">External review ratings are omitted — no permitted source supplies one.</p>
      </div>
      <div className="grid gap-px overflow-hidden rounded-[12px] border border-divider bg-divider md:grid-cols-2 lg:grid-cols-3">
        {/* Fit for me */}
        <section aria-labelledby="fit-title" className="flex min-w-0 flex-col gap-3 bg-surface p-4 md:p-5">
          <header>
            <p className="eyebrow flex items-center gap-1.5">
              <UserRound aria-hidden className="size-3.5" /> Fit for me
            </p>
            <h4 id="fit-title" className="sr-only">
              Fit for me
            </h4>
            <p className="mt-1 text-[12.5px] text-ink-3">Does it suit a {ABILITY_TEXT[ability] ?? ability}, my travel limits and budget? Not date-specific.</p>
          </header>
          <div className="flex items-end gap-3">
            {fit.score !== null ? (
              <span className="font-display text-[44px] leading-none text-ink tnum">{fit.score}</span>
            ) : (
              <span className="font-display text-[34px] leading-none text-ink-3">—</span>
            )}
            <div className="pb-1 text-[13px] leading-tight">
              <p className="font-semibold text-ink">{fit.label}</p>
              <ConfidenceTag confidence={fit.confidence} className="mt-1" />
            </div>
          </div>
          <ul className="flex flex-col gap-2">
            {fit.components.map((c) => (
              <li key={c.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                <span className="truncate text-[13px] text-ink-2">{c.label}</span>
                <span className={cn('text-[13px] tnum', c.known ? 'font-semibold text-ink' : 'text-ink-3 italic')}>{c.known ? c.value : 'Unknown'}</span>
                <span aria-hidden className="col-span-2 h-1 overflow-hidden rounded-full bg-surface-3">
                  {c.known && c.value !== null ? <span className="block h-full rounded-full bg-teal/70" style={{ width: `${Math.max(3, c.value)}%` }} /> : null}
                </span>
              </li>
            ))}
          </ul>
          {fit.reasons.length || fit.unknowns.length ? (
            <Disclosure summary={`Why this fit${fit.unknowns.length ? ` · ${fit.unknowns.length} unknown` : ''}`}>
              <ul className="mt-1.5 flex flex-col gap-1 text-[13px] text-ink-2">
                {fit.reasons.slice(0, 3).map((x) => (
                  <li key={x} className="flex gap-2">
                    <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-3" />
                    {x}
                  </li>
                ))}
                {fit.unknowns.map((x) => (
                  <li key={x} className="flex gap-2 text-ink-3 italic">
                    <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-divider-strong" />
                    {x}
                  </li>
                ))}
              </ul>
            </Disclosure>
          ) : null}
          {fit.cappedBy ? <p className="text-[12.5px] font-medium text-caution">{fit.cappedBy}</p> : null}
          <p className="mt-auto text-[12.5px] text-ink-3">
            Based on your{' '}
            <Link href="/settings" className="text-teal hover:underline">
              ability and travel settings
            </Link>
            . {fit.confidenceReasons[0] ?? ''}
          </p>
        </section>

        {/* Conditions on the date */}
        <section aria-labelledby="cond-title" className="flex min-w-0 flex-col gap-3 bg-surface p-4 md:p-5">
          <header>
            <p className="eyebrow flex items-center gap-1.5">
              <CalendarClock aria-hidden className="size-3.5" /> Conditions · {dayLabel(v.date)}
            </p>
            <h4 id="cond-title" className="sr-only">
              Conditions on {dayLabelYear(v.date)}
            </h4>
            <p className="mt-1 text-[12.5px] text-ink-3">How suitable is that day for a {SCORING_MODE_LABEL[v.mode].toLowerCase()}? Suitability, not safety.</p>
          </header>
          <div className="flex min-h-[44px] items-end">
            {r.closure ? (
              <p className="flex items-center gap-2 font-display text-[34px] leading-none text-critical">
                <Ban aria-hidden className="size-7" strokeWidth={1.8} /> Closed
              </p>
            ) : score?.scoreKind === 'limited' ? (
              <p className="font-display text-[30px] leading-none text-caution">Limited data</p>
            ) : score && score.score !== null ? (
              <ScoreChip scoreKind={score.scoreKind} score={score.score} coverage={score.coverage} size="lg" />
            ) : (
              <p className="font-display text-[30px] leading-none text-ink-3">No score yet</p>
            )}
          </div>
          {r.closure ? (
            <p className="text-[13.5px] text-ink">{r.closure.reason}. No ski-day score is shown for a closed resort.</p>
          ) : score ? (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <ConfidenceTag confidence={score.confidence} />
                <span className="text-[12.5px] text-ink-3 tnum">{Math.round(score.coverage * 100)}% of weighted inputs</span>
              </div>
              <p className="text-[13.5px] text-ink-2">{score.surface.text}</p>
            </>
          ) : (
            <p className="text-[13.5px] text-ink-2">
              No score for this date yet
              {r.freshness.weatherFetchedAt ? '' : weatherFailed ? ' — the weather fetch failed' : ' — weather has not been fetched'}. Scores need weather plus operations
              evidence.
            </p>
          )}
          {r.status.status === 'unknown' && !r.closure ? (
            <p className="text-[12.5px] font-medium text-caution">Operating status unknown — never treated as open.</p>
          ) : null}
          <a href="#score-breakdown" className="mt-auto inline-flex items-center gap-1 text-[13px] font-medium text-teal hover:underline">
            Breakdown and evidence <ArrowDown aria-hidden className="size-3.5" />
          </a>
        </section>

        {/* My rating */}
        <section aria-labelledby="mine-title" className="flex min-w-0 flex-col gap-3 bg-surface p-4 md:col-span-2 md:p-5 lg:col-span-1">
          <header>
            <p className="eyebrow">My rating</p>
            <h4 id="mine-title" className="sr-only">
              My rating
            </h4>
            <p className="mt-1 text-[12.5px] text-ink-3">My own review after a visit — private, editable.</p>
          </header>
          <RatingEditor
            resortId={r.id}
            name={r.shortName}
            initial={d.myRating ? { rating: d.myRating.rating, review: d.myRating.review, updatedAt: d.myRating.updatedAt } : null}
            updatedLabel={d.myRating ? ago(d.myRating.updatedAt, v.now) : null}
          />
          <p className="mt-auto text-[12.5px] text-ink-3 tnum">
            {days.length ? (
              <>
                {plural(days.length, 'ski day')} logged here · last {dayLabelYear(days[0].date)}
              </>
            ) : (
              <>No ski days logged here yet.</>
            )}{' '}
            <Link href="/season" className="text-teal hover:underline">
              My Season
            </Link>
          </p>
        </section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// At a glance

function AtAGlance({ d, x, v }: { d: ResortDetail; x: ResortPageExtras; v: PageView }) {
  const r = d.summary
  const u = units(v.units)
  const t = x.catalog.terrain
  const f = r.features
  const base = u.elev(r.baseElevationM)
  const top = u.elev(r.summitElevationM)
  const vertical = u.elev(r.verticalM ?? (r.baseElevationM !== null && r.summitElevationM !== null ? r.summitElevationM - r.baseElevationM : null))
  const terrainBits = t
    ? [
        t.trails !== null ? plural(t.trails, 'trail') : null,
        t.lifts !== null ? plural(t.lifts, 'lift') : null,
        t.skiableAcres !== null ? `${t.skiableAcres.toLocaleString('en-US')} acres` : null,
        t.pisteKm != null ? `${u.dist(t.pisteKm)} of pistes` : null,
        t.terrainParks !== null ? plural(t.terrainParks, 'terrain park') : null,
      ].filter(Boolean)
    : []
  // Lifts by type and uphill capacity, where research found them (shown only when known).
  const byType = t?.liftsByType ?? null
  const liftTypeBits = byType
    ? [
        byType.gondolas ? plural(byType.gondolas, 'gondola') : null,
        byType.cableCars ? plural(byType.cableCars, 'cable car') : null,
        byType.chairlifts ? plural(byType.chairlifts, 'chairlift') : null,
        byType.surfaceLifts ? plural(byType.surfaceLifts, 'surface lift') : null,
        byType.other ? plural(byType.other, 'other lift') : null,
      ].filter((b): b is string => !!b)
    : []
  const capacity = t?.liftCapacityPerHour ?? null
  const terrainCheck = needsCheck(t?.prov) ? confirmText(t?.prov) : undefined
  const split = r.beginner
  const expertPct = t?.expertPct ?? null
  const hasSplit = split.beginnerPct !== null || split.intermediatePct !== null || split.advancedPct !== null || expertPct !== null
  const learning = split.learning
  return (
    <div className="min-w-0">
      <SubHead aside={<Src title="Catalog facts" items={[src('Location', r.locationProv), src('Elevation', r.elevationProv), src('Terrain', t?.prov), src('Facilities', f?.prov)]} />}>
        At a glance
      </SubHead>
      <dl className="rounded-[12px] border border-divider bg-surface px-4 py-1">
        <FactRow label="Location" source={<Src title="Location" items={[src('Location', r.locationProv, coords(r.lat, r.lon))]} />}>
          <span className="block">{placeLine(r.locality, r.region, r.stateProvince)}</span>
          <span className="block font-mono text-[12px] text-ink-3">{coords(r.lat, r.lon)}</span>
        </FactRow>
        <FactRow label="Elevation" source={<Src title="Elevation" items={[src('Elevation', r.elevationProv, dotJoin(base && `Base ${base}`, top && `summit ${top}`))]} />}>
          {base || top ? (
            <span className="tnum">
              {base ?? <Missing />} <span className="text-ink-3">→</span> {top ?? <Missing />}
              {vertical ? <span className="block text-[12.5px] text-ink-3">{vertical} vertical</span> : null}
            </span>
          ) : (
            <Missing />
          )}
        </FactRow>
        <FactRow
          label="Terrain"
          source={t?.prov ? <Src title="Terrain" items={[src('Terrain', t.prov, terrainBits.join(' · '))]} /> : null}
          hint={t?.season ? `Figures from the ${seasonText(t.season)} season${needsCheck(t.prov) ? ' — researched, confirm at source' : ''}` : undefined}
        >
          {terrainBits.length ? <span className="tnum">{terrainBits.join(' · ')}</span> : <Missing label="Trail and lift counts unknown" />}
        </FactRow>
        {liftTypeBits.length ? (
          <FactRow label="Lifts by type" source={<Src title="Lifts by type" items={[src('Terrain', t?.prov, liftTypeBits.join(' · '))]} />} hint={terrainCheck}>
            <span className="tnum">{liftTypeBits.join(' · ')}</span>
          </FactRow>
        ) : null}
        {capacity !== null ? (
          <FactRow label="Uphill capacity" source={<Src title="Uphill capacity" items={[src('Terrain', t?.prov, `${capacity.toLocaleString('en-US')} people per hour`)]} />} hint={terrainCheck}>
            <span className="tnum">{capacity.toLocaleString('en-US')} people per hour</span>
          </FactRow>
        ) : null}
        <div className="border-b border-divider py-2.5">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="shrink-0 text-[13.5px] text-ink-2">Ability split</dt>
            <dd className="text-right text-[13px] text-ink-2 tnum">
              {hasSplit ? (
                dotJoin(
                  split.beginnerPct !== null && `${split.beginnerPct}% beginner`,
                  split.intermediatePct !== null && `${split.intermediatePct}% intermediate`,
                  split.advancedPct !== null && `${split.advancedPct}% advanced`,
                  expertPct !== null && `${expertPct}% expert`,
                )
              ) : (
                <Missing label="Unknown" />
              )}
            </dd>
          </div>
          {hasSplit ? (
            <dd aria-hidden className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-3">
              <span className="h-full bg-positive/80" style={{ width: `${split.beginnerPct ?? 0}%` }} />
              <span className="h-full bg-info/70" style={{ width: `${split.intermediatePct ?? 0}%` }} />
              <span className="h-full bg-ink/70" style={{ width: `${split.advancedPct ?? 0}%` }} />
              <span className="h-full bg-ink" style={{ width: `${expertPct ?? 0}%` }} />
            </dd>
          ) : null}
        </div>
        <FactRow label="Snowmaking" source={f?.prov ? <Src title="Snowmaking" items={[src('Facilities', f.prov)]} /> : null}>
          {f?.snowmakingPct != null ? <span className="tnum">{f.snowmakingPct}% of terrain</span> : <Missing />}
        </FactRow>
        <FactRow label="Operator">{r.operator ? <span className="line-clamp-2">{r.operator}</span> : <Missing />}</FactRow>
        <FactRow label="Time zone">
          <span className="tnum">
            {v.tz.replace(/_/g, ' ')} <span className="text-ink-3">({v.zone})</span>
          </span>
        </FactRow>
      </dl>
      <div className="mt-4">
        <p className="mb-2 text-[13px] font-medium text-ink-2">Facilities</p>
        <div className="flex flex-wrap gap-2">
          <TriChip label="Night skiing" value={f?.nightSkiing} />
          <TriChip label="Lessons" value={f?.lessons} />
          <TriChip label="Rentals" value={f?.rentals} />
          <TriChip label="Lodging on the mountain" value={f?.onMountainLodging} />
          <TriChip label="Tubing" value={f?.tubing} />
          <TriChip label="Childcare" value={f?.childcare} />
        </div>
        {needsCheck(f?.prov) ? <p className="mt-2 text-[12.5px] text-ink-3">Facility facts are catalog research — confirm at source. Unknown never means “not offered”.</p> : null}
      </div>
      {learning || split.beginnerArea ? (
        <div className="mt-5 rounded-[12px] border border-divider bg-surface-2 p-4">
          <p className="eyebrow mb-1.5">Learning here</p>
          {split.beginnerArea ? <p className="text-[14px] font-medium text-ink">{split.beginnerArea}</p> : null}
          {learning ? <p className="mt-1.5 max-w-[68ch] text-[14px] text-ink-2">{learning}</p> : null}
          <div className="mt-2 flex items-center gap-2">
            {needsCheck(split.featuresProv ?? split.terrainProv) ? <ConfirmTag text={confirmText(split.featuresProv ?? split.terrainProv)} /> : null}
            <Src title="Learning information" items={[src('Facilities', split.featuresProv), src('Terrain', split.terrainProv)]} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Season dates

/** First day of the month `n` months after the month of `first` (a YYYY-MM-01 date). */
const addMonths = (first: string, n: number) => {
  let d = first
  for (let i = 0; i < n; i++) d = `${addDays(d, 32).slice(0, 7)}-01`
  return d
}

interface Mark {
  date: string
  label: string
  tone: 'announced' | 'opened' | 'closed' | 'date' | 'estimate'
}

function SeasonTimeline({ seasonId, hemisphere, marks, band, date }: { seasonId: string; hemisphere: Hemisphere; marks: Mark[]; band: { from: string; to: string } | null; date: string }) {
  // Six winter months in the resort's hemisphere: November–April, or May–October in the Southern Hemisphere.
  const span = skiWindow(seasonId, hemisphere)
  const total = daysBetween(span.from, span.to)
  const pos = (x: string) => Math.min(100, Math.max(0, (daysBetween(span.from, x) / total) * 100))
  const inSpan = (x: string) => x >= span.from && x <= span.to
  const months = [0, 1, 2, 3, 4, 5].map((i) => addMonths(span.from, i))
  return (
    <div aria-hidden className="relative mt-1 mb-6 h-10 select-none">
      <div className="absolute inset-x-0 top-4 h-1.5 rounded-full bg-surface-3" />
      {band && inSpan(band.from) ? (
        <div
          className="absolute top-3 h-3.5 rounded-sm border border-dashed border-caution/70 bg-caution-bg"
          style={{ left: `${pos(band.from)}%`, width: `${Math.max(1.2, pos(band.to) - pos(band.from))}%` }}
        />
      ) : null}
      {marks.filter((m) => inSpan(m.date)).map((m) => (
        <span
          key={`${m.label}-${m.date}`}
          className={cn(
            'absolute top-2.5 size-[18px] -translate-x-1/2 rounded-full border-2 border-surface',
            m.tone === 'opened' && 'bg-positive',
            m.tone === 'announced' && 'bg-teal',
            m.tone === 'closed' && 'bg-critical',
            m.tone === 'estimate' && 'bg-caution',
          )}
          style={{ left: `${pos(m.date)}%` }}
        />
      ))}
      {inSpan(date) ? (
        <span className="absolute top-0 h-9 w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${pos(date)}%` }}>
          <span className={cn('absolute -top-0.5 text-[11.5px] leading-none font-semibold whitespace-nowrap text-ink', pos(date) > 70 ? 'right-1.5' : 'left-1.5')}>{dayLabel(date)}</span>
        </span>
      ) : (
        <span className={cn('absolute -top-1 text-[11.5px] leading-none font-semibold whitespace-nowrap text-ink', date < span.from ? 'left-0' : 'right-0')}>
          {date < span.from ? `◂ ${dayLabel(date)} — before the season` : `${dayLabel(date)} — after the season ▸`}
        </span>
      )}
      <div className="absolute inset-x-0 top-7 flex justify-between text-[11.5px] text-ink-3">
        {months.map((m) => (
          <span key={m} className="tnum">
            {shortDate(m).split(' ')[1]}
          </span>
        ))}
      </div>
    </div>
  )
}

function SeasonBlock({ d, v }: { d: ResortDetail; v: PageView }) {
  const o = d.summary.opening
  const cur = d.season.current
  const marks: Mark[] = []
  if (cur?.announcedOpening) marks.push({ date: cur.announcedOpening, label: 'Announced target', tone: 'announced' })
  if (cur?.actualOpening) marks.push({ date: cur.actualOpening, label: 'Opened', tone: 'opened' })
  if (cur?.announcedClosing) marks.push({ date: cur.announcedClosing, label: 'Announced closing', tone: 'announced' })
  if (cur?.actualClosing) marks.push({ date: cur.actualClosing, label: 'Closed', tone: 'closed' })
  const band = cur?.estimatedOpenFrom && cur.estimatedOpenTo && !cur.actualOpening ? { from: cur.estimatedOpenFrom, to: cur.estimatedOpenTo } : null
  const changes = d.season.changes.slice(0, 6)
  const FIELD: Record<string, string> = { announcedOpening: 'Announced opening', actualOpening: 'Actual opening', announcedClosing: 'Announced closing', actualClosing: 'Actual closing' }

  return (
    <div className="min-w-0">
      <SubHead aside={cur?.lastCheckedAt ? <>Last checked {shortDate(cur.lastCheckedAt.slice(0, 10))}</> : null}>{d.season.label} season</SubHead>
      <div className="rounded-[12px] border border-divider bg-surface p-4">
        <SeasonTimeline seasonId={d.season.seasonId} hemisphere={d.season.hemisphere} marks={marks} band={band} date={v.date} />
        <dl className="flex flex-col divide-y divide-divider">
          <div className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-start gap-x-3 py-2.5">
            <dt className="text-[13.5px] text-ink-2">Opening</dt>
            <dd className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <OpeningTag label={o.label} />
                <span className="text-[14.5px] font-medium text-ink tnum">
                  {o.label === 'opened'
                    ? o.date
                      ? dayLabelYear(o.date)
                      : 'Opened'
                    : o.label === 'announced'
                      ? o.date
                        ? `Target ${dayLabelYear(o.date)}`
                        : 'Target announced'
                      : o.label === 'estimated'
                        ? o.date
                          ? `About ${dayLabel(o.date)}${o.to && o.to !== o.date ? ` – ${dayLabelYear(o.to)}` : ''}`
                          : 'Estimated'
                        : 'Not announced'}
                </span>
                {o.daysAway !== null && o.daysAway > 0 && o.label !== 'opened' ? <span className="text-[12.5px] text-ink-3 tnum">in {plural(o.daysAway, 'day')}</span> : null}
              </div>
              <p className="mt-1 text-[13px] text-ink-2">
                {o.label === 'announced'
                  ? dotJoin(o.text ? `“${o.text}”` : null, o.announcedOn ? `Announced ${shortDate(o.announcedOn)}` : null, 'A target — subject to weather and operations; never shown as Open until it opens')
                  : o.label === 'estimated'
                    ? dotJoin(o.basis, 'Piste estimate, not an announcement')
                    : o.label === 'opened'
                      ? dotJoin(cur?.announcedOpening ? `Announced target was ${dayLabel(cur.announcedOpening)}` : null, o.date ? 'Actual opening' : 'Reported open this season — the opening date is not recorded')
                      : (o.typicalText ?? 'No opening date or estimate on file for this season.')}
              </p>
              {o.label !== 'not-announced' && o.typicalText ? <p className="mt-1 line-clamp-3 text-[12.5px] text-ink-3">Typically: {o.typicalText}</p> : null}
            </dd>
            <dd>
              <Src
                title="Opening"
                items={[
                  src('Opening', o.prov, o.date ? dayLabelYear(o.date) : 'Not announced'),
                  ...(cur?.announcedOpeningProv && o.label !== 'announced' ? [src('Announced opening', cur.announcedOpeningProv, cur.announcedOpening ? dayLabelYear(cur.announcedOpening) : null)] : []),
                ]}
              />
            </dd>
          </div>
          <div className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-start gap-x-3 py-2.5">
            <dt className="text-[13.5px] text-ink-2">Closing</dt>
            <dd className="min-w-0">
              <p className="text-[14.5px] font-medium text-ink tnum">
                {o.closing.label === 'closed' && o.closing.date
                  ? `Closed ${dayLabelYear(o.closing.date)}`
                  : o.closing.label === 'announced'
                    ? o.closing.date
                      ? `Announced ${dayLabelYear(o.closing.date)}`
                      : 'Announced'
                    : 'Not announced'}
              </p>
              {o.closing.text ? <p className="mt-1 text-[13px] text-ink-2">“{o.closing.text}”</p> : null}
            </dd>
            <dd>{o.closing.prov ? <Src title="Closing" items={[src('Closing', o.closing.prov)]} /> : null}</dd>
          </div>
        </dl>
        {changes.length ? (
          <Disclosure summary={`Date changes on file (${changes.length})`} className="mt-2 border-t border-divider pt-2">
            <ul className="mt-2 flex flex-col gap-1.5 text-[13px] text-ink-2">
              {changes.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 tnum">
                  <span className="font-medium text-ink">{FIELD[c.field] ?? c.field}</span>
                  <span>
                    {c.previousValue ? dayLabel(c.previousValue) : 'none'} → {c.newValue ? dayLabel(c.newValue) : 'cleared'}
                  </span>
                  <span className="text-ink-3">· recorded {instantLabel(c.changedAt, v.tz, v.now)}</span>
                  {c.prov ? <KindTag kind={c.prov.kind} compact /> : null}
                </li>
              ))}
            </ul>
          </Disclosure>
        ) : null}
        {d.season.others.length ? (
          <div className="mt-2 border-t border-divider pt-2.5 text-[13px] text-ink-2">
            <p className="font-medium text-ink">{d.season.others.some((s) => s.seasonId > d.season.seasonId) ? 'Other seasons' : 'Earlier seasons'}</p>
            <ul className="mt-1 flex flex-col gap-0.5 tnum">
              {d.season.others.slice(0, 3).map((s) => (
                <li key={s.id}>
                  {s.seasonId > d.season.seasonId
                    ? `${seasonText(s.seasonId)} (next): ${s.announcedOpening ? `target ${dayLabelYear(s.announcedOpening)}` : s.estimatedOpenFrom ? `Piste estimate from ${dayLabelYear(s.estimatedOpenFrom)}` : 'opening not announced'}`
                    : `${seasonText(s.seasonId)}: ${s.actualOpening ? `opened ${dayLabelYear(s.actualOpening)}` : 'opening not recorded'}${s.actualClosing ? ` · closed ${dayLabelYear(s.actualClosing)}` : ''}`}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {cur?.notes ? (
          <Disclosure summary="Season research notes" className="mt-2 border-t border-divider pt-2">
            <p className="mt-2 max-w-[68ch] text-[13px] text-ink-2">{cur.notes}</p>
          </Disclosure>
        ) : null}
        <p className="mt-3 flex items-center gap-1.5 border-t border-divider pt-2.5 text-[12.5px] text-ink-3">
          <span aria-hidden className="inline-block size-2.5 rounded-full bg-teal" /> Announced
          <span aria-hidden className="ml-2 inline-block size-2.5 rounded-full bg-positive" /> Opened
          <span aria-hidden className="ml-2 inline-block h-2.5 w-4 rounded-[2px] border border-dashed border-caution/70 bg-caution-bg" /> Estimate
          <span aria-hidden className="ml-2 inline-block h-3 w-0.5 bg-ink" /> Planning date
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status

function StatusBlock({ d, x, v }: { d: ResortDetail; x: ResortPageExtras; v: PageView }) {
  const st = d.summary.status
  const history = x.statusHistory
  return (
    <div className="min-w-0">
      <SubHead aside={st.prov ? <Src title="Operating status" items={[src('Operating status', st.prov, st.label)]} /> : null}>Operating status</SubHead>
      <div className="rounded-[12px] border border-divider bg-surface p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <StatusPill status={st.status} />
          <span className="text-[13px] text-ink-2 tnum">
            {st.status === 'unknown'
              ? 'Nothing current on file'
              : dotJoin(
                  st.since ? `Since ${instantLabel(st.since, v.tz, v.now)}` : null,
                  st.lastConfirmedAt ? `confirmed ${ago(st.lastConfirmedAt, v.now)}` : null,
                  st.basis === 'season' ? 'derived from season dates' : st.basis === 'reported' ? 'reported' : null,
                )}
          </span>
        </div>
        {st.note && st.note !== 'No operating status recorded' ? <p className="mt-2 text-[13.5px] text-ink-2">{st.note}</p> : null}
        {st.status === 'unknown' ? (
          <p className="mt-3 flex gap-2 rounded-[10px] border border-dashed border-caution/50 bg-caution-bg px-3 py-2 text-[13px] text-ink">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-caution" />
            <span>
              <strong className="font-semibold">Status unavailable.</strong> Piste never treats an unknown status as open, and an announced opening date never turns into
              “Open” on its own. Check the official snow report before you go.
            </span>
          </p>
        ) : null}
        {history.length ? (
          // The current statement leads the block above; its history is one click away.
          <Disclosure summary={`Status history (${history.length})`} className="mt-3">
            <ol className="relative mt-3 flex flex-col gap-3 border-l border-divider-strong pl-5">
              {history.map((e, i) => (
                <li key={e.id} className="relative">
                  <span aria-hidden className={cn('absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface', i === 0 ? 'bg-teal' : 'bg-divider-strong')} />
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[14px] font-medium text-ink">{e.label}</span>
                    <span className="text-[12.5px] text-ink-3 tnum">{instantLabel(e.effectiveAt, v.tz, v.now)}</span>
                    <KindTag kind={e.prov.kind} compact />
                    <Src title={`Status: ${e.label}`} items={[src(`Status on ${dayLabelYear(e.localDate)}`, e.prov, e.label)]} />
                  </div>
                  {e.note ? <p className="text-[12.5px] text-ink-2">{e.note}</p> : null}
                </li>
              ))}
            </ol>
          </Disclosure>
        ) : (
          <p className="mt-3 text-[13px] text-ink-3 italic">No status statements recorded yet — history starts with the first official or manual report.</p>
        )}
        <p className="mt-3 text-[12.5px] text-ink-3">Status changes are appended, never overwritten.{v.date !== v.today ? ` Status is as of now, not ${dayLabel(v.date)}.` : ''}</p>
      </div>
    </div>
  )
}
