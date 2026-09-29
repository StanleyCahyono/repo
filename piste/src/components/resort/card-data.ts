/**
 * Resort card view model — the serializable contract behind <ResortCard/> (Explore list, map preview, Today).
 *
 * Build it on the SERVER from a ResortSummary (src/lib/data/resorts.ts) with `toResortCardData(summary, opts)`, then
 * pass the plain object to the client card. Everything here is pre-formatted in the user's units so the client does
 * no unit or money work, and every value keeps its honesty state:
 *   - unknown stays unknown (null / explicit "Unknown" text) — never 0, never "open", never "allowed";
 *   - reported vs weather-model snow are separate fields with their evidence kind;
 *   - estimates (drive times, day cost, opening windows) say so in their caption;
 *   - demo data carries `demo: true`.
 *
 * Pure module: no DB, no network, no clock (callers pass `now`). Type-only imports from the read models.
 */
import type { ResortSummary } from '@/lib/data/resorts'
import type { SourceItem } from '@/components/ui/source-drawer'
import { formatMoney, formatMoneyRange } from '@/lib/domain/money'
import { terrainMatch } from '@/lib/domain/fit'
import type { FitLabel } from '@/lib/domain/fit'
import type { AccessStatus } from '@/lib/domain/passes/types'
import { formatLocalDate, relativeLabel } from '@/lib/domain/time'
import { formatDuration, formatElevation, formatSnow } from '@/lib/domain/units'
import {
  PASS_FAMILIES,
  SCORING_MODE_LABEL,
  type Confidence,
  type DataKind,
  type ExpenseTier,
  type OpeningLabel,
  type OperatingStatus,
  type PassFamilyId,
  type Provenance,
  type ScoreKind,
  type UnitPrefs,
  type VerificationLevel,
} from '@/lib/domain/types'

// ---------------------------------------------------------------------------
// Types

/** How the catalog facts behind a resort were gathered (brief: "Researched" vs "Reference — confirm"). */
export type ResearchLevel = 'researched' | 'reference' | null

export type LearningLevel = 'good' | 'ok' | 'limited' | 'unknown'

export interface CardLearning {
  level: LearningLevel
  /** "Good for learning", "Learning possible", "Limited for learning", "Learning suitability unknown". */
  label: string
  /** Plain-language reason, e.g. "Lessons offered · 30% beginner terrain". */
  reason: string
  /** The terrain split is research-grade (confirm at source). */
  researched: boolean
}

export interface CardPassBadge {
  familyId: PassFamilyId
  familyName: string
  /** false = every rule behind the badge is 'unknown' for the season: draw it dashed, say "unconfirmed". */
  confirmed: boolean
  /** Only discount-only / unknown access. */
  qualifiedOnly: boolean
  /** Accessible description, e.g. "Ikon Pass — 2026–27 access unconfirmed". */
  title: string
}

/** One exact-product answer for the card's date ("Can I use my pass here?"). */
export interface CardPassLine {
  status: 'covered' | 'not-covered' | 'unconfirmed'
  productName: string
  /** e.g. "Included (1 of 2 days left)" / "Access not confirmed". */
  headline: string
  confirmAtSource: boolean
}

