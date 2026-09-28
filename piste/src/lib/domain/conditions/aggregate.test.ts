import { describe, expect, it } from 'vitest'
import { aggregateDay, aggregateDays, prepareSeries, rollingSum, rollingWindows, sumBetween } from './aggregate'
import { blankHour, hourly } from './test-fixtures'

const DENVER = 'America/Denver'
const NY = 'America/New_York'

describe('interval semantics and midnight attribution', () => {
  it('attributes an accumulation stamped 00:00 local to the PREVIOUS local day under preceding-hour semantics', () => {
    // 2027-01-15T05:00Z is 00:00 EST on 15 Jan; the value covers 23:00–24:00 on 14 Jan.
    const pts = [{ ...blankHour('2027-01-15T05:00:00Z'), snowfallCm: 3 }]
    const s = prepareSeries(pts, 'preceding-hour')
    expect(aggregateDay(s, '2027-01-14', NY).snowfallCm).toBe(3)
    expect(aggregateDay(s, '2027-01-15', NY).snowfallCm).toBeNull()
  })

  it('attributes the same stamp to the new day under following-hour semantics', () => {
    const pts = [{ ...blankHour('2027-01-15T05:00:00Z'), snowfallCm: 3 }]
    const s = prepareSeries(pts, 'following-hour')
    expect(aggregateDay(s, '2027-01-14', NY).snowfallCm).toBeNull()
    expect(aggregateDay(s, '2027-01-15', NY).snowfallCm).toBe(3)
  })

  it('counts a full preceding-hour day as stamps 01:00 … 24:00 local, exactly 24 hours', () => {
    // 04:00Z on 15 Jan (23:00 EST 14 Jan) → through 06:00Z 16 Jan (01:00 EST 16 Jan)
    const s = prepareSeries(hourly('2027-01-15T04:00:00Z', 27, () => ({ snowfallCm: 1 })), 'preceding-hour')
    const d = aggregateDay(s, '2027-01-15', NY)
    expect(d.expectedHours).toBe(24)
    expect(d.hoursCovered).toBe(24)
    expect(d.snowfallCm).toBe(24)
    expect(d.firstHour).toBe('2027-01-15T06:00:00.000Z') // 01:00 EST
    expect(d.lastHour).toBe('2027-01-16T05:00:00.000Z') // 00:00 EST next day closes the day
  })
})

describe('DST days (resort-local aggregation)', () => {
  it('handles the 25-hour fall-back day America/Denver 2026-11-01 with full coverage', () => {
    // Local midnight 1 Nov = 06:00Z (MDT); local midnight 2 Nov = 07:00Z (MST).
    const s = prepareSeries(hourly('2026-10-31T00:00:00Z', 24 * 4, () => ({ snowfallCm: 1, temperatureC: -3 })), 'preceding-hour')
    const d = aggregateDay(s, '2026-11-01', DENVER)
    expect(d.expectedHours).toBe(25)
    expect(d.hoursCovered).toBe(25)
    expect(d.coverage).toBe(1)
    expect(d.complete).toBe(true)
    expect(d.snowfallCm).toBe(25)
    expect(d.hoursBelowFreezing).toBe(25)
  })

  it('handles the 23-hour spring-forward day America/Denver 2027-03-14 with full coverage', () => {
    const s = prepareSeries(hourly('2027-03-13T00:00:00Z', 24 * 4, () => ({ snowfallCm: 1 })), 'preceding-hour')
    const d = aggregateDay(s, '2027-03-14', DENVER)
    expect(d.expectedHours).toBe(23)
    expect(d.hoursCovered).toBe(23)
    expect(d.coverage).toBe(1)
    expect(d.snowfallCm).toBe(23)
  })

  it('never double counts: daily sums across a DST boundary add up to the series total', () => {
    const pts = hourly('2026-10-31T06:00:00Z', 24 * 3, (i) => ({ snowfallCm: (i % 5) * 0.3 }))
    const s = prepareSeries(pts, 'preceding-hour')
    const total = pts.reduce((a, p) => a + (p.snowfallCm ?? 0), 0)
    const days = aggregateDays(s, DENVER)
    const hoursCounted = days.reduce((a, d) => a + d.hoursCovered, 0)
    expect(hoursCounted).toBe(pts.length)
    expect(days.reduce((a, d) => a + (d.snowfallCm ?? 0), 0)).toBeCloseTo(total, 6)
  })

  it('reports partial coverage instead of pretending a partial day is complete', () => {
    const pts = hourly('2027-03-14T07:00:00Z', 10, () => ({ snowfallCm: 2 })) // first 10 hours only
    const d = aggregateDay(prepareSeries(pts, 'preceding-hour'), '2027-03-14', DENVER)
    expect(d.expectedHours).toBe(23)
    expect(d.hoursCovered).toBe(9) // the 07:00Z stamp closes the previous day
    expect(d.coverage).toBeCloseTo(9 / 23, 6)
    expect(d.complete).toBe(false)
    expect(d.snowfallCm).toBe(18)
  })
})

