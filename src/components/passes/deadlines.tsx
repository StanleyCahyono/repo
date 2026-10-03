/**
 * Buy-by dates: advance-price cut-offs and sales deadlines from the recorded price snapshots and products, soonest
 * first. Undated statements ("reports say it sold out") are listed as stated, never given a date.
 */
import Link from 'next/link'
import { ArrowRight, CalendarClock } from 'lucide-react'
import { PassBadge } from '@/components/ui/badge'
import { SourceDrawer } from '@/components/ui/source-drawer'
import type { DeadlineItem } from '@/lib/data/passes-screen'
import { formatMoney } from '@/lib/domain/money'
import { cn } from '@/lib/ui/cn'
import { dayMonth, daysAway, familyId } from './format'

export function BuyByDates({ items, limit = 5 }: { items: DeadlineItem[]; limit?: number }) {
  const dated = items.filter((i) => i.date)
  const undated = items.filter((i) => !i.date)
  const shown = dated.slice(0, limit)
  return (
    <section aria-labelledby="buyby-title" className="min-w-0 glass rounded-[24px]">
      <header className="flex items-center justify-between gap-3 border-b border-divider px-4 pt-4 pb-3">
        <h2 id="buyby-title" className="flex items-center gap-2 text-[17px] font-semibold text-ink">
          <CalendarClock aria-hidden className="size-4 text-ink-3" />
          Buy-by dates
        </h2>
        <Link href="/passes/products" className="inline-flex items-center gap-1 text-[13px] font-medium text-teal hover:underline max-md:min-h-11">
          All prices <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </header>
      {shown.length ? (
        <ol className="flex flex-col divide-y divide-divider">
          {shown.map((d, i) => {
            const soon = d.daysLeft !== null && d.daysLeft <= 7
            return (
              <li key={`${d.productId}-${d.kind}-${i}`} className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 px-4 py-3">
                <p className="flex flex-col">
                  <span className={cn('font-display text-[22px] leading-none tnum', soon ? 'text-copper' : 'text-ink')}>{dayMonth(d.date!)}</span>
                  <span className={cn('mt-1 text-[12px]', soon ? 'font-medium text-copper' : 'text-ink-3')}>{daysAway(d.daysLeft)}</span>
                </p>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <PassBadge family={familyId(d.familyId)} size="sm" />
                    <span className="text-[14px] font-medium text-ink">{d.productName}</span>
                  </p>
                  <p className="mt-0.5 text-[13px] text-ink-2">
                    {d.kind === 'price' && d.price ? (
                      <>
                        <span className="font-medium text-ink tnum">{formatMoney(d.price)}</span>
                        {d.category ? ` ${d.category.toLowerCase()}` : ''} price ends{d.nextPrice ? <> — then <span className="tnum">{formatMoney(d.nextPrice)}</span></> : ''}
                      </>
                    ) : (
                      (d.text ?? 'Sales deadline')
                    )}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2">
                    <SourceDrawer title={d.productName} items={[{ label: d.kind === 'price' ? 'Advance price' : 'Sales deadline', value: d.text ?? undefined, prov: d.prov }]} />
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="px-4 py-4 text-[13.5px] text-ink-2">No upcoming buy-by dates are recorded. Prices and deadlines that are not recorded stay unknown — check the official pages.</p>
      )}
      {undated.length ? (
        <details className="border-t border-divider px-4 py-3">
          <summary className="cursor-pointer text-[13px] font-medium text-teal select-none hover:underline">Stated without a date ({undated.length})</summary>
          <ul className="mt-2 flex flex-col gap-2 text-[13px]">
            {undated.map((d) => (
              <li key={`${d.productId}-u`}>
                <span className="font-medium text-ink">{d.productName}</span>
                <span className="block text-ink-2">{d.text}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
