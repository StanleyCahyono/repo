import { describe, expect, it } from 'vitest'
import { loadCatalog } from '@/lib/catalog/seed'
import { dateRange, localDateOf, localTimeToInstant, startOfLocalDay } from '@/lib/domain/time'
import { simulateReports, studyPlot, terrainTotals } from './reports'
import { DEMO_RESORTS, REVISIONS, TRACKING_START, demoProfile } from './scenario'
import { HOUR_MS, buildResortTruth, forecastRun, localHour, regionDrivers, sumWindow, type ResortLike, type ResortTruth } from './weather'

const catalog = loadCatalog()
const resortLike = (id: string): ResortLike => {
  const r = catalog.resorts.find((x) => x.id === id)!
  return {
    id,
    timezone: r.timezone,
    baseElevationM: r.elevation.baseM,
    summitElevationM: r.elevation.summitM,
    weatherPoints: r.weatherPoints.map((p) => ({ key: p.key, lat: p.lat, lon: p.lon, elevationM: p.elevationM })),
  }
}
const truths = new Map<string, ResortTruth>()
const truth = (id: string) => {
  let t = truths.get(id)
  if (!t) {
    t = buildResortTruth(resortLike(id), demoProfile(id))
    truths.set(id, t)
  }
  return t
}
const ms = (date: string, hhmm: string, tz: string) => Date.parse(localTimeToInstant(date, hhmm, tz))
const hoursOn = (t: ResortTruth, key: string, date: string) => {
  const from = Date.parse(startOfLocalDay(date, t.tz))
  return t.points.get(key)!.hourly.filter((h) => Date.parse(h.validTime) > from && Date.parse(h.validTime) <= from + 24 * HOUR_MS)
}
const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0)

