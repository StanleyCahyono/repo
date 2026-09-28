import type { AppMode } from '@/lib/domain/types'

/**
 * Demo mode runs against a simulated mid-season instant so in-season workflows can be explored before the
 * season starts. Live mode always uses the real clock.
 */
export const DEMO_NOW = '2027-01-15T14:00:00.000Z' // Friday 15 Jan 2027, 09:00 in Ithaca

export function nowFor(mode: AppMode): string {
  if (mode === 'demo') return DEMO_NOW
  const fixed = process.env.PISTE_FIXED_NOW // test/debug hook, never set in normal use
  return fixed ? new Date(fixed).toISOString() : new Date().toISOString()
}
