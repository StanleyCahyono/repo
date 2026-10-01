import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))
const ctxRef: { current: unknown } = { current: null }
vi.mock('@/lib/context', () => ({ getCtx: async () => ctxRef.current }))

import { asc, eq } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import { buildFixture, type Fixture } from '@/lib/data/fixtures.test-helpers'
import {
  createAlertRule,
  deleteAlertRule,
  restoreAlertRule,
  saveCosts,
  saveCurrency,
  saveHome,
  saveProfile,
  saveTheme,
  saveTravel,
  saveUnits,
  saveWeights,
  updateAlertRule,
} from './settings'

let fx: Fixture

beforeAll(async () => {
  fx = await buildFixture()
  ctxRef.current = fx.ctx
})

/** Every stored measurement, price, quote, budget amount and threshold that a display switch must never touch. */
async function storedValues(db: Fixture['db']) {
  const [prefs] = await db.select().from(s.userPreferences).where(eq(s.userPreferences.id, 1))
  return {
    prices: await db.select().from(s.priceSnapshots).orderBy(asc(s.priceSnapshots.id)),
    fx: await db.select().from(s.fxRates),
    reports: await db.select().from(s.operationalReports).orderBy(asc(s.operationalReports.id)),
    points: await db.select().from(s.weatherPoints).orderBy(asc(s.weatherPoints.runId), asc(s.weatherPoints.validTime)).limit(200),
    resorts: await db.select({ id: s.resorts.id, base: s.resorts.baseElevationM, summit: s.resorts.summitElevationM, vertical: s.resorts.verticalM }).from(s.resorts),
    travel: await db.select().from(s.travelOptions).orderBy(asc(s.travelOptions.id)),
    owned: await db.select().from(s.passOwnership),
    rules: await db.select().from(s.alertRules).orderBy(asc(s.alertRules.id)),
    budget: prefs?.budget ?? null,
    travelPrefs: prefs?.travel ?? null,
  }
}

describe('units and currency are display-only (the conversion boundary)', () => {
  it('switching every unit and the display currency changes the preference and nothing stored', async () => {
    await createAlertRule({ type: 'snow-threshold', resortId: 'test-peak', params: { thresholdCm: 15.2, windowHours: 48 }, cooldownHours: 12, enabled: true })
    await saveCosts({
      gear: { ownsSkis: false, ownsBoots: true, ownsHelmet: false, rentalOption: 'skis-only' },
      budget: { currency: 'USD', dayBudget: '120', seasonBudget: '1,500.50', lunchEstimate: '25' },
      lodgingStyle: 'budget',
    })
    const before = await storedValues(fx.db)
    expect(before.prices.length).toBeGreaterThan(0)
    expect(before.reports.length).toBeGreaterThan(0)

    const metric = await saveUnits({ temperature: 'C', snow: 'cm', distance: 'km', elevation: 'm', speed: 'kmh' })
    expect(metric).toMatchObject({ ok: true, data: { temperature: 'C', snow: 'cm' } })
    expect(await saveCurrency({ currency: 'EUR' })).toMatchObject({ ok: true, data: { currency: 'EUR' } })
    // Mixed: each unit is independent.
    expect(await saveUnits({ temperature: 'F', snow: 'cm', distance: 'mi', elevation: 'm', speed: 'mph' })).toMatchObject({ ok: true })

    const [prefs] = await fx.db.select().from(s.userPreferences).where(eq(s.userPreferences.id, 1))
    expect(prefs.units).toEqual({ temperature: 'F', snow: 'cm', distance: 'mi', elevation: 'm', speed: 'mph' })
    expect(prefs.currency).toBe('EUR')
    expect(await storedValues(fx.db)).toEqual(before)
  })

  it('the budget keeps its own currency and minor-unit amounts whatever the display currency', async () => {
    await saveCurrency({ currency: 'CAD' })
    const [prefs] = await fx.db.select().from(s.userPreferences).where(eq(s.userPreferences.id, 1))
    expect(prefs.budget).toMatchObject({ currency: 'USD', dayBudgetMinor: 12000, seasonBudgetMinor: 150050, lunchEstimateMinor: 2500 })
  })

  it('rejects unknown units and currencies without writing', async () => {
    const [before] = await fx.db.select().from(s.userPreferences).where(eq(s.userPreferences.id, 1))
    expect(await saveUnits({ ...before.units, snow: 'ft' as never })).toMatchObject({ ok: false })
    expect(await saveCurrency({ currency: 'MXN' })).toMatchObject({ ok: false })
    const [after] = await fx.db.select().from(s.userPreferences).where(eq(s.userPreferences.id, 1))
    expect(after.units).toEqual(before.units)
    expect(after.currency).toBe(before.currency)
  })
})

