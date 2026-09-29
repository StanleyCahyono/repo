import type { Metadata } from 'next'
import { PassBadge } from '@/components/ui/badge'
import { familyId, plural } from '@/components/passes/format'
import type { ProductChoice } from '@/components/passes/pass-forms'
import { FamilySection } from '@/components/passes/products'
import { Rise } from '@/components/passes/rise'
import { PassesSection } from '@/components/passes/section'
import { getCtx } from '@/lib/context'
import { getPassesView } from '@/lib/data/passes'
import { entryCurrencies } from '@/lib/data/passes-screen'

export const metadata: Metadata = { title: 'Products & prices · Passes & Costs' }

export default async function ProductsPage() {
  const ctx = await getCtx()
  const pv = await getPassesView(ctx)
  const choices: ProductChoice[] = pv.products.map((p) => ({ id: p.id, name: p.name, familyName: p.familyName, mine: p.ownedByMe }))
  const currencies = entryCurrencies(ctx.prefs.currency)
  const families = pv.families.filter((f) => f.productIds.length)
  // Your own estimates are not recorded prices: they never count here.
  const priced = pv.products.filter((p) => p.currentPrice && p.currentPrice.quoteKind !== 'user-estimate').length
  const onFile = pv.products.filter((p) => p.prices.some((x) => x.quoteKind !== 'user-estimate')).length

  return (
    <PassesSection
      id="products"
      rule={false}
      title="Products & prices"
      meta={
        <>
          Every exact {pv.season.label} product on file, with each recorded price: category, purchase window, kind of quote and source. Most multi-resort prices were
          not researched in this build — they show as not recorded with the official page, never as $0.
        </>
      }
    >
      <Rise index={0}>
        <div className="mb-6 flex flex-col gap-4 rounded-[12px] border border-divider bg-surface px-4 py-4 md:px-5 xl:flex-row xl:items-center xl:justify-between">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 xl:flex xl:gap-8">
            {(
              [
                ['Products', pv.products.length, 'text-ink'],
                ['Current adult price', priced, 'text-ink'],
                ['Other prices only', onFile - priced, 'text-ink-2'],
                ['Price not recorded', pv.products.length - onFile, 'text-ink-2'],
              ] as const
            ).map(([label, n, cls]) => (
              <div key={label} className="flex flex-col">
                <dt className="text-[12.5px] text-ink-3">{label}</dt>
                <dd className={`font-display text-[28px] leading-none tnum ${cls}`}>{n}</dd>
              </div>
            ))}
          </dl>
          <nav aria-label="Jump to a pass family">
            <ul className="flex flex-wrap gap-2">
              {families.map((f) => (
                <li key={f.id}>
                  <a href={`#family-${f.id}`} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-divider px-2 py-1 text-[13px] text-ink-2 hover:border-teal max-md:min-h-11">
                    <PassBadge family={familyId(f.id)} size="sm" />
                    <span className="tnum">{plural(f.productIds.length, 'product')}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </Rise>
      <p className="mb-6 text-[12.5px] text-ink-3">{pv.disclaimer} Family colours and monograms are Piste’s own categories — not official logos.</p>
      <div className="flex flex-col gap-10">
        {families.map((f, i) => (
          <Rise key={f.id} index={i + 1}>
            <FamilySection
              f={f}
              products={pv.products.filter((p) => p.familyId === f.id)}
              choices={choices}
              currencies={currencies}
              defaultCurrency={ctx.prefs.currency}
              today={ctx.today}
              seasonLabel={pv.season.label}
            />
          </Rise>
        ))}
      </div>
    </PassesSection>
  )
}
