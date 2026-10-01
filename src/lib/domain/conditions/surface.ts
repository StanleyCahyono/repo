/**
 * Surface interpretation (brief §4 surface tags, §5 surface interpretation).
 *
 * Evidence order:
 *   1. A fresh official/manual report (for the assessed date, ≤ reportFreshMaxAgeHours) with surface tags → basis 'reported',
 *      unless weather after the report (new snow / rain) supersedes it.
 *   2. My own recent feedback → basis 'personal'.
 *   3. Weather-inferred rules (text always "Likely …") → basis 'inferred'. A stale or superseded report is
 *      referenced by the inference and can be carried forward as "Likely still …".
 *   4. Nothing usable → basis 'none', tag 'unknown'.
 *
 * Grooming and snowmaking are management actions / snow origin, not surface; they are returned separately in
 * `management` and never become surface tags. Model inference never claims "powder" or "corn".
 */
import { formatLocalDate, hoursBetween, startOfLocalDay } from '../time'
import { SURFACE_LABEL, type SurfaceInterpretation, type SurfaceTag, type UnitPrefs } from '../types'
import { HOUR_MS, msToIso, slotsWithin, toMs, values, type HourSlot, type PreparedSeries } from './aggregate'
import { ageLabel, localTimeLabel, makeFormatters, type Formatters } from './format'
import type { ConditionsConfig, PersonalFeedback, ReportEvidence, ScoredSurfaceTag } from './types'

export interface SurfaceWeather {
  series: PreparedSeries
  pointKey: string
}

export interface SurfaceContext {
  date: string
  timezone: string
  /** Instant report and feedback ages are measured to. */
  referenceAt: string
  /** Lift-operating window on the date (UTC ms). */
  windowFromMs: number
  windowToMs: number
  report: ReportEvidence | null
  personal: readonly PersonalFeedback[]
  /** Weather at the point used for surface inference. */
  weather: SurfaceWeather | null
  /** Weather used for wind exposure (upper mountain preferred). */
  windWeather: SurfaceWeather | null
  units: UnitPrefs
  /**
   * The date is in the future: no report or feedback can describe it yet, so even a fresh report is only
   * carried forward as an inference ("Likely still …") and personal feedback is not used.
   */
  projecting?: boolean
}

export type ReportState = 'fresh' | 'superseded' | 'stale' | 'too-old' | 'no-surface' | 'absent'

export interface SurfaceResult {
  surface: SurfaceInterpretation
  /** Quality of the evidence behind the surface (drives confidence). */
  evidence: 'official' | 'personal' | 'modeled' | 'none'
  reportState: ReportState
  reportAgeHours: number | null
  /** The report had no publish time; its age is measured from the start of its local date (conservative). */
  reportTimeAssumed: boolean
  /** Fresh-snow amount behind a 'fresh-snow' tag, when known. */
  freshSnowCm: number | null
  freshSnowSource: 'report' | 'modeled' | null
  /** Snow cover proven by a recent report or my feedback (never by a model). */
  snowKnownToExist: boolean
  /** Additional plain-language notes (time-of-day window, wind, skipped rules). */
  notes: string[]
  management: { groomingText: string | null; groomedRuns: number | null; snowmakingText: string | null } | null
}

interface RuleHit {
  id: string
  tags: SurfaceTag[]
  /** Sentence without the "Likely" prefix, e.g. "fresh snow: about 12 cm modeled …". */
  body: string
  freshCm?: number
}

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

export function usableTags(tags: readonly SurfaceTag[]): ScoredSurfaceTag[] {
  return tags.filter((t): t is ScoredSurfaceTag => t !== 'unknown')
}

export function tagsText(tags: readonly SurfaceTag[]): string {
  return tags.map((t) => SURFACE_LABEL[t]).join(', ')
}

/** Reported new-snow amount: overnight/24 h reading first, then 48 h. */
export function reportedFreshSnowCm(report: ReportEvidence | null): number | null {
  if (!report) return null
  const pick = (windows: string[]) => {
    const xs = report.snowfall.filter((r) => windows.includes(r.window) && isNum(r.amountCm)).map((r) => r.amountCm!)
    return xs.length ? Math.max(...xs) : null
  }
  return pick(['overnight', '24h']) ?? pick(['48h'])
}

function reportTime(report: ReportEvidence, tz: string): { at: string; assumed: boolean } {
  return report.reportedAt ? { at: report.reportedAt, assumed: false } : { at: startOfLocalDay(report.localDate, tz), assumed: true }
}

