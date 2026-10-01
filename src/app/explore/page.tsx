import { DemoBadge } from '@/components/ui/badge'
import { ExploreScreen } from '@/components/explore/explore-screen'
import { getCtx } from '@/lib/context'
import { getExploreView } from '@/lib/data/explore'
import { SCORING_MODES, type ScoringMode } from '@/lib/domain/types'

export const metadata = { title: 'Explore' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null

export default async function ExplorePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams
  const ctx = await getCtx()
  const modeParam = one(sp.mode)
  const mode = modeParam && (SCORING_MODES as readonly string[]).includes(modeParam) ? (modeParam as ScoringMode) : null
  const view = await getExploreView(ctx, { date: one(sp.date), mode })

  return (
    <ExploreScreen
      view={view}
      eyebrow={
        <>
          <span>Season {view.seasonLabel}</span>
          <span aria-hidden>·</span>
          <span>
            {view.counts.total} resorts from {view.home.name}
          </span>
          {view.demo ? <DemoBadge /> : null}
        </>
      }
    />
  )
}