export interface ResortCardData {
  id: string
  name: string
  shortName: string
  /** Resort page link (keeps the card's date when it is not the resort's today). */
  href: string
  /** Short place, e.g. "Virgil, NY". */
  place: string
  region: string
  country: string
  lat: number
  lon: number
  timezone: string
  /** Resort-local date the date-specific facts describe. */
  date: string
  /** "Mon 28 Sep". */
  dateLabel: string
  isToday: boolean
  /** Active season label, e.g. "2026–27" (pass badges say which season is unconfirmed). */
  seasonLabel: string
  demo: boolean
  isFavorite: boolean
  media: {
    /** Licensed photo only — never invented; null → designed contour placeholder. */
    photo: { src: string; alt: string; credit: string; license: string; sourceUrl: string } | null
    /** "2,100 ft summit" for the placeholder caption. */
    elevationLabel: string | null
  }
  status: {
    status: OperatingStatus
    label: string
    /** reported = official/manual statement; season = derived from season dates; none = nothing recorded. */
    basis: 'reported' | 'season' | 'none'
    note: string | null
    /** "Reported 3 h ago" / null. */
    asOf: string | null
    prov: Provenance | null
  }
  opening: {
    label: OpeningLabel
    /** Full sentence: "Opens Sat 21 Nov (announced)", "Est. 28 Nov – 5 Dec", "Opened Fri 5 Dec", "Opening not announced". */
    text: string
    /** Date part only, shown beside the OpeningTag: "Sat 21 Nov", "28 Nov – 5 Dec", "Fri 5 Dec"; null when not announced. */
    dates: string | null
    prov: Provenance | null
  }
  /** Confirmed closure on the date: show "Closed", never a ski-day score. */
  closure: { reason: string; prov: Provenance | null } | null
  score: {
    kind: ScoreKind
    value: number | null
    descriptor: string | null
    coverage: number | null
    confidence: Confidence | null
    /** Scoring mode label, e.g. "Learning day". */
    modeLabel: string
    /** Short line under the score ("High confidence", "No assessment for this date", closure reason…). */
    caption: string
    /** Surface interpretation ("Likely packed powder…") when an assessment exists. */
    surface: string | null
    prov: Provenance | null
  }
  snow: {
    /** Latest official/manual/demo report on or before the date. */
    reported: {
      headline: string
      detail: string | null
      kind: DataKind
      /** "Reported 6 h ago" (publish time) or "Report for Thu 14 Jan". */
      age: string | null
      stale: boolean
      prov: Provenance
    } | null
    /** Weather-model outlook from now (never an observation). */
    modeled: { headline: string; detail: string | null; prov: Provenance } | null
    /** Why nothing is shown (both missing): "No report on file · weather not fetched". */
    missing: string | null
  }
  passes: CardPassBadge[]
  /** Best owned-pass answer for the date (null when no pass is recorded). */
  pass: CardPassLine | null
  expense: {
    tier: ExpenseTier | 'incomplete'
    /** Tier symbol or "Incomplete estimate". */
    label: string
    /** Per-person total ("$142" or "$120–$160"); null when incomplete. */
    amount: string | null
    /** "per person · Piste estimate" / "lift ticket price missing". */
    caption: string
    missing: string[]
    confirmAtSource: boolean
    passCoveredBy: string | null
  }
  travel: {
    mode: 'drive' | 'fly' | 'none'
    /** "33 min" / "Fly" / "Unknown". */
    headline: string
    /** "drive · estimate" / "via SLC · 45 min transfer". */
    caption: string
    /** Travel verdict sentence with the winter-buffer assumption. */
    detail: string | null
    driveMinutes: number | null
    estimate: boolean
    prov: Provenance | null
  }
  fit: {
    score: number | null
    label: FitLabel
    confidence: Confidence
    reasons: string[]
    unknowns: string[]
  }
  /** Tri-state on-mountain facts: true = offered, false = confirmed not offered, null = unknown. */
  features: { key: 'night' | 'lessons' | 'rentals' | 'lodging'; label: string; value: boolean | null }[]
  learning: CardLearning
  terrain: { beginnerPct: number | null; intermediatePct: number | null; advancedPct: number | null } | null
  events: {
    count: number
    /** "within 3 days of Sat 16 Jan". */
    windowLabel: string
    next: { title: string; when: string; statusLabel: string } | null
  }
  alerts: { count: number; headline: string | null }
  gaps: string[]
  research: ResearchLevel
  /** Everything important on the card, with provenance, for the SourceDrawer. */
  sources: SourceItem[]
}

export interface CardDataOptions {
  units: UnitPrefs
  /** App clock (ctx.now) — for relative ages. */
  now: string
  /** "2026–27". */
  seasonLabel: string
  /** Catalog research method when the caller knows it (Explore's loader does); inferred from provenance otherwise. */
  research?: ResearchLevel
  /** Override the link target. Default `/resorts/<id>` (+ `?date=` when the date is not the resort's today). */
  href?: string
}

// ---------------------------------------------------------------------------
// Small pure helpers (exported for Explore filters and tests)

