import { Badge } from '@/components/ui/badge'
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

  return (
    <>
      <ExploreHeader
        eyebrow={
          <>
            <span>Season {view.seasonLabel}</span>
            <span aria-hidden className="text-ink-3">
              ·
            </span>
            <span>{view.dateLabel}</span>
            {view.demo ? (
              <Badge tone="demo" className="normal-case tracking-normal">
                Demo data
              </Badge>
            ) : null}
          </>
        }
        title="Compare"
        lead={
          view.columns.length >= 2
            ? `${view.columns.map((c) => c.card.shortName).join(', ')} — side by side on identical terms.`
            : 'Two to four resorts, side by side on identical terms.'
        }
      />
      <CompareScreen view={view} />
    </>
  )
}