describe('preference forms', () => {
  it('home: validates coordinates, zone and season; rounds coordinates', async () => {
    expect(await saveHome({ homeName: 'Ithaca, NY', homeLat: 95, homeLon: -76.5, homeTimezone: 'America/New_York', activeSeasonId: '2026-27' })).toMatchObject({
      ok: false,
      fieldErrors: { homeLat: expect.any(String) },
    })
    expect(await saveHome({ homeName: 'Ithaca, NY', homeLat: 42.44, homeLon: -76.5, homeTimezone: 'Mars/Olympus', activeSeasonId: '2026-27' })).toMatchObject({
      ok: false,
      fieldErrors: { homeTimezone: expect.any(String) },
    })
    expect(await saveHome({ homeName: 'Ithaca, NY', homeLat: 42.44, homeLon: -76.5, homeTimezone: 'America/New_York', activeSeasonId: '2031-32' })).toMatchObject({
      ok: false,
      fieldErrors: { activeSeasonId: expect.any(String) },
    })
    const r = await saveHome({ homeName: '  Dryden, NY ', homeLat: 42.4908123456, homeLon: -76.2971987654, homeTimezone: 'America/New_York', activeSeasonId: '2026-27' })
    expect(r).toMatchObject({ ok: true, data: { homeName: 'Dryden, NY', homeLat: 42.49081, homeLon: -76.2972 } })
  })

  it('profile: a companion needs an ability; clearing the ability clears the name', async () => {
    expect(await saveProfile({ ability: 'novice', scoringMode: 'learning', companionName: 'Sam', companionAbility: null })).toMatchObject({
      ok: false,
      fieldErrors: { companionAbility: expect.any(String) },
    })
    expect(await saveProfile({ ability: 'novice', scoringMode: 'powder', companionName: 'Sam', companionAbility: 'advanced' })).toMatchObject({
      ok: true,
      data: { companionName: 'Sam', companionAbility: 'advanced' },
    })
    expect(await saveProfile({ ability: 'novice', scoringMode: 'powder', companionName: '', companionAbility: null })).toMatchObject({
      ok: true,
      data: { companionName: null, companionAbility: null },
    })
  })

  it('travel: whole-percent buffer, quarter-hour drive limit, known airports once each', async () => {
    expect(await saveTravel({ maxDriveHours: 3.3, willingToFly: false, originAirports: [], winterBufferPct: 25 })).toMatchObject({ ok: true, data: { maxDriveHours: 3.25, willingToFly: false } })
    expect(await saveTravel({ maxDriveHours: null, willingToFly: true, originAirports: [], winterBufferPct: 12.5 })).toMatchObject({ ok: false, fieldErrors: { winterBufferPct: expect.any(String) } })
    // The fixture has no airport catalog, so any code is unknown.
    expect(await saveTravel({ maxDriveHours: null, willingToFly: true, originAirports: ['ZZZ'], winterBufferPct: 20 })).toMatchObject({ ok: false, fieldErrors: { originAirports: expect.any(String) } })
  })

  it('costs: keeps budget keys other screens store (basket party size), and amounts are exact minor units', async () => {
    const [p] = await fx.db.select().from(s.userPreferences).where(eq(s.userPreferences.id, 1))
    await fx.db
      .update(s.userPreferences)
      .set({ budget: { ...p.budget, basketPartySize: 3 } as typeof p.budget })
      .where(eq(s.userPreferences.id, 1))
    const r = await saveCosts({
      gear: { ownsSkis: true, ownsBoots: true, ownsHelmet: true, rentalOption: 'none' },
      budget: { currency: 'CAD', dayBudget: null, seasonBudget: '2000', lunchEstimate: '19.99' },
      lodgingStyle: null,
    })
    expect(r).toMatchObject({ ok: true })
    const [after] = await fx.db.select().from(s.userPreferences).where(eq(s.userPreferences.id, 1))
    expect(after.budget).toMatchObject({ currency: 'CAD', dayBudgetMinor: null, seasonBudgetMinor: 200000, lunchEstimateMinor: 1999, basketPartySize: 3 })
    expect(after.gear).toEqual({ ownsSkis: true, ownsBoots: true, ownsHelmet: true, rentalOption: 'none' })
    expect(await saveCosts({ gear: after.gear, budget: { currency: 'CAD', dayBudget: '12.345', seasonBudget: null, lunchEstimate: '10' }, lodgingStyle: null })).toMatchObject({
      ok: false,
      fieldErrors: { 'budget.dayBudget': expect.any(String) },
    })
  })

  it('weights: at least one factor must count; theme: only system/light/dark', async () => {
    expect(await saveWeights({ conditions: 0, fit: 0, travel: 0, cost: 0, events: 0 })).toMatchObject({ ok: false })
    expect(await saveWeights({ conditions: 50, fit: 20, travel: 20, cost: 10, events: 0 })).toMatchObject({ ok: true })
    expect(await saveTheme({ theme: 'dark' })).toMatchObject({ ok: true, data: { theme: 'dark' } })
    expect(await saveTheme({ theme: 'sepia' })).toMatchObject({ ok: false })
  })
})