describe('demo weather truth', () => {
  it('starts at the tracking start and uses preceding-hour stamps', () => {
    const t = truth('greek-peak')
    const first = t.points.get('base')!.hourly[0].validTime
    // The first stamp covers 00:00–01:00 on 1 Dec local: stamped 01:00 local.
    expect(first).toBe(new Date(Date.parse(startOfLocalDay(TRACKING_START, t.tz)) + HOUR_MS).toISOString())
    expect(localDateOf(new Date(Date.parse(first) - HOUR_MS).toISOString(), t.tz)).toBe(TRACKING_START)
  })

  it('cools with height at about 6.5 °C per km', () => {
    const t = truth('alta')
    const base = t.points.get('base')!
    const summit = t.points.get('summit')!
    const mean = (xs: typeof base.hourly) => sum(xs.map((h) => h.temperatureC)) / xs.length
    const perKm = (mean(base.hourly) - mean(summit.hourly)) / ((summit.simElevationM - base.simElevationM) / 1000)
    expect(perKm).toBeGreaterThan(5.5)
    expect(perKm).toBeLessThan(7.5)
  })

  it('has a diurnal cycle (afternoons warmer than early mornings)', () => {
    const t = truth('greek-peak')
    const base = t.points.get('base')!.hourly
    const at = (h: number) => base.filter((x) => Math.round(localHour(Date.parse(x.validTime), t.tz)) === h).map((x) => x.temperatureC!)
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(avg(at(15)) - avg(at(7))).toBeGreaterThan(1.5)
  })

  it('snows only when cold, rains only when warm, and never counts rain as snowfall', () => {
    for (const p of DEMO_RESORTS) {
      for (const pt of truth(p.id).points.values()) {
        for (const h of pt.hourly) {
          // Thresholds 2.5 °C / 0.5 °C, with the 0.1 °C storage rounding of temperature.
          if (h.temperatureC! > 2.55) expect(h.snowfallCm).toBe(0)
          if (h.temperatureC! < 0.45) expect(h.rainMm).toBe(0)
          expect(h.precipitationMm! + 0.11).toBeGreaterThanOrEqual(h.rainMm!)
        }
      }
    }
  })

  it('brings storm systems every few days in every region', () => {
    for (const region of ['east', 'utah', 'colorado'] as const) {
      const storms = regionDrivers(region).storms.filter((s) => s.startMs >= Date.parse('2026-12-01T00:00:00Z') && s.startMs < Date.parse('2027-01-01T00:00:00Z'))
      expect(storms.length).toBeGreaterThanOrEqual(5)
      expect(storms.length).toBeLessThanOrEqual(11)
    }
  })

  it('scripts the Eastern thaw with rain on 11 Jan followed by a hard freeze', () => {
    const t = truth('greek-peak')
    const jan11 = hoursOn(t, 'base', '2027-01-11')
    expect(sum(jan11.map((h) => h.rainMm))).toBeGreaterThan(10)
    expect(Math.max(...jan11.map((h) => h.temperatureC!))).toBeGreaterThan(5)
    const freeze = [...hoursOn(t, 'base', '2027-01-12'), ...hoursOn(t, 'base', '2027-01-13')]
    expect(Math.min(...freeze.map((h) => h.temperatureC!))).toBeLessThan(-12)
    expect(sum(freeze.map((h) => h.rainMm))).toBe(0)
    expect(sum(freeze.map((h) => h.snowfallCm))).toBeLessThan(2)
  })

  it('drops about 40 cm on Alta on 13–14 Jan', () => {
    const t = truth('alta')
    const plot = studyPlot(t)
    const storm = sumWindow(t, plot.snow, ms('2027-01-13', '00:00', t.tz), ms('2027-01-15', '06:00', t.tz))!
    expect(storm).toBeGreaterThan(35)
    expect(storm).toBeLessThan(55)
  })

  it('puts a wind event on Jay Peak only', () => {
    const gust = (id: string) => Math.max(...[...hoursOn(truth(id), 'summit', '2027-01-14'), ...hoursOn(truth(id), 'summit', '2027-01-15')].map((h) => h.gustKmh!))
    expect(gust('jay-peak')).toBeGreaterThanOrEqual(90)
    expect(gust('killington')).toBeLessThan(gust('jay-peak') - 25)
  })

  it('is deterministic', () => {
    const a = buildResortTruth(resortLike('stowe'), demoProfile('stowe'))
    const b = buildResortTruth(resortLike('stowe'), demoProfile('stowe'))
    expect(b.points.get('summit')!.hourly).toEqual(a.points.get('summit')!.hourly)
    expect(forecastRun(a, '2027-01-05T11:00:00.000Z', { pastDays: 1, horizonDays: 8 }).points.get('base')).toEqual(
      forecastRun(b, '2027-01-05T11:00:00.000Z', { pastDays: 1, horizonDays: 8 }).points.get('base'),
    )
  })
})

