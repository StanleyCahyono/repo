import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { createMemoryDb, type Db } from '@/lib/db/client'
import * as s from '@/lib/db/schema'
import type { OperationalReportRow, WeatherRunRow } from '@/lib/db/rows'
import { CATALOG_PROVIDER, getMeta, loadCatalog, seedCatalog, setMeta } from '@/lib/catalog/seed'
import { aggregateDay, assessDay, prepareSeries } from '@/lib/domain/conditions'
import { defaultPreferences } from '@/lib/domain/defaults'
import { addDays, dateRange, localTimeToInstant, startOfLocalDay } from '@/lib/domain/time'
import { SCORING_MODES } from '@/lib/domain/types'
import { buildAssessInput } from '@/lib/jobs/assessments'
import { weatherLocalDate } from '@/lib/jobs/weather'
import type { HourlyWeather } from '@/lib/providers/types'
import { evidenceAt, type ResortTimeline, type StoredRun } from './assess'
import { ALTA_TRIP, GREEK_TRIP, INDY_PRODUCT } from './personal'
import { demoTableCounts, ensureDemoData, generateDemoData, type DemoSummary } from './generate'
import { DEMO_NOW, DEMO_RESORT_IDS, DEMO_TODAY, LAST_DATE, META_GENERATED, META_MARKER, NOT_OPEN_RESORT, TRACKING_START } from './scenario'

/** The earliest instant of 1 Dec in any simulated zone (New York). */
const TRACKING_START_INSTANT = startOfLocalDay(TRACKING_START, 'America/New_York')
const units = defaultPreferences(DEMO_NOW).units

let db: Db
let summary: DemoSummary

beforeAll(async () => {
  db = (await createMemoryDb()).db
  summary = await generateDemoData(db)
}, 120_000)

const sha = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex')

async function fingerprint(d: Db) {
  const runIds = (await d.select({ id: s.weatherRuns.id }).from(s.weatherRuns).orderBy(asc(s.weatherRuns.id))).map((r) => r.id)
  const sampleRuns = [runIds[0], runIds[Math.floor(runIds.length / 2)], runIds[runIds.length - 1]]
  return {
    counts: await demoTableCounts(d),
    reports: sha(await d.select().from(s.operationalReports).orderBy(asc(s.operationalReports.id))),
    status: sha(await d.select().from(s.statusEvents).orderBy(asc(s.statusEvents.id))),
    seasons: sha(await d.select().from(s.resortSeasons).orderBy(asc(s.resortSeasons.id))),
    assessments: sha(
      await d
        .select({ r: s.conditionsAssessments.resortId, d: s.conditionsAssessments.localDate, m: s.conditionsAssessments.mode, c: s.conditionsAssessments.computedAt, k: s.conditionsAssessments.scoreKind, v: s.conditionsAssessments.score, x: s.conditionsAssessments.explanation })
        .from(s.conditionsAssessments)
        .orderBy(asc(s.conditionsAssessments.id)),
    ),
    points: sha(await d.select().from(s.weatherPoints).where(inArray(s.weatherPoints.runId, sampleRuns)).orderBy(asc(s.weatherPoints.runId), asc(s.weatherPoints.validTime))),
    personal: sha([
      await d.select().from(s.tripItems).orderBy(asc(s.tripItems.id)),
      await d.select().from(s.alerts).orderBy(asc(s.alerts.id)),
      await d.select().from(s.skiDayLogs).orderBy(asc(s.skiDayLogs.id)),
      await d.select().from(s.fxRates),
      await d.select().from(s.expenses).orderBy(asc(s.expenses.id)),
    ]),
  }
}