// ---------------------------------------------------------------------------
// Rules

function freshSnowRule(series: PreparedSeries, endMs: number, cfg: ConditionsConfig, f: Formatters, ctx: SurfaceContext): RuleHit | { blocked: string } | null {
  const r = cfg.surface.freshSnow
  const slots = slotsWithin(series, endMs - r.lookbackHours * HOUR_MS, endMs)
  const snowVals = values(slots, 'snowfallCm')
  if (snowVals.length === 0) return null
  const snow = sum(snowVals)
  if (snow < r.minSnowCm) return null
  let last = -1
  slots.forEach((s, i) => {
    if (isNum(s.point.snowfallCm) && s.point.snowfallCm >= cfg.surface.traceSnowCm) last = i
  })
  const after = slots.slice(last + 1)
  // Unknown is not "dry and cold". Where rain is missing, total precipitation bounds it from above; an hour with
  // neither, or without a temperature, cannot confirm the "little subsequent rain / still cold" condition.
  let rainAfter = 0
  let rainUnknownHours = 0
  let warmAfter = 0
  let tempUnknownHours = 0
  for (const s of after) {
    const wet = isNum(s.point.rainMm) ? s.point.rainMm : isNum(s.point.precipitationMm) ? s.point.precipitationMm : null
    if (wet === null) rainUnknownHours++
    else rainAfter += wet
    const t = s.point.temperatureC
    if (!isNum(t)) tempUnknownHours++
    else if (t > r.warmAfterC) warmAfter++
  }
  if (rainAfter > r.maxRainAfterMm || warmAfter > r.maxWarmHoursAfter) {
    return { blocked: `Recent modeled snow (${f.snow(snow)}) was followed by rain or warmth, so it is not read as fresh snow` }
  }
  if (rainUnknownHours > 0 || warmAfter + tempUnknownHours > r.maxWarmHoursAfter) {
    return { blocked: `Recent modeled snow (${f.snow(snow)}), but rain or temperature after it is unknown, so it is not read as fresh snow` }
  }
  const deep = snow >= r.deepSnowCm ? ' (deep)' : ''
  return {
    id: r.id,
    tags: ['fresh-snow'],
    freshCm: Math.round(snow * 10) / 10,
    body: `fresh snow${deep}: about ${f.snow(snow)} modeled in the ${r.lookbackHours} h to ${localTimeLabel(msToIso(endMs), ctx.timezone, ctx.date)}; grooming and coverage unknown`,
  }
}