describe('quantities stay separate', () => {
  it('never counts liquid rain as snowfall', () => {
    const pts = hourly('2027-01-15T06:00:00Z', 24, () => ({ temperatureC: 4, rainMm: 1.5, precipitationMm: 1.5, snowfallCm: 0 }))
    const d = aggregateDay(prepareSeries(pts, 'preceding-hour'), '2027-01-15', NY)
    expect(d.rainMm).toBe(36)
    expect(d.precipitationMm).toBe(36)
    expect(d.snowfallCm).toBe(0)
  })

  it('keeps snowfall unknown (null) when only precipitation is supplied — no derivation from water equivalent', () => {
    const pts = hourly('2027-01-15T06:00:00Z', 24, () => ({ temperatureC: -5, precipitationMm: 1 }))
    const d = aggregateDay(prepareSeries(pts, 'preceding-hour'), '2027-01-15', NY)
    expect(d.precipitationMm).toBe(24)
    expect(d.snowfallCm).toBeNull()
    expect(d.variableCoverage.snowfallCm).toBe(0)
  })

  it('reports modeled ground depth separately and never mixes it into snowfall', () => {
    const pts = hourly('2027-01-15T06:00:00Z', 24, (i) => ({ snowDepthM: 0.5 + i * 0.01, snowfallCm: 0 }))
    const d = aggregateDay(prepareSeries(pts, 'preceding-hour'), '2027-01-15', NY)
    expect(d.snowfallCm).toBe(0)
    expect(d.modeledSnowDepthCm).toBeCloseTo(73, 6)
  })
})

describe('rolling windows', () => {
  const pts = hourly('2027-01-12T05:00:00Z', 24 * 4, (i) => ({ snowfallCm: i < 48 ? 0.5 : 1 }))
  const s = prepareSeries(pts, 'preceding-hour')
  const end = '2027-01-15T05:00:00Z'

  it('adjacent windows partition the hours: 24 h + preceding 24 h = 48 h', () => {
    const w = rollingWindows(s, 'snowfallCm', end, [24, 48])
    const earlier = rollingSum(s, 'snowfallCm', '2027-01-14T05:00:00Z', 24)
    expect(w[24].sum! + earlier.sum!).toBeCloseTo(w[48].sum!, 6)
    expect(w[24].hoursWithValue + earlier.hoursWithValue).toBe(w[48].hoursWithValue)
  })

  it('includes the hour stamped at the window end and excludes the one stamped at the start (preceding-hour)', () => {
    const one = [{ ...blankHour('2027-01-15T05:00:00Z'), snowfallCm: 4 }]
    const ss = prepareSeries(one, 'preceding-hour')
    expect(sumBetween(ss, 'snowfallCm', '2027-01-15T04:00:00Z', '2027-01-15T05:00:00Z').sum).toBe(4)
    expect(sumBetween(ss, 'snowfallCm', '2027-01-15T05:00:00Z', '2027-01-15T06:00:00Z').sum).toBeNull()
  })

  it('returns coverage < 1 and a null sum for windows without data', () => {
    const w = rollingSum(s, 'snowfallCm', '2027-01-12T10:00:00Z', 24)
    expect(w.expectedHours).toBe(24)
    expect(w.hoursWithValue).toBe(6) // stamps 05:00…10:00Z
    expect(w.coverage).toBeCloseTo(6 / 24, 6)
    expect(w.complete).toBe(false)
    expect(rollingSum(s, 'snowfallCm', '2026-12-01T00:00:00Z', 24).sum).toBeNull()
  })

  it('never double counts overlapping hours from irregular stamps (e.g. a 15:10 special between hourly obs)', () => {
    const irregular = [
      { ...blankHour('2027-01-15T14:53:00Z'), precipitationMm: 1 },
      { ...blankHour('2027-01-15T15:10:00Z'), precipitationMm: 1 },
      { ...blankHour('2027-01-15T15:53:00Z'), precipitationMm: 1 },
    ]
    const ss = prepareSeries(irregular, 'preceding-hour')
    expect(ss.overlapsDropped).toBe(1)
    for (let i = 1; i < ss.slots.length; i++) expect(ss.slots[i].startMs).toBeGreaterThanOrEqual(ss.slots[i - 1].endMs)
    // Two hours of time can hold at most two hourly accumulations.
    expect(aggregateDay(ss, '2027-01-15', NY).precipitationMm).toBe(2)
  })

  it('counts a duplicated hour once (later record wins)', () => {
    const dup = [
      { ...blankHour('2027-01-15T06:00:00Z'), snowfallCm: 2 },
      { ...blankHour('2027-01-15T06:00:00.000Z'), snowfallCm: 3 },
    ]
    const ss = prepareSeries(dup, 'preceding-hour')
    expect(ss.duplicatesDropped).toBe(1)
    expect(aggregateDay(ss, '2027-01-15', NY).snowfallCm).toBe(3)
  })
})
