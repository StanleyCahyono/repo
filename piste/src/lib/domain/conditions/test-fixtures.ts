/**
 * Recorded-format fixtures for conditions tests. Hourly records follow Open-Meteo's normalised shape
 * (`HourlyWeather`, preceding-hour accumulations). Not imported by production code.
 */
import type { HourlyWeather } from '@/lib/providers/types'
import { addHours } from '../time'
import type { AssessDayInput, OperationsEvidence, PointWeather, ReportEvidence } from './types'

export function blankHour(validTime: string): HourlyWeather {
  return {
    validTime,
    temperatureC: null,
    apparentTemperatureC: null,
    snowfallCm: null,
    rainMm: null,
    precipitationMm: null,
    windKmh: null,
    gustKmh: null,
    humidityPct: null,
    visibilityM: null,
    cloudCoverPct: null,
    freezingLevelM: null,
    snowDepthM: null,
    weatherCode: null,
    isDay: null,
  }
}

/** `hours` consecutive hourly records starting at `from` (UTC ISO). */
export function hourly(from: string, hours: number, fn: (i: number, validTime: string) => Partial<HourlyWeather> = () => ({})): HourlyWeather[] {
  return Array.from({ length: hours }, (_, i) => {
    const t = addHours(from, i)
    return { ...blankHour(t), ...fn(i, t) }
  })
}

/** Calm, cold, clear, dry weather. */
export const FAIR: Partial<HourlyWeather> = {
  temperatureC: -4,
  apparentTemperatureC: -7,
  snowfallCm: 0,
  rainMm: 0,
  precipitationMm: 0,
  windKmh: 10,
  gustKmh: 20,
  visibilityM: 20000,
  cloudCoverPct: 20,
}

export function point(pointKey: 'base' | 'summit', hours: HourlyWeather[], extra: Partial<PointWeather> = {}): PointWeather {
  return {
    pointKey,
    kind: 'modeled',
    provider: 'Open-Meteo',
    model: 'best_match',
    intervalSemantics: 'preceding-hour',
    fetchedAt: null,
    modelRunAt: null,
    elevationM: pointKey === 'base' ? 350 : 640,
    horizonDays: 16,
    hourly: hours,
    ...extra,
  }
}

export function report(overrides: Partial<ReportEvidence> = {}): ReportEvidence {
  return {
    kind: 'official',
    localDate: '2027-01-15',
    reportedAt: '2027-01-15T12:10:00.000Z', // 07:10 EST
    status: 'open',
    snowfall: [],
    baseDepthCm: 90,
    surfaceTags: ['packed-powder'],
    surfaceText: 'Packed powder',
    groomingText: null,
    groomedRuns: null,
    snowmakingText: null,
    openTrails: 30,
    totalTrails: 40,
    openLifts: 6,
    totalLifts: 8,
    openBeginnerTrails: 6,
    totalBeginnerTrails: 8,
    ...overrides,
  }
}

export function ops(overrides: Partial<OperationsEvidence> = {}): OperationsEvidence {
  return {
    status: null,
    statusDate: null,
    statusAt: null,
    announcedOpening: '2026-12-05',
    estimatedOpenFrom: null,
    actualOpening: '2026-12-05',
    announcedClosing: null,
    actualClosing: null,
    ...overrides,
  }
}

export const TZ_NY = 'America/New_York'
export const DAY = '2027-01-15'
export const NOW = '2027-01-15T14:00:00.000Z' // 09:00 EST

/** Four days of history before DAY through five days after, hourly, fair weather unless overridden. */
export function fairWeather(fn: (i: number, t: string) => Partial<HourlyWeather> = () => ({})): HourlyWeather[] {
  return hourly('2027-01-11T05:00:00.000Z', 24 * 10, (i, t) => ({ ...FAIR, ...fn(i, t) }))
}

/** A complete, open, perfect day: fresh official report, fair weather at base and summit. */
export function perfectDay(overrides: Partial<AssessDayInput> = {}): AssessDayInput {
  return {
    date: DAY,
    timezone: TZ_NY,
    now: NOW,
    mode: 'learning',
    weather: {
      base: point('base', fairWeather(), { fetchedAt: '2027-01-15T12:00:00.000Z' }),
      summit: point('summit', fairWeather(), { fetchedAt: '2027-01-15T12:00:00.000Z' }),
    },
    report: report(),
    personalFeedback: [],
    operations: ops(),
    alerts: [],
    units: { temperature: 'C', snow: 'cm', distance: 'km', elevation: 'm', speed: 'kmh' },
    ...overrides,
  }
}
