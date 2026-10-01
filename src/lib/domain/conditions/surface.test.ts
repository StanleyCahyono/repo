import { describe, expect, it } from 'vitest'
import type { HourlyWeather } from '@/lib/providers/types'
import { localWindowMs, prepareSeries } from './aggregate'
import { CONDITIONS_CONFIG_V1 as CFG } from './config.v1'
import { interpretSurface, type SurfaceContext } from './surface'
import { DAY, NOW, TZ_NY, fairWeather, report } from './test-fixtures'

const METRIC = { temperature: 'C', snow: 'cm', distance: 'km', elevation: 'm', speed: 'kmh' } as const
const within = (t: string, from: string, to: string) => t >= from && t < to

function ctx(hours: HourlyWeather[] | null, overrides: Partial<SurfaceContext> = {}): SurfaceContext {
  const series = hours ? prepareSeries(hours, 'preceding-hour') : null
  const { fromMs, toMs } = localWindowMs(DAY, '09:00', '16:00', TZ_NY)
  return {
    date: DAY,
    timezone: TZ_NY,
    referenceAt: NOW,
    windowFromMs: fromMs,
    windowToMs: toMs,
    report: null,
    personal: [],
    weather: series ? { series, pointKey: 'base' } : null,
    windWeather: series ? { series, pointKey: 'summit' } : null,
    units: METRIC,
    ...overrides,
  }
}

// Overnight storm: 20 h of 1.5 cm/h at −6 °C, ending 05:00 EST on the day → 30 cm.
const storm = fairWeather((_, t) => (within(t, '2027-01-14T15:00:00.000Z', '2027-01-15T11:00:00.000Z') ? { snowfallCm: 1.5, temperatureC: -6, precipitationMm: 1.5 } : {}))

// Thaw with rain on 13 Jan, then a hard freeze from 14 Jan 00:00Z.
const thawThenFreeze = fairWeather((_, t) => {
  if (within(t, '2027-01-13T12:00:00.000Z', '2027-01-14T00:00:00.000Z')) return { temperatureC: 4, rainMm: 0.5, precipitationMm: 0.5 }
  if (t >= '2027-01-14T00:00:00.000Z') return { temperatureC: -8 }
  return {}
})

// Rain and warmth during lift hours (14:00–21:00Z).
const warmRain = fairWeather((_, t) => (within(t, '2027-01-15T14:00:00.000Z', '2027-01-15T22:00:00.000Z') ? { temperatureC: 5, rainMm: 1, precipitationMm: 1 } : {}))

