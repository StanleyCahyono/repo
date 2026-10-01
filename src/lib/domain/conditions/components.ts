/**
 * Score components S, T, W, V, C (0–100) with explicit curves from the versioned config.
 * A component with no usable input returns `value: null` and an explanatory note — never a neutral default.
 */
import type { ComponentKey, DataKind, ScoringMode, UnitPrefs } from '../types'
import { formatLocalDate, hoursBetween } from '../time'
import { values, slotsWithin, type HourSlot, type PreparedSeries } from './aggregate'
import { clamp, evalCurve } from './curve'
import { ageLabel, localTimeLabel, makeFormatters } from './format'
import { tagsText, type SurfaceResult } from './surface'
import type { ConditionsComponent, ConditionsConfig, ReportEvidence, ScoredSurfaceTag } from './types'

export interface PointPick {
  series: PreparedSeries
  pointKey: string
  /** True when the preferred point had no data and another point was used. */
  fallback: boolean
  preferredKey: string
  kind: DataKind
}

export interface ComponentContext {
  mode: ScoringMode
  cfg: ConditionsConfig
  date: string
  timezone: string
  /** Instant ages are measured to. */
  referenceAt: string
  windowFromMs: number
  windowToMs: number
  /** e.g. "09:00–16:00". */
  windowLabel: string
  units: UnitPrefs
  surface: SurfaceResult
  report: ReportEvidence | null
  wind: PointPick | null
  visibility: PointPick | null
  comfort: PointPick | null
  /** Set for future dates: terrain is not scored and this reason is shown. */
  terrainUnknownReason?: string | null
}

export interface ComponentBuild {
  component: ConditionsComponent
  hardRuleNotes: string[]
}

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const r1 = (v: number) => Math.round(v * 10) / 10

function nominal(ctx: ComponentContext, key: ComponentKey) {
  return ctx.cfg.weights[ctx.mode][key]
}

function missing(ctx: ComponentContext, key: ComponentKey, note: string, inputs: ConditionsComponent['inputs'] = {}): ComponentBuild {
  return { component: { key, value: null, weight: nominal(ctx, key), included: false, inputs, note, proxy: null }, hardRuleNotes: [] }
}

function kindWord(kind: DataKind): string {
  return kind === 'observed' ? 'observed' : kind === 'demo' ? 'demo data' : 'modeled'
}

/** "summit", or "base (no summit data)" when the preferred point had no values for this purpose. */
function pointLabel(pick: PointPick): string {
  return pick.fallback ? `${pick.pointKey} (no ${pick.preferredKey} data)` : pick.pointKey
}

function windowSlots(ctx: ComponentContext, pick: PointPick): HourSlot[] {
  return slotsWithin(pick.series, ctx.windowFromMs, ctx.windowToMs)
}

function expectedWindowHours(ctx: ComponentContext) {
  return Math.round((ctx.windowToMs - ctx.windowFromMs) / 3_600_000)
}

function hoursSuffix(ctx: ComponentContext, n: number) {
  const expected = expectedWindowHours(ctx)
  return n < expected ? ` (${n} of ${expected} lift hours available)` : ''
}

// ---------------------------------------------------------------------------
// S — surface suitability