describe('alert rules', () => {
  it('validates scope and thresholds against the rule parameters', async () => {
    expect(await createAlertRule({ type: 'pass-deadline', resortId: 'test-peak', params: {}, cooldownHours: 12, enabled: true })).toMatchObject({ ok: false, fieldErrors: { resortId: expect.any(String) } })
    expect(await createAlertRule({ type: 'snow-threshold', resortId: 'nowhere', params: {}, cooldownHours: 12, enabled: true })).toMatchObject({ ok: false, fieldErrors: { resortId: 'Unknown resort' } })
    expect(await createAlertRule({ type: 'snow-threshold', resortId: null, params: { thresholdCm: 900 }, cooldownHours: 12, enabled: true })).toMatchObject({
      ok: false,
      fieldErrors: { 'params.thresholdCm': expect.any(String) },
    })
    expect(await createAlertRule({ type: 'event', resortId: null, params: {}, cooldownHours: 500, enabled: true })).toMatchObject({ ok: false, fieldErrors: { cooldownHours: expect.any(String) } })
  })

  it('pauses, edits, deletes and restores a rule under its old id', async () => {
    const created = await createAlertRule({ type: 'forecast-deterioration', resortId: null, params: { minDrop: 20, mode: 'powder' }, cooldownHours: 6, enabled: true })
    if (!created.ok) throw new Error(created.error)
    const id = created.data.id
    expect(await updateAlertRule({ id, enabled: false })).toMatchObject({ ok: true, data: { enabled: false }, message: 'Alert rule paused' })
    expect(await updateAlertRule({ id, params: { minDrop: 10 }, cooldownHours: 24 })).toMatchObject({ ok: true, data: { params: { minDrop: 10 }, cooldownHours: 24 } })
    const deleted = await deleteAlertRule({ id })
    if (!deleted.ok) throw new Error(deleted.error)
    expect(await fx.db.select().from(s.alertRules).where(eq(s.alertRules.id, id))).toEqual([])
    expect(await restoreAlertRule(deleted.data)).toMatchObject({ ok: true, data: { id, enabled: false, cooldownHours: 24 } })
    expect(await deleteAlertRule({ id: 999_999 })).toMatchObject({ ok: false })
  })
})
