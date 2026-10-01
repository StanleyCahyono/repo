import Link from 'next/link'
import { DemoBadge } from '@/components/ui/badge'
import { CompareScreen } from '@/components/explore/compare-screen'
import { ExploreHeader } from '@/components/explore/explore-header'
import { getCtx } from '@/lib/context'
import { getCompareView } from '@/lib/data/explore'
import { SCORING_MODES, type ScoringMode } from '@/lib/domain/types'

export const metadata = { title: 'Compare resorts' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null

export default async function ComparePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams
  const ctx = await getCtx()
  const ids = (one(sp.ids) ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
  const modeParam = one(sp.mode)
  const mode = modeParam && (SCORING_MODES as readonly string[]).includes(modeParam) ? (modeParam as ScoringMode) : null
  const party = Number(one(sp.party) ?? 1)
  const product = one(sp.product)
  const view = await getCompareView(ctx, {
    ids,
    date: one(sp.date),
    mode,
    party: Number.isFinite(party) ? party : 1,
    productId: product && /^[a-z0-9-]{1,100}$/.test(product) ? product : null,
  })

  const names = view.columns.map((c) => c.card.shortName)
  const title =
    names.length >= 2 ? `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}.` : names.length === 1 ? `${names[0]}, and…` : 'Side by side.'

  return (
    <>
      <ExploreHeader
        eyebrow={
          <>
            <span>
              Compare · {view.columns.length} of 4
            </span>
            <span aria-hidden>·</span>
            <span>{view.dateLabel}</span>
            <span aria-hidden>·</span>
            <span>Season {view.seasonLabel}</span>
            {view.demo ? <DemoBadge /> : null}
          </>
        }
        title={title}
        actions={
          <Link href="/explore" className="hud rounded-full px-2 py-2 text-ink-2 hover:text-ink">
            ← Back to map
          </Link>
        }
      />
      <CompareScreen view={view} />
    </>
  )
}
