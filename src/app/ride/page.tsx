/**
 * Ride there — the Uber-style journey map from home to any resort (/ride?to=<resortId>&mode=drive|fly&via=&from=).
 * Data: src/lib/data/ride.ts (curated drive estimates, recorded airports and transfers, published lift hours).
 */
import type { Metadata } from 'next'
import { RideThere } from '@/components/ride/ride-there'
import { getCtx } from '@/lib/context'
import { getRideIndex, getRidePlan } from '@/lib/data/ride'

export const metadata: Metadata = { title: 'Ride there' }

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? undefined

export default async function RidePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const to = one(sp.to)
  const mode = one(sp.mode)
  const ctx = await getCtx()
  const [index, plan] = await Promise.all([getRideIndex(ctx), to ? getRidePlan(ctx, to) : Promise.resolve(null)])
  const code = (v: string | undefined) => (v && /^[A-Z]{3}$/.test(v.toUpperCase()) ? v.toUpperCase() : undefined)
  return (
    <RideThere
      plan={plan}
      index={index}
      home={index.home}
      initial={{ mode: mode === 'fly' || mode === 'drive' ? mode : undefined, via: code(one(sp.via)), from: code(one(sp.from)) }}
    />
  )
}
