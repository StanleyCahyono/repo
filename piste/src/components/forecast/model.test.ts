import { describe, expect, it } from 'vitest'
import type { HourView } from '@/lib/data/forecast'
import type { DayPotential } from '@/lib/data/forecast-screen'
import {
  addMonths,
  dateZone,
  displayPotential,
  headlineSnow,
  intervalLabel,
  lastForecastDate,
  outlookColumns,
  provided,
  severityTone,
  summarizeHours,
  windowHours,
  zoneLabel,
} from './model'

const TZ = 'America/Denver'
function hour(validTime: string, over: Partial<HourView> = {}): HourView {
  return {
    validTime,
    localDate: '2027-01-15',
    localTime: '00:00',
    temperatureC: -5,
    apparentTemperatureC: -9,
    snowfallCm: 1,
    rainMm: 0,
    precipitationMm: 0,
    windKmh: 10,
    gustKmh: 20,
    humidityPct: null,
    visibilityM: null,
    cloudCoverPct: null,
    freezingLevelM: null,
    snowDepthM: null,
    weatherCode: null,
    isDay: null,
    ...over,
  }
}
/** 49 stamps from 14:00Z (= 07:00 MST), like the 48-hour window from the current hour. */
const hourly = Array.from({ length: 49 }, (_, i) => hour(new Date(Date.parse('2027-01-15T14:00:00.000Z') + i * 3_600_000).toISOString()))

describe('dateZone', () => {
  it('places a date relative to the resort-local today and the last forecast day', () => {
    expect(dateZone('2027-01-10', '2027-01-15', '2027-01-30')).toBe('past')
    expect(dateZone('2027-01-15', '2027-01-15', null)).toBe('today')
    expect(dateZone('2027-01-20', '2027-01-15', '2027-01-30')).toBe('forecast')
    expect(dateZone('2027-03-13', '2027-01-15', '2027-01-30')).toBe('beyond')
    expect(dateZone('2027-01-20', '2027-01-15', null)).toBe('no-forecast')
  })
  it('reads the last covered day from the daily outlook', () => {
    expect(lastForecastDate({ daily: [] })).toBeNull()
    expect(lastForecastDate(null)).toBeNull()
  })
})

describe('windowHours / summarizeHours', () => {
  it('with preceding-hour sums, the first stamp is the hour that already ended', () => {
    const win = windowHours(hourly, 48, 'preceding-hour')
    expect(win).toHaveLength(48)
    expect(win[0].validTime).toBe('2027-01-15T15:00:00.000Z')
    expect(windowHours(hourly, 48, 'following-hour')[0].validTime).toBe('2027-01-15T14:00:00.000Z')
  })

  it('sums known accumulations only; unknown hours make the total a lower bound', () => {
    const withGap = hourly.map((h, i) => (i === 10 ? { ...h, snowfallCm: null } : h))
    const s = summarizeHours(withGap, 48, 'preceding-hour')
    expect(s.snow).toMatchObject({ sum: 47, known: 47, complete: false })
    expect(s.rain).toMatchObject({ sum: 0, complete: true })
    expect(s.visibilityMin).toBeNull() // not provided — not zero
    expect(s.gustMax).toBe(20)
  })

  it('labels the accumulation interval in resort-local time', () => {
    expect(intervalLabel(hourly[0], 'preceding-hour', TZ)).toBe('06:00–07:00')
    expect(intervalLabel(hourly[0], 'following-hour', TZ)).toBe('07:00–08:00')
  })

  it('tells a variable that was never returned apart from zeros', () => {
    expect(provided(hourly, 'rainMm')).toBe(true)
    expect(provided(hourly, 'visibilityM')).toBe(false)
  })

  it('names the zone, and both names across a DST change', () => {
    expect(zoneLabel(TZ, ['2027-01-15T14:00:00.000Z'])).toBe('MST')
    expect(zoneLabel(TZ, ['2027-03-14T08:00:00.000Z', '2027-03-14T10:00:00.000Z'])).toBe('MST/MDT')
  })
})

describe('outlookColumns', () => {
  it('unions resort-local days and flags days 8–16 as trend', () => {
    const day = (date: string, trend = false) => ({ date, trend }) as never
    const cols = outlookColumns(
      [
        { today: '2027-01-15', daily: [day('2027-01-15'), day('2027-01-16'), day('2027-01-22', true)] },
        { today: '2027-01-15', daily: [day('2027-01-16'), day('2027-01-17')] },
      ],
      '2027-01-15',
    )
    expect(cols.map((c) => [c.date, c.dayIndex, c.trend])).toEqual([
      ['2027-01-15', 0, false],
      ['2027-01-16', 1, false],
      ['2027-01-17', 2, false],
      ['2027-01-22', 7, true],
    ])
  })
})

describe('displayPotential', () => {
  const p = (over: Partial<DayPotential>): DayPotential =>
    ({
      date: '2027-01-17',
      score: 80,
      scoreKind: 'weather-potential',
      descriptor: 'Good',
      eligibility: 'status-unknown',
      closure: null,
      ...over,
    }) as DayPotential

  it('never shows a full conditions score for a future day', () => {
    expect(displayPotential(p({ scoreKind: 'conditions', score: 91 }), true)).toEqual({ scoreKind: 'none', score: null, descriptor: null })
    expect(displayPotential(p({ scoreKind: 'limited', score: 60 }), true)?.score).toBeNull()
    expect(displayPotential(p({}), true)).toEqual({ scoreKind: 'weather-potential', score: 80, descriptor: 'Good' })
  })
  it('shows today as stored, and Closed for a confirmed closure', () => {
    expect(displayPotential(p({ scoreKind: 'conditions', score: 91 }), false)?.score).toBe(91)
    expect(displayPotential(p({ scoreKind: 'closed', score: null }), true)).toEqual({ scoreKind: 'closed', score: null, descriptor: 'Closed' })
    expect(displayPotential(undefined, true)).toBeNull()
  })
})

describe('headlineSnow / severityTone / addMonths', () => {
  it('prefers the 24 h window, then overnight; a stated zero is kept, a missing amount is not invented', () => {
    expect(
      headlineSnow({
        snowfall: [
          { window: 'overnight', amountCm: 5 },
          { window: '24h', amountCm: 0, sourceText: '0"' },
        ],
      }),
    ).toEqual({ window: '24h', amountCm: 0, sourceText: '0"' })
    expect(
      headlineSnow({
        snowfall: [
          { window: '24h', amountCm: null },
          { window: 'overnight', amountCm: 3 },
        ],
      })?.window,
    ).toBe('overnight')
    expect(headlineSnow({ snowfall: [{ window: '7d', amountCm: 30 }] })).toBeNull()
    expect(headlineSnow(null)).toBeNull()
  })
  it('maps CAP severity to a tone', () => {
    expect(severityTone('Severe')).toBe('critical')
    expect(severityTone('Moderate')).toBe('caution')
    expect(severityTone(null)).toBe('info')
  })
  it('does month arithmetic across years', () => {
    expect(addMonths('2027-01', -1)).toBe('2026-12')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
  })
})