const COUNTRY_NAME: Record<string, string> = {
  US: 'USA',
  CA: 'Canada',
  AT: 'Austria',
  CH: 'Switzerland',
  FR: 'France',
  IT: 'Italy',
  DE: 'Germany',
  JP: 'Japan',
}

/** "Virgil (Cortland mailing address…)" + NY → "Virgil, NY"; Arlberg's village list → "St. Anton am Arlberg, Austria". */
export function shortPlace(locality: string | null, stateProvince: string | null, country: string): string {
  const where = country === 'US' || country === 'CA' ? (stateProvince ?? COUNTRY_NAME[country] ?? country) : (COUNTRY_NAME[country] ?? country)
  const base = (locality ?? '').replace(/\s*\([^)]*\)/g, '').trim()
  const first = base
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)[0]
  if (!first) return where
  return first === where ? first : `${first}, ${where}`
}

/**
 * Learning suitability, independent of the user's own ability: lessons + beginner terrain + beginner area.
 * Unknown lessons AND unknown terrain → 'unknown' (never assumed suitable).
 */
export function learningSuitability(input: {
  beginnerPct: number | null
  intermediatePct?: number | null
  advancedPct?: number | null
  lessons: boolean | null
  beginnerArea: string | null
  terrainVerification?: VerificationLevel | null
}): CardLearning {
  const t = terrainMatch('beginner', {
    beginnerPct: input.beginnerPct,
    intermediatePct: input.intermediatePct ?? null,
    advancedPct: input.advancedPct ?? null,
    verification: input.terrainVerification ?? null,
  })
  const v = t.value
  const parts: string[] = []
  if (input.lessons === true) parts.push('Lessons offered')
  else if (input.lessons === false) parts.push('No lessons offered')
  else parts.push('Lessons unknown')
  if (t.share !== null) parts.push(`${Math.round(t.share)}% beginner terrain`)
  else parts.push('beginner terrain share unknown')
  if (input.beginnerArea) parts.push('dedicated beginner area')
  const reason = parts.join(' · ')
  const researched = t.researched
  if (input.lessons === false) return { level: 'limited', label: 'Limited for learning', reason, researched }
  if (v !== null && v < 35) return { level: 'limited', label: 'Limited for learning', reason, researched }
  if (input.lessons === true && ((v !== null && v >= 65) || (v === null && !!input.beginnerArea))) {
    return { level: 'good', label: 'Good for learning', reason, researched }
  }
  if (input.lessons === true) return { level: 'ok', label: 'Learning possible', reason, researched }
  if (v !== null && v >= 65) return { level: 'ok', label: 'Learning possible', reason, researched }
  return { level: 'unknown', label: 'Learning suitability unknown', reason, researched }
}

/** Infer the catalog research level from the provenance of catalog facts (when the caller does not know it). */
export function inferResearch(provs: readonly (Provenance | null | undefined)[]): ResearchLevel {
  const levels = provs.filter((p): p is Provenance => !!p).map((p) => p.verification ?? null)
  if (levels.includes('search-summary')) return 'researched'
  if (levels.some((v) => v === 'unverified' || v === null)) return 'reference'
  return null
}

export const RESEARCH_LABEL: Record<Exclude<ResearchLevel, null>, { short: string; long: string }> = {
  researched: { short: 'Researched — confirm', long: 'Catalog facts were researched via web search — confirm at the source' },
  reference: { short: 'Reference — confirm', long: 'Catalog facts are Piste reference data (not web-verified) — confirm at the source' },
}

const isFamily = (id: string): id is PassFamilyId => (PASS_FAMILIES as readonly string[]).includes(id)

export const EVENT_STATUS_LABEL: Record<string, string> = {
  announced: 'Announced',
  tentative: 'Tentative',
  'not-announced': 'Dates not announced yet',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
}

function openingDates(o: ResortSummary['opening']): string | null {
  if (!o.date) return null
  if (o.label === 'estimated') return `${formatLocalDate(o.date, 'd LLL')}${o.to && o.to !== o.date ? ` – ${formatLocalDate(o.to, 'd LLL')}` : ''}`
  if (o.label === 'not-announced') return null
  return formatLocalDate(o.date, 'ccc d LLL')
}