export function surfaceComponent(ctx: ComponentContext): ComponentBuild {
  const { surface: sr, cfg, mode } = ctx
  const S = cfg.components.S
  const tags = sr.surface.tags.filter((t): t is ScoredSurfaceTag => t !== 'unknown')
  if (tags.length === 0) return missing(ctx, 'S', `Surface unknown — ${sr.surface.text.replace(/^Unknown — /, '')}`, { basis: sr.surface.basis })

  const primary = tags.length > 1 ? tags.filter((t) => t !== 'wind-affected') : tags
  const secondary = tags.filter((t) => !primary.includes(t))
  const baseValue = mean(primary.map((t) => S.base[mode][t]))
  const hardRuleNotes: string[] = []

  let freshAdj = 0
  const grooming = !!sr.management && (!!sr.management.groomingText || (isNum(sr.management.groomedRuns) && sr.management.groomedRuns > 0))
  if (primary.includes('fresh-snow')) {
    freshAdj = sr.freshSnowCm !== null ? evalCurve(S.freshSnowAdjustment[mode], sr.freshSnowCm) : 0
    if (mode === 'learning') {
      // Hard rule: fresh snow never raises a learning-day surface score.
      freshAdj = Math.min(0, freshAdj)
      if (freshAdj < 0 && grooming) freshAdj *= 1 - S.learningGroomedMitigation
      hardRuleNotes.push(
        freshAdj < 0
          ? 'Deep fresh snow lowered the learning-day surface score (ungroomed snow is harder for beginners)'
          : 'Fresh snow earned no learning-day surface bonus (packed, groomed-friendly surfaces score highest for beginners)',
      )
    }
  }
  const secondaryAdj = secondary.reduce((acc, t) => acc + (S.secondaryAdjustment[t] ?? 0), 0)
  let value = clamp(baseValue + freshAdj + secondaryAdj, 0, 100)
  const inferred = sr.surface.basis === 'inferred'
  let capped = false
  if (inferred && value > S.inferredCap) {
    value = S.inferredCap
    capped = true
  }
  const factor = inferred ? cfg.weightFactors.inferredSurface : 1

  const f = makeFormatters(ctx.units)
  let note: string
  if (sr.surface.basis === 'reported') {
    const r = ctx.report
    const source = r?.kind === 'manual' ? 'manual entry' : r?.kind === 'demo' ? 'demo report' : 'official report'
    const when = r?.reportedAt ? localTimeLabel(r.reportedAt, ctx.timezone, ctx.date) : 'time not stated'
    const fresh = sr.freshSnowCm !== null && primary.includes('fresh-snow') ? `; ${f.snow(sr.freshSnowCm)} new snow reported` : ''
    note = `Surface: ${sr.surface.text} (${source} ${when}${sr.reportAgeHours !== null ? `, ${ageLabel(sr.reportAgeHours)} old` : ''}${fresh})`
  } else if (sr.surface.basis === 'personal') {
    note = `Surface: ${tagsText(tags)} (my feedback)`
  } else {
    note = `Surface: ${sr.surface.text.split('. ')[0]} (inferred from modeled weather; counts at reduced weight)`
  }
  return {
    component: {
      key: 'S',
      value: Math.round(value),
      weight: nominal(ctx, 'S') * factor,
      included: true,
      inputs: {
        tags: tags.join(','),
        basis: sr.surface.basis,
        baseValue: r1(baseValue),
        freshSnowCm: sr.freshSnowCm,
        freshSnowSource: sr.freshSnowSource,
        freshAdjustment: r1(freshAdj),
        secondaryAdjustment: secondaryAdj,
        groomingReported: grooming,
        inferredCapApplied: capped,
        weightFactor: factor,
        nominalWeight: nominal(ctx, 'S'),
      },
      note,
      proxy: null,
    },
    hardRuleNotes,
  }
}

// ---------------------------------------------------------------------------
// T — terrain availability