describe('demo generator', () => {
  it('runs in bounded time with modest row counts', () => {
    // About 12 s on an idle 4-core machine; the generous ceiling catches runaway generation without failing on a
    // busy machine (parallel test files, builds). Row counts below are the real size guard.
    expect(summary.totalMs).toBeLessThan(60_000)
    const c = summary.counts
    expect(c.weather_points).toBeGreaterThan(100_000)
    expect(c.weather_points).toBeLessThan(250_000)
    expect(c.weather_runs).toBeGreaterThan(500)
    expect(c.operational_reports).toBeGreaterThan(600)
    expect(c.conditions_assessments).toBeGreaterThan(4000)
    expect(c.conditions_assessments).toBeLessThan(8000)
    expect(summary.simulatedResorts).toHaveLength(DEMO_RESORT_IDS.length)
  })

  it('is deterministic, and an interrupted earlier run is wiped and rebuilt identically', async () => {
    const other = (await createMemoryDb()).db
    // An interrupted demo generation: the demo marker plus stray rows (including an autoincrement table).
    await setMeta(other, META_MARKER, 'partial', DEMO_NOW)
    await other.insert(s.trips).values({ id: 'stray', name: 'stray', startDate: '2027-01-01', endDate: '2027-01-01', companions: [], createdAt: DEMO_NOW, updatedAt: DEMO_NOW })
    await other.insert(s.expenses).values({ date: '2027-01-01', category: 'other', label: 'stray', amountMinor: 1, currency: 'USD', createdAt: DEMO_NOW })
    await generateDemoData(other)
    expect(await fingerprint(other)).toEqual(await fingerprint(db))
  }, 120_000)

  it('records the tracking start and the generation marker', async () => {
    expect(await getMeta(db, 'tracking.start')).toBe(TRACKING_START)
    expect(await getMeta(db, META_GENERATED)).toBe(DEMO_NOW)
    expect(summary.untouchedResorts.length).toBeGreaterThanOrEqual(8)
  })

  it('labels every simulated row as demo', async () => {
    const runs = await db.select().from(s.weatherRuns)
    expect(runs.every((r) => r.kind === 'demo' && r.provider === 'demo' && r.prov.kind === 'demo' && r.prov.provider === 'Piste demo generator' && r.prov.note?.startsWith('Simulated'))).toBe(true)
    const reports = await db.select().from(s.operationalReports)
    expect(reports.every((r) => r.kind === 'demo' && r.prov.kind === 'demo' && r.prov.note?.startsWith('Simulated') && r.notes?.startsWith('Simulated report'))).toBe(true)
    expect((await db.select().from(s.conditionsAssessments)).every((a) => a.kind === 'demo')).toBe(true)
    expect((await db.select().from(s.statusEvents)).every((e) => e.prov.kind === 'demo')).toBe(true)
    expect((await db.select().from(s.openingDateHistory)).every((h) => h.prov?.kind === 'demo')).toBe(true)
    const seasons = await db.select().from(s.resortSeasons)
    for (const r of seasons) {
      if (r.actualOpening) expect(r.actualOpeningProv?.kind).toBe('demo')
      // An announced date is either simulated, or a real researched catalog fact kept with its catalog provenance.
      if (r.announcedOpening && r.announcedOpeningProv?.kind !== 'demo') expect(r.announcedOpeningProv?.provider).toBe(CATALOG_PROVIDER)
    }
    expect((await db.select().from(s.fxRates)).every((f) => f.kind === 'demo')).toBe(true)
    // Tables without a kind column say so in their text.
    expect((await db.select().from(s.trips)).every((t) => t.notes?.startsWith('Demo trip'))).toBe(true)
    expect((await db.select().from(s.tripItems)).every((i) => i.details.demo === true)).toBe(true)
    expect((await db.select().from(s.skiDayLogs)).every((l) => l.notes?.startsWith('Demo'))).toBe(true)
    expect((await db.select().from(s.expenses)).every((e) => e.notes?.startsWith('Demo'))).toBe(true)
    expect((await db.select().from(s.lessons)).every((l) => l.notes?.startsWith('Demo'))).toBe(true)
    expect((await db.select().from(s.passOwnership)).every((o) => o.notes?.startsWith('Demo'))).toBe(true)
    expect((await db.select().from(s.alerts)).every((a) => a.body.endsWith('Demo data — simulated.'))).toBe(true)
    // The catalog itself stays the real catalog: no demo price or catalog provenance was rewritten.
    expect((await db.select().from(s.priceSnapshots)).some((p) => p.quoteKind === 'demo' || p.prov.kind === 'demo')).toBe(false)
  })

  it('simulates nothing dated before the tracking start', async () => {
    for (const r of await db.select().from(s.weatherRuns)) expect(r.fetchedAt >= TRACKING_START_INSTANT).toBe(true)
    const [{ first }] = await db.select({ first: s.weatherPoints.localDate }).from(s.weatherPoints).orderBy(asc(s.weatherPoints.localDate)).limit(1)
    expect(first >= TRACKING_START).toBe(true)
    for (const r of await db.select().from(s.operationalReports)) {
      expect(r.localDate >= TRACKING_START && r.reportedAt! >= TRACKING_START_INSTANT).toBe(true)
      for (const w of r.snowfall) expect(w.startAt! >= TRACKING_START_INSTANT).toBe(true)
    }
    for (const e of await db.select().from(s.statusEvents)) expect(e.localDate >= TRACKING_START && e.effectiveAt >= TRACKING_START_INSTANT).toBe(true)
    for (const a of await db.select({ d: s.conditionsAssessments.localDate, c: s.conditionsAssessments.computedAt }).from(s.conditionsAssessments)) {
      expect(a.d >= TRACKING_START && a.c >= TRACKING_START_INSTANT).toBe(true)
    }
    for (const h of await db.select().from(s.openingDateHistory)) expect(h.changedAt >= TRACKING_START_INSTANT).toBe(true)
    for (const a of await db.select().from(s.alerts)) expect(a.firedAt >= TRACKING_START_INSTANT).toBe(true)
    for (const f of await db.select().from(s.fxRates)) expect(f.rateDate >= TRACKING_START).toBe(true)
    for (const l of await db.select().from(s.skiDayLogs)) expect(l.date >= TRACKING_START).toBe(true)
    for (const u of await db.select().from(s.passUsage)) expect(u.date >= TRACKING_START).toBe(true)
    for (const t of await db.select().from(s.trips)) expect(t.createdAt >= TRACKING_START_INSTANT).toBe(true)
    // The only earlier date is the pass purchase itself (a personal record), linked to its ownership.
    const early = (await db.select().from(s.expenses)).filter((e) => e.date < TRACKING_START)
    expect(early.map((e) => e.category)).toEqual(['pass'])
    expect(early[0].passOwnershipId).not.toBeNull()
  })

  it('never turns an announced opening into "open" (Song Mountain)', async () => {
    const events = await db.select().from(s.statusEvents).where(eq(s.statusEvents.resortId, NOT_OPEN_RESORT)).orderBy(asc(s.statusEvents.effectiveAt), asc(s.statusEvents.id))
    expect(events.length).toBeGreaterThan(0)
    expect(events.some((e) => e.status === 'open' || e.status === 'partially-open')).toBe(false)
    expect(events.at(-1)!.status).toBe('not-yet-open')
    // The day the announced date passed without an opening, Piste marked the status unknown.
    expect(events.some((e) => e.status === 'unknown' && e.prov.provider === 'Piste')).toBe(true)
    const [season] = await db.select().from(s.resortSeasons).where(eq(s.resortSeasons.resortId, NOT_OPEN_RESORT))
    expect(season.announcedOpening! < DEMO_TODAY).toBe(true)
    expect(season.actualOpening).toBeNull()
    expect(await db.select().from(s.operationalReports).where(eq(s.operationalReports.resortId, NOT_OPEN_RESORT))).toEqual([])
    const assessed = await db.select().from(s.conditionsAssessments).where(eq(s.conditionsAssessments.resortId, NOT_OPEN_RESORT))
    expect(assessed.some((a) => a.eligibility === 'eligible')).toBe(false)
  })

  it('leaves every catalog resort it does not simulate with no status at all', async () => {
    const withStatus = new Set((await db.select({ id: s.statusEvents.resortId }).from(s.statusEvents)).map((r) => r.id))
    const all = (await db.select({ id: s.resorts.id }).from(s.resorts)).map((r) => r.id)
    const none = all.filter((id) => !withStatus.has(id))
    // Computed from the catalog, so the count follows it as resorts are added.
    const unsimulated = loadCatalog()
      .resorts.map((r) => r.id)
      .filter((id) => !DEMO_RESORT_IDS.includes(id))
    expect(unsimulated.length).toBeGreaterThanOrEqual(8)
    expect(new Set(none)).toEqual(new Set(unsimulated))
    expect(new Set(none)).toEqual(new Set(summary.untouchedResorts))
    expect(await db.select().from(s.weatherRuns).where(inArray(s.weatherRuns.resortId, none))).toEqual([])
    expect(await db.select().from(s.conditionsAssessments).where(inArray(s.conditionsAssessments.resortId, none))).toEqual([])
  })

  it('keeps what was forecast then apart from what was later reported (Greek Peak)', async () => {
    const tz = 'America/New_York'
    const runs = await db
      .select()
      .from(s.weatherRuns)
      .where(and(eq(s.weatherRuns.resortId, 'greek-peak'), eq(s.weatherRuns.pointKey, 'base')))
      .orderBy(asc(s.weatherRuns.fetchedAt))
    const reports = await db.select().from(s.operationalReports).where(and(eq(s.operationalReports.resortId, 'greek-peak'), eq(s.operationalReports.revision, 1)))
    const byDate = new Map(reports.map((r) => [r.localDate, r]))
    const differs: string[] = []
    for (const date of dateRange('2026-12-02', '2027-01-14')) {
      const dayStart = startOfLocalDay(date, tz)
      const run = [...runs].reverse().find((r) => r.fetchedAt < dayStart)
      const next = byDate.get(addDays(date, 1))?.snowfall.find((w) => w.window === '24h')
      if (!run || !next) continue
      const pts = await db.select().from(s.weatherPoints).where(eq(s.weatherPoints.runId, run.id))
      const forecast = aggregateDay(prepareSeries(pts as HourlyWeather[], 'preceding-hour'), date, tz).snowfallCm ?? 0
      if (Math.abs(forecast - next.amountCm!) >= 5) differs.push(date)
    }
    expect(differs).toContain('2027-01-09')
  })

  it('never rates a beginner day higher because of fresh snow (Alta, 13–14 Jan storm)', async () => {
    const tz = 'America/Denver'
    const get = async (date: string, mode: 'learning' | 'powder', computedAt: string) =>
      (
        await db
          .select()
          .from(s.conditionsAssessments)
          .where(and(eq(s.conditionsAssessments.resortId, 'alta'), eq(s.conditionsAssessments.localDate, date), eq(s.conditionsAssessments.mode, mode), eq(s.conditionsAssessments.computedAt, computedAt)))
      )[0]
    const S = (a: { components: { key: string; value: number | null }[] }) => a.components.find((c) => c.key === 'S')!.value!
    const before = { learning: await get('2027-01-12', 'learning', localTimeToInstant('2027-01-12', '07:00', tz)), powder: await get('2027-01-12', 'powder', localTimeToInstant('2027-01-12', '07:00', tz)) }
    const after = { learning: await get(DEMO_TODAY, 'learning', DEMO_NOW), powder: await get(DEMO_TODAY, 'powder', DEMO_NOW) }
    expect(before.learning.surface.tags).toEqual(['packed-powder'])
    expect(after.learning.surface.tags).toContain('fresh-snow')
    expect(after.learning.surface.basis).toBe('reported')
    expect(after.learning.score!).toBeLessThanOrEqual(before.learning.score!)
    expect(S(after.learning)).toBeLessThan(S(before.learning))
    expect(S(after.powder)).toBeGreaterThan(S(before.powder))
    const stormDay = await get('2027-01-14', 'learning', localTimeToInstant('2027-01-14', '07:00', tz))
    expect(stormDay.score!).toBeLessThanOrEqual(before.learning.score!)
  })

  it('lets a confirmed closure override the score (Jay Peak, 15 Jan)', async () => {
    const rows = await db
      .select()
      .from(s.conditionsAssessments)
      .where(and(eq(s.conditionsAssessments.resortId, 'jay-peak'), eq(s.conditionsAssessments.localDate, DEMO_TODAY), eq(s.conditionsAssessments.computedAt, DEMO_NOW)))
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.scoreKind === 'closed' && r.score === null && r.eligibility === 'closed')).toBe(true)
  })

  it('assesses every simulated resort, every day from the tracking start to DEMO_NOW + 16 d, in all modes', async () => {
    const rows = await db.select({ r: s.conditionsAssessments.resortId, d: s.conditionsAssessments.localDate, m: s.conditionsAssessments.mode }).from(s.conditionsAssessments)
    const have = new Set(rows.map((x) => `${x.r}|${x.d}|${x.m}`))
    for (const id of summary.simulatedResorts) {
      for (const d of dateRange(TRACKING_START, LAST_DATE)) for (const m of SCORING_MODES) expect(have.has(`${id}|${d}|${m}`)).toBe(true)
    }
  })

  it('computes each assessment only from evidence that existed at the time', async () => {
    const reports = new Map((await db.select().from(s.operationalReports)).map((r) => [r.id, r]))
    const runs = new Map((await db.select().from(s.weatherRuns)).map((r) => [r.id, r]))
    const events = new Map((await db.select().from(s.statusEvents)).map((e) => [e.id, e]))
    const rows = await db.select().from(s.conditionsAssessments)
    let checked = 0
    for (const a of rows) {
      if (a.inputs.reportId !== null) {
        const r = reports.get(a.inputs.reportId)!
        expect((r.reportedAt ?? r.createdAt) <= a.computedAt).toBe(true)
        checked++
      }
      for (const id of a.inputs.weatherRunIds) expect(runs.get(id)!.fetchedAt <= a.computedAt).toBe(true)
      if (a.inputs.statusEventId !== null) expect(events.get(a.inputs.statusEventId)!.effectiveAt <= a.computedAt).toBe(true)
    }
    expect(checked).toBeGreaterThan(1000)
    // "What Piste estimated then" exists before the day starts wherever a daily forecast run existed.
    const early = rows.filter((a) => a.resortId === 'greek-peak' && a.localDate === '2027-01-09' && a.computedAt < startOfLocalDay('2027-01-09', 'America/New_York'))
    expect(early.map((a) => a.scoreKind)).toEqual(['weather-potential', 'weather-potential', 'weather-potential'])
  })

  it('stores runs with preceding-hour semantics, resort-local dates and the stated horizons', async () => {
    const runs = await db.select().from(s.weatherRuns).where(eq(s.weatherRuns.resortId, 'alta'))
    expect(runs.every((r) => r.intervalSemantics === 'preceding-hour' && r.status === 'ok')).toBe(true)
    const daily = runs.filter((r) => r.fetchedAt.endsWith('T11:00:00.000Z'))
    expect(daily).toHaveLength(dateRange(TRACKING_START, DEMO_TODAY).length * 2)
    expect(daily.every((r) => r.horizonDays === 8)).toBe(true)
    const latest = runs.filter((r) => r.fetchedAt === DEMO_NOW)
    expect(latest.map((r) => r.horizonDays)).toEqual([17, 17])
    const pts = await db.select().from(s.weatherPoints).where(eq(s.weatherPoints.runId, latest[0].id))
    expect(new Set(pts.map((p) => p.localDate)).has(LAST_DATE)).toBe(true)
    for (const p of pts.slice(0, 60)) expect(p.localDate).toBe(weatherLocalDate(p.validTime, 'preceding-hour', 'America/Denver'))
    // Resorts without daily runs only have the latest run.
    const holiday = await db.select().from(s.weatherRuns).where(eq(s.weatherRuns.resortId, 'holiday-valley'))
    expect(holiday.map((r) => r.fetchedAt)).toEqual([DEMO_NOW, DEMO_NOW])
  })

  it('creates the personal demo records', async () => {
    const [own] = await db.select().from(s.passOwnership)
    expect(own).toMatchObject({ productId: INDY_PRODUCT, holder: 'me', purchasedOn: '2026-09-20' })
    const passExpense = (await db.select().from(s.expenses)).filter((e) => e.passOwnershipId === own.id)
    expect(passExpense).toHaveLength(1)
    expect(passExpense[0].amountMinor).toBe(own.pricePaidMinor)
    expect((await db.select().from(s.passUsage)).map((u) => [u.resortId, u.date])).toEqual([
      ['greek-peak', '2026-12-19'],
      ['greek-peak', '2027-01-02'],
    ])

    const trips = await db.select().from(s.trips).orderBy(asc(s.trips.startDate))
    expect(trips.map((t) => [t.id, t.status, t.startDate, t.endDate])).toEqual([
      [GREEK_TRIP, 'booked', '2027-01-16', '2027-01-16'],
      [ALTA_TRIP, 'draft', '2027-02-13', '2027-02-17'],
    ])
    const alta = await db.select().from(s.tripItems).where(eq(s.tripItems.tripId, ALTA_TRIP))
    const flight = alta.find((i) => i.type === 'flight')!
    expect(flight).toMatchObject({ costKind: 'estimate', currency: 'USD' })
    expect(flight.costMaxMinor!).toBeGreaterThan(flight.costMinor!)
    expect(flight.details.origin).toBe('SYR')
    const lodging = alta.find((i) => i.type === 'lodging')!
    expect(lodging).toMatchObject({ costKind: 'estimate', costBasis: 'shared' })
    expect(lodging.costMaxMinor!).toBeGreaterThan(lodging.costMinor!)
    expect(await db.select().from(s.priceSnapshots).where(eq(s.priceSnapshots.subjectType, 'lodging'))).toEqual([])
    // Exactly one priced-item type is left unpriced (resort days are priced by the day basket, not as items).
    expect(alta.filter((i) => i.costMinor === null && i.type !== 'resort-day').map((i) => i.type)).toEqual(['lesson'])
    expect(alta.filter((i) => i.type === 'resort-day').map((i) => i.date)).toEqual(['2027-02-14', '2027-02-15', '2027-02-16'])
    const altaChecklist = await db.select().from(s.tripChecklist).where(eq(s.tripChecklist.tripId, ALTA_TRIP))
    expect(altaChecklist).toHaveLength((await db.select().from(s.checklistTemplates)).length)
    expect(altaChecklist.filter((c) => c.done)).toHaveLength(2)
    const greek = await db.select().from(s.tripItems).where(eq(s.tripItems.tripId, GREEK_TRIP))
    expect(greek.map((i) => i.type).sort()).toEqual(['drive', 'food', 'lift-ticket', 'rental', 'resort-day'])

    const logs = await db.select().from(s.skiDayLogs).orderBy(asc(s.skiDayLogs.date))
    expect(logs.map((l) => l.resortId)).toEqual(['greek-peak', 'labrador-mountain', 'greek-peak', 'labrador-mountain'])
    for (const l of logs) {
      const [rep] = await db
        .select()
        .from(s.operationalReports)
        .where(and(eq(s.operationalReports.resortId, l.resortId), eq(s.operationalReports.localDate, l.date), eq(s.operationalReports.revision, 1)))
      expect(l.surfaceFeedback).toEqual((rep as OperationalReportRow).surfaceTags)
      expect(l.rating).not.toBeNull()
      if (l.surfaceFeedback.some((t) => t === 'icy-refrozen' || t === 'wet-slushy')) expect(l.rating!).toBeLessThan(5)
      expect(l.skillsPracticed.length).toBeGreaterThan(0)
      expect(l.spendMinor).toBeNull()
    }
    const skills = await db.select().from(s.skillChecklist)
    expect(skills.filter((k) => k.status === 'instructor-confirmed')).toHaveLength(1)
    expect(skills.filter((k) => k.status === 'self-confirmed').length).toBeGreaterThan(2)
    const lessons = await db.select().from(s.lessons)
    expect(lessons.filter((l) => l.date! < DEMO_TODAY)).toHaveLength(1)
    expect(lessons.filter((l) => l.date! > DEMO_TODAY)).toHaveLength(1)
    expect(lessons.every((l) => l.instructor === null && l.bookingRef === null)).toBe(true)

    const alerts = await db.select().from(s.alerts)
    expect(new Set(alerts.map((a) => a.type))).toEqual(new Set(['opening-date-change', 'resort-opened', 'snow-threshold', 'pass-deadline']))
    expect(alerts.find((a) => a.type === 'pass-deadline')!.title).toMatch(/\(simulated\)$/)
    const rules = await db.select().from(s.alertRules)
    for (const fav of ['greek-peak', 'alta']) expect(rules.filter((r) => r.resortId === fav).map((r) => r.type).sort()).toEqual(['opening-date-change', 'resort-opened', 'snow-threshold'])
    const fx = await db.select().from(s.fxRates)
    expect(new Set(fx.map((f) => `${f.base}->${f.quote}`))).toEqual(new Set(['USD->CAD', 'USD->EUR']))
    const ratings = await db.select().from(s.myRatings)
    expect(ratings.map((r) => [r.resortId, r.rating])).toEqual([['greek-peak', 4]])
    // Written the evening of the 2 Jan visit: it describes what I logged that day, nothing later.
    expect(ratings[0].updatedAt < '2027-01-04').toBe(true)
    expect(ratings[0].review).toMatch(/on my 2 Jan visit\.$/)
  })

  it('is a no-op once generated and refuses a database that holds live data', async () => {
    const before = await demoTableCounts(db)
    expect(await ensureDemoData(db)).toBeNull()
    expect(await demoTableCounts(db)).toEqual(before)

    const live = (await createMemoryDb()).db
    await seedCatalog(live, loadCatalog(), DEMO_NOW)
    await expect(ensureDemoData(live)).rejects.toThrow(/Refusing to write demo data/)
    expect(await getMeta(live, META_MARKER)).toBeNull()
    const personal = (await createMemoryDb()).db
    await personal.insert(s.trips).values({ id: 'mine', name: 'My trip', startDate: '2027-02-01', endDate: '2027-02-02', companions: [], createdAt: DEMO_NOW, updatedAt: DEMO_NOW })
    await expect(ensureDemoData(personal)).rejects.toThrow(/Refusing to write demo data/)
  })
})

