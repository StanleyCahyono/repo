/**
 * Pass families (discovery) and this season's exact products with every price snapshot: category, currency, purchase
 * window, quote kind, verification and source. A product with no price on file says "Price not recorded" and links
 * to the official page — never $0. Family colours are Piste's own categories, not official branding.
 */
import Link from 'next/link'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { PassBadge } from '@/components/ui/badge'
import { Missing } from '@/components/ui/provenance'
import { SourceDrawer, type SourceItem } from '@/components/ui/source-drawer'
import type { FamilyView, PassPriceView, PassProductView } from '@/lib/data/passes'
import type { EstimateView } from '@/lib/data/passes-screen'
import { formatMoney, formatMoneyRange, toMajorString } from '@/lib/domain/money'
import { cn } from '@/lib/ui/cn'
import { daysAway, dotJoin, familyId, plural, shortDate } from './format'
import { checkerHref } from './params'
import { EstimateButton } from './estimate-form'
import { AddPassButton, type ProductChoice } from './pass-forms'
import { ConfirmTag, HolderTag } from './section'

const FAMILY_LINK_LABEL: Record<string, string> = {
  official: 'Official site',
  compare: 'Compare passes',
  restrictedDates: 'Restricted dates',
  blackouts: 'Blackouts & reservations',
  resorts: 'Resort list',
}

function priceSources(p: PassProductView): SourceItem[] {
  return [
    { label: `Product: ${p.name}`, value: p.summary ?? undefined, prov: p.prov },
    ...p.prices.map((x) => ({ label: `Price: ${x.category ?? 'category not stated'}`, value: formatMoneyRange(x.amount, x.amountMax) ?? undefined, prov: x.prov })),
  ]
}

function PriceLine({ x, current }: { x: PassPriceView; current: boolean }) {
  const closed = x.purchaseClosed || x.expired
  return (
    <li className={cn('flex flex-col gap-0.5 py-2', current && 'rounded-md')}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-[13px] text-ink-2">{x.category ?? <span className="italic">Category not stated</span>}</span>
        <span className={cn('shrink-0 text-[14px] font-semibold tnum', closed ? 'text-ink-3 line-through decoration-ink-3/60' : 'text-ink')}>
          {x.amount.amountMinor === 0 && !x.amountMax ? 'Free' : formatMoneyRange(x.amount, x.amountMax)}
        </span>
      </div>
      <p className="text-[12px] text-ink-3">
        {dotJoin(
          x.quoteLabel,
          x.purchaseBy ? `${closed ? 'closed' : 'buy by'} ${shortDate(x.purchaseBy.slice(0, 10))}` : null,
          x.window,
          x.includesTax === true ? 'incl. tax' : x.includesTax === false ? 'before tax' : null,
          x.feesText,
        )}
      </p>
    </li>
  )
}

/** What the estimate sheet needs (same for every product). */
interface EstimateEntry {
  currencies: string[]
  defaultCurrency: string
  seasonLabel: string
}

