import { DemoBadge } from '@/components/ui/badge'
import { EventsScreen } from '@/components/explore/events-screen'
import { ExploreHeader } from '@/components/explore/explore-header'
import { getCtx } from '@/lib/context'
import { getEventsView } from '@/lib/data/explore'

export const metadata = { title: 'Events' }

export default async function EventsPage() {
  const ctx = await getCtx()
  const view = await getEventsView(ctx)
  return (
    <>
      <ExploreHeader
        eyebrow={
          <>
            <span>Season {view.seasonLabel}</span>
            <span aria-hidden>·</span>
            <span>
              {view.events.length} {view.events.length === 1 ? 'event' : 'events'} tracked
            </span>
            {view.demo ? <DemoBadge /> : null}
          </>
        }
        title="Events"
        lead="Festivals, races, live music and opening days at the resorts — with honest dates: announced, tentative, or still waiting for the organiser."
      />
      <EventsScreen view={view} />
    </>
  )
}
