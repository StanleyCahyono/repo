import type { Metadata } from 'next'
import Link from 'next/link'
import { Ticket } from 'lucide-react'
import { CheckerForm } from '@/components/passes/checker-form'
import { CheckerResults } from '@/components/passes/checker-results'
import { BuyByDates } from '@/components/passes/deadlines'
import { PassesNav, PendingVeil } from '@/components/passes/nav'
import { OwnedPassCard } from '@/components/passes/owned-passes'
import { AddPassButton, type ProductChoice } from '@/components/passes/pass-forms'
import { checkerHref, parseChecker } from '@/components/passes/params'
import { Rise } from '@/components/passes/rise'
import { PassesSection } from '@/components/passes/section'
import { getCtx } from '@/lib/context'
import { getPassesView } from '@/lib/data/passes'
import { buyByDates, entryCurrencies, getCheckerView, ownedValueBasis } from '@/lib/data/passes-screen'
import { getSeasonView } from '@/lib/data/season'
import { cn } from '@/lib/ui/cn'

export const metadata: Metadata = { title: 'My passes · Passes & Costs' }

export default async function PassesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = parseChecker(await searchParams)
  const ctx = await getCtx()
  const [checker, season, pv, basis] = await Promise.all([getCheckerView(ctx, q), getSeasonView(ctx), getPassesView(ctx), ownedValueBasis(ctx)])
  const owned = season.passes
  const mineCount = owned.filter((p) => p.holder === 'me').length
  const products: ProductChoice[] = pv.products.map((p) => ({ id: p.id, name: p.name, familyName: p.familyName, mine: p.ownedByMe }))
  const currencies = entryCurrencies(ctx.prefs.currency)
  const addPass = (props: { variant?: 'primary' | 'secondary' | 'quiet'; size?: 'sm' | 'md'; label?: string; className?: string }) => (
    <AddPassButton products={products} currencies={currencies} defaultCurrency={ctx.prefs.currency} today={ctx.today} {...props} />
  )
  const favorites = checker.resorts.filter((r) => r.isFavorite)

  return (
    <PassesNav>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(300px,340px)] lg:grid-rows-[auto_1fr] lg:items-start xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-x-10">
        <Rise index={1} className="min-w-0 lg:col-start-2 lg:row-start-1">
          <section aria-labelledby="owned-title" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 id="owned-title" className="text-[21px] leading-tight font-semibold text-ink md:text-[22px]">
                Your passes
              </h2>
              {owned.length ? addPass({ variant: 'secondary', size: 'sm', label: 'Add' }) : null}
            </div>
            {owned.length ? (
              owned.map((p) => <OwnedPassCard key={p.ownershipId} p={p} resorts={checker.resorts} today={ctx.today} seasonStart={checker.season.start} basis={basis[p.ownershipId] ?? null} />)
            ) : (
              <div className="rounded-[12px] border border-dashed border-divider-strong bg-surface-2 px-4 py-5">
                <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                  <Ticket aria-hidden className="size-4 text-ink-3" /> No pass recorded
                </p>
                <p className="mt-1 text-[13.5px] text-ink-2">
                  Add the exact product you hold to track remaining days and shared pools. Resort affiliation never implies you own a pass.
                </p>
                <div className="mt-3">{addPass({ variant: 'primary', label: 'Add a pass you own' })}</div>
              </div>
            )}
          </section>
        </Rise>
        {/* Mobile: your passes first when you hold one, then the checker; desktop: checker left, passes and buy-by dates right. */}
        <Rise index={0} className={cn('min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1', !mineCount && 'max-lg:order-first')}>
          <PassesSection
            id="check"
            rule={false}
            title="Can I use my exact pass here?"
            meta="Answered day by day from the product’s own rules — days you have logged count. An unknown or missing rule is shown as not confirmed, never as access."
          >
            <div className="rounded-[12px] border border-divider bg-surface">
              <div className="border-b border-divider px-4 py-4 md:px-5">
                <CheckerForm
                  passes={checker.passes}
                  resorts={checker.resorts}
                  ruleResortIds={checker.ruleResortIds}
                  selection={checker.selection}
                  season={checker.season}
                  today={checker.today}
                />
                {checker.selection.note ? <p className="mt-2 text-[12.5px] text-caution">{checker.selection.note}</p> : null}
              </div>
              <PendingVeil className="px-4 py-5 md:px-5">
                {checker.mode === 'empty' ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-[15px] text-ink">Choose a pass and a resort — or only a resort to see every product recorded there.</p>
                    {favorites.length ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] text-ink-3">Your favourites:</span>
                        {favorites.map((r) => (
                          <Link
                            key={r.id}
                            href={checkerHref({ pass: 'none', resort: r.id, from: checker.selection.from })}
                            scroll={false}
                            className="inline-flex h-9 items-center rounded-full border border-divider bg-surface px-3 text-[13.5px] font-medium text-ink-2 transition-colors hover:border-teal hover:text-teal max-md:h-11"
                          >
                            {r.name}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                    <p className="text-[13px] text-ink-3">No pass is recorded as yours. Resort affiliation never implies you own a pass.</p>
                  </div>
                ) : (
                  <CheckerResults view={checker} />
                )}
              </PendingVeil>
            </div>
          </PassesSection>
        </Rise>
        <Rise index={2} className="min-w-0 lg:col-start-2 lg:row-start-2">
          <BuyByDates items={buyByDates(pv.products, ctx.today)} />
        </Rise>
      </div>
    </PassesNav>
  )
}
