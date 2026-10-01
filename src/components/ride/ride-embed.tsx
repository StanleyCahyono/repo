/**
 * Server wrapper for embedding "Ride there" with a fixed destination (resort page travel section, trip planner):
 * `<RideThereEmbed resortId="zermatt" mode="fly" />`. Renders nothing when the resort is unknown.
 */
import { getCtx } from '@/lib/context'
import { getRidePlan } from '@/lib/data/ride'
import { RideThere } from './ride-there'
import type { RideMode } from './journey-model'

export async function RideThereEmbed({ resortId, mode, className }: { resortId: string; mode?: RideMode; className?: string }) {
  const ctx = await getCtx()
  const plan = await getRidePlan(ctx, resortId)
  if (!plan) return null
  return <RideThere plan={plan} home={plan.home} initial={{ mode }} className={className} />
}
