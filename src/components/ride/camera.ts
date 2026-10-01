/**
 * Shared camera choreography for the journey maps (pure numbers, no DOM): how long each phase lasts and where the
 * camera should be while a car or plane glyph travels a leg. Both the MapLibre map and the offline schematic follow it.
 */
import { easeInOut, legDurationMs, pathKm, pointAlong, cumulativeKm, type LonLat } from '@/lib/domain/journey'
import type { Journey, Leg } from './journey-model'

export const OVERVIEW_MS = 1700
export const APPROACH_MS = 2600

export interface Timeline {
  legs: { leg: Leg; start: number; dur: number; cum: number[] }[]
  /** When the last leg ends (approach starts). */
  travelEnd: number
  end: number
}

export function timeline(j: Journey): Timeline {
  let t = OVERVIEW_MS
  const legs = j.legs.map((leg) => {
    const dur = legDurationMs(leg.kind, leg.km || pathKm(leg.coords))
    const item = { leg, start: t, dur, cum: cumulativeKm(leg.coords) }
    t += dur
    return item
  })
  return { legs, travelEnd: t, end: t + APPROACH_MS }
}

export type Phase = { phase: 'overview' } | { phase: 'leg'; index: number; f: number; e: number; point: LonLat; vertex: number } | { phase: 'approach'; f: number } | { phase: 'done' }

export function phaseAt(tl: Timeline, t: number): Phase {
  if (t < OVERVIEW_MS) return { phase: 'overview' }
  for (let i = 0; i < tl.legs.length; i++) {
    const L = tl.legs[i]
    if (t < L.start + L.dur) {
      const f = Math.max(0, (t - L.start) / L.dur)
      const e = easeInOut(f)
      const at = pointAlong(L.leg.coords, L.cum, e)
      return { phase: 'leg', index: i, f, e, point: at.point, vertex: at.index }
    }
  }
  if (t < tl.end) return { phase: 'approach', f: (t - tl.travelEnd) / APPROACH_MS }
  return { phase: 'done' }
}

/** Visible span (km across the view) while following a leg at eased progress e: zooms out mid-leg, in at the ends. */
export function followSpanKm(leg: Leg, e: number): number {
  const arc = Math.sin(Math.PI * Math.max(0, Math.min(1, e)))
  const km = leg.km
  if (leg.kind === 'air') {
    const near = Math.min(420, Math.max(160, km * 0.12))
    const far = Math.max(near, km * 0.85)
    return near + (far - near) * arc
  }
  if (leg.kind === 'drive') {
    const near = Math.max(16, Math.min(260, km * 0.5))
    return near * (1 + 0.9 * arc)
  }
  const near = Math.max(12, Math.min(160, km * 1.1))
  return near * (1 + 0.4 * arc)
}

export const APPROACH_SPAN_KM = 30
