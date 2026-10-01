/**
 * Simulated official-style daily snow reports (pure — no database).
 *
 * Every report is derived from the simulated truth series at a mid-mountain "study plot" (mean of base and summit):
 * - Snowfall windows (overnight, 24 h, 48 h, 7 days) are each summed directly from the hourly truth over their own
 *   stated window (preceding-hour stamps in (start, end]) — nested windows, never built by adding other reports, so
 *   nothing is double counted. A window that would start before the tracking start is omitted, not guessed.
 * - Amounts are rounded to whole inches (how US resorts report) with the source wording kept in `sourceText`.
 * - Base depth evolves (settled new snow, early-season snowmaking, rain/thaw losses); surface tags and wording follow
 *   the recent weather (fresh snow, refreeze after the thaw, wet snow, wind), grooming and snowmaking are separate
 *   statements, open terrain ramps up after opening.
 * - ~10% of days have no report, Holiday Valley has a 4-day outage, and a few days get an 11:00 revision: that
 *   morning's report has terrain on a delayed start (or a storm hold) and the revision opens it, so the update adds
 *   what its note says; snow that fell since the morning report is mentioned too.
 * - Trail/lift/beginner totals come from the catalog; a total the catalog lacks is a simulated profile value, and the
 *   report says exactly which ones.
 */
import { addDays as addDaysRaw, daysBetween as daysBetweenRaw, localTimeToInstant } from '@/lib/domain/time'
import type { OperatingStatus, SnowfallReading, SurfaceTag } from '@/lib/domain/types'
import type { ParsedReport } from '@/lib/providers/types'
import { rng } from './prng'
import { CLOSED_TODAY, DEMO_TODAY, REVISIONS, TRACKING_START, type DemoResortProfile } from './scenario'
import { HOUR_MS, stampIndex, sumWindow, type ResortTruth } from './weather'

export type TerrainTotalKey = 'trails' | 'lifts' | 'beginnerTrails'

export interface TerrainTotals {
  trails: number
  lifts: number
  beginnerTrails: number
  /** True when any total came from the demo profile because the catalog has no count. */
  simulated: boolean
  /** Exactly which totals are simulated (the others are catalog counts). */
  simulatedFields: TerrainTotalKey[]
}

export interface CatalogTerrain {
  trails: number | null
  lifts: number | null
  beginnerPct: number | null
}

/** Catalog counts win; missing ones fall back to the profile's simulated totals (and say so). */
export function terrainTotals(catalog: CatalogTerrain | null, profile: DemoResortProfile): TerrainTotals {
  const trails = catalog?.trails ?? null
  const lifts = catalog?.lifts ?? null
  const beginner = trails !== null && catalog?.beginnerPct != null ? Math.round((trails * catalog.beginnerPct) / 100) : null
  const simulatedFields: TerrainTotalKey[] = []
  if (trails === null) simulatedFields.push('trails')
  if (lifts === null) simulatedFields.push('lifts')
  if (beginner === null) simulatedFields.push('beginnerTrails')
  return {
    trails: trails ?? profile.simTerrain.trails,
    lifts: lifts ?? profile.simTerrain.lifts,
    beginnerTrails: beginner ?? profile.simTerrain.beginnerTrails,
    simulated: simulatedFields.length > 0,
    simulatedFields,
  }
}

const TOTAL_LABEL: Record<TerrainTotalKey, string> = { trails: 'trail', lifts: 'lift', beginnerTrails: 'beginner-trail' }

