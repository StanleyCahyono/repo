import type { Metadata } from 'next'
import { PassBadge } from '@/components/ui/badge'
import { familyId } from '@/components/passes/format'
import type { ProductChoice } from '@/components/passes/pass-forms'
import { FamilySection, hasPrices, type ProductCtx } from '@/components/passes/products'
import { Rise } from '@/components/passes/rise'
import { getCtx } from '@/lib/context'
import { getPassesView } from '@/lib/data/passes'
import { entryCurrencies } from '@/lib/data/passes-screen'

export const metadata: Metadata = { title: 'Products & prices · Passes & Costs' }

export default async function ProductsPage() {
  const ctx = await getCtx()
  const pv = await getPassesView(ctx)
  const choices: ProductChoice[] = pv.products.map((p) => ({ id: p.id, name: p.name, familyName: p.familyName, mine: p.ownedByMe }))
  const pctx: ProductCtx = { choices, currencies: entryCurrencies(ctx.prefs.currency), defaultCurrency: ctx.prefs.currency, today: ctx.today, seasonLabel: pv.season.label }
  const families = pv.families.filter((f) => f.productIds.length)
  const priced = pv.products.filter(hasPrices).length

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <Rise index={0}>
        <nav aria-label="Jump to a pass family" className="glass flex flex-col gap-3 rounded-[24px] px-4 py-3.5 md:flex-row md:items-center md:justify-between md:px-5">
          <p className="m-0 text-[14px] text-ink-2">
            <span className="font-medium text-ink tnum">{pv.products.length}</span> {pv.season.label} passes · <span className="font-medium text-ink tnum">{priced}</span> with published prices
          </p>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {families.map((f) => (
              <li key={f.id}>
                <a
                  href={`#family-${f.id}`}
                  className="inline-flex min-h-9 items-center gap-2 rounded-full border border-divider bg-surface/60 py-1 pr-3 pl-1.5 text-[13px] text-ink-2 transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-teal max-md:min-h-11"
                >
                  <PassBadge family={familyId(f.id)} size="sm" />
                  <span className="tnum">{f.productIds.length}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </Rise>
      {families.map((f, i) => (
        <Rise key={f.id} index={i + 1}>
          <FamilySection f={f} products={pv.products.filter((p) => p.familyId === f.id)} ctx={pctx} />
        </Rise>
      ))}
      <p className="m-0 text-[12.5px] text-ink-3">Family colours and monograms are Piste’s own labels, not official logos.</p>
    </div>
  )
}
