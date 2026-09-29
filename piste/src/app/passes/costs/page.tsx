import type { Metadata } from 'next'
import { ChevronRight } from 'lucide-react'
import { AssumptionsForm } from '@/components/passes/assumptions-form'
import { BandRuler, CostsList, CostsTable, type EstimateCtx } from '@/components/passes/costs'
import { dayLabel, plural } from '@/components/passes/format'
import { PassesNav, PendingNote, PendingVeil } from '@/components/passes/nav'
import { parseCosts } from '@/components/passes/params'
import { Rise } from '@/components/passes/rise'
import { PassesSection } from '@/components/passes/section'
import { ChipFilter, CurrencySelect, DateField } from '@/components/passes/toolbar'
import { getCtx } from '@/lib/context'
import { getDayCostsView, MAX_PARTY, type DayCostRow } from '@/lib/data/passes-screen'
import { RENTAL_LABEL } from '@/lib/domain/costs'
import { toMajorString } from '@/lib/domain/money'

export const metadata: Metadata = { title: 'Day costs · Passes & Costs' }

const DAY_TYPE_TEXT: Record<string, string> = { weekday: 'weekday prices', weekend: 'weekend prices', holiday: 'holiday prices' }

function Rows({ rows, ctx, currency, caption }: { rows: DayCostRow[]; ctx: EstimateCtx; currency: string; caption?: string }) {
  return (
    <>
      <div className="max-lg:hidden">
        <CostsTable rows={rows} ctx={ctx} currency={currency} caption={caption} />
      </div>
      <div className="lg:hidden">
        <CostsList rows={rows} ctx={ctx} />
      </div>
    </>
  )
}

