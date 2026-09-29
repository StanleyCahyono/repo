/**
 * Deterministic pseudo-random numbers for the demo generator.
 *
 * Every draw comes from a *named stream* (`rng('fc|east|2027-01-08T11:00:00.000Z')`) seeded by hashing the name, so
 * the generated data does not depend on the order in which things are generated: adding a resort or a report
 * never changes the weather of another resort. Never use Math.random() in demo code.
 */

/** Bump to regenerate a different (still deterministic) demo world. */
export const DEMO_SEED = 'piste-demo-v1'

/** FNV-1a 32-bit hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  uniform(min: number, max: number): number
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number
  /** Standard normal (Box–Muller) scaled to mean/sd. */
  normal(mean?: number, sd?: number): number
  chance(p: number): boolean
  pick<T>(xs: readonly T[]): T
}

/** mulberry32 seeded from the stream name (plus the global demo seed). */
export function rng(name: string): Rng {
  let a = hashString(`${DEMO_SEED}|${name}`) || 0x9e3779b9
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  let spare: number | null = null
  return {
    next,
    uniform: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    normal: (mean = 0, sd = 1) => {
      if (spare !== null) {
        const v = spare
        spare = null
        return mean + sd * v
      }
      let u = 0
      while (u <= Number.EPSILON) u = next()
      const v = next()
      const r = Math.sqrt(-2 * Math.log(u))
      spare = r * Math.sin(2 * Math.PI * v)
      return mean + sd * r * Math.cos(2 * Math.PI * v)
    },
    chance: (p) => next() < p,
    pick: (xs) => xs[Math.floor(next() * xs.length) % xs.length],
  }
}