describe('evidence order', () => {
  it('uses a fresh official report verbatim with basis "reported"', () => {
    const r = interpretSurface(ctx(fairWeather(), { report: report() }), CFG)
    expect(r.surface.basis).toBe('reported')
    expect(r.surface.tags).toEqual(['packed-powder'])
    expect(r.surface.text).toBe('Packed powder')
    expect(r.evidence).toBe('official')
  })

  it('downgrades a stale report: older than the fresh limit it becomes a "Likely still …" inference that references it', () => {
    const stale = report({ localDate: '2027-01-13', reportedAt: '2027-01-13T12:10:00.000Z' }) // ~50 h old
    const r = interpretSurface(ctx(fairWeather(), { report: stale }), CFG)
    expect(r.reportState).toBe('stale')
    expect(r.surface.basis).toBe('inferred')
    expect(r.surface.text.startsWith('Likely still packed powder')).toBe(true)
    expect(r.surface.text).toContain('last report Wed 07:10')
    expect(r.surface.rules).toContain('surface/report-stale')
    expect(r.evidence).toBe('modeled')
  })

  it('lets later weather override a stale report with an inference that references the report', () => {
    const stale = report({ localDate: '2027-01-13', reportedAt: '2027-01-13T12:10:00.000Z' })
    const r = interpretSurface(ctx(storm, { report: stale }), CFG)
    expect(r.surface.basis).toBe('inferred')
    expect(r.surface.tags[0]).toBe('fresh-snow')
    expect(r.surface.text).toMatch(/^Likely fresh snow/)
    expect(r.surface.text).toContain('Based on the last report')
  })

  it('does not carry a stale report forward as "no change" when rain fell since it', () => {
    const stale = report({ localDate: '2027-01-13', reportedAt: '2027-01-13T12:10:00.000Z' })
    // 3 mm of rain overnight, then hovering at −1 °C (no hard freeze, no warm/wet lift hours): no rule fires.
    const rained = fairWeather((_, t) => {
      if (within(t, '2027-01-14T20:00:00.000Z', '2027-01-14T23:00:00.000Z')) return { rainMm: 1, temperatureC: 0.5 }
      if (t >= '2027-01-14T23:00:00.000Z') return { temperatureC: -1 }
      return {}
    })
    const r = interpretSurface(ctx(rained, { report: stale }), CFG)
    expect(r.surface.basis).toBe('inferred')
    expect(r.surface.text).not.toContain('Likely still')
    expect(r.surface.tags).toEqual(['mixed'])
    expect(r.notes.join(' ')).toContain('Since the last report: 3 mm modeled rain')
  })

  it('does not carry an older report\'s "fresh snow" forward as fresh', () => {
    const staleFresh = report({ localDate: '2027-01-13', reportedAt: '2027-01-13T12:10:00.000Z', surfaceTags: ['fresh-snow'], surfaceText: '25 cm new', snowfall: [{ window: '24h', amountCm: 25 }] })
    const r = interpretSurface(ctx(fairWeather(), { report: staleFresh }), CFG)
    expect(r.surface.tags).not.toContain('fresh-snow')
    expect(r.freshSnowCm).toBeNull()
    expect(r.surface.text.startsWith('Likely')).toBe(true)
  })

  it('ignores reports older than the stale limit entirely', () => {
    const old = report({ localDate: '2027-01-09', reportedAt: '2027-01-09T12:10:00.000Z' })
    const r = interpretSurface(ctx(fairWeather(), { report: old }), CFG)
    expect(r.reportState).toBe('too-old')
    expect(r.surface.basis).toBe('none')
    expect(r.surface.tags).toEqual(['unknown'])
  })

  it('measures report age from the publish time, not the fetch time; a missing publish time counts from the report date', () => {
    const noTime = report({ reportedAt: null })
    const r = interpretSurface(ctx(fairWeather(), { report: noTime }), CFG)
    expect(r.reportTimeAssumed).toBe(true)
    expect(r.reportAgeHours).toBeCloseTo(9, 6) // local midnight → 09:00
  })

  it('supersedes a fresh report when significant snow falls after it', () => {
    const snowAfter = fairWeather((_, t) => (within(t, '2027-01-15T13:00:00.000Z', '2027-01-15T20:00:00.000Z') ? { snowfallCm: 1.5, temperatureC: -5 } : {}))
    const r = interpretSurface(ctx(snowAfter, { report: report() }), CFG)
    expect(r.reportState).toBe('superseded')
    expect(r.surface.basis).toBe('inferred')
    expect(r.surface.text).toMatch(/^Likely fresh snow/)
    expect(r.surface.text).toContain('Packed powder')
  })

  it('prefers my own recent feedback over weather inference', () => {
    const r = interpretSurface(
      ctx(storm, { personal: [{ date: '2027-01-14', surfaceTags: ['firm'], recordedAt: '2027-01-14T22:00:00.000Z' }] }),
      CFG,
    )
    expect(r.surface.basis).toBe('personal')
    expect(r.surface.tags).toEqual(['firm'])
    expect(r.evidence).toBe('personal')
  })

  it('does not show yesterday’s report as today’s reported surface, even when it is under 24 h old', () => {
    const lastEvening = report({ localDate: '2027-01-14', reportedAt: '2027-01-14T21:00:00.000Z' }) // 16:00 EST, 12 h old
    const r = interpretSurface(ctx(fairWeather(), { report: lastEvening }), CFG)
    expect(r.reportAgeHours).toBeLessThan(CFG.surface.reportFreshMaxAgeHours)
    expect(r.reportState).toBe('stale')
    expect(r.surface.basis).toBe('inferred')
    expect(r.surface.text.startsWith('Likely still packed powder')).toBe(true)
  })

  it('never uses a report for a later date to describe an earlier one', () => {
    const later = report({ localDate: '2027-01-16', reportedAt: '2027-01-16T12:10:00.000Z' })
    const r = interpretSurface(ctx(fairWeather(), { report: later }), CFG)
    expect(r.reportState).toBe('absent')
    expect(r.surface.basis).not.toBe('reported')
    expect(r.surface.text).not.toContain('Packed powder')
    expect(r.notes.join(' ')).toContain('report for a later date')
  })

  it('does not treat a fresh report as describing a future date', () => {
    const r = interpretSurface(ctx(fairWeather(), { report: report(), projecting: true }), CFG)
    expect(r.surface.basis).toBe('inferred')
    expect(r.surface.text.startsWith('Likely')).toBe(true)
  })
})