function openingText(o: ResortSummary['opening']): string {
  const d = (x: string, fmt = 'ccc d LLL') => formatLocalDate(x, fmt)
  switch (o.label) {
    case 'opened':
      return o.date ? `Opened ${d(o.date)}` : 'Opened'
    case 'announced':
      return o.date ? `Opens ${d(o.date)} (announced)` : 'Opening announced'
    case 'estimated':
      return o.date ? `Est. ${d(o.date, 'd LLL')}${o.to && o.to !== o.date ? ` – ${d(o.to, 'd LLL')}` : ''}` : 'Opening estimated'
    default:
      return 'Opening not announced'
  }
}

/**
 * The line under the ScoreChip. It adds what the chip does not already say (the chip shows "Limited data · 45%
 * inputs" or "Weather potential · weather only" itself), so the two never repeat each other.
 */
function scoreCaption(s: ResortSummary): string {
  if (s.closure) return s.closure.reason
  const sc = s.score
  if (!sc) return `No assessment for ${s.date === s.today ? 'today' : formatLocalDate(s.date)}`
  const confidence = `${sc.confidence[0].toUpperCase()}${sc.confidence.slice(1)} confidence`
  if (sc.scoreKind === 'limited') return confidence
  if (sc.scoreKind === 'weather-potential') return 'Terrain & surface unknown'
  if (sc.scoreKind === 'none') return 'Not enough evidence for a score'
  return confidence
}

function reportedSnow(s: ResortSummary, units: UnitPrefs, now: string): ResortCardData['snow']['reported'] {
  const r = s.snow.report
  if (!r) return null
  const window =
    r.snowfall.find((x) => x.window === '24h' && x.amountCm !== null) ?? r.snowfall.find((x) => x.window === 'overnight' && x.amountCm !== null) ?? null
  const fresh = window ? formatSnow(window.amountCm, units) : null
  const base = formatSnow(r.baseDepthCm, units)
  const windowLabel = window ? (window.window === 'overnight' ? 'overnight' : '24 h') : null
  const headline = fresh
    ? `${fresh} new`
    : base
      ? `${base} base`
      : r.openTrails !== null && r.totalTrails !== null
        ? `${r.openTrails}/${r.totalTrails} trails`
        : 'Report on file'
  const detailParts: string[] = []
  if (fresh && windowLabel) detailParts.push(windowLabel)
  if (fresh && base) detailParts.push(`${base} base`)
  if (!fresh && base && r.openTrails !== null && r.totalTrails !== null) detailParts.push(`${r.openTrails}/${r.totalTrails} trails open`)
  const age =
    r.reportedAt && r.localDate === s.date
      ? `Reported ${relativeLabel(r.reportedAt, now)}`
      : r.localDate !== s.date
        ? `Report for ${formatLocalDate(r.localDate)}`
        : r.fetchedAt
          ? `Fetched ${relativeLabel(r.fetchedAt, now)}`
          : null
  const stale = r.localDate < s.date || (r.ageHours !== null && r.ageHours > 36)
  return { headline, detail: detailParts.join(' · ') || null, kind: r.kind, age, stale, prov: r.prov }
}

function modeledSnow(s: ResortSummary, units: UnitPrefs): ResortCardData['snow']['modeled'] {
  const pts = (['summit', 'base'] as const)
    .map((k) => ({ k, f: s.snow.forecast[k] }))
    .filter((p) => p.f && p.f.next72h.sumCm !== null)
    .sort((a, b) => b.f!.next72h.sumCm! - a.f!.next72h.sumCm!)
  const top = pts[0]
  if (!top?.f) return null
  const w = top.f.next72h
  const amount = formatSnow(w.sumCm, units)
  const headline = w.sumCm === 0 ? (w.complete ? 'No new snow likely' : 'No snow modeled yet') : `Likely ${w.complete ? '' : '≥ '}${amount}`
  const detail = `next 72 h · ${top.k} · model${w.complete ? '' : `, ${w.hoursWithValue} of 72 h`}`
  return { headline, detail, prov: top.f.run.prov }
}

