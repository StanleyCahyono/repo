import type { Metadata } from 'next'
import { CompareResults, PlannedDays } from '@/components/passes/compare'
import { plural } from '@/components/passes/format'
import { PassesNav, PendingNote, PendingVeil } from '@/components/passes/nav'
import { parseCompare } from '@/components/passes/params'
import { Rise } from '@/components/passes/rise'
import { AddDayForm, ClearAddedDays, TripDaysToggle, ViewSwitch } from '@/components/passes/scenario-editor'
import { PassesSection } from '@/components/passes/section'
import { CurrencySelect } from '@/components/passes/toolbar'
import { getCtx } from '@/lib/context'
import { getPassCompareView } from '@/lib/data/passes-screen'

export const metadata: Metadata = { title: 'Pass vs tickets · Passes & Costs' }

export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = parseCompare(await searchParams)
  const ctx = await getCtx()
  const v = await getPassCompareView(ctx, { added: q.days, includeTrips: q.trips, currency: q.cur })
  const added = v.days.filter((d) => d.source === 'added').map((d) => ({ resortId: d.resortId, date: d.date }))
  const convertedFx = v.fx.filter((f) => f.rate)
  const missingFx = v.fx.filter((f) => !f.rate)

  return (
    <PassesNav>
      <PassesSection
        id="compare"
        rule={false}
        title="Pass vs tickets"
        meta={
          <>
            Your planned resort-days, each priced with that day’s own lift ticket, against every {v.season.label} product: the pass price plus tickets for the days it
            can’t cover. Lodging, travel, rentals and lessons are the same either way and left out.
          </>
        }
      >
        <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:items-start">
          <Rise index={0} className="flex min-w-0 flex-col gap-4">
            <section aria-labelledby="days-title" className="rounded-[12px] border border-divider bg-surface px-4 py-4 md:px-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 id="days-title" className="text-[16px] font-semibold text-ink">
                  Planned days <span className="font-normal text-ink-3 tnum">({v.days.length})</span>
                </h3>
                <TripDaysToggle include={v.includeTrips} count={v.tripDayCount} />
              </div>
              <AddDayForm added={added} resorts={v.resorts} today={v.today} seasonEnd={v.season.end} />
              {v.dropped ? <p className="mt-2 text-[12.5px] text-caution">{plural(v.dropped, 'day')} from the link were skipped (past, outside the season, unknown resort or a duplicate).</p> : null}
            </section>
            {v.days.length ? (
              <PendingVeil>
                <PlannedDays view={v} added={added} />
                {added.length ? <ClearAddedDays className="mt-2" /> : null}
              </PendingVeil>
            ) : null}
          </Rise>

          <Rise index={1} className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-4 rounded-[12px] border border-divider bg-surface px-4 py-4 md:flex-row md:flex-wrap md:items-end md:justify-between md:px-5">
              <ViewSwitch value={q.view} />
              <CurrencySelect value={v.currency} choices={v.currencies} preferred={ctx.prefs.currency.toUpperCase()} />
            </div>
            {convertedFx.length || missingFx.length ? (
              <p className="-mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-3">
                {convertedFx.map((f) => (
                  <span key={f.from} className="tnum">
                    {f.rate} · {f.rateDate}
                    {f.demo ? ' · demo rate' : f.provider ? ` · ${f.provider}` : ''}
                  </span>
                ))}
                {missingFx.map((f) => (
                  <span key={f.from} className="text-caution">
                    No stored {f.from}→{f.to} rate — those amounts can’t be totalled in {f.to}
                  </span>
                ))}
              </p>
            ) : null}
            <PendingNote />
            <PendingVeil>
              {v.result ? (
                <CompareResults view={v} mode={q.view} />
              ) : (
                <div className="rounded-[12px] border border-dashed border-divider-strong bg-surface-2 px-5 py-6">
                  <p className="text-[15px] font-semibold text-ink">No planned days yet</p>
                  <p className="mt-1 max-w-[60ch] text-[14px] text-ink-2">
                    Add the resort-days you expect to ski — or plan them in Trips — and each pass is compared with buying that day’s own ticket. Nothing is
                    assumed: a day without a recorded ticket price stays unknown and blocks the total rather than being guessed.
                  </p>
                </div>
              )}
            </PendingVeil>
          </Rise>
        </div>
      </PassesSection>
    </PassesNav>
  )
}