/** "Beginner-trail total is simulated (the catalog has no count)" — names only the totals that are simulated. */
export function simulatedTotalsText(t: Pick<TerrainTotals, 'simulatedFields'>): string | null {
  const names = t.simulatedFields.map((f) => TOTAL_LABEL[f])
  if (!names.length) return null
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${list[0].toUpperCase()}${list.slice(1)} ${names.length === 1 ? 'total is' : 'totals are'} simulated (the catalog has no count)`
}

export interface SimReport {
  resortId: string
  localDate: string
  revision: number
  reportedAt: string
  fetchedAt: string
  report: ParsedReport
}

export interface StudyPlot {
  snow: number[]
  rain: number[]
  tempBase: number[]
  gustSummit: number[]
}

export function studyPlot(truth: ResortTruth): StudyPlot {
  const base = truth.points.get('base') ?? truth.points.get('summit')!
  const summit = truth.points.get('summit') ?? base
  const n = truth.stampMs.length
  const snow = new Array<number>(n)
  const rain = new Array<number>(n)
  const tempBase = new Array<number>(n)
  const gustSummit = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const b = base.hourly[i]
    const s = summit.hourly[i]
    snow[i] = ((b.snowfallCm ?? 0) + (s.snowfallCm ?? 0)) / 2
    rain[i] = ((b.rainMm ?? 0) + (s.rainMm ?? 0)) / 2
    tempBase[i] = b.temperatureC ?? 0
    gustSummit[i] = s.gustKmh ?? 0
  }
  return { snow, rain, tempBase, gustSummit }
}

const inches = (cm: number) => Math.round(cm / 2.54)
const cmOfInches = (n: number) => Math.round(n * 2.54 * 10) / 10
const isoOf = (ms: number) => new Date(ms).toISOString()

/** Memoised wrappers: the same few dates and wall times recur for every resort and day. */
function memo<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const cache = new Map<string, R>()
  return (...args: A) => {
    const key = args.join('|')
    let v = cache.get(key)
    if (v === undefined) {
      v = fn(...args)
      cache.set(key, v)
    }
    return v
  }
}
const addDays = memo(addDaysRaw)
const daysBetween = memo(daysBetweenRaw)
/** UTC ms of a resort-local wall time on a date (Luxon, memoised). */
const at = memo((date: string, hhmm: string, tz: string) => Date.parse(localTimeToInstant(date, hhmm, tz)))

/** Days whose reports are never "missing" (they anchor stories elsewhere in the demo). */
const KEY_DAYS: Record<string, readonly string[]> = {
  'greek-peak': ['2026-12-19', '2027-01-02', '2027-01-09', '2027-01-10', '2027-01-11', '2027-01-12', '2027-01-13', '2027-01-14'],
  'labrador-mountain': ['2026-12-28', '2027-01-10'],
  alta: ['2027-01-12', '2027-01-13', '2027-01-14'],
  'jay-peak': ['2027-01-11', '2027-01-14'],
}

/** Storm holds reported at 06:30 (upper lifts closed for avalanche mitigation). */
const HOLDS: readonly { resortId: string; date: string }[] = [
  { resortId: 'alta', date: '2027-01-14' },
  { resortId: 'snowbird', date: '2027-01-14' },
]

const THAW_DAYS = new Set(['2027-01-11', '2027-01-12', '2027-01-13'])

interface Surface {
  tags: SurfaceTag[]
  text: string
}

function describeSurface(
  east: boolean,
  s: { snow24: number; snow48: number; rain72: number; rain12: number; thaw72: number; frozenRun: number; t06: number; gust24: number; refrozeRecently: boolean; earlySeason: boolean },
): { surface: Surface; refroze: boolean } {
  const wetRecent = s.rain72 >= 1 || s.thaw72 >= 3
  if (wetRecent && s.frozenRun >= 4 && s.snow24 < 5) {
    const icy = s.rain72 >= 3 || s.thaw72 >= 8
    return {
      surface: icy
        ? { tags: ['icy-refrozen', 'firm'], text: east ? 'Frozen granular and hardpack; icy patches' : 'Firm and refrozen; icy in places' }
        : { tags: ['firm'], text: east ? 'Hardpack' : 'Firm' },
      refroze: true,
    }
  }
  if (wetRecent && (s.t06 >= 0.5 || s.rain12 >= 1)) {
    return { surface: { tags: ['wet-slushy'], text: east ? 'Wet granular — soft and heavy' : 'Wet snow, spring-like' }, refroze: false }
  }
  if (s.snow24 >= 5 || (s.snow48 >= 20 && !wetRecent)) {
    if (!east && s.snow24 >= 15) return { surface: { tags: ['fresh-snow'], text: 'Powder' }, refroze: false }
    return { surface: { tags: ['fresh-snow', 'packed-powder'], text: east ? 'New snow over packed powder' : 'Powder, packed powder' }, refroze: false }
  }
  if (s.gust24 >= 70) return { surface: { tags: ['wind-affected', 'packed-powder'], text: 'Wind-packed and variable up high; packed powder lower down' }, refroze: false }
  if (s.refrozeRecently && s.snow48 < 8) {
    return { surface: { tags: ['firm', 'packed-powder'], text: east ? 'Packed powder over a firm base' : 'Packed powder, firm in spots' }, refroze: false }
  }
  if (east && s.earlySeason) return { surface: { tags: ['packed-powder', 'firm'], text: 'Machine groomed; packed powder, firm in spots' }, refroze: false }
  return { surface: { tags: ['packed-powder'], text: east ? 'Machine groomed, packed powder' : 'Packed powder' }, refroze: false }
}

/**
 * Daily reports for one simulated resort from its opening (or the tracking start) to DEMO day.
 * Returns revision-1 reports plus any 11:00 revisions, in chronological order.
 */
export function simulateReports(truth: ResortTruth, profile: DemoResortProfile, totals: TerrainTotals): SimReport[] {
  if (!profile.opening) return []
  const tz = truth.tz
  const east = profile.region === 'east'
  const plot = studyPlot(truth)
  const firstDay = profile.opening > TRACKING_START ? profile.opening : TRACKING_START
  const out: SimReport[] = []
  const r = rng(`reports|${profile.id}`)
  const keyDays = new Set([firstDay, DEMO_TODAY, ...(KEY_DAYS[profile.id] ?? []), ...REVISIONS.filter((x) => x.resortId === profile.id).map((x) => x.date)])

  let baseCm = profile.baseDepthStartCm + (profile.opening < TRACKING_START ? 1.2 * daysBetween(profile.opening, TRACKING_START) : 0)
  let lastRefreeze: string | null = null
  let seasonSnow = 0

  for (let d = firstDay; d <= DEMO_TODAY; d = addDays(d, 1)) {
    const dayIdx = daysBetween(profile.opening, d)
    const t06 = at(d, '06:00', tz)
    const win = (fromDay: string, fromHm: string, values: readonly number[]) => sumWindow(truth, values, at(fromDay, fromHm, tz), t06)
    const snowOvernight = win(addDays(d, -1), '16:00', plot.snow)
    const snow24 = win(addDays(d, -1), '06:00', plot.snow)
    const snow48 = win(addDays(d, -2), '06:00', plot.snow)
    const snow7d = win(addDays(d, -7), '06:00', plot.snow)
    const rain24 = win(addDays(d, -1), '06:00', plot.rain) ?? 0
    const rain12 = sumWindow(truth, plot.rain, t06 - 12 * HOUR_MS, t06) ?? 0
    const rain72 = win(addDays(d, -3), '06:00', plot.rain) ?? rain24

    // Thaw hours, last wet hour and the freeze since, from the base temperatures of the last 72 h.
    const end = stampIndex(truth, t06)
    const start = Math.max(0, end - 71)
    let thaw72 = 0
    let thaw24 = 0
    let lastWet = -1
    for (let i = start; i <= end; i++) {
      const warm = plot.tempBase[i] >= 1
      if (warm) {
        thaw72++
        if (i > end - 24) thaw24++
      }
      if (warm || plot.rain[i] >= 0.2) lastWet = i
    }
    let frozenRun = 0
    for (let i = end; i > lastWet && i >= start; i--) {
      if (plot.tempBase[i] <= -2) frozenRun++
      else break
    }
    let nightMin = Infinity
    let nightMax = -Infinity
    for (let i = Math.max(0, end - 10); i <= end; i++) {
      nightMin = Math.min(nightMin, plot.tempBase[i])
      nightMax = Math.max(nightMax, plot.tempBase[i])
    }
    let gust24 = 0
    for (let i = Math.max(0, end - 23); i <= end; i++) gust24 = Math.max(gust24, plot.gustSummit[i])

    // Base depth evolves every day, reported or not.
    if (d !== firstDay) {
      const making = east && profile.snowmaking && nightMin <= -3 && (dayIdx < 40 || THAW_DAYS.has(addDays(d, -1)))
      baseCm += 0.3 * (snow24 ?? 0) + (making ? 2.5 : 0) - 0.7 * rain24 - 0.3 * thaw24 - 0.25
      baseCm = Math.max(east ? 15 : 40, baseCm)
    }
    seasonSnow += snow24 ?? 0

    const refrozeRecently = lastRefreeze !== null && daysBetween(lastRefreeze, d) <= 4
    const { surface, refroze } = describeSurface(east, {
      snow24: snow24 ?? 0,
      snow48: snow48 ?? snow24 ?? 0,
      rain72,
      rain12,
      thaw72,
      frozenRun,
      t06: plot.tempBase[end],
      gust24,
      refrozeRecently,
      earlySeason: dayIdx < 10,
    })
    if (refroze) lastRefreeze = d

    const missing =
      !keyDays.has(d) &&
      ((profile.gap && d >= profile.gap.from && d <= profile.gap.to) || rng(`missing|${profile.id}|${d}`).chance(0.1))
    if (missing) continue

    // Terrain.
    const closed = profile.id === CLOSED_TODAY.resortId && d === CLOSED_TODAY.date
    const hold = HOLDS.some((h) => h.resortId === profile.id && h.date === d)
    const rev = closed ? null : (REVISIONS.find((x) => x.resortId === profile.id && x.date === d) ?? null)
    let frac = east ? Math.min(totals.trails <= 40 ? 0.96 : 0.92, 0.12 + 0.035 * dayIdx) : Math.min(0.97, 0.35 + 0.03 * dayIdx)
    frac += Math.min(0.08, seasonSnow / 500)
    if (east && THAW_DAYS.has(d)) frac -= 0.12
    if (east && d === '2027-01-14') frac -= 0.06
    frac = Math.max(0.08, Math.min(0.99, frac + r.uniform(-0.015, 0.015)))
    let openTrails = Math.max(1, Math.round(frac * totals.trails))
    let openLifts = Math.max(1, Math.round(Math.min(1, frac * 1.1 + 0.08) * totals.lifts))
    let openBeginner = Math.max(1, Math.round(Math.min(1, frac * 1.6 + 0.25) * totals.beginnerTrails))
    if (hold) {
      openTrails = Math.round(totals.trails * 0.5)
      openLifts = Math.max(1, Math.ceil(totals.lifts * 0.45))
    } else if (rev) {
      // The 11:00 update opens what the morning report held back (delayed start), so it adds what its note says.
      openTrails = Math.max(1, openTrails - rev.extraTrails)
      openLifts = Math.max(1, openLifts - rev.extraLifts)
    }
    if (closed) {
      openTrails = 0
      openLifts = 0
      openBeginner = 0
    }
    const status: OperatingStatus = closed ? 'temporarily-closed' : dayIdx < profile.partialDays ? 'partially-open' : 'open'

    const groomedRuns = closed ? null : hold ? Math.max(1, Math.round(openTrails * 0.2)) : Math.max(1, Math.round(openTrails * r.uniform(0.35, 0.6)))
    const groomingText = closed
      ? null
      : hold
        ? `Limited grooming during the storm: ${groomedRuns} lower-mountain runs groomed`
        : `${groomedRuns} trails groomed overnight`
    let snowmakingText: string | null = null
    if (east && profile.snowmaking && !closed) {
      if (nightMin <= -3 && (dayIdx < 40 || THAW_DAYS.has(addDays(d, -1)))) snowmakingText = `Snowmaking overnight on ${Math.max(2, Math.round(openTrails * 0.15))} trails`
      else if (nightMax > 0.5) snowmakingText = 'No snowmaking overnight — too warm'
    } else if (!east && dayIdx < 20 && !closed) {
      snowmakingText = 'Snowmaking on lower-mountain runs'
    }

    const snowfall: SnowfallReading[] = []
    const reading = (window: SnowfallReading['window'], cm: number | null, fromMs: number) => {
      if (cm === null) return
      const n = inches(cm)
      snowfall.push({ window, amountCm: cmOfInches(n), startAt: isoOf(fromMs), endAt: isoOf(t06), sourceText: `${n}"` })
    }
    reading('overnight', snowOvernight, at(addDays(d, -1), '16:00', tz))
    reading('24h', snow24, at(addDays(d, -1), '06:00', tz))
    reading('48h', snow48, at(addDays(d, -2), '06:00', tz))
    reading('7d', snow7d, at(addDays(d, -7), '06:00', tz))

    const baseIn = inches(baseCm)
    const totalsText = simulatedTotalsText(totals)
    const notes = [
      'Simulated report (demo data).',
      totalsText ? `${totalsText}.` : null,
      hold ? 'Upper-mountain lifts on hold for avalanche mitigation.' : null,
      rev && !hold ? rev.morningNote : null,
      closed ? 'Closed today: high winds (summit gusts over 60 mph) on top of Monday’s rain and refreeze. We plan to reopen Saturday, conditions permitting.' : null,
    ]
      .filter(Boolean)
      .join(' ')
    const minuteJitter = r.int(-12, 15)
    const reportedMs = at(d, '06:30', tz) + minuteJitter * 60_000
    const report: ParsedReport = {
      localDate: d,
      reportedAt: isoOf(reportedMs),
      status,
      snowfall,
      baseDepthCm: cmOfInches(baseIn),
      baseDepthLocation: east ? 'Average base depth' : 'Base',
      summitDepthCm: east ? null : cmOfInches(inches(baseCm * 1.3 + 10)),
      surfaceTags: closed ? [] : surface.tags,
      surfaceText: closed ? null : surface.text,
      groomingText,
      groomedRuns,
      snowmakingText,
      openTrails,
      totalTrails: totals.trails,
      openLifts,
      totalLifts: totals.lifts,
      openBeginnerTrails: openBeginner,
      totalBeginnerTrails: totals.beginnerTrails,
      openAcres: null,
      notes,
    }
    out.push({ resortId: profile.id, localDate: d, revision: 1, reportedAt: report.reportedAt!, fetchedAt: isoOf(reportedMs + 4 * 60_000), report })

    if (rev) {
      const revMs = at(d, '11:00', tz)
      // Snow at the study plot since the morning report's windows ended (06:00): the update says so, and a surface
      // reported before it started snowing becomes new snow over what was there.
      const snowSince = sumWindow(truth, plot.snow, t06, revMs) ?? 0
      const snowedIn = snowSince >= 2.54 && !report.surfaceTags.includes('fresh-snow')
      const firmBelow = report.surfaceTags.some((t) => t === 'firm' || t === 'icy-refrozen')
      const updated: ParsedReport = {
        ...report,
        reportedAt: isoOf(revMs),
        openLifts: Math.min(totals.lifts, openLifts + rev.extraLifts),
        openTrails: Math.min(hold ? Math.round(totals.trails * 0.97) : totals.trails, openTrails + rev.extraTrails),
        surfaceTags: snowedIn ? ['fresh-snow', firmBelow ? 'firm' : 'packed-powder'] : report.surfaceTags,
        surfaceText: snowedIn ? (firmBelow ? 'New snow over a firm base' : east ? 'New snow over packed powder' : 'Powder, packed powder') : report.surfaceText,
        notes: [notes, rev.note, snowSince >= 2.54 ? `Snowing since the morning report: about ${inches(snowSince)}" so far.` : null].filter(Boolean).join(' '),
      }
      out.push({ resortId: profile.id, localDate: d, revision: 2, reportedAt: updated.reportedAt!, fetchedAt: isoOf(revMs + 3 * 60_000), report: updated })
    }
  }
  return out
}
