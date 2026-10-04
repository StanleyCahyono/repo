import type { Metadata } from 'next'
import { CalendarPlus } from 'lucide-react'
import { CheapestWay, DayList, StepHead } from '@/components/passes/compare'
import { compareModel } from '@/components/passes/compare-model'
import { plural } from '@/components/passes/format'
import { PassesNav, PendingNote, PendingVeil } from '@/components/passes/nav'
import { parseCompare } from '@/components/passes/params'
import { Payoff } from '@/components/passes/payoff'
import { Rise } from '@/components/passes/rise'
import { AddDayForm, ClearAddedDays, CurrencyPill } from '@/components/passes/scenario-editor'
import { getCtx } from '@/lib/context'
import { getPassCompareView } from '@/lib/data/passes-screen'

export const metadata: Metadata = { title: 'Pass vs tickets · Passes & Costs' }

export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = parseCompare(await searchParams)
  const ctx = await getCtx()
  const v = await getPassCompareView(ctx, { added: q.days, includeTrips: q.trips, currency: q.cur })
  const added = v.days.filter((d) => d.source === 'added').map((d) => ({ resortId: d.resortId, date: d.date }))
  const model = compareModel(v)

  return (
    <PassesNav>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:items-start">
        <Rise index={0} className="min-w-0">
          <section aria-labelledby="days-title" className="glass rounded-[28px] p-4 sm:p-5 md:p-6">
            <StepHead n={1} id="days-title" title="Your ski days" aside={v.days.length ? <span className="hud tracking-[0.1em] text-ink-2 tnum">{plural(v.days.length, 'day')}</span> : null}>
              Pick a resort and a day — or a few. Each day is priced with that resort’s own lift ticket.
            </StepHead>
            <AddDayForm added={added} resorts={v.resorts} today={v.today} seasonEnd={v.season.end} includeTrips={v.includeTrips} tripDayCount={v.tripDayCount} />
            {v.dropped ? <p className="m-0 mt-2 text-[12.5px] text-caution">{plural(v.dropped, 'day')} from the link were skipped (past, outside the season, unknown resort or a repeat).</p> : null}
            {v.days.length ? (
              <PendingVeil className="mt-5 border-t border-divider pt-4">
                <DayList view={v} model={model} added={added} />
                {added.length ? <ClearAddedDays className="mt-2" /> : null}
              </PendingVeil>
            ) : (
              <p className="m-0 mt-5 flex items-start gap-2.5 rounded-[18px] border border-dashed border-divider-strong bg-glass-soft px-4 py-3.5 text-[14px] text-ink-2">
                <CalendarPlus aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
                <span>No days yet. Add one above{v.tripDayCount ? ', or switch on your trips' : ', or plan them in Trips'}.</span>
              </p>
            )}
          </section>
        </Rise>

        <Rise index={1} className="min-w-0">
          <section aria-labelledby="cheapest-title" className="glass rounded-[28px] p-4 sm:p-5 md:p-6">
            <StepHead
              n={2}
              id="cheapest-title"
              title="Cheapest way"
              aside={
                <>
                  <PendingNote />
                  <CurrencyPill value={v.currency} choices={v.currencies} preferred={ctx.prefs.currency.toUpperCase()} />
                </>
              }
            />
            <PendingVeil>
              {model ? (
                <CheapestWay model={model} view={v} />
              ) : (
                <p className="m-0 rounded-[18px] border border-dashed border-divider-strong bg-glass-soft px-4 py-4 text-[14px] text-ink-2">
                  Add your ski days and the cheapest way to pay for them shows up here — lift tickets or a pass. Lodging, travel, rentals and lessons are the same either way and
                  are left out.
                </p>
              )}
            </PendingVeil>
          </section>
        </Rise>
      </div>

      {model ? (
        <Rise index={2} className="mt-6 min-w-0">
          <section aria-labelledby="payoff-title" className="glass rounded-[28px] p-4 sm:p-5 md:p-6">
            <StepHead n={3} id="payoff-title" title="When does a pass pay off?" />
            <PendingVeil>
              {model.payoff.length ? (
                <Payoff key={`${model.dayCount}:${model.payoff.map((p) => p.id).join(',')}`} passes={model.payoff} dayCount={model.dayCount} />
              ) : (
                <p className="m-0 text-[14px] text-ink-2">
                  No pass with a published price covers these days yet, so there is no break-even to show. Add your own price for a pass in step 2 to see it.
                </p>
              )}
            </PendingVeil>
          </section>
        </Rise>
      ) : null}
    </PassesNav>
  )
}