export function terrainComponent(ctx: ComponentContext): ComponentBuild {
  const T = ctx.cfg.components.T
  if (ctx.terrainUnknownReason) return missing(ctx, 'T', ctx.terrainUnknownReason)
  const r = ctx.report
  if (!r) return missing(ctx, 'T', 'No terrain report — open terrain unknown (never assumed open)')
  if (r.localDate !== ctx.date) {
    return missing(ctx, 'T', `Latest terrain report is for ${formatLocalDate(r.localDate)}; terrain for this date not reported`, { reportDate: r.localDate })
  }
  const at = r.reportedAt
  if (at) {
    const age = Math.max(0, hoursBetween(at, ctx.referenceAt))
    if (age > T.reportMaxAgeHours) return missing(ctx, 'T', `Terrain report is ${ageLabel(age)} old — too old to use`, { reportAgeHours: r1(age) })
  }
  const when = at ? `reported ${localTimeLabel(at, ctx.timezone, ctx.date)}` : `report for ${r.localDate}, time not stated`
  const ratio = (open: number | null, total: number | null) => (isNum(open) && isNum(total) && total > 0 ? clamp(open / total, 0, 1) : null)

  const build = (value: number, note: string, inputs: ConditionsComponent['inputs'], proxy: string | null): ComponentBuild => {
    const factor = proxy ? ctx.cfg.weightFactors.proxy : 1
    return {
      component: {
        key: 'T',
        value: Math.round(value),
        weight: nominal(ctx, 'T') * factor,
        included: true,
        inputs: { ...inputs, weightFactor: factor, nominalWeight: nominal(ctx, 'T') },
        note,
        proxy,
      },
      hardRuleNotes: [],
    }
  }

  if (ctx.mode === 'learning') {
    const br = ratio(r.openBeginnerTrails, r.totalBeginnerTrails)
    if (br !== null) {
      return build(evalCurve(T.ratioCurve, br), `Beginner terrain: ${r.openBeginnerTrails} of ${r.totalBeginnerTrails} trails open (${when})`, { openBeginnerTrails: r.openBeginnerTrails, totalBeginnerTrails: r.totalBeginnerTrails, ratio: r1(br * 100) / 100 }, null)
    }
    if (isNum(r.openBeginnerTrails)) {
      return build(evalCurve(T.beginnerCountCurve, r.openBeginnerTrails), `Beginner terrain: ${r.openBeginnerTrails} trails open, total not reported (${when})`, { openBeginnerTrails: r.openBeginnerTrails, totalBeginnerTrails: null }, null)
    }
    const tr = ratio(r.openTrails, r.totalTrails)
    if (tr !== null) {
      return build(
        evalCurve(T.ratioCurve, tr),
        `Beginner terrain not reported; ${r.openTrails} of ${r.totalTrails} trails open overall (${when}) used as a proxy`,
        { openTrails: r.openTrails, totalTrails: r.totalTrails, ratio: r1(tr * 100) / 100 },
        'Whole-mountain open-trail share (beginner trail counts not reported)',
      )
    }
    const lr = ratio(r.openLifts, r.totalLifts)
    if (lr !== null) {
      return build(
        evalCurve(T.ratioCurve, lr),
        `Beginner terrain not reported; ${r.openLifts} of ${r.totalLifts} lifts open (${when}) used as a proxy`,
        { openLifts: r.openLifts, totalLifts: r.totalLifts, ratio: r1(lr * 100) / 100 },
        'Open-lift share (no trail counts reported)',
      )
    }
    return missing(ctx, 'T', `Report (${when}) has no terrain counts — open terrain unknown`)
  }

  const tr = ratio(r.openTrails, r.totalTrails)
  if (tr !== null) {
    return build(evalCurve(T.ratioCurve, tr), `Terrain: ${r.openTrails} of ${r.totalTrails} trails open (${when})`, { openTrails: r.openTrails, totalTrails: r.totalTrails, ratio: r1(tr * 100) / 100 }, null)
  }
  const lr = ratio(r.openLifts, r.totalLifts)
  if (lr !== null) {
    return build(
      evalCurve(T.ratioCurve, lr),
      `Terrain: ${r.openLifts} of ${r.totalLifts} lifts open (${when}); trail counts not reported`,
      { openLifts: r.openLifts, totalLifts: r.totalLifts, ratio: r1(lr * 100) / 100 },
      'Open-lift share (no trail counts reported)',
    )
  }
  return missing(ctx, 'T', `Report (${when}) has no terrain counts — open terrain unknown`)
}

// ---------------------------------------------------------------------------
// W — wind comfort

