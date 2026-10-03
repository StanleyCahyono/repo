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
import { BreakEvenBand, FamilyCards } from '@/components/passes/hud-cards'
import { VerdictCard } from '@/components/passes/verdict-card'
import { verdictModel } from '@/components/passes/verdict-model'
import { familyCards, getBreakEven, getSeasonContext } from '@/lib/data/passes-hud'
import { favorites as favoritesTable } from '@/lib/db/schema'
import { getCtx } from '@/lib/context'
import { getPassesView } from '@/lib/data/passes'
import { buyByDates, entryCurrencies, getCheckerView, ownedValueBasis } from '@/lib/data/passes-screen'
import { getSeasonView } from '@/lib/data/season'
import { cn } from '@/lib/ui/cn'

export const metadata: Metadata = { title: 'My passes · Passes & Costs' }

export default async function PassesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = parseChecker(await searchParams)
  const ctx = await getCtx()
  const [checker, season, pv, basis, favoriteIds] = await Promise.all([
    getCheckerView(ctx, q),
    getSeasonView(ctx),
    getPassesView(ctx),
    ownedValueBasis(ctx),
    ctx.db.select({ id: favoritesTable.resortId }).from(favoritesTable),
  ])
  const sel = checker.selection
  const seasonCtx = sel.resortId ? await getSeasonContext(ctx, sel.resortId, checker.season.id, sel.from, sel.to) : null
  const model = verdictModel(checker, seasonCtx)
  const owned = season.passes
  const mineCount = owned.filter((p) => p.holder === 'me').length
  const products: ProductChoice[] = pv.products.map((p) => ({ id: p.id, name: p.name, familyName: p.familyName, mine: p.ownedByMe }))
  const currencies = entryCurrencies(ctx.prefs.currency)
  const addPass = (props: { variant?: 'primary' | 'secondary' | 'quiet'; size?: 'sm' | 'md'; label?: string; className?: string }) => (
    <AddPassButton products={products} currencies={currencies} defaultCurrency={ctx.prefs.currency} today={ctx.today} {...props} />
  )
  const favorites = checker.resorts.filter((r) => r.isFavorite)
  const cards = familyCards(pv.families, pv.products, checker.season.id, new Set(favoriteIds.map((f) => f.id)))
  const breakEven = await getBreakEven(
    ctx,
    pv.products,
    owned.map((o) => ({ productId: o.productId, holder: o.holder, pricePaid: o.pricePaid })),
    checker.season,
  )

  return (
    <PassesNav>
      <div className="flex flex-col gap-6 md:gap-8">
        <Rise index={0} as="section" className={cn('relative min-w-0', !mineCount && 'max-lg:order-first')}>
          <h2 id="check-title" className="sr-only">
            Can I use my exact pass here?
          </h2>
          <div aria-labelledby="check-title" className="glass grid gap-5 rounded-[36px] p-4 sm:p-5 md:p-[26px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="flex min-w-0 flex-col gap-3 md:px-1 md:pt-1">
              <CheckerForm
                passes={checker.passes}
                resorts={checker.resorts}
                ruleResortIds={checker.ruleResortIds}
                selection={checker.selection}
                season={checker.season}
                today={checker.today}
              />
              {checker.selection.note ? <p className="text-[12.5px] text-caution">{checker.selection.note}</p> : null}
              <p className="mt-auto text-[12.5px] leading-[1.45] text-ink-3">
                Answered day by day from the product’s own rules — days you have logged count. A missing rule never counts as access.
              </p>
            </div>
            <VerdictCard model={model}>
              {checker.mode === 'empty' && favorites.length ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="hud">Your favourites</span>
                  {favorites.map((r) => (
                    <Link
                      key={r.id}
                      href={checkerHref({ pass: 'none', resort: r.id, from: checker.selection.from })}
                      scroll={false}
                      className="inline-flex h-9 items-center rounded-full border border-divider-strong bg-surface px-3 text-[13.5px] font-medium text-ink-2 transition-[color,border-color,transform] duration-150 hover:-translate-y-px hover:border-teal hover:text-teal max-md:h-11"
                    >
                      {r.name}
                    </Link>
                  ))}
                </div>
              ) : null}
            </VerdictCard>
          </div>
        </Rise>

        {checker.mode !== 'empty' ? (
          <Rise index={1}>
            <PassesSection id="check" rule={false} title="The detail" meta="The rule on file, the shared day pool and the product’s own notes behind the answer.">
              <PendingVeil className="glass rounded-[28px] px-4 py-5 md:px-6 md:py-6">
                <CheckerResults view={checker} hero />
              </PendingVeil>
            </PassesSection>
          </Rise>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:items-start xl:gap-8">
          <Rise index={2} className="min-w-0">
            <section aria-labelledby="owned-title" className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h2 id="owned-title" className="m-0 text-[26px] leading-[1.1] font-light tracking-[-0.03em] text-ink md:text-[30px]">
                  Your passes
                </h2>
                {owned.length ? addPass({ variant: 'secondary', size: 'sm', label: 'Add' }) : null}
              </div>
              {owned.length ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  {owned.map((p) => (
                    <OwnedPassCard key={p.ownershipId} p={p} resorts={checker.resorts} today={ctx.today} seasonStart={checker.season.start} basis={basis[p.ownershipId] ?? null} />
                  ))}
                </div>
              ) : (
                <div className="glass flex flex-col gap-3 rounded-[28px] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="m-0 flex items-center gap-2 text-[16px] font-semibold text-ink">
                      <Ticket aria-hidden className="size-4 text-ink-3" /> No pass recorded
                    </p>
                    <p className="m-0 mt-1 max-w-[60ch] text-[13.5px] text-ink-2">
                      Add the exact product you hold to track remaining days and shared pools. Resort affiliation never implies you own a pass.
                    </p>
                  </div>
                  <div className="shrink-0">{addPass({ variant: 'primary', label: 'Add a pass you own' })}</div>
                </div>
              )}
            </section>
          </Rise>
          <Rise index={3} className="min-w-0">
            <BuyByDates items={buyByDates(pv.products, ctx.today)} />
          </Rise>
        </div>

        <FamilyCards cards={cards} />
        <BreakEvenBand b={breakEven} />
      </div>
    </PassesNav>
  )
}
