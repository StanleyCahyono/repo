import { getCtx } from '@/lib/context'
import { getTripsPage } from '@/lib/data/trip-plan'
import { PageHeader } from '@/components/ui/page-header'
import { DemoBadge } from '@/components/ui/badge'
import { TripsOverview } from '@/components/trips/trip-list'
import { NewTripButton, NewTripSheet } from '@/components/trips/new-trip-sheet'

export const metadata = { title: 'Trips' }

export default async function TripsPage() {
  const ctx = await getCtx()
  const data = await getTripsPage(ctx)
  const season = ctx.prefs.activeSeasonId.replace('-', '–')
  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <span>Season {season}</span>
            <span aria-hidden>·</span>
            <span>From {data.home}</span>
            {data.demo ? <DemoBadge /> : null}
          </>
        }
        title="Trips"
        lead="Start from dates and a resort, then add travel, lodging, lessons and events. Every price is yours — an estimate, a quote or an actual — and nothing is booked from here."
        actions={<NewTripButton />}
      />
      <TripsOverview data={data} />
      <NewTripSheet resorts={data.picker} today={data.today} templateCount={data.templateCount} />
    </>
  )
}