export function windComponent(ctx: ComponentContext): ComponentBuild {
  const W = ctx.cfg.components.W
  const pick = ctx.wind
  if (!pick) return missing(ctx, 'W', `No wind data for lift hours (${ctx.windowLabel})`)
  const slots = windowSlots(ctx, pick)
  let peak: number | null = null
  let peakSustained: number | null = null
  let peakGust: number | null = null
  let hours = 0
  for (const s of slots) {
    const w = s.point.windKmh
    const g = s.point.gustKmh
    if (!isNum(w) && !isNum(g)) continue
    hours++
    const eff = Math.max(isNum(w) ? w : 0, isNum(g) ? g * W.gustWeight : 0)
    peak = peak === null ? eff : Math.max(peak, eff)
    if (isNum(w)) peakSustained = peakSustained === null ? w : Math.max(peakSustained, w)
    if (isNum(g)) peakGust = peakGust === null ? g : Math.max(peakGust, g)
  }
  if (peak === null) return missing(ctx, 'W', `No wind values at the ${pick.pointKey} point for lift hours (${ctx.windowLabel})`)
  const f = makeFormatters(ctx.units)
  const where = pick.fallback
    ? `${pick.pointKey} (no ${pick.preferredKey} data; upper-mountain wind is often stronger)`
    : pick.pointKey
  const detail = [peakSustained !== null ? `sustained ${f.speed(peakSustained)}` : null, peakGust !== null ? `gusts ${f.speed(peakGust)}` : null]
    .filter(Boolean)
    .join(', ')
  return {
    component: {
      key: 'W',
      value: Math.round(evalCurve(W.curve, peak)),
      weight: nominal(ctx, 'W'),
      included: true,
      inputs: {
        point: pick.pointKey,
        fallbackPoint: pick.fallback,
        peakEffectiveKmh: r1(peak),
        peakSustainedKmh: peakSustained,
        peakGustKmh: peakGust,
        gustWeight: W.gustWeight,
        hours,
        nominalWeight: nominal(ctx, 'W'),
      },
      note: `Wind at ${where}: peak ${f.speed(peak)} effective (${detail}), ${ctx.windowLabel} — ${kindWord(pick.kind)}${hoursSuffix(ctx, hours)}`,
      proxy: null,
    },
    hardRuleNotes: [],
  }
}

// ---------------------------------------------------------------------------
// V — visibility

export function visibilityComponent(ctx: ComponentContext): ComponentBuild {
  const V = ctx.cfg.components.V
  const pick = ctx.visibility
  if (!pick) return missing(ctx, 'V', `No visibility data for lift hours (${ctx.windowLabel})`)
  const slots = windowSlots(ctx, pick)
  const f = makeFormatters(ctx.units)
  const vis = values(slots, 'visibilityM')
  if (vis.length > 0) {
    const score = mean(vis.map((v) => evalCurve(V.curve, v)))
    const meanVis = mean(vis)
    return {
      component: {
        key: 'V',
        value: Math.round(score),
        weight: nominal(ctx, 'V'),
        included: true,
        inputs: { point: pick.pointKey, fallbackPoint: pick.fallback, meanVisibilityM: Math.round(meanVis), minVisibilityM: Math.min(...vis), hours: vis.length, nominalWeight: nominal(ctx, 'V') },
        note: `Visibility at ${pointLabel(pick)}: mean ${f.visibility(meanVis)}, lowest ${f.visibility(Math.min(...vis))} in lift hours — ${kindWord(pick.kind)}${hoursSuffix(ctx, vis.length)}`,
        proxy: null,
      },
      hardRuleNotes: [],
    }
  }
  // Labelled proxy: cloud cover with a precipitation penalty. Never a silent neutral value.
  const hourly: number[] = []
  let precipHours = 0
  for (const s of slots) {
    const c = s.point.cloudCoverPct
    if (!isNum(c)) continue
    let v = evalCurve(V.proxy.cloudCurve, c)
    const p = s.point.precipitationMm
    if (isNum(p) && p >= V.proxy.precipMmPerHour) {
      v -= V.proxy.precipPenalty
      precipHours++
    }
    hourly.push(clamp(v, 0, 100))
  }
  if (hourly.length === 0) return missing(ctx, 'V', `No visibility or cloud-cover data for lift hours (${ctx.windowLabel})`)
  const cloud = values(slots, 'cloudCoverPct')
  const factor = ctx.cfg.weightFactors.proxy
  return {
    component: {
      key: 'V',
      value: Math.round(mean(hourly)),
      weight: nominal(ctx, 'V') * factor,
      included: true,
      inputs: { point: pick.pointKey, meanCloudPct: Math.round(mean(cloud)), precipHours, hours: hourly.length, weightFactor: factor, nominalWeight: nominal(ctx, 'V') },
      note: `Visibility estimated from cloud cover (mean ${Math.round(mean(cloud))}%)${precipHours ? ` and ${precipHours} h of precipitation` : ''} — proxy, no visibility data`,
      proxy: 'Cloud cover and precipitation (no visibility data)',
    },
    hardRuleNotes: [],
  }
}