describe('weather-inferred hypotheses', () => {
  it('infers fresh snow from cold modeled snowfall and phrases it as "Likely …", without claiming powder', () => {
    const r = interpretSurface(ctx(storm), CFG)
    expect(r.surface.basis).toBe('inferred')
    expect(r.surface.tags).toEqual(['fresh-snow'])
    expect(r.surface.text.startsWith('Likely')).toBe(true)
    expect(r.surface.text.toLowerCase()).not.toContain('powder')
    expect(r.surface.text).toContain('grooming and coverage unknown')
    expect(r.freshSnowCm).toBeCloseTo(30, 6)
    expect(r.freshSnowSource).toBe('modeled')
    expect(r.surface.rules).toContain('surface/fresh-snow-cold')
  })

  it('does not read snow followed by rain as fresh snow', () => {
    const snowThenRain = fairWeather((_, t) => {
      if (within(t, '2027-01-14T10:00:00.000Z', '2027-01-14T20:00:00.000Z')) return { snowfallCm: 1, temperatureC: -2 }
      if (within(t, '2027-01-14T20:00:00.000Z', '2027-01-15T02:00:00.000Z')) return { rainMm: 1, temperatureC: 2 }
      return {}
    })
    const r = interpretSurface(ctx(snowThenRain), CFG)
    expect(r.surface.tags).not.toContain('fresh-snow')
    expect(r.notes.join(' ')).toContain('followed by rain or warmth')
  })

  it('does not read snow as fresh when rain and temperature after it are unknown (unknown is not "dry and cold")', () => {
    const afterSnow = (t: string) => t >= '2027-01-15T11:00:00.000Z'
    const unknownAfter = storm.map((h) => (afterSnow(h.validTime) ? { ...h, rainMm: null, precipitationMm: null, temperatureC: null } : h))
    const r = interpretSurface(ctx(unknownAfter), CFG)
    expect(r.surface.tags).not.toContain('fresh-snow')
    expect(r.notes.join(' ')).toContain('rain or temperature after it is unknown')

    // Rain missing but total precipitation (an upper bound on rain) known and dry: still fresh snow.
    const precipOnly = storm.map((h) => (afterSnow(h.validTime) ? { ...h, rainMm: null, precipitationMm: 0 } : h))
    expect(interpretSurface(ctx(precipOnly), CFG).surface.tags).toEqual(['fresh-snow'])
  })

  it('infers firm/refrozen after thaw + sustained freeze only where snow is known to exist', () => {
    const withoutSnowEvidence = interpretSurface(ctx(thawThenFreeze), CFG)
    expect(withoutSnowEvidence.surface.tags).not.toContain('icy-refrozen')
    expect(withoutSnowEvidence.surface.tags).not.toContain('firm')
    expect(withoutSnowEvidence.notes.join(' ')).toContain('snow cover is not confirmed')

    const stale = report({ localDate: '2027-01-13', reportedAt: '2027-01-13T12:10:00.000Z', baseDepthCm: 90 })
    const withSnow = interpretSurface(ctx(thawThenFreeze, { report: stale }), CFG)
    expect(withSnow.snowKnownToExist).toBe(true)
    expect(withSnow.surface.basis).toBe('inferred')
    expect(withSnow.surface.tags).toEqual(['icy-refrozen'])
    expect(withSnow.surface.text).toMatch(/^Likely icy or refrozen/)
  })

  it('infers wet/slushy from warmth and rain during lift hours', () => {
    const r = interpretSurface(ctx(warmRain), CFG)
    expect(r.surface.tags).toEqual(['wet-slushy'])
    expect(r.surface.text).toMatch(/^Likely wet or slushy/)
  })

  it('adds a late-day warming note that shifts the preferred time window', () => {
    const warming = fairWeather((_, t) => (within(t, '2027-01-15T17:00:00.000Z', '2027-01-15T22:00:00.000Z') ? { temperatureC: 2 } : {}))
    const r = interpretSurface(ctx(warming, { report: report() }), CFG)
    expect(r.surface.basis).toBe('reported')
    expect(r.surface.rules).toContain('surface/late-day-warming')
    expect(r.notes.join(' ')).toMatch(/Likely firmer early, softening from about 12:00/)
  })

  it('flags possible wind-affected snow on exposed terrain after strong wind, never as a lift-closure claim', () => {
    const windy = storm.map((h) => (h.validTime >= '2027-01-15T00:00:00.000Z' ? { ...h, windKmh: 45, gustKmh: 80 } : h))
    const r = interpretSurface(ctx(windy), CFG)
    expect(r.surface.tags).toEqual(['fresh-snow', 'wind-affected'])
    expect(r.surface.text).toContain('Possibly wind-affected snow on exposed terrain')
    expect(r.surface.text.toLowerCase()).not.toContain('lift')
  })

  it('returns basis none / unknown when there is no evidence at all', () => {
    const r = interpretSurface(ctx(null), CFG)
    expect(r.surface).toEqual({ tags: ['unknown'], basis: 'none', text: 'Unknown — no recent surface report or weather data', rules: [] })
  })
})

describe('grooming and snowmaking stay separate from surface', () => {
  it('keeps grooming/snowmaking as management info and never turns them into surface evidence', () => {
    const groomedOnly = report({ surfaceTags: [], surfaceText: null, groomingText: '14 trails groomed overnight', groomedRuns: 14, snowmakingText: 'Snowmaking on Chair 2 trails' })
    const r = interpretSurface(ctx(fairWeather(), { report: groomedOnly }), CFG)
    expect(r.surface.basis).not.toBe('reported')
    expect(r.reportState).toBe('no-surface')
    expect(r.management).toEqual({ groomingText: '14 trails groomed overnight', groomedRuns: 14, snowmakingText: 'Snowmaking on Chair 2 trails' })
  })
})