function travelFact(s: ResortSummary): ResortCardData['travel'] {
  const t = s.travel
  const v = t.verdict
  const practical = t.airports.find((a) => a.role !== 'closest') ?? t.airports[0] ?? null
  if (v.mode === 'drive' && t.driveMinutes !== null) {
    return {
      mode: 'drive',
      headline: formatDuration(t.driveMinutes) ?? 'Unknown',
      caption: t.isEstimate ? 'drive · estimate' : 'drive · routed',
      detail: v.note,
      driveMinutes: t.driveMinutes,
      estimate: t.isEstimate,
      prov: t.prov,
    }
  }
  if (v.mode === 'fly' || (t.driveMinutes === null && practical)) {
    const via = practical ? `via ${practical.iata}` : 'airport not recorded'
    const transfer = practical?.minutes != null ? ` · ${formatDuration(practical.minutes)} transfer` : ''
    const alt = t.driveMinutes !== null ? ` · or ${formatDuration(t.driveMinutes)} drive` : ''
    return {
      mode: 'fly',
      headline: 'Fly',
      caption: `${via}${transfer || alt}`,
      detail: v.note + (practical?.name ? ` Practical airport: ${practical.name} (${practical.iata}).` : ''),
      driveMinutes: t.driveMinutes,
      estimate: true,
      prov: practical?.prov ?? t.prov,
    }
  }
  if (t.driveMinutes !== null) {
    return {
      mode: 'drive',
      headline: formatDuration(t.driveMinutes) ?? 'Unknown',
      caption: t.isEstimate ? 'drive · estimate' : 'drive',
      detail: v.note,
      driveMinutes: t.driveMinutes,
      estimate: t.isEstimate,
      prov: t.prov,
    }
  }
  return { mode: 'none', headline: 'Unknown', caption: 'no travel info recorded', detail: v.note, driveMinutes: null, estimate: true, prov: null }
}

function expenseFact(s: ResortSummary): ResortCardData['expense'] {
  const e = s.expense
  if (e.tier === 'incomplete') {
    const lift = e.requiredMissing.find((m) => /lift/i.test(m))
    const rental = e.requiredMissing.find((m) => /rental/i.test(m))
    const caption =
      lift && rental
        ? 'lift & rental prices missing'
        : lift
          ? 'lift ticket price missing'
          : rental
            ? 'rental price missing'
            : e.requiredMissing.length
              ? 'prices missing'
              : 'estimate incomplete'
    return {
      tier: 'incomplete',
      label: 'Incomplete estimate',
      amount: null,
      caption,
      missing: e.missing,
      confirmAtSource: e.confirmAtSource,
      passCoveredBy: e.passCoveredBy,
    }
  }
  const amount = e.totalMax ? formatMoneyRange(e.total, e.totalMax) : formatMoney(e.total, { compact: true })
  const caption = `per person${e.passCoveredBy ? ' · with pass' : ''} · ${e.confirmAtSource ? 'confirm prices' : 'Piste estimate'}`
  return { tier: e.tier, label: e.label, amount, caption, missing: e.missing, confirmAtSource: e.confirmAtSource, passCoveredBy: e.passCoveredBy }
}

function passLine(s: ResortSummary): CardPassLine | null {
  const p = s.myPass
  if (p.status === 'no-pass' || !p.productName) return null
  const v = p.verdicts.find((x) => x.productName === p.productName) ?? p.verdicts[0]
  return {
    status: p.status,
    productName: p.productName,
    headline: v ? v.headline : p.headline,
    confirmAtSource: !!v?.confirmAtSource,
  }
}

/** Product verdict → card pass line (Explore's product filter, Compare). */
export function passLineFromVerdict(v: {
  productName: string
  status: AccessStatus
  canSki: boolean
  headline: string
  confirmAtSource: boolean
}): CardPassLine {
  return {
    status: v.canSki ? 'covered' : v.status === 'unknown' ? 'unconfirmed' : 'not-covered',
    productName: v.productName,
    headline: v.headline,
    confirmAtSource: v.confirmAtSource,
  }
}

// ---------------------------------------------------------------------------
// Builder