describe('demo forecast runs', () => {
  it('repeat the truth before the fetch time and err more with lead time', () => {
    const t = truth('greek-peak')
    const base = t.points.get('base')!.hourly
    const byTime = new Map(base.map((h) => [h.validTime, h]))
    const errs: Record<'short' | 'long', number[]> = { short: [], long: [] }
    for (const d of dateRange('2026-12-02', '2027-01-06')) {
      const fetchedAt = `${d}T11:00:00.000Z`
      const run = forecastRun(t, fetchedAt, { pastDays: 1, horizonDays: 8 }).points.get('base')!
      for (const h of run) {
        const truthH = byTime.get(h.validTime)!
        const lead = (Date.parse(h.validTime) - Date.parse(fetchedAt)) / HOUR_MS
        if (lead <= 0) expect(h).toEqual(truthH)
        else if (lead <= 24) errs.short.push(Math.abs(h.temperatureC! - truthH.temperatureC!))
        else if (lead >= 144 && lead <= 168) errs.long.push(Math.abs(h.temperatureC! - truthH.temperatureC!))
      }
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(mean(errs.long)).toBeGreaterThan(1.5 * mean(errs.short))
  })

  it('cover the past day + 7 days for daily runs and today−2 … today+16 for the latest run, never before tracking', () => {
    const t = truth('alta')
    const daily = forecastRun(t, '2027-01-08T11:00:00.000Z', { pastDays: 1, horizonDays: 8 }).points.get('summit')!
    const localDay = (validTime: string) => localDateOf(new Date(Date.parse(validTime) - HOUR_MS).toISOString(), t.tz)
    expect(localDay(daily[0].validTime)).toBe('2027-01-07')
    expect(localDay(daily[daily.length - 1].validTime)).toBe('2027-01-15')
    const latest = forecastRun(t, '2027-01-15T14:00:00.000Z', { pastDays: 2, horizonDays: 17 }).points.get('base')!
    expect(localDay(latest[0].validTime)).toBe('2027-01-13')
    expect(localDay(latest[latest.length - 1].validTime)).toBe('2027-01-31')
    const first = forecastRun(t, '2026-12-01T11:00:00.000Z', { pastDays: 1, horizonDays: 8 }).points.get('base')!
    expect(localDay(first[0].validTime)).toBe(TRACKING_START)
  })

  it('under-forecast the 9 Jan storm in the East the day before', () => {
    const t = truth('greek-peak')
    const dayFrom = Date.parse(startOfLocalDay('2027-01-09', t.tz))
    const onDay = (hs: { validTime: string; snowfallCm: number | null }[]) =>
      sum(hs.filter((h) => Date.parse(h.validTime) > dayFrom && Date.parse(h.validTime) <= dayFrom + 24 * HOUR_MS).map((h) => h.snowfallCm))
    const forecast = onDay(forecastRun(t, '2027-01-08T11:00:00.000Z', { pastDays: 1, horizonDays: 8 }).points.get('base')!)
    const actual = onDay(t.points.get('base')!.hourly)
    expect(actual - forecast).toBeGreaterThan(8)
  })
})

describe('demo reports', () => {
  const reportsFor = (id: string) => {
    const p = demoProfile(id)
    const r = catalog.resorts.find((x) => x.id === id)!
    return simulateReports(truth(id), p, terrainTotals(r.terrain, p))
  }

  it('state nested snowfall windows computed from the hourly truth (no double counting)', () => {
    for (const id of ['greek-peak', 'alta', 'jay-peak']) {
      const t = truth(id)
      const plot = studyPlot(t)
      for (const r of reportsFor(id)) {
        const w = Object.fromEntries(r.report.snowfall.map((s) => [s.window, s.amountCm!]))
        if (w.overnight !== undefined && w['24h'] !== undefined) expect(w.overnight).toBeLessThanOrEqual(w['24h'])
        if (w['24h'] !== undefined && w['48h'] !== undefined) expect(w['24h']).toBeLessThanOrEqual(w['48h'])
        if (w['48h'] !== undefined && w['7d'] !== undefined) expect(w['48h']).toBeLessThanOrEqual(w['7d'])
        const s24 = r.report.snowfall.find((s) => s.window === '24h')
        if (s24) {
          const cm = sumWindow(t, plot.snow, Date.parse(s24.startAt!), Date.parse(s24.endAt!))!
          expect(s24.sourceText).toBe(`${Math.round(cm / 2.54)}"`)
        }
        for (const s of r.report.snowfall) expect(s.startAt! >= new Date(Date.parse(startOfLocalDay(TRACKING_START, t.tz))).toISOString()).toBe(true)
      }
    }
  })

  it('publish around 06:30 local, skip ~10% of days, and include an outage and 11:00 revisions', () => {
    const gp = reportsFor('greek-peak')
    const tz = truth('greek-peak').tz
    for (const r of gp.filter((x) => x.revision === 1)) {
      const minutes = (Date.parse(r.reportedAt) - ms(r.localDate, '06:30', tz)) / 60_000
      expect(Math.abs(minutes)).toBeLessThanOrEqual(15)
    }
    expect(gp.some((r) => r.revision === 2 && r.localDate === '2027-01-09')).toBe(true)
    const hv = reportsFor('holiday-valley').map((r) => r.localDate)
    for (const d of dateRange('2026-12-20', '2026-12-23')) expect(hv).not.toContain(d)
    let days = 0
    let reported = 0
    for (const p of DEMO_RESORTS.filter((x) => x.opening && !x.gap)) {
      const first = p.opening! > TRACKING_START ? p.opening! : TRACKING_START
      days += dateRange(first, '2027-01-15').length
      reported += reportsFor(p.id).filter((r) => r.revision === 1).length
    }
    const missing = 1 - reported / days
    expect(missing).toBeGreaterThan(0.03)
    expect(missing).toBeLessThan(0.16)
  })

  it('describe the story surfaces: wet on the thaw, refrozen after, fresh snow at Alta, Jay closed on 15 Jan', () => {
    const tagsOn = (id: string, date: string) => reportsFor(id).find((r) => r.localDate === date && r.revision === 1)!.report
    expect(tagsOn('greek-peak', '2027-01-11').surfaceTags).toContain('wet-slushy')
    expect(tagsOn('greek-peak', '2027-01-12').surfaceTags).toContain('icy-refrozen')
    expect(tagsOn('alta', '2027-01-14').surfaceTags).toContain('fresh-snow')
    expect(tagsOn('alta', '2027-01-12').surfaceTags).toEqual(['packed-powder'])
    const jay = tagsOn('jay-peak', '2027-01-15')
    expect(jay.status).toBe('temporarily-closed')
    expect(jay.openLifts).toBe(0)
    expect(reportsFor('song-mountain')).toEqual([])
  })

  it('make every 11:00 revision open the lifts and trails its note announces', () => {
    for (const rev of REVISIONS) {
      const day = reportsFor(rev.resortId).filter((r) => r.localDate === rev.date)
      expect(day.map((r) => r.revision)).toEqual([1, 2])
      const [morning, update] = day.map((r) => r.report)
      expect(Date.parse(update.reportedAt!)).toBeGreaterThan(Date.parse(morning.reportedAt!))
      expect(update.openLifts).toBe(Math.min(update.totalLifts!, morning.openLifts! + rev.extraLifts))
      expect(update.openLifts!).toBeGreaterThan(morning.openLifts!)
      expect(update.openTrails!).toBeGreaterThan(morning.openTrails!)
      expect(update.openTrails! - morning.openTrails!).toBeLessThanOrEqual(rev.extraTrails)
      if (rev.morningNote) expect(morning.notes).toContain(rev.morningNote)
      expect(update.notes).toContain(rev.note)
    }
    // It has been snowing at Greek Peak since dawn on 9 Jan: the 11:00 update says so.
    const gp = reportsFor('greek-peak').find((r) => r.localDate === '2027-01-09' && r.revision === 2)!.report
    expect(gp.surfaceTags).toContain('fresh-snow')
    expect(gp.notes).toMatch(/Snowing since the morning report: about \d+" so far\./)
  })

  it('say exactly which terrain totals are simulated (catalog counts always win)', () => {
    const totalsOf = (id: string) => terrainTotals(catalog.resorts.find((x) => x.id === id)!.terrain, demoProfile(id))
    expect(totalsOf('greek-peak')).toMatchObject({ trails: 56, lifts: 8, simulated: false, simulatedFields: [] })
    expect(totalsOf('labrador-mountain')).toMatchObject({ trails: 22, lifts: 4, simulated: true, simulatedFields: ['beginnerTrails'] })
    expect(totalsOf('killington').simulatedFields).toEqual(['beginnerTrails'])
    const firstNotes = (id: string) => reportsFor(id)[0].report.notes
    expect(firstNotes('greek-peak')).toBe('Simulated report (demo data).')
    expect(firstNotes('labrador-mountain')).toBe('Simulated report (demo data). Beginner-trail total is simulated (the catalog has no count).')
    expect(firstNotes('killington')).toBe('Simulated report (demo data). Beginner-trail total is simulated (the catalog has no count).')
  })
})