// ---------------------------------------------------------------------------

async function timelineFromDb(d: Db, resortId: string): Promise<ResortTimeline> {
  const [resort] = await d.select().from(s.resorts).where(eq(s.resorts.id, resortId))
  const [season] = await d.select().from(s.resortSeasons).where(eq(s.resortSeasons.resortId, resortId))
  const runs = await d.select().from(s.weatherRuns).where(eq(s.weatherRuns.resortId, resortId)).orderBy(asc(s.weatherRuns.fetchedAt), asc(s.weatherRuns.id))
  const byKey = new Map<string, StoredRun[]>()
  for (const run of runs as WeatherRunRow[]) {
    const pts = await d.select().from(s.weatherPoints).where(eq(s.weatherPoints.runId, run.id)).orderBy(asc(s.weatherPoints.validTime))
    const hourly = pts.map(({ runId: _r, localDate: _l, ...h }) => h as HourlyWeather)
    byKey.set(run.pointKey, [...(byKey.get(run.pointKey) ?? []), { run, hourly }])
  }
  const logs = await d.select().from(s.skiDayLogs).where(eq(s.skiDayLogs.resortId, resortId))
  return {
    resort,
    schedules: await d.select().from(s.operatingSchedules).where(and(eq(s.operatingSchedules.resortId, resortId), eq(s.operatingSchedules.activity, 'lifts'))),
    seasonVersions: [{ at: '', row: season }],
    events: await d.select().from(s.statusEvents).where(eq(s.statusEvents.resortId, resortId)).orderBy(asc(s.statusEvents.effectiveAt), asc(s.statusEvents.id)),
    reports: await d.select().from(s.operationalReports).where(eq(s.operationalReports.resortId, resortId)),
    personal: logs.map((l) => ({ date: l.date, surfaceTags: l.surfaceFeedback, recordedAt: l.createdAt, note: l.notes })),
    runs: byKey,
  }
}

describe('demo assessment slicing', () => {
  it('gives exactly the same assessment as the full stored run', async () => {
    for (const id of ['greek-peak', 'alta']) {
      const tl = await timelineFromDb(db, id)
      const tz = tl.resort.timezone
      const cases: [string, string][] = [
        ...dateRange('2026-12-15', '2027-01-14').map((d): [string, string] => [localTimeToInstant(d, '07:00', tz), d]),
        ...dateRange('2027-01-02', DEMO_TODAY).map((d): [string, string] => [`${addDays(d, -1)}T11:05:00.000Z`, d]),
        ...dateRange(DEMO_TODAY, LAST_DATE).map((d): [string, string] => [DEMO_NOW, d]),
      ]
      for (const [asOf, date] of cases) {
        for (const mode of SCORING_MODES) {
          const args = { date, mode, now: asOf, demo: true, units }
          const sliced = assessDay(buildAssessInput(evidenceAt(tl, asOf, date), args))
          const full = assessDay(buildAssessInput(evidenceAt(tl, asOf, date, { full: true }), args))
          expect(sliced).toEqual(full)
        }
      }
    }
  }, 60_000)
})
