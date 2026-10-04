/**
 * Passes HUD cards under the checker:
 * - FamilyCards: one glass card per pass family (Ikon, Epic, Indy, Mountain Collective, resort & regional) with the
 *   cheapest current adult price on file — or "No price yet" and the official link. Never $0, never a guess.
 * - BreakEvenBand: a resort season pass against that resort's own adult day-ticket figures, as a dark HUD band with a
 *   break-even meter. Ticket figures from an earlier season are labelled as a reference, not this season's price.
 */
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight, Tags } from 'lucide-react'
import { PassBadge } from '@/components/ui/badge'
import type { BreakEvenView, FamilyCard } from '@/lib/data/passes-hud'
import { breakEvenDays } from '@/lib/data/passes-hud'
import { formatMoney } from '@/lib/domain/money'
import { cn } from '@/lib/ui/cn'
import { CountUp, MoneyUp } from './count-up'
import { familyId, plural } from './format'
import css from './hud.module.css'

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Official site'
  }
}

export function FamilyCards({ cards }: { cards: FamilyCard[] }) {
  if (!cards.length) return null
  return (
    <section aria-labelledby="families-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2 id="families-title" className="m-0 text-[26px] leading-[1.1] font-light tracking-[-0.03em] text-ink md:text-[30px]">
          The passes
        </h2>
        <p className="hud m-0 text-ink-2">{cards[0].seasonLabel} · prices on file only</p>
      </div>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        {cards.map((c, i) => (
          <li key={c.id} style={{ '--i': i } as CSSProperties} className={cn(css.rise, 'min-w-0')}>
            <article className={cn(css.lift, 'glass flex h-full flex-col gap-2.5 rounded-[28px] p-5')}>
              <div className="flex flex-col items-start gap-2">
                <PassBadge family={familyId(c.id)} size="sm" />
                <h3 className="m-0 min-w-0 text-[17px] leading-snug font-semibold text-ink">{c.name}</h3>
              </div>
              {c.price ? (
                <p className="m-0 flex flex-wrap items-baseline gap-x-2">
                  {c.id === 'regional' ? null : <span className="text-[13px] text-ink-2">from</span>}
                  <MoneyUp amountMinor={c.price.amountMinor} currency={c.price.currency} className="tnum text-[32px] leading-[1.1] font-light tracking-[-0.02em] text-ink" />
                  <span className="text-[13px] text-ink-2">adult</span>
                </p>
              ) : (
                <p className="m-0 text-[28px] leading-[1.1] font-light tracking-[-0.02em] text-ink-3">No price yet</p>
              )}
              <p className="m-0 text-[13px] leading-[1.45] text-ink-2">
                {c.price
                  ? c.id === 'regional'
                    ? 'Current adult price on file for your favourite resort’s pass.'
                    : `Cheapest current adult price across ${plural(c.productCount, 'product')}.`
                  : `No ${c.seasonLabel} price on file yet — the official site has the latest.`}
              </p>
              {c.salesNote ? <p className="m-0 text-[13px] leading-[1.45] text-copper">{c.salesNote}</p> : null}
              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
                {c.officialUrl ? (
                  <a href={c.officialUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 text-[13px] font-semibold text-teal hover:underline max-md:min-h-11">
                    {host(c.officialUrl)} <ArrowUpRight aria-hidden className="size-3.5" />
                  </a>
                ) : null}
                <Link href={`/passes/products#family-${c.id}`} className="inline-flex min-h-9 items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-teal max-md:min-h-11">
                  <Tags aria-hidden className="size-3.5" /> All prices
                </Link>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  )
}

const fmtDays = (n: number) => (Math.round(n * 10) / 10).toFixed(1)

export function BreakEvenBand({ b }: { b: BreakEvenView | null }) {
  if (!b) return null
  const typ = b.typical ? breakEvenDays(b.passPrice, b.typical.amount) : null
  const low = b.low ? breakEvenDays(b.passPrice, b.low.amount) : null
  const scale = Math.max(typ ?? 0, low ?? 0, b.daysSkied, 1)
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`
  const passText = `${formatMoney(b.passPrice)} ${b.productName}${b.passPriceKind === 'paid' ? ' (what you paid)' : ''}`
  const ticketSeason = b.typical?.seasonId?.replace('-', '–')
  return (
    <section aria-labelledby="breakeven-title" className={cn(css.rise, 'grid items-center gap-7 rounded-[32px] bg-ink-chip p-6 text-on-ink-chip md:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]')}>
      <div className="flex min-w-0 flex-col gap-2.5">
        <p className="hud m-0 tracking-[0.16em] text-on-ink-chip-accent">Pass vs lift tickets · {b.resortName}</p>
        <h2 id="breakeven-title" className="m-0 text-[clamp(36px,4.4vw,60px)] leading-[1] font-light tracking-[-0.04em]">
          {typ != null ? (
            <>
              About <CountUp value={Math.round(typ)} className="tnum" /> {Math.round(typ) === 1 ? 'day' : 'days'} to break even
            </>
          ) : (
            'Break-even unknown'
          )}
        </h2>
        <p className="m-0 text-[14px] leading-[1.5] text-on-ink-chip-2">
          {typ != null && b.typical ? (
            <>
              {passText} ÷ a {formatMoney(b.typical.amount)} adult day ticket{b.ticketsThisSeason ? '' : ` (${ticketSeason} price)`}.
              {low != null && b.low ? ` On cheaper days (${formatMoney(b.low.amount)}) it takes about ${Math.round(low)}.` : ''}{' '}
              {b.ticketsThisSeason ? 'A rough guide.' : `A rough guide until ${b.seasonLabel} ticket prices are out.`}
            </>
          ) : (
            <>
              {passText} — but no adult day-ticket price is on file for {b.resortName}, so nothing is divided. Add your own estimate in day costs.
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
          <Link href="/passes/compare" className="inline-flex min-h-9 items-center gap-1 text-[13.5px] font-semibold text-on-ink-chip-accent hover:underline max-md:min-h-11">
            Full pass-vs-tickets comparison <ArrowRight aria-hidden className="size-3.5" />
          </Link>
          {typ == null ? (
            <Link href="/passes/costs" className="inline-flex min-h-9 items-center gap-1 text-[13.5px] font-semibold text-on-ink-chip-accent hover:underline max-md:min-h-11">
              Day costs <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">
        <div className="hud flex justify-between gap-3 text-on-ink-chip-2">
          <span>0 days</span>
          <span>Days skied so far: {b.daysSkied}</span>
          <span className="tnum">{typ != null ? Math.ceil(scale) : '?'}</span>
        </div>
        <div
          role="img"
          aria-label={
            typ != null
              ? `${b.daysSkied} days skied so far at ${b.resortName}; break-even about ${fmtDays(typ)} days at ${formatMoney(b.typical!.amount)}${low != null ? ` and ${fmtDays(low)} days at ${formatMoney(b.low!.amount)}` : ''}.`
              : `${b.daysSkied} days skied so far; break-even unknown without a ticket price.`
          }
          className="relative h-4 rounded-full bg-on-ink-chip/12"
        >
          <span aria-hidden className={cn(css.grow, 'absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,var(--snow-top),var(--on-ink-chip-accent))]')} style={{ width: typ != null ? pct(typ) : '0%' }} />
          {b.daysSkied > 0 ? <span aria-hidden className="absolute inset-y-[3px] left-[3px] rounded-full bg-on-ink-chip" style={{ width: `calc(${pct(b.daysSkied)} - 6px)` }} /> : null}
          {typ != null ? <span aria-hidden className="absolute -top-1.5 -bottom-1.5 w-[2px] rounded-full bg-on-ink-chip" style={{ left: pct(typ) }} /> : null}
          {low != null ? <span aria-hidden className="absolute -top-1.5 -bottom-1.5 w-[2px] rounded-full bg-on-ink-chip/60" style={{ left: `calc(${pct(low)} - 2px)` }} /> : null}
        </div>
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-[13px] text-on-ink-chip-2 tnum">
          {typ != null ? <span>Break-even at {formatMoney(b.typical!.amount)}/day: {fmtDays(typ)} days</span> : <span>Day-ticket price: not on file</span>}
          {low != null ? <span>at {formatMoney(b.low!.amount)}: {fmtDays(low)} days</span> : null}
        </div>
      </div>
    </section>
  )
}