export function toResortCardData(s: ResortSummary, opts: CardDataOptions): ResortCardData {
  const { units, now, seasonLabel } = opts
  const research =
    opts.research !== undefined ? opts.research : inferResearch([s.locationProv, s.elevationProv, s.beginner.terrainProv, s.beginner.featuresProv])
  const isToday = s.date === s.today
  const href = opts.href ?? `/resorts/${s.id}${isToday ? '' : `?date=${s.date}`}`

  const statusAt = s.status.lastConfirmedAt ?? s.status.since
  const summit = formatElevation(s.summitElevationM, units)
  const f = s.features

  const scoreKind: ScoreKind = s.closure ? 'closed' : (s.score?.scoreKind ?? 'none')
  const reported = reportedSnow(s, units, now)
  const modeled = modeledSnow(s, units)
  const weatherMissing = !s.snow.forecast.base && !s.snow.forecast.summit
  const snowMissing = !reported && !modeled ? ['No report on file', weatherMissing ? 'weather not fetched' : 'no model snowfall'].join(' · ') : null

  const nextEvent = s.eventsInWindow[0] ?? null
  const eventWhen = (e: (typeof s.eventsInWindow)[number]) => {
    if (!e.startDate) return 'Dates not announced'
    const start = formatLocalDate(e.startDate, 'ccc d LLL')
    return e.endDate && e.endDate !== e.startDate ? `${start} – ${formatLocalDate(e.endDate, 'ccc d LLL')}` : start
  }

  const learning = learningSuitability({
    beginnerPct: s.beginner.beginnerPct,
    intermediatePct: s.beginner.intermediatePct,
    advancedPct: s.beginner.advancedPct,
    lessons: s.beginner.lessons,
    beginnerArea: s.beginner.beginnerArea,
    terrainVerification: s.beginner.terrainProv?.verification ?? null,
  })

  const travel = travelFact(s)
  const expense = expenseFact(s)
  const opening = { label: s.opening.label, text: openingText(s.opening), dates: openingDates(s.opening), prov: s.opening.prov }

  const passes: CardPassBadge[] = s.passes
    .filter((p) => isFamily(p.familyId))
    .map((p) => ({
      familyId: p.familyId as PassFamilyId,
      familyName: p.familyName,
      confirmed: p.confirmed,
      qualifiedOnly: p.qualifiedOnly,
      title: `${p.familyName} — ${p.confirmed ? (p.qualifiedOnly ? `${seasonLabel} discount or unconfirmed access only` : `${seasonLabel} access recorded (discovery only)`) : `${seasonLabel} access unconfirmed`}`,
    }))

  const scoreValue = s.closure ? null : (s.score?.score ?? null)

  const sources: SourceItem[] = [
    { label: 'Operating status', value: s.status.label, prov: s.status.prov },
    { label: 'Opening date', value: opening.text, prov: s.opening.prov },
    ...(s.closure ? [{ label: 'Closure', value: s.closure.reason, prov: s.closure.prov }] : []),
    {
      label: `Conditions score (${SCORING_MODE_LABEL[s.mode]})`,
      value: scoreValue !== null ? `${scoreValue} — ${s.score?.descriptor ?? ''}` : scoreCaption(s),
      prov: s.score?.prov ?? null,
    },
    {
      label: 'Snow report',
      value: reported ? [reported.headline, reported.detail].filter(Boolean).join(' · ') : 'No report on file',
      prov: s.snow.report?.prov ?? null,
    },
    ...(s.snow.forecast.summit ? [{ label: 'Weather model (summit)', value: modeled?.headline ?? null, prov: s.snow.forecast.summit.run.prov }] : []),
    ...(s.snow.forecast.base ? [{ label: 'Weather model (base)', value: null, prov: s.snow.forecast.base.run.prov }] : []),
    {
      label: 'Drive from home',
      value: s.travel.driveMinutes !== null ? `${formatDuration(s.travel.driveMinutes)}${s.travel.isEstimate ? ' (estimate)' : ''}` : 'Not recorded',
      prov: s.travel.prov,
    },
    ...s.travel.airports
      .slice(0, 2)
      .map((a) => ({
        label: `Airport ${a.iata} (${a.role ?? 'airport'})`,
        value: a.minutes != null ? `${formatDuration(a.minutes)} transfer` : 'Transfer time not recorded',
        prov: a.prov,
      })),
    { label: 'Terrain split', value: s.beginner.beginnerPct !== null ? `${s.beginner.beginnerPct}% beginner` : 'Unknown', prov: s.beginner.terrainProv },
    { label: 'Lessons, rentals, lodging, night skiing', value: null, prov: s.beginner.featuresProv },
    { label: 'Location', value: `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`, prov: s.locationProv },
    { label: 'Elevation', value: summit ? `${summit} summit` : 'Unknown', prov: s.elevationProv },
    ...s.eventsInWindow
      .slice(0, 3)
      .map((e) => ({ label: `Event: ${e.title}`, value: `${eventWhen(e)} · ${EVENT_STATUS_LABEL[e.status] ?? e.status}`, prov: e.prov })),
    ...s.officialAlerts.slice(0, 2).map((a) => ({ label: `Official alert: ${a.event}`, value: a.headline, prov: a.prov })),
  ]

  return {
    id: s.id,
    name: s.name,
    shortName: s.shortName,
    href,
    place: shortPlace(s.locality, s.stateProvince, s.country),
    region: s.region,
    country: s.country,
    lat: s.lat,
    lon: s.lon,
    timezone: s.timezone,
    date: s.date,
    dateLabel: formatLocalDate(s.date),
    isToday,
    seasonLabel,
    demo: s.demo,
    isFavorite: s.isFavorite,
    media: { photo: s.photo, elevationLabel: summit ? `${summit} summit` : null },
    status: {
      status: s.status.status,
      label: s.status.label,
      basis: s.status.basis,
      note: s.status.note,
      asOf: statusAt ? `${s.status.basis === 'season' ? 'Derived' : 'Stated'} ${relativeLabel(statusAt, now)}` : null,
      prov: s.status.prov,
    },
    opening,
    closure: s.closure ? { reason: s.closure.reason, prov: s.closure.prov } : null,
    score: {
      kind: scoreKind,
      value: scoreValue,
      descriptor: s.closure ? null : (s.score?.descriptor ?? null),
      coverage: s.score?.coverage ?? null,
      confidence: s.score?.confidence ?? null,
      modeLabel: SCORING_MODE_LABEL[s.mode],
      caption: scoreCaption(s),
      surface: s.closure ? null : (s.score?.surface.text ?? null),
      prov: s.score?.prov ?? null,
    },
    snow: { reported, modeled, missing: snowMissing },
    passes,
    pass: passLine(s),
    expense,
    travel,
    fit: {
      score: s.fit.score,
      label: s.fit.label,
      confidence: s.fit.confidence,
      reasons: s.fit.reasons.slice(0, 3),
      unknowns: s.fit.unknowns.slice(0, 3),
    },
    features: [
      { key: 'night', label: 'Night skiing', value: f?.nightSkiing ?? null },
      { key: 'lessons', label: 'Lessons', value: f?.lessons ?? null },
      { key: 'rentals', label: 'Rentals', value: f?.rentals ?? null },
      { key: 'lodging', label: 'On-mountain lodging', value: f?.onMountainLodging ?? null },
    ],
    learning,
    terrain:
      s.beginner.beginnerPct !== null || s.beginner.intermediatePct !== null || s.beginner.advancedPct !== null
        ? { beginnerPct: s.beginner.beginnerPct, intermediatePct: s.beginner.intermediatePct, advancedPct: s.beginner.advancedPct }
        : null,
    events: {
      count: s.eventsInWindow.length,
      windowLabel: `within 3 days of ${formatLocalDate(s.date)}`,
      next: nextEvent ? { title: nextEvent.title, when: eventWhen(nextEvent), statusLabel: EVENT_STATUS_LABEL[nextEvent.status] ?? nextEvent.status } : null,
    },
    alerts: { count: s.officialAlerts.length, headline: s.officialAlerts[0]?.headline ?? s.officialAlerts[0]?.event ?? null },
    gaps: s.dataGaps,
    research,
    sources,
  }
}