function thawRefreezeRule(
  series: PreparedSeries,
  startMs: number,
  cfg: ConditionsConfig,
  f: Formatters,
  snowKnown: boolean,
): RuleHit | { skipped: string } | null {
  const r = cfg.surface.thawRefreeze
  const slots = slotsWithin(series, startMs - r.lookbackHours * HOUR_MS, startMs)
  let thawHours = 0
  let rain = 0
  let lastWet = -1
  slots.forEach((s, i) => {
    const t = s.point.temperatureC
    const p = s.point.rainMm
    const warm = isNum(t) && t >= r.thawTempC
    const wet = isNum(p) && p >= cfg.surface.traceRainMm
    if (warm) thawHours++
    if (isNum(p)) rain += p
    if (warm || wet) lastWet = i
  })
  if (lastWet < 0 || (thawHours < r.minThawHours && rain < r.minRainMm)) return null
  const after: HourSlot[] = slots.slice(lastWet + 1)
  let run = 0
  let longest = 0
  for (const s of after) {
    const t = s.point.temperatureC
    run = isNum(t) && t <= r.freezeTempC ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  if (longest < r.minFreezeHours) return null
  if (sum(values(after, 'snowfallCm')) >= cfg.surface.freshSnow.minSnowCm) return null
  if (!snowKnown) {
    return { skipped: 'A thaw followed by a hard freeze was modeled, but snow cover is not confirmed by a recent report, so no firm/refrozen surface is inferred' }
  }
  const icy = rain >= r.icyRainMm || thawHours >= r.icyThawHours
  const cause = [rain >= r.minRainMm ? `${f.rain(rain)} rain` : null, thawHours > 0 ? `${thawHours} h above ${f.temp(r.thawTempC)}` : null]
    .filter(Boolean)
    .join(' and ')
  return {
    id: r.id,
    tags: [icy ? 'icy-refrozen' : 'firm'],
    body: `${icy ? 'icy or refrozen' : 'firm'}: ${cause} in the last ${r.lookbackHours} h, then ${longest} h at or below ${f.temp(r.freezeTempC)} (modeled)`,
  }
}

function warmWetRule(series: PreparedSeries, ctx: SurfaceContext, cfg: ConditionsConfig, f: Formatters): RuleHit | null {
  const r = cfg.surface.warmWet
  const slots = slotsWithin(series, ctx.windowFromMs, ctx.windowToMs)
  const rain = sum(values(slots, 'rainMm'))
  const warmHours = values(slots, 'temperatureC').filter((t) => t >= r.warmTempC).length
  if (rain < r.minRainMm && warmHours < r.minWarmHours) return null
  const parts = [rain >= r.minRainMm ? `${f.rain(rain)} rain` : null, warmHours >= r.minWarmHours ? `${warmHours} h at or above ${f.temp(r.warmTempC)}` : null]
  return { id: r.id, tags: ['wet-slushy'], body: `wet or slushy: ${parts.filter(Boolean).join(' and ')} modeled during lift hours` }
}

function lateDayWarmingNote(series: PreparedSeries, ctx: SurfaceContext, cfg: ConditionsConfig): { id: string; note: string } | null {
  const r = cfg.surface.lateDayWarming
  const slots = slotsWithin(series, ctx.windowFromMs, ctx.windowToMs)
  if (slots.length <= r.morningHours) return null
  const morning = slots.slice(0, r.morningHours).map((s) => s.point.temperatureC)
  if (!morning.every((t) => isNum(t) && t <= r.morningMaxC)) return null
  const warm = slots.slice(r.morningHours).find((s) => isNum(s.point.temperatureC) && s.point.temperatureC >= r.afternoonMinC)
  if (!warm) return null
  return {
    id: r.id,
    // Temperature is an instantaneous value: label it with its own timestamp, not the slot start.
    note: `Likely firmer early, softening from about ${localTimeLabel(msToIso(toMs(warm.point.validTime)), ctx.timezone, ctx.date)} as temperatures rise above freezing (modeled)`,
  }
}

function windRule(ctx: SurfaceContext, cfg: ConditionsConfig, f: Formatters, snowKnown: boolean): RuleHit | null {
  const r = cfg.surface.windAffected
  if (!ctx.windWeather) return null
  const endMs = ctx.windowToMs
  const slots = slotsWithin(ctx.windWeather.series, endMs - r.lookbackHours * HOUR_MS, endMs)
  const wind = values(slots, 'windKmh')
  const gust = values(slots, 'gustKmh')
  const maxWind = wind.length ? Math.max(...wind) : null
  const maxGust = gust.length ? Math.max(...gust) : null
  const windy = (maxWind !== null && maxWind >= r.sustainedKmh) || (maxGust !== null && maxGust >= r.gustKmh)
  if (!windy) return null
  const snowSeries = ctx.weather?.series ?? ctx.windWeather.series
  const recentSnow = sum(values(slotsWithin(snowSeries, endMs - cfg.surface.freshSnow.lookbackHours * HOUR_MS, endMs), 'snowfallCm'))
  if (!snowKnown && recentSnow < r.recentSnowCm) return null
  const speed = maxGust !== null && maxGust >= r.gustKmh ? `gusts to ${f.speed(maxGust)}` : `wind to ${f.speed(maxWind!)}`
  return {
    id: r.id,
    tags: ['wind-affected'],
    body: `wind-affected snow on exposed terrain (${speed} at the ${ctx.windWeather.pointKey} point, modeled)`,
  }
}

// ---------------------------------------------------------------------------

export function interpretSurface(ctx: SurfaceContext, cfg: ConditionsConfig): SurfaceResult {
  const f = makeFormatters(ctx.units)
  const sc = cfg.surface
  const notes: string[] = []
  let report = ctx.report && sc.reportKinds.includes(ctx.report.kind) ? ctx.report : null
  if (report && report.localDate > ctx.date) {
    // Later evidence never rewrites an earlier day.
    notes.push(`A report for a later date (${formatLocalDate(report.localDate)}) was not used for this date`)
    report = null
  }

  // Report age (a refetch never resets it: only the source's publish time counts).
  let reportAgeHours: number | null = null
  let reportTimeAssumed = false
  let reportAt: string | null = null
  if (report) {
    const rt = reportTime(report, ctx.timezone)
    reportAt = rt.at
    reportTimeAssumed = rt.assumed
    reportAgeHours = Math.max(0, hoursBetween(rt.at, ctx.referenceAt))
  }
  const reportTags = report ? usableTags(report.surfaceTags) : []
  const management =
    report && (report.groomingText || isNum(report.groomedRuns) || report.snowmakingText)
      ? { groomingText: report.groomingText, groomedRuns: report.groomedRuns, snowmakingText: report.snowmakingText }
      : null

  // Snow cover is "known" only from reports or my own feedback.
  const knownWindowH = sc.snowKnownMaxAgeDays * 24
  const reportShowsSnow =
    !!report &&
    reportAgeHours! <= knownWindowH &&
    ((isNum(report.baseDepthCm) && report.baseDepthCm > 0) ||
      reportTags.length > 0 ||
      report.status === 'open' ||
      report.status === 'partially-open' ||
      (isNum(report.openTrails) && report.openTrails > 0))
  const personalRecent = ctx.personal
    .filter((p) => p.date <= ctx.date && usableTags(p.surfaceTags).length > 0)
    .map((p) => ({ p, age: Math.max(0, hoursBetween(p.recordedAt ?? startOfLocalDay(p.date, ctx.timezone), ctx.referenceAt)) }))
    .sort((a, b) => a.age - b.age)
  const snowKnownToExist = reportShowsSnow || personalRecent.some((x) => x.age <= knownWindowH)

  let reportState: ReportState = !report ? 'absent' : reportTags.length === 0 ? 'no-surface' : 'fresh'
  if (reportState === 'fresh') {
    if (reportAgeHours! > sc.reportStaleMaxAgeHours) reportState = 'too-old'
    // A daily report describes its own local date: an earlier day's report is at most carried forward as
    // "Likely still …", never shown as this date's reported surface, however few hours old it is.
    else if (reportAgeHours! > sc.reportFreshMaxAgeHours || ctx.projecting || report!.localDate !== ctx.date) reportState = 'stale'
  }
  if (report && reportState === 'no-surface' && report.surfaceText) {
    notes.push(`Report surface wording could not be classified: "${report.surfaceText}"`)
  }

  const base = {
    reportAgeHours,
    reportTimeAssumed,
    snowKnownToExist,
    management,
  }
  const reportWording = report ? (report.surfaceText?.trim() || tagsText(reportTags)) : ''
  const reportRef =
    report && reportAt ? `last report ${localTimeLabel(reportAt, ctx.timezone, ctx.date)}${reportTimeAssumed ? ' (time not stated)' : ''}, ${ageLabel(reportAgeHours!)} old: ${reportWording}` : ''

  const series = ctx.weather?.series ?? null
  const late = series ? lateDayWarmingNote(series, ctx, cfg) : null

  // Weather since the report (to the end of the assessed day's lift hours).
  let changedSince: string | null = null
  if (series && reportAt && (reportState === 'fresh' || reportState === 'stale')) {
    const since = slotsWithin(series, toMs(reportAt), ctx.windowToMs)
    const snowSince = sum(values(since, 'snowfallCm'))
    const rainSince = sum(values(since, 'rainMm'))
    if (snowSince >= sc.reportSuperseded.snowCm) changedSince = `${f.snow(snowSince)} modeled snow`
    else if (rainSince >= sc.reportSuperseded.rainMm) changedSince = `${f.rain(rainSince)} modeled rain`
  }

  // 1. Fresh official/manual report, unless weather since the report supersedes it.
  if (reportState === 'fresh') {
    if (!changedSince) {
      const extra = [late?.note].filter((x): x is string => !!x)
      const wind = windRule(ctx, cfg, f, snowKnownToExist)
      if (wind && !reportTags.includes('wind-affected')) extra.push(`Possibly ${wind.body}`)
      const freshCm = reportTags.includes('fresh-snow') ? reportedFreshSnowCm(report) : null
      return {
        ...base,
        surface: {
          tags: reportTags,
          basis: 'reported',
          text: reportWording,
          rules: [sc.freshReport.id, ...(late ? [late.id] : []), ...(wind ? [wind.id] : [])],
        },
        evidence: 'official',
        reportState,
        freshSnowCm: freshCm,
        freshSnowSource: freshCm !== null ? 'report' : null,
        notes: [...notes, ...extra],
      }
    }
    reportState = 'superseded'
    notes.push(`Report superseded: ${changedSince} since it was published`)
  } else if (changedSince) {
    notes.push(`Since the last report: ${changedSince}`)
  }

  // 2. My own recent feedback.
  const fb = ctx.projecting ? undefined : personalRecent.find((x) => x.age <= sc.personalMaxAgeHours)
  if (fb) {
    const tags = usableTags(fb.p.surfaceTags)
    return {
      ...base,
      surface: {
        tags,
        basis: 'personal',
        text: `My feedback (${formatLocalDate(fb.p.date)}): ${tagsText(tags)}${fb.p.note ? ` — ${fb.p.note}` : ''}`,
        rules: [sc.personal.id, ...(late ? [late.id] : [])],
      },
      evidence: 'personal',
      reportState,
      freshSnowCm: null,
      freshSnowSource: null,
      notes: [...notes, ...(late ? [late.note] : [])],
    }
  }

  // 3. Weather inference.
  const rules: string[] = []
  let primary: RuleHit | null = null
  if (series) {
    const wet = warmWetRule(series, ctx, cfg, f)
    const fresh = freshSnowRule(series, ctx.windowToMs, cfg, f, ctx)
    const refreeze = thawRefreezeRule(series, ctx.windowFromMs, cfg, f, snowKnownToExist)
    if (fresh && 'blocked' in fresh) notes.push(fresh.blocked)
    if (refreeze && 'skipped' in refreeze) notes.push(refreeze.skipped)
    const candidates = [wet, fresh && 'id' in fresh ? fresh : null, refreeze && 'id' in refreeze ? refreeze : null]
    primary = candidates.find((c): c is RuleHit => c !== null) ?? null
  }
  const wind = windRule(ctx, cfg, f, snowKnownToExist)
  const carry = (reportState === 'stale' || reportState === 'superseded') && reportTags.length > 0

  const sentences: string[] = []
  let tags: SurfaceTag[] = []
  let freshCm: number | null = null
  if (primary) {
    tags = [...primary.tags]
    rules.push(primary.id)
    sentences.push(`Likely ${primary.body}`)
    freshCm = primary.freshCm ?? null
  } else if (carry && changedSince) {
    tags = ['mixed']
    rules.push(sc.reportSuperseded.id)
    sentences.push('Likely mixed — the surface has changed since the report and no single pattern is modeled')
  } else if (carry) {
    rules.push(sc.staleReport.id)
    const check = series ? 'no major change modeled since the report' : 'no weather data to check for changes since the report'
    // Reported fresh snow does not stay fresh: an older report's "fresh snow" is not carried forward as fresh.
    const kept = reportTags.filter((t) => t !== 'fresh-snow')
    if (kept.length > 0) {
      tags = kept
      sentences.push(`Likely still ${tagsText(kept).toLowerCase()} — ${check}`)
    } else {
      tags = ['mixed']
      sentences.push(`Likely mixed — the fresh snow in the last report is ${ageLabel(reportAgeHours!)} old and has probably been skied or groomed`)
    }
  }
  if (wind) {
    rules.push(wind.id)
    if (tags.length === 0) sentences.push(`Likely ${wind.body}`)
    else sentences.push(`Possibly ${wind.body}`)
    if (!tags.includes('wind-affected')) tags.push('wind-affected')
  }
  if (late) rules.push(late.id)

  if (tags.length === 0) {
    const why = !series && !ctx.windWeather ? 'no recent surface report or weather data' : 'no recent surface report, and the modeled weather supports no specific inference'
    return {
      ...base,
      surface: { tags: ['unknown'], basis: 'none', text: `Unknown — ${why}`, rules },
      evidence: 'none',
      reportState,
      freshSnowCm: null,
      freshSnowSource: null,
      notes: [...notes, ...(late ? [late.note] : [])],
    }
  }
  if (reportRef && (reportState === 'stale' || reportState === 'superseded')) {
    sentences.push(`Based on the ${reportRef}`)
  }
  return {
    ...base,
    surface: { tags, basis: 'inferred', text: sentences.join('. '), rules },
    evidence: 'modeled',
    reportState,
    freshSnowCm: freshCm,
    freshSnowSource: freshCm === null ? null : 'modeled',
    notes: [...notes, ...(late ? [late.note] : [])],
  }
}
