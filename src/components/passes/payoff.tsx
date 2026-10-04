'use client'
/**
 * Step 03 of Pass vs tickets — "When does a pass pay off?": pick a pass, slide the number of days you ski, and read
 * one sentence. Tickets are priced at the average ticket on the planned days that pass covers; the pass at its
 * published price. Two directly labelled bars on one scale show the same comparison (the sentence is the text
 * alternative). Only passes with a price that cover at least one planned day are offered; nothing is guessed.
 */
import { useId, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { PassBadge } from '@/components/ui/badge'
import { formatMoney, money } from '@/lib/domain/money'
import { t } from '@/lib/ui/motion'
import { cn } from '@/lib/ui/cn'
import type { PayoffPass } from './compare-model'
import { familyId } from './format'
import css from './hud.module.css'

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

export function Payoff({ passes, dayCount }: { passes: PayoffPass[]; dayCount: number }) {
  const id = useId()
  const [passId, setPassId] = useState(passes[0]?.id ?? '')
  const p = passes.find((x) => x.id === passId) ?? passes[0]
  const max = Math.min(60, Math.max(10, dayCount, p ? p.breakEvenDays * 2 : 10))
  const [days, setDays] = useState(Math.min(max, Math.max(1, dayCount || p?.breakEvenDays || 5)))
  if (!p) return null
  const n = Math.min(days, max)
  const tickets = money(p.avgTicket.amountMinor * n, p.avgTicket.currency)
  const diff = tickets.amountMinor - p.price.amountMinor
  const scale = Math.max(tickets.amountMinor, p.price.amountMinor, 1)
  const pct = (v: number) => Math.max(0.02, v / scale)
  const be = p.breakEvenDays
  const marker = ((Math.min(be, max) - 1) / Math.max(1, max - 1)) * 100

  return (
    <div className="flex flex-col gap-5">
      {passes.length > 1 ? (
        <div role="radiogroup" aria-label="Pass" className="flex flex-wrap gap-1.5">
          {passes.map((x) => {
            const on = x.id === p.id
            return (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPassId(x.id)}
                className={cn(
                  'relative inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 max-md:h-11',
                  on ? 'border-transparent text-on-ink-chip' : 'border-divider-strong/70 bg-glass-strong text-ink-2 hover:border-teal hover:text-teal',
                )}
              >
                {on ? <motion.span layoutId={`${id}-pass`} transition={t.select} aria-hidden className="absolute inset-0 rounded-full bg-ink-chip" /> : null}
                <span className="relative">{x.name}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="m-0 flex flex-wrap items-center gap-2">
            <PassBadge family={familyId(p.familyId)} size="sm" />
            <span className="text-[14px] font-medium text-ink-2">
              {p.name} · <span className="tnum">{formatMoney(p.price)}</span>
            </span>
          </p>
          <p key={p.id} className={cn(css.rise, 'm-0 text-[30px] leading-[1.1] font-light tracking-[-0.03em] text-ink text-balance md:text-[36px]')}>
            Pays off from your <span className="tnum">{ordinal(be)}</span> ski day
          </p>
          <p className="m-0 text-[14.5px] leading-[1.5] text-ink-2" aria-live="polite">
            {n} {n === 1 ? 'day' : 'days'} of lift tickets at about {formatMoney(p.avgTicket)} come to <span className="font-medium text-ink tnum">{formatMoney(tickets)}</span>
            {diff > 0 ? (
              <>
                {' '}
                — the pass saves <span className="font-medium text-positive tnum">{formatMoney(money(diff, tickets.currency))}</span>.
              </>
            ) : diff < 0 ? (
              <>
                {' '}
                — tickets are <span className="font-medium text-ink tnum">{formatMoney(money(-diff, tickets.currency))}</span> cheaper.
              </>
            ) : (
              ' — exactly the pass price.'
            )}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={`${id}-days`} className="hud tracking-[0.12em] text-ink-2">
                Days you ski
              </label>
              <output htmlFor={`${id}-days`} className="text-[20px] leading-none font-light text-ink tnum">
                {n} {n === 1 ? 'day' : 'days'}
              </output>
            </div>
            <div className="relative pt-7">
              {be <= max ? (
                <span aria-hidden className="pointer-events-none absolute top-0 -translate-x-1/2 text-center" style={{ left: `calc(11px + (100% - 22px) * ${marker / 100})` } as CSSProperties}>
                  <span className="hud block text-[11px] tracking-[0.08em] whitespace-nowrap text-teal">pays off</span>
                  <span className="mx-auto mt-0.5 block h-3 w-[2px] rounded-full bg-teal" />
                </span>
              ) : null}
              <input
                id={`${id}-days`}
                type="range"
                min={1}
                max={max}
                step={1}
                value={n}
                onChange={(e) => setDays(Number(e.target.value))}
                aria-valuetext={`${n} ${n === 1 ? 'day' : 'days'}`}
                className={css.range}
                style={{ '--fill': (n - 1) / Math.max(1, max - 1) } as CSSProperties}
              />
              <div aria-hidden className="mt-1 flex justify-between text-[12px] text-ink-3 tnum">
                <span>1</span>
                <span>{max}</span>
              </div>
            </div>
          </div>

          <dl className="m-0 flex flex-col gap-2.5">
            {(
              [
                ['Lift tickets', `${n} × ${formatMoney(p.avgTicket)}`, tickets, 'bg-copper'],
                [p.name, 'pass price', p.price, 'bg-teal'],
              ] as const
            ).map(([label, sub, amount, color]) => (
              <div key={label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                <dt className="min-w-0 text-[13px] text-ink-2">
                  <span className="font-medium text-ink">{label}</span> <span className="text-ink-3 tnum">· {sub}</span>
                </dt>
                <dd className="m-0 text-right text-[15px] font-medium text-ink tnum">{formatMoney(amount)}</dd>
                <div className="col-span-2 h-3 overflow-hidden rounded-full bg-chip-track">
                  <motion.div initial={false} animate={{ x: `${(pct(amount.amountMinor) - 1) * 100}%` }} transition={t.bars} className={cn('h-full w-full rounded-full', color)} />
                </div>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <p className="m-0 text-[12.5px] leading-[1.5] text-ink-3">
        Uses {formatMoney(p.avgTicket)}, the average ticket on the {p.coveredDays === 1 ? 'planned day' : `${p.coveredDays} planned days`} this pass covers, and assumes it covers every day you
        ski{p.coveredDays < dayCount ? ` — of your ${dayCount} planned days it covers ${p.coveredDays}` : ''}.
      </p>
    </div>
  )
}
