import { getCtx } from '@/lib/context'
import { getTripsPage } from '@/lib/data/trip-plan'
import { DemoBadge } from '@/components/ui/badge'
import { TripsOverview } from '@/components/trips/trip-list'
import { NewTripButton, NewTripSheet } from '@/components/trips/new-trip-sheet'
import { Rise } from '@/components/trips/rise'

export const metadata = { title: 'Trips' }

export default async function TripsPage() {
  const ctx = await getCtx()
  const data = await getTripsPage(ctx)
  const season = ctx.prefs.activeSeasonId.replace('-', '–')
  const n = data.upcoming.length
  const any = n + data.past.length + data.cancelled.length > 0
  return (
    <>
      <Rise>
        <header className="mb-8 flex flex-col gap-5 md:mb-10 md:flex-row md:items-end md:justify-between">
          <div className="flex min-w-0 flex-col gap-3">
            <p className="hud flex flex-wrap items-center gap-x-2.5 gap-y-1 tracking-[0.16em] text-teal">
              <span>Trip planner</span>
              <span aria-hidden>·</span>
              <span>Season {season}</span>
              <span aria-hidden>·</span>
              <span>From {data.home}</span>
              {data.demo ? <DemoBadge /> : null}
            </p>
            <h1 className="m-0 text-[clamp(44px,6vw,84px)] leading-[0.98] font-light tracking-[-0.04em] text-ink">{!any ? 'No trips yet.' : n ? `${n} ${n === 1 ? 'trip' : 'trips'} ahead.` : 'Trips.'}</h1>
            <p className="m-0 max-w-[620px] text-[16px] leading-[1.5] text-ink-2 md:text-[18px]">
              Start from a resort and dates, then add travel, lodging, lessons and events. Every price is yours — an estimate, a quote or an actual — and nothing is booked from here.
            </p>
          </div>
          {any ? <NewTripButton className="h-11 self-start md:self-auto" /> : null}
        </header>
      </Rise>
      <TripsOverview data={data} />
      <NewTripSheet resorts={data.picker} today={data.today} templateCount={data.templateCount} />
    </>
  )
}