// ---------------------------------------------------------------------------
// C — temperature comfort

/** Environment Canada / NWS wind chill (°C, km/h). Returns the air temperature outside the formula's range. */
export function windChillC(tempC: number, windKmh: number, cfg: ConditionsConfig): number {
  const { maxTempC, minWindKmh } = cfg.components.C.windChill
  if (tempC > maxTempC || windKmh < minWindKmh) return tempC
  const v = windKmh ** 0.16
  return 13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v
}

export function comfortComponent(ctx: ComponentContext): ComponentBuild {
  const C = ctx.cfg.components.C
  const pick = ctx.comfort
  if (!pick) return missing(ctx, 'C', `No temperature data for lift hours (${ctx.windowLabel})`)
  const slots = windowSlots(ctx, pick)
  const feels: number[] = []
  let computed = 0
  let plain = 0
  for (const s of slots) {
    const a = s.point.apparentTemperatureC
    const t = s.point.temperatureC
    const w = s.point.windKmh
    if (isNum(a)) feels.push(a)
    else if (isNum(t) && isNum(w)) {
      feels.push(windChillC(t, w, ctx.cfg))
      computed++
    } else if (isNum(t)) {
      feels.push(t)
      plain++
    }
  }
  if (feels.length === 0) return missing(ctx, 'C', `No temperature values at the ${pick.pointKey} point for lift hours (${ctx.windowLabel})`)
  const f = makeFormatters(ctx.units)
  const proxy = plain > 0 ? `Air temperature without wind chill for ${plain} h` : null
  const factor = proxy ? ctx.cfg.weightFactors.proxy : 1
  const source = computed > 0 ? ` (wind chill computed from temperature and wind for ${computed} h)` : ''
  const avg = mean(feels)
  return {
    component: {
      key: 'C',
      value: Math.round(mean(feels.map((v) => evalCurve(C.curve, v)))),
      weight: nominal(ctx, 'C') * factor,
      included: true,
      inputs: {
        point: pick.pointKey,
        fallbackPoint: pick.fallback,
        meanFeelsLikeC: r1(avg),
        coldestFeelsLikeC: r1(Math.min(...feels)),
        computedWindChillHours: computed,
        plainTemperatureHours: plain,
        hours: feels.length,
        weightFactor: factor,
        nominalWeight: nominal(ctx, 'C'),
      },
      note: `Feels like ${f.temp(avg)} on average at ${pointLabel(pick)} in lift hours (coldest ${f.temp(Math.min(...feels))})${source} — ${kindWord(pick.kind)}${hoursSuffix(ctx, feels.length)}`,
      proxy,
    },
    hardRuleNotes: [],
  }
}
