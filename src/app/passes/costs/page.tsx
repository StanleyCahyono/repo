import type { Metadata } from 'next'
import { ChevronDown } from 'lucide-react'
import { AssumptionsForm } from '@/components/passes/assumptions-form'
import { BandRuler, CostsList, CostsTable, type EstimateCtx } from '@/components/passes/costs'
import { dayLabel, plural } from '@/components/passes/format'
import { PassesNav, PendingNote, PendingVeil } from '@/components/passes/nav'
import { parseCosts } from '@/components/passes/params'
import { Rise } from '@/components/passes/rise'
import { ChipFilter, CurrencySelect, DateField } from '@/components/passes/toolbar'
import { Disclosure } from '@/components/ui/disclosure'
import { getCtx } from '@/lib/context'
import { getDayCostsView, MAX_PARTY, type DayCostRow } from '@/lib/data/passes-screen'
import { toMajorString } from '@/lib/domain/money'

export const metadata: Metadata = { title: 'Day costs · Passes & Costs' }

const DAY_TYPE_TEXT: Record<string, string> = { weekday: 'Weekday prices', weekend: 'Weekend prices', holiday: 'Holiday prices' }

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
  const est: EstimateCtx = { date: v.date, rentalOption: a.rentalOption, currencies: v.entryCurrencies, defaultCurrency: ctx.prefs.currency.toUpperCase(), seasonLabel: v.season.label }
  const dayText = v.holidayName ? `${v.holidayName} — holiday prices` : DAY_TYPE_TEXT[v.dayType]
  const fx = v.fx.filter((f) => f.rate)

  return (
    <PassesNav>
      <div className="flex flex-col gap-6">
        <Rise index={0}>
          <div className="glass flex flex-col gap-4 rounded-[24px] px-4 py-4 md:flex-row md:flex-wrap md:items-start md:justify-between md:px-5">
            <DateField value={v.date} today={v.today} season={v.season} label="Day" hint={`${dayText}${v.myPasses.length ? ` · your ${v.myPasses.join(' and ')} covers lift access where it can` : ''}`} />
            <ChipFilter
              label="Show"
              param="show"
              value={q.show}
              defaultValue="all"
              options={[
                { value: 'all', label: 'All resorts', count: all.length },
                { value: 'favorites', label: 'Favourites', count: all.filter((r) => r.resort.isFavorite).length },
                { value: 'complete', label: 'Every price known', count: complete.length },
              ]}
            />
            <CurrencySelect value={v.currency} choices={v.currencies} preferred={ctx.prefs.currency.toUpperCase()} />
          </div>
        </Rise>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Rise index={1} className="min-w-0">
            <section aria-labelledby="assumptions-title" className="h-full glass rounded-[24px] px-4 py-4 md:px-5">
              <h2 id="assumptions-title" className="m-0 mb-3 text-[16px] font-semibold text-ink">
                Your day
              </h2>
              <AssumptionsForm rentalOption={a.rentalOption} lunchMajor={a.lunch ? toMajorString(a.lunch) : ''} lunchCurrency={a.lunchCurrency} partySize={a.partySize} maxParty={MAX_PARTY} />
            </section>
          </Rise>
          <Rise index={2} className="min-w-0">
            <section aria-labelledby="bands-title" className="flex h-full flex-col gap-4 glass rounded-[24px] px-4 py-4 md:px-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 id="bands-title" className="m-0 text-[16px] font-semibold text-ink">
                  Price bands
                </h2>
                <p className="m-0 text-[13px] text-ink-2">
                  <span className="font-medium text-ink tnum">{c.complete}</span> of <span className="tnum">{c.resorts}</span> resorts have every price for {dayLabel(v.date)}
                </p>
              </div>
              <BandRuler bands={v.bands} rows={all} currency={v.bandCurrency} />
              <Disclosure summary="How this works" className="mt-auto border-t border-divider pt-3">
                <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0 text-[13px] leading-[1.5] text-ink-2">
                  <li>
                    One person’s day: the adult full-day lift ticket{v.myPasses.length ? ' (or your pass, where it covers the day)' : ''}, your rental choice, lunch, and your share of
                    parking. Lessons are listed separately and never added in.
                  </li>
                  <li>
                    A lift price applies at <span className="tnum">{plural(c.liftOnDate, 'resort')}</span> this day
                    {c.rentalOnDate != null ? (
                      <>
                        , a rental price at <span className="tnum">{plural(c.rentalOnDate, 'resort')}</span>
                      </>
                    ) : null}
                    {c.liftNotApplicable ? <>; {plural(c.liftNotApplicable, 'resort')} only have prices for other days or seasons</> : null}.
                  </li>
                  <li>
                    Missing a price? Use <span className="font-medium text-teal">Add estimate</span> — it’s saved as yours, and a published price replaces it once recorded.
                    {v.withEstimates ? ` ${plural(v.withEstimates, 'resort')} use your estimates today.` : ''}
                  </li>
                </ul>
              </Disclosure>
            </section>
          </Rise>
        </div>

        <div>
          <p className="m-0 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
            <span>Per person in {v.currency}, cheapest first.</span>
            {fx.length ? <span className="tnum">{fx.map((f) => `${f.rate} (${f.rateDate}${f.demo ? ', demo rate' : ''})`).join(' · ')}</span> : null}
            <PendingNote />
          </p>

          <PendingVeil>
            {shown.length ? (
              <div className="flex flex-col gap-4">
                {lead.length ? <Rows rows={lead} ctx={est} currency={v.currency} /> : null}
                {rest.length ? (
                  <details className="group glass rounded-[24px]" open={!lead.length}>
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 select-none md:px-5 [&::-webkit-details-marker]:hidden">
                      <span>
                        <span className="block text-[15px] font-semibold text-ink">
                          {lead.length ? plural(rest.length, 'more resort') : plural(rest.length, 'resort')} missing a price
                        </span>
                        <span className="block text-[12.5px] text-ink-3">Open to see what’s known and add your own estimates.</span>
                      </span>
                      <ChevronDown aria-hidden className="size-4 shrink-0 text-ink-3 transition-transform duration-200 group-open:rotate-180" />
                    </summary>
                    <div className="border-t border-divider p-2 md:p-3">
                      <Rows rows={rest} ctx={est} currency={v.currency} caption={`Resorts missing a price on ${dayLabel(v.date, true)}, in ${v.currency}`} />
                    </div>
                  </details>
                ) : null}
              </div>
            ) : (
              <p className="m-0 rounded-[22px] border border-dashed border-divider-strong bg-glass-soft p-5 text-[14px] text-ink-2">
                {q.show === 'complete'
                  ? 'No resort has every price for this day yet. Try “Own gear”, or add your own estimate where a price is missing.'
                  : 'No favourite resorts yet — star resorts in Explore to follow them here.'}
              </p>
            )}
          </PendingVeil>
        </div>
      </div>
    </PassesNav>
  )
}