export default async function CostsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = parseCosts(await searchParams)
  const ctx = await getCtx()
  const v = await getDayCostsView(ctx, { date: q.date, currency: q.cur })
  const all = v.rows
  const complete = all.filter((r) => r.basket.total)
  const shown = (q.show === 'favorites' ? all.filter((r) => r.resort.isFavorite) : q.show === 'complete' ? complete : all).slice().sort((a, b) => {
    const at = a.basket.total?.amountMinor
    const bt = b.basket.total?.amountMinor
    if (at != null && bt != null) return at - bt
    if (at != null) return -1
    if (bt != null) return 1
    return Number(b.resort.isFavorite) - Number(a.resort.isFavorite)
  })
  // "All resorts": complete baskets and favourites up front; the rest (still missing a required price) folded away.
  const lead = q.show === 'all' ? shown.filter((r) => r.basket.total || r.resort.isFavorite) : shown
  const rest = q.show === 'all' ? shown.filter((r) => !r.basket.total && !r.resort.isFavorite) : []
  const a = v.assumptions
  const c = v.coverage
  const rentalMissingEverywhere = c.rentalOnDate === 0
  const est: EstimateCtx = { date: v.date, rentalOption: a.rentalOption, currencies: v.entryCurrencies, defaultCurrency: ctx.prefs.currency.toUpperCase(), seasonLabel: v.season.label }

  return (
    <PassesNav>
      <PassesSection
        id="costs"
        rule={false}
        title="Day costs by resort"
        meta={
          <>
            A per-person day basket for every resort on {dayLabel(v.date, true)} ({v.holidayName ? `${v.holidayName} — holiday prices` : DAY_TYPE_TEXT[v.dayType]}): lift
            access, {RENTAL_LABEL[a.rentalOption].toLowerCase()}, lunch and your share of parking, with the same assumptions everywhere.
            {v.myPasses.length ? ` Your ${v.myPasses.join(' and ')} covers lift access where its rules allow on this date.` : ''}
          </>
        }
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Rise index={0}>
            <section aria-labelledby="assumptions-title" className="h-full rounded-[12px] border border-divider bg-surface px-4 py-4 md:px-5">
              <h3 id="assumptions-title" className="mb-3 text-[16px] font-semibold text-ink">
                Basket assumptions
              </h3>
              <AssumptionsForm rentalOption={a.rentalOption} lunchMajor={a.lunch ? toMajorString(a.lunch) : ''} lunchCurrency={a.lunchCurrency} partySize={a.partySize} maxParty={MAX_PARTY} />
            </section>
          </Rise>
          <Rise index={1}>
            <section aria-labelledby="bands-title" className="flex h-full flex-col gap-4 rounded-[12px] border border-divider bg-surface px-4 py-4 md:px-5">
              <h3 id="bands-title" className="text-[16px] font-semibold text-ink">
                Expense tiers
              </h3>
              <BandRuler bands={v.bands} rows={all} currency={v.bandCurrency} />
              <div className="border-t border-divider pt-3 text-[13px] text-ink-2">
                <p>
                  <span className="font-medium text-ink tnum">{c.complete}</span> of <span className="tnum">{c.resorts}</span> resorts have a complete estimate on this date
                  {v.withEstimates ? <> ({v.withEstimates} with your own estimates)</> : null}. Lift access is priced{v.myPasses.length ? ' or covered by your pass' : ''} at{' '}
                  <span className="tnum">{plural(c.liftOnDate, 'resort')}</span>
                  {c.rentalOnDate != null ? (
                    <>
                      , a rental price applies at <span className="tnum">{plural(c.rentalOnDate, 'resort')}</span>
                    </>
                  ) : null}
                  .
                </p>
                {c.liftNotApplicable ? (
                  <p className="mt-1.5 text-ink-3">
                    {plural(c.liftNotApplicable, 'resort')} {c.liftNotApplicable === 1 ? 'has' : 'have'} lift prices on file that don’t apply to this date (another season or
                    day type) — they are never stretched to fit.
                  </p>
                ) : null}
                {rentalMissingEverywhere ? <p className="mt-1.5 text-ink-3">No rental price applies anywhere yet, so every rental basket is incomplete — choose “Own gear” to compare lift + lunch.</p> : null}
                <p className="mt-1.5 text-ink-3">
                  Fill a gap with <span className="font-medium text-teal">Add estimate</span> — it is saved as “Your estimate”, never a published price, and a published price
                  takes over once recorded.
                </p>
              </div>
            </section>
          </Rise>
        </div>

        <div className="mt-6 mb-4 flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end md:justify-between">
          <DateField value={v.date} today={v.today} season={v.season} />
          <ChipFilter
            label="Show"
            param="show"
            value={q.show}
            defaultValue="all"
            options={[
              { value: 'all', label: 'All resorts', count: all.length },
              { value: 'favorites', label: 'Favourites', count: all.filter((r) => r.resort.isFavorite).length },
              { value: 'complete', label: 'Complete estimates', count: complete.length },
            ]}
          />
          <CurrencySelect value={v.currency} choices={v.currencies} preferred={ctx.prefs.currency.toUpperCase()} />
        </div>
        <p className="mb-3 flex flex-wrap items-center gap-x-3 text-[12.5px] text-ink-3">
          <span>Complete estimates first, cheapest first. Amounts per person in {v.currency}.</span>
          {v.fx.filter((f) => f.rate).map((f) => (
            <span key={f.from} className="tnum">
              {f.rate} ({f.rateDate}
              {f.demo ? ', demo rate' : ''})
            </span>
          ))}
          <PendingNote />
        </p>

        <PendingVeil>
          {shown.length ? (
            <div className="flex flex-col gap-4">
              {lead.length ? <Rows rows={lead} ctx={est} currency={v.currency} /> : null}
              {rest.length ? (
                <details className="group rounded-[12px] border border-divider bg-surface-2" open={!lead.length}>
                  <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-4 py-3 select-none">
                    <span>
                      <span className="block text-[15px] font-semibold text-ink">
                        {lead.length ? `${plural(rest.length, 'more resort')}` : `${plural(rest.length, 'resort')}`} without a complete estimate
                      </span>
                      <span className="block text-[12.5px] text-ink-3">A required price is unknown on this date — nothing is guessed. Open to add your own estimates.</span>
                    </span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-90" />
                  </summary>
                  <div className="border-t border-divider p-2 md:p-3">
                    <Rows rows={rest} ctx={est} currency={v.currency} caption={`Resorts without a complete basket on ${dayLabel(v.date, true)}, in ${v.currency}`} />
                  </div>
                </details>
              ) : null}
            </div>
          ) : (
            <p className="rounded-[12px] border border-dashed border-divider-strong bg-surface-2 p-5 text-[14px] text-ink-2">
              {q.show === 'complete'
                ? 'No resort has every required price for this date — nothing is guessed. Try “Own gear”, or add your own estimate where a price is missing.'
                : 'No favourite resorts yet — star resorts in Explore to follow them here.'}
            </p>
          )}
        </PendingVeil>
      </PassesSection>
    </PassesNav>
  )
}
