/**
 * Products & prices: each pass family, and each exact product as a card with its real prices — the adult price as the
 * headline, every other category under it, and when buying gets more expensive (the purchase-by date and the price
 * after it) or stops (the sales deadline). Products with no published price yet get one compact row each — the
 * official page and "where it works" stay one click away — never a big empty card and never $0. Family colours are
 * Piste's own categories, not official branding.
 */
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarClock, ExternalLink, TrendingUp } from 'lucide-react'
import { PassBadge } from '@/components/ui/badge'
import { Disclosure } from '@/components/ui/disclosure'
import { SourceDrawer, type SourceItem } from '@/components/ui/source-drawer'
import type { FamilyView, PassPriceView, PassProductView } from '@/lib/data/passes'
import type { EstimateView } from '@/lib/data/passes-screen'
import { adultRank, audienceOf } from '@/lib/domain/costs/items'
import { formatMoneyRange, toMajorString } from '@/lib/domain/money'
import { cn } from '@/lib/ui/cn'
import { MoneyUp } from './count-up'
import { EstimateButton } from './estimate-form'
import { daysAway, dotJoin, familyId, plural, shortDate } from './format'
import css from './hud.module.css'
import { checkerHref } from './params'
import { AddPassButton, type ProductChoice } from './pass-forms'
import { HolderTag } from './section'

const FAMILY_LINK_LABEL: Record<string, string> = {
  official: 'Official site',
  compare: 'Compare passes',
  restrictedDates: 'Restricted dates',
  blackouts: 'Blackouts & reservations',
  resorts: 'Resort list',
}

/** What the estimate sheet and the add-pass sheet need (same for every product). */
export interface ProductCtx {
  choices: ProductChoice[]
  currencies: string[]
  defaultCurrency: string
  today: string
  seasonLabel: string
}

/** "Adult", "Adult (23+)", "Young adult (19–22)", "Child (5–12)" — and "Age not stated" when it wasn't recorded. */
export function categoryLabel(category: string | null): string {
  if (!category) return 'Age not stated'
  if (audienceOf(category) === 'unstated') return 'Age not stated'
  const c = category.trim()
  return c.charAt(0).toUpperCase() + c.slice(1)
}

function amountText(x: PassPriceView): string {
  return x.amount.amountMinor === 0 && !x.amountMax ? 'Free' : (formatMoneyRange(x.amount, x.amountMax) ?? '')
}

function priceSources(p: PassProductView): SourceItem[] {
  return [
    { label: `Product: ${p.name}`, value: p.summary ?? undefined, prov: p.prov },
    ...p.prices.filter((x) => x.quoteKind !== 'user-estimate').map((x) => ({ label: `Price: ${categoryLabel(x.category)}`, value: formatMoneyRange(x.amount, x.amountMax) ?? undefined, prov: x.prov })),
  ]
}

function estimateOf(p: PassProductView): EstimateView | null {
  const mine = p.prices.find((x) => x.quoteKind === 'user-estimate')
  if (!mine) return null
  return {
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
}

/** Published prices of a product split for display: the headline, the next price after it, the rest, and earlier ones. */
export function priceGroups(p: PassProductView) {
  const published = p.prices.filter((x) => x.quoteKind !== 'user-estimate')
  const cur = p.currentPrice?.quoteKind === 'user-estimate' ? null : p.currentPrice
  const open = published.filter((x) => !x.purchaseClosed && !x.expired)
  const sameCat = (x: PassPriceView) => (x.category ?? '').toLowerCase() === (cur?.category ?? '').toLowerCase()
  const next = cur?.purchaseBy
    ? (open
        .filter((x) => x.id !== cur.id && sameCat(x) && (x.purchaseBy == null || x.purchaseBy.slice(0, 10) > cur.purchaseBy!.slice(0, 10)))
        .sort((a, b) => (a.purchaseBy ?? '9999').localeCompare(b.purchaseBy ?? '9999'))[0] ?? null)
    : null
  const others = open.filter((x) => x.id !== cur?.id && x.id !== next?.id).sort((a, b) => adultRank(a.category) - adultRank(b.category) || b.amount.amountMinor - a.amount.amountMinor)
  const earlier = published.filter((x) => x.purchaseClosed || x.expired)
  return { cur, next, others, earlier }
}

function PriceRow({ x, struck = false }: { x: PassPriceView; struck?: boolean }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="min-w-0 text-[13.5px] text-ink-2">
        {categoryLabel(x.category)}
        {x.purchaseBy ? <span className="text-ink-3"> · {struck ? 'until' : 'buy by'} {shortDate(x.purchaseBy.slice(0, 10))}</span> : null}
      </span>
      <span className={cn('shrink-0 text-[14.5px] font-medium tnum', struck ? 'text-ink-3 line-through decoration-ink-3/60' : 'text-ink')}>{amountText(x)}</span>
    </li>
  )
}

