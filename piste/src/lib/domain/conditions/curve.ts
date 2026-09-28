import type { Curve } from './types'

/** Evaluate a piecewise-linear curve. Inputs beyond either end clamp to the end value. */
export function evalCurve(curve: Curve, x: number): number {
  if (curve.length === 0) throw new Error('Empty curve')
  if (!Number.isFinite(x)) throw new Error(`Curve input must be finite: ${x}`)
  if (x <= curve[0][0]) return curve[0][1]
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i]
    if (x <= x1) {
      const [x0, y0] = curve[i - 1]
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return curve[curve.length - 1][1]
}

/** True when x values strictly ascend (config sanity check). */
export function isValidCurve(curve: Curve): boolean {
  return curve.length > 0 && curve.every((p, i) => i === 0 || p[0] > curve[i - 1][0])
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
