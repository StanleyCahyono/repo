import { describe, expect, it } from 'vitest'
import { accessTone, clock, flightDates, groupErrors, linkState, linkStateDetail, straightLineKm, weekdaysText } from './format'

const NOW = '2027-01-15T14:00:00.000Z'
const check = (ok: boolean | null, httpStatus: number | null, error: string | null = null) => ({ ok, httpStatus, error, checkedAt: '2027-01-15T10:00:00.000Z' })

describe('linkState', () => {
  it('never calls a link broken when the check itself was refused or could not connect', () => {
    expect(linkState(null)).toBe('unchecked')
    expect(linkState(check(true, 200))).toBe('ok')
    expect(linkState(check(null, null))).toBe('unknown')
    expect(linkState(check(false, 404))).toBe('broken')
    expect(linkState(check(false, 410))).toBe('broken')
    expect(linkState(check(false, 503))).toBe('broken')
    // Refused / rate-limited / proxy-blocked checks: the page may still open in a browser.
    for (const code of [401, 403, 407, 429]) expect(linkState(check(false, code))).toBe('check-failed')
    // No HTTP answer at all (timeout, DNS, TLS).
    expect(linkState(check(false, null, 'timeout: no response in 10 s'))).toBe('check-failed')
  })

  it('explains the state with the status code and when it was checked', () => {
    expect(linkStateDetail(check(false, 403), NOW)).toMatch(/^HTTP 403 when checked 4 h ago — the site or network refused/)
    expect(linkStateDetail(check(false, 404), NOW)).toMatch(/^HTTP 404 .* may have moved/)
    expect(linkStateDetail(null, NOW)).toMatch(/has not visited/)
  })
})

describe('groupErrors', () => {
  it('collapses per-point errors with the same message into one line naming the points', () => {
    expect(
      groupErrors([
        { source: 'base · open-meteo', message: 'Open-Meteo: HTTP 403 Forbidden' },
        { source: 'summit · open-meteo', message: 'Open-Meteo: HTTP 403 Forbidden' },
        { source: 'base · nws-grid', message: 'NWS points: HTTP 403 Forbidden' },
        { source: 'greek-peak-official', message: 'greekpeak.net: HTTP 403 Forbidden' },
      ]),
    ).toEqual([
      { message: 'Open-Meteo: HTTP 403 Forbidden', where: ['base', 'upper mountain'] },
      { message: 'NWS points: HTTP 403 Forbidden', where: ['base'] },
      { message: 'greekpeak.net: HTTP 403 Forbidden', where: [] },
    ])
  })
})

describe('labels', () => {
  it('formats weekday sets and clock times', () => {
    expect(weekdaysText([1, 2, 3, 4, 5])).toBe('Mon–Fri')
    expect(weekdaysText([6, 7])).toBe('Sat, Sun')
    expect(weekdaysText([1, 2, 3, 4, 5, 6, 7])).toBe('Every day')
    expect(weekdaysText(null)).toBe('Days not stated')
    expect(clock('09:30')).toBe('9:30')
    expect(clock(null)).toBeNull()
  })

  it('never gives unknown pass access a positive tone', () => {
    expect(accessTone('included')).toBe('positive')
    expect(accessTone('included-limited')).toBe('positive')
    expect(accessTone('unknown')).toBe('unknown')
    expect(accessTone('discount-only')).toBe('caution')
    expect(accessTone('blackout')).toBe('critical')
  })
})

describe('travel helpers', () => {
  it('prefills flight searches from the planning date, never in the past', () => {
    expect(flightDates('2027-02-13', '2027-01-15')).toEqual({ depart: '2027-02-13', ret: '2027-02-16' })
    expect(flightDates('2027-01-10', '2027-01-15')).toEqual({ depart: '2027-01-15', ret: '2027-01-18' })
  })

  it('computes straight-line distances (labelled as such wherever shown)', () => {
    const ithaca = { lat: 42.4440, lon: -76.5019 }
    const greekPeak = { lat: 42.5086, lon: -76.146 }
    expect(straightLineKm(ithaca, greekPeak)).toBeGreaterThan(28)
    expect(straightLineKm(ithaca, greekPeak)).toBeLessThan(32)
    expect(straightLineKm(ithaca, ithaca)).toBe(0)
  })
})