function SalesLine({ p }: { p: PassProductView }) {
  const d = p.salesDeadline
  if (!d) return null
  const soon = !d.passed && d.daysLeft !== null && d.daysLeft <= 14
  return (
    <p className={cn('m-0 flex items-start gap-2 text-[13px] leading-[1.45]', d.passed ? 'text-ink-3' : soon ? 'font-medium text-copper' : 'text-ink-2')}>
      <CalendarClock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {d.date ? (
          <>
            {d.passed ? 'Sales ended' : 'Sales end'} {shortDate(d.date)}
            {!d.passed && d.daysLeft !== null ? <span className="tnum"> · {daysAway(d.daysLeft)}</span> : null}
            {d.text ? ' — ' : ''}
          </>
        ) : null}
        {d.text}
      </span>
    </p>
  )
}

function ProductCard({ p, ctx, index }: { p: PassProductView; ctx: ProductCtx; index: number }) {
  const { cur, next, others, earlier } = priceGroups(p)
  const mine = estimateOf(p)
  const official = p.prov?.sourceUrl
  const notes: [string, string][] = (
    [
      ['Blackouts', p.blackoutsSummary],
      ['Reservations', p.reservationsSummary],
      ['Renewal', p.renewalNotes],
    ] as [string, string | null][]
  ).filter((e): e is [string, string] => !!e[1])
  return (
    <li id={`product-${p.id}`} style={{ '--i': Math.min(index, 4) } as CSSProperties} className={cn(css.rise, 'min-w-0 scroll-mt-24')}>
      <article aria-labelledby={`product-${p.id}-name`} className={cn(css.lift, 'flex h-full flex-col gap-4 rounded-[24px] border border-glass-line bg-surface/70 p-4 md:p-5')}>
        <header className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`product-${p.id}-name`} className="m-0 text-[18px] leading-snug font-semibold text-ink">
              {p.name}
            </h3>
            {p.ownedBy.map((h) => (
              <HolderTag key={h} holder={h} />
            ))}
          </div>
          {p.resortName ? <p className="m-0 text-[13px] text-ink-3">{p.resortName} season pass</p> : null}
        </header>

        <div className="flex flex-col gap-1.5">
          {cur ? (
            <>
              <p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[40px] leading-none font-light tracking-[-0.04em] text-ink">
                  {cur.amountMax ? <span className="tnum">{formatMoneyRange(cur.amount, cur.amountMax)}</span> : <MoneyUp amountMinor={cur.amount.amountMinor} currency={cur.amount.currency} className="tnum" />}
                </span>
                <span className="text-[14px] font-medium text-ink-2">{categoryLabel(cur.category)}</span>
              </p>
              <p className="m-0 text-[13px] text-ink-2">
                {dotJoin(
                  cur.purchaseBy ? `This price until ${shortDate(cur.purchaseBy.slice(0, 10))}` : p.salesDeadline?.passed ? 'Last published price' : 'On sale now',
                  cur.includesTax === true ? 'incl. tax' : cur.includesTax === false ? 'before tax' : null,
                  cur.feesText,
                )}
              </p>
              {next ? (
                <p className="m-0 inline-flex w-fit items-center gap-1.5 rounded-full bg-copper/12 px-2.5 py-1 text-[13px] font-medium text-copper">
                  <TrendingUp aria-hidden className="size-3.5" />
                  Then <span className="tnum">{amountText(next)}</span>
                  {next.purchaseBy ? <span className="font-normal"> until {shortDate(next.purchaseBy.slice(0, 10))}</span> : null}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="m-0 text-[17px] font-medium text-ink">No adult price published</p>
              <p className="m-0 text-[13px] text-ink-3">{others.length ? 'Only the prices below are published.' : 'Check the official page.'}</p>
            </>
          )}
          <SalesLine p={p} />
        </div>

        {others.length || earlier.length ? (
          <div className="border-t border-divider pt-2">
            {others.length ? (
              <>
                <p className="eyebrow m-0 mb-0.5">{cur ? 'Other prices' : 'Prices'}</p>
                <ul className="m-0 flex list-none flex-col divide-y divide-divider p-0">
                  {others.map((x) => (
                    <PriceRow key={x.id} x={x} />
                  ))}
                </ul>
              </>
            ) : null}
            {earlier.length ? (
              <Disclosure summary={`Earlier prices (${earlier.length})`} className="mt-1">
                <ul className="m-0 mt-1 flex list-none flex-col divide-y divide-divider p-0">
                  {earlier.map((x) => (
                    <PriceRow key={x.id} x={x} struck />
                  ))}
                </ul>
              </Disclosure>
            ) : null}
          </div>
        ) : null}

        {mine ? (
          <div className="flex items-start justify-between gap-2 rounded-[14px] border border-dashed border-divider-strong bg-surface-2 py-2 pr-1 pl-3">
            <span className="min-w-0 text-[13px] text-ink-2">
              <span className="font-medium text-ink">Your estimate</span> · <span className="tnum">{formatMoneyRange(mine.amount, mine.amountMax)}</span>
              <span className="block text-[12px] text-ink-3">Yours, not a published price — used only in Pass vs tickets</span>
            </span>
            <EstimateButton subject="pass-product" subjectId={p.id} subjectName={p.name} existing={mine} currencies={ctx.currencies} defaultCurrency={ctx.defaultCurrency} seasonLabel={ctx.seasonLabel} trigger="icon" />
          </div>
        ) : null}

        {notes.length || p.summary ? (
          <Disclosure summary={notes.length ? notes.map(([k]) => k).join(' · ') : 'About this pass'}>
            <div className="mt-2 flex flex-col gap-2 text-[13.5px] leading-[1.5]">
              {p.summary ? <p className="m-0 text-ink-2">{p.summary}</p> : null}
              {notes.length ? (
                <dl className="m-0 grid gap-1.5">
                  {notes.map(([k, v]) => (
                    <div key={k} className="grid gap-0.5 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-2">
                      <dt className="text-ink-3">{k}</dt>
                      <dd className="m-0 text-ink-2">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          </Disclosure>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-divider pt-3">
          <Link href={checkerHref({ pass: p.id })} className="inline-flex min-h-9 items-center gap-1 text-[13.5px] font-medium text-teal hover:underline max-md:min-h-11">
            Where it works <ArrowRight aria-hidden className="size-3.5" />
          </Link>
          {official ? (
            <a href={official} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 text-[13.5px] font-medium text-teal hover:underline max-md:min-h-11">
              Official page <ExternalLink aria-hidden className="size-3.5" />
            </a>
          ) : null}
          {!p.ownedByMe ? (
            <AddPassButton
              products={ctx.choices}
              currencies={ctx.currencies}
              defaultCurrency={ctx.defaultCurrency}
              today={ctx.today}
              preselect={p.id}
              label="I have this pass"
              variant="ghost"
              size="sm"
              icon={false}
              className="-ml-2 text-teal"
            />
          ) : null}
          <span className="ml-auto">
            <SourceDrawer title={p.name} label="Sources" items={priceSources(p)} />
          </span>
        </div>
      </article>
    </li>
  )
}

function UnpricedRow({ p, ctx }: { p: PassProductView; ctx: ProductCtx }) {
  const official = p.prov?.sourceUrl
  return (
    <li id={`product-${p.id}`} className="flex scroll-mt-24 flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <p className="m-0 flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-[15px] font-medium text-ink">{p.name}</span>
        {p.ownedBy.map((h) => (
          <HolderTag key={h} holder={h} />
        ))}
        {p.salesDeadline?.text && !p.salesDeadline.date ? <span className="text-[12.5px] text-copper">{p.salesDeadline.text}</span> : null}
      </p>
      <span className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-0">
        <Link href={checkerHref({ pass: p.id })} className="inline-flex min-h-9 items-center gap-1 text-[13px] font-medium text-teal hover:underline max-md:min-h-11">
          Where it works <ArrowRight aria-hidden className="size-3.5" />
        </Link>
        {official ? (
          <a href={official} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 text-[13px] font-medium text-teal hover:underline max-md:min-h-11">
            Official page <ExternalLink aria-hidden className="size-3.5" />
          </a>
        ) : null}
        {!p.ownedByMe ? (
          <AddPassButton
            products={ctx.choices}
            currencies={ctx.currencies}
            defaultCurrency={ctx.defaultCurrency}
            today={ctx.today}
            preselect={p.id}
            label="I have this pass"
            variant="ghost"
            size="sm"
            icon={false}
            className="-ml-2 text-teal"
          />
        ) : null}
      </span>
    </li>
  )
}

/** A product has something to show as a card: a published price, your estimate, or a sales deadline. */
export function hasPrices(p: PassProductView): boolean {
  return p.prices.length > 0 || !!p.salesDeadline?.date
}

export function FamilySection({ f, products, ctx }: { f: FamilyView; products: PassProductView[]; ctx: ProductCtx }) {
  const links = Object.entries(f.links).filter(([, url]) => !!url && /^https?:\/\//.test(url!)) as [string, string][]
  const priced = products.filter(hasPrices)
  const unpriced = products.filter((p) => !hasPrices(p))
  return (
    <section id={`family-${f.id}`} aria-labelledby={`family-${f.id}-title`} className="glass scroll-mt-24 rounded-[28px] p-4 sm:p-5 md:p-6">
      <header className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <PassBadge family={familyId(f.id)} />
            <h2 id={`family-${f.id}-title`} className="m-0 text-[26px] leading-[1.1] font-light tracking-[-0.03em] text-ink md:text-[30px]">
              {f.name}
            </h2>
          </div>
          <p className="m-0 mt-1 text-[13px] text-ink-3">{dotJoin(f.operator, plural(products.length, 'pass', 'passes'), priced.length ? `${priced.length} with prices` : 'no prices published yet')}</p>
        </div>
        {links.length ? (
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-0 p-0">
            {links.map(([k, url]) => (
              <li key={k}>
                <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 text-[13.5px] font-medium text-teal hover:underline max-md:min-h-11">
                  {FAMILY_LINK_LABEL[k] ?? k} <ExternalLink aria-hidden className="size-3.5" />
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </header>
      {priced.length ? (
        <ul className="m-0 grid list-none gap-4 p-0 lg:grid-cols-2">
          {priced.map((p, i) => (
            <ProductCard key={p.id} p={p} ctx={ctx} index={i} />
          ))}
        </ul>
      ) : null}
      {unpriced.length ? (
        <div className={cn(priced.length && 'mt-4 border-t border-divider pt-3')}>
          <p className="m-0 text-[13px] text-ink-3">{priced.length ? 'No price published yet:' : 'No price published yet for these — check the official pages.'}</p>
          <ul className="m-0 flex list-none flex-col divide-y divide-divider p-0">
            {unpriced.map((p) => (
              <UnpricedRow key={p.id} p={p} ctx={ctx} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