function PriceBlock({ p, est }: { p: PassProductView; est: EstimateEntry }) {
  // Your own estimate is never presented as the product's price: it is shown separately, labelled as yours.
  const mine = p.prices.find((x) => x.quoteKind === 'user-estimate') ?? null
  const cur = p.currentPrice?.quoteKind === 'user-estimate' ? null : p.currentPrice
  const others = p.prices.filter((x) => x.id !== cur?.id && x.quoteKind !== 'user-estimate')
  const later = cur ? p.prices.filter((x) => x.id !== cur.id && x.quoteKind !== 'user-estimate' && !x.purchaseClosed && !x.expired && (x.category ?? '').toLowerCase() === (cur.category ?? '').toLowerCase()) : []
  const estimate: EstimateView | null = mine
    ? {
        id: mine.id,
        subject: 'pass-product',
        subjectId: p.id,
        rentalOption: null,
        dayType: 'any',
        amount: mine.amount,
        amountMax: mine.amountMax,
        amountMajor: toMajorString(mine.amount),
        amountMaxMajor: mine.amountMax ? toMajorString(mine.amountMax) : null,
        note: mine.prov?.note?.startsWith('Your estimate — ') ? mine.prov.note.slice('Your estimate — '.length) : null,
        enteredAt: mine.prov?.fetchedAt ?? mine.observedAt,
      }
    : null
  return (
    <div className="flex min-w-0 flex-col">
      {cur ? (
        <>
          <p className="font-display text-[32px] leading-none text-ink tnum">{formatMoneyRange(cur.amount, cur.amountMax)}</p>
          <p className="mt-1 text-[12.5px] text-ink-2">
            {dotJoin(cur.category ?? 'Adult', cur.purchaseBy ? `buy by ${shortDate(cur.purchaseBy.slice(0, 10))}` : 'on sale now', later[0] ? `then ${formatMoney(later[0].amount)}` : null)}
          </p>
          {cur.confirmAtSource ? <ConfirmTag className="mt-1" /> : null}
        </>
      ) : others.length ? (
        <>
          <p className="text-[15px] font-semibold text-ink">No adult price on sale</p>
          <p className="mt-0.5 text-[12.5px] text-ink-3">Only the prices below are on file — confirm the current adult price at the source.</p>
        </>
      ) : (
        <>
          <Missing label="Price not recorded" className="text-[15px]" />
          <p className="mt-0.5 text-[12.5px] text-ink-3">No {p.seasonId.replace('-', '–')} price on file — check the official page.</p>
        </>
      )}
      {estimate ? (
        <div className="mt-3 flex items-start justify-between gap-2 rounded-[10px] border border-dashed border-divider-strong bg-surface-2 py-2 pr-1 pl-3">
          <span className="min-w-0 text-[13px] text-ink-2">
            <span className="font-medium text-ink">Your estimate</span> · <span className="tnum">{formatMoneyRange(estimate.amount, estimate.amountMax)}</span>
            <span className="block text-[12px] text-ink-3">Not a published price — used only in Pass vs tickets</span>
          </span>
          <EstimateButton subject="pass-product" subjectId={p.id} subjectName={p.name} existing={estimate} currencies={est.currencies} defaultCurrency={est.defaultCurrency} seasonLabel={est.seasonLabel} trigger="icon" />
        </div>
      ) : null}
      {others.length ? (
        <details className="group mt-2" open={!cur}>
          <summary className="cursor-pointer text-[12.5px] font-medium text-teal select-none hover:underline">
            {cur ? `${plural(others.length, 'other price')} on file` : `${plural(others.length, 'price')} on file`}
          </summary>
          <ul className="mt-1 flex flex-col divide-y divide-divider">
            {others.map((x) => (
              <PriceLine key={x.id} x={x} current={false} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

function ProductRow({
  p,
  choices,
  currencies,
  defaultCurrency,
  today,
  seasonLabel,
}: {
  p: PassProductView
  choices: ProductChoice[]
  currencies: string[]
  defaultCurrency: string
  today: string
  seasonLabel: string
}) {
  const d = p.salesDeadline
  const official = p.prov?.sourceUrl
  return (
    <li id={`product-${p.id}`} className="grid scroll-mt-24 gap-x-8 gap-y-4 py-5 md:grid-cols-[minmax(0,1fr)_240px]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[17px] leading-snug font-semibold text-ink">{p.name}</h3>
          {p.ownedByMe ? <HolderTag holder="me" /> : null}
          {p.ownedBy
            .filter((h) => h !== 'me')
            .map((h) => (
              <HolderTag key={h} holder={h} />
            ))}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-3">
          <span>{dotJoin(p.resortName ? `${p.resortName} season pass` : null, p.resortCount ? `rules at ${plural(p.resortCount, 'resort')}` : 'no resort rules recorded')}</span>
          {p.confirmAtSource ? <ConfirmTag text={p.verificationLabel} /> : <span>· {p.verificationLabel}</span>}
        </p>
        {p.summary ? <p className="mt-2 max-w-[68ch] text-[14px] text-ink-2">{p.summary}</p> : null}
        {p.blackoutsSummary || p.reservationsSummary || p.renewalNotes ? (
          <dl className="mt-2 grid max-w-[68ch] gap-1 text-[13px]">
            {p.blackoutsSummary ? (
              <div className="flex gap-2">
                <dt className="w-[92px] shrink-0 text-ink-3">Blackouts</dt>
                <dd className="text-ink-2">{p.blackoutsSummary}</dd>
              </div>
            ) : null}
            {p.reservationsSummary ? (
              <div className="flex gap-2">
                <dt className="w-[92px] shrink-0 text-ink-3">Reservations</dt>
                <dd className="text-ink-2">{p.reservationsSummary}</dd>
              </div>
            ) : null}
            {p.renewalNotes ? (
              <div className="flex gap-2">
                <dt className="w-[92px] shrink-0 text-ink-3">Renewal</dt>
                <dd className="text-ink-2">{p.renewalNotes}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {d ? (
          <p className={cn('mt-2 text-[13px]', d.passed ? 'text-ink-3' : d.daysLeft !== null && d.daysLeft <= 14 ? 'font-medium text-copper' : 'text-ink-2')}>
            <span className="text-ink-3">Sales: </span>
            {d.date ? `${d.passed ? 'ended' : 'until'} ${shortDate(d.date)}${!d.passed && d.daysLeft !== null ? ` (${daysAway(d.daysLeft)})` : ''}` : null}
            {d.date && d.text ? ' — ' : null}
            {d.text}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href={checkerHref({ pass: p.id })} className="inline-flex items-center gap-1 text-[13.5px] font-medium text-teal hover:underline max-md:min-h-11">
            Where it works <ArrowRight aria-hidden className="size-3.5" />
          </Link>
          {official ? (
            <a href={official} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13.5px] font-medium text-teal hover:underline max-md:min-h-11">
              Official page <ExternalLink aria-hidden className="size-3.5" />
            </a>
          ) : null}
          {!p.ownedByMe ? (
            <AddPassButton
              products={choices}
              currencies={currencies}
              defaultCurrency={defaultCurrency}
              today={today}
              preselect={p.id}
              label="I hold this"
              variant="ghost"
              size="sm"
              icon={false}
              className="-ml-2 text-teal"
            />
          ) : null}
          <SourceDrawer title={p.name} label="Sources" compact={false} items={priceSources(p)} />
        </div>
      </div>
      <div className="md:border-l md:border-divider md:pl-6">
        <PriceBlock p={p} est={{ currencies, defaultCurrency, seasonLabel }} />
      </div>
    </li>
  )
}

export function FamilySection({
  f,
  products,
  choices,
  currencies,
  defaultCurrency,
  today,
  seasonLabel,
}: {
  f: FamilyView
  products: PassProductView[]
  choices: ProductChoice[]
  currencies: string[]
  defaultCurrency: string
  today: string
  seasonLabel: string
}) {
  const links = Object.entries(f.links).filter(([, url]) => !!url && /^https?:\/\//.test(url!)) as [string, string][]
  const priced = products.filter((p) => p.currentPrice && p.currentPrice.quoteKind !== 'user-estimate').length
  return (
    <section id={`family-${f.id}`} aria-labelledby={`family-${f.id}-title`} className="scroll-mt-24 border-t border-divider-strong pt-5">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <PassBadge family={familyId(f.id)} />
            <h2 id={`family-${f.id}-title`} className="text-[21px] leading-tight font-semibold text-ink md:text-[22px]">
              {f.name}
            </h2>
          </div>
          <p className="mt-1 text-[13px] text-ink-3">
            {dotJoin(f.operator, plural(products.length, 'product'), priced ? `${priced} with a current price` : 'no current prices recorded', f.prov ? (f.prov.verification === 'unverified' ? 'Unverified — confirm at source' : null) : null)}
          </p>
        </div>
        {links.length ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {links.map(([k, url]) => (
              <li key={k}>
                <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13.5px] font-medium text-teal hover:underline max-md:min-h-11">
                  {FAMILY_LINK_LABEL[k] ?? k} <ExternalLink aria-hidden className="size-3.5" />
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </header>
      <ul className="divide-y divide-divider">
        {products.map((p) => (
          <ProductRow key={p.id} p={p} choices={choices} currencies={currencies} defaultCurrency={defaultCurrency} today={today} seasonLabel={seasonLabel} />
        ))}
      </ul>
    </section>
  )
}
