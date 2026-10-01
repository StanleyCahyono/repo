'use client'
/**
 * Today's three glass cards: opening countdown rings, 7-day snow at the home mountain, and pass deadlines.
 * Hovering or focusing a ring or a day lifts it, dims the rest and fills the detail line underneath.
 */
import { useState } from 'react'
import Link from 'next/link'
import type { Countdown, PassCard, SnowDay } from '@/lib/data/today-hud'
import { cn } from '@/lib/ui/cn'

const RING_SCALE_DAYS = 60
const fill = (days: number) => Math.max(0.03, Math.min(1, 1 - days / RING_SCALE_DAYS))
const LIFT = 'transition-[opacity,transform] duration-[350ms] ease-[cubic-bezier(.3,1.4,.5,1)]'

function Card({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="glass flex flex-col gap-3.5 rounded-[28px] px-[22px] py-5" aria-label={title}>
      <div className="flex justify-between gap-2">
        <h2 className="hud m-0 tracking-[0.14em] text-ink-2">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Tip({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <p
      aria-live="polite"
      className={cn(
        'm-0 mt-auto min-h-[38px] rounded-[14px] px-3.5 py-2.5 text-[13px] leading-[1.4] transition-colors duration-[250ms]',
        active ? 'bg-ink-chip text-on-ink-chip' : 'bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] text-ink-2',
      )}
    >
      {children}
    </p>
  )
}

export function CountdownCard({ items }: { items: Countdown[] }) {
  const [hc, setHc] = useState<number | null>(null)
  const leave = (i: number) => setHc((v) => (v === i ? null : v))
  return (
    <Card title="Opening countdown · days">
      {items.length ? (
        <div className="grid grid-cols-3 justify-items-center gap-x-1 gap-y-4 sm:flex sm:justify-between">
          {items.map((c, i) => {
            const on = hc === i
            const dim = hc !== null && !on
            const deg = Math.round(fill(c.days) * 360)
            return (
              <div
                key={c.resortId}
                tabIndex={0}
                onMouseEnter={() => setHc(i)}
                onMouseLeave={() => leave(i)}
                onFocus={() => setHc(i)}
                onBlur={() => leave(i)}
                aria-label={`${c.name}: ${c.days} ${c.days === 1 ? 'day' : 'days'}, ${c.estimate ? 'estimated' : 'announced'} ${c.sub.replace('EST. ', '').toLowerCase()}`}
                className={cn('flex w-[66px] cursor-default flex-col items-center gap-1.5 rounded-[14px] outline-offset-4', LIFT, dim ? 'opacity-35' : 'opacity-100', on && '-translate-y-[5px] scale-[1.08]')}
              >
                <div
                  className={cn('flex size-14 items-center justify-center rounded-full transition-shadow duration-[250ms]', on && 'shadow-[0_10px_24px_rgb(19_32_44/0.3)]')}
                  style={{
                    background: `conic-gradient(${on ? 'var(--ink-chip)' : c.estimate ? 'var(--copper)' : 'var(--teal)'} ${deg}deg, color-mix(in srgb, var(--teal) 12%, transparent) 0)`,
                  }}
                >
                  <div className={cn('tnum flex size-[46px] items-center justify-center rounded-full text-[16px] font-semibold transition-colors duration-[250ms]', on ? 'bg-ink-chip text-on-ink-chip' : 'bg-surface-2 text-ink')}>
                    {c.days}
                  </div>
                </div>
                <span className="text-center text-[12px] leading-[1.2] font-medium">{c.name}</span>
                <span className="text-center font-mono text-[12px] text-ink-2">{c.sub}</span>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="m-0 text-[14px] text-ink-2">No opening dates on file for the next 90 days.</p>
      )}
      <Tip active={hc !== null}>{hc !== null ? items[hc].detail : 'Hover a ring for detail. Rings fill as opening day approaches; copper rings are Piste estimates.'}</Tip>
    </Card>
  )
}

export function SnowCard({ resortName, days, status, footer }: { resortName: string | null; days: SnowDay[]; status: string; footer?: React.ReactNode }) {
  const [hd, setHd] = useState<number | null>(null)
  const leave = (i: number) => setHd((v) => (v === i ? null : v))
  const max = Math.max(2, ...days.map((d) => d.snowCm ?? 0))
  const d = hd !== null ? days[hd] : null
  const tip = d
    ? d.snow == null
      ? `${d.label}: not fetched yet.`
      : `${d.label}: likely ${d.partial ? 'at least ' : ''}${d.snow} of snow${d.temps ? `, high/low ${d.temps}` : ''}. Modeled, not observed.`
    : 'Hover a day for detail.'
  return (
    <Card title={`7-day snow${resortName ? ` · ${resortName}` : ''}`} aside={<span className="hud text-right text-copper">{status}</span>}>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {days.map((x, i) => {
          const on = hd === i
          const dim = hd !== null && !on
          const h = x.snowCm != null ? Math.max(3, (x.snowCm / max) * 100) : 0
          return (
            <div
              key={x.date}
              tabIndex={0}
              onMouseEnter={() => setHd(i)}
              onMouseLeave={() => leave(i)}
              onFocus={() => setHd(i)}
              onBlur={() => leave(i)}
              aria-label={`${x.label}: ${x.snow == null ? 'not fetched' : `likely ${x.partial ? 'at least ' : ''}${x.snow}${x.temps ? `, ${x.temps}` : ''}`}`}
              className={cn('flex cursor-default flex-col items-center gap-1.5 rounded-[12px] outline-offset-4', LIFT, dim ? 'opacity-35' : 'opacity-100', on && '-translate-y-[5px]')}
            >
              <div
                className={cn(
                  'relative h-[58px] w-full overflow-hidden rounded-[12px] transition-[background-color,box-shadow] duration-[250ms]',
                  on ? 'bg-[color-mix(in_srgb,var(--teal)_14%,transparent)] shadow-[0_10px_22px_color-mix(in_srgb,var(--teal)_28%,transparent)]' : 'bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]',
                )}
              >
                <div
                  className="absolute inset-x-0 bottom-0 rounded-[12px]"
                  style={{ height: `${h}%`, background: `linear-gradient(180deg, var(--snow-top), ${on ? 'var(--ink-chip)' : 'var(--teal)'})` }}
                />
              </div>
              <span className="flex flex-col items-center font-mono text-[12px] leading-tight whitespace-nowrap text-ink-2 sm:block">
                {x.label.split(' ').map((part) => (
                  <span key={part} className="sm:after:content-['_'] sm:last:after:content-none">
                    {part}
                  </span>
                ))}
              </span>
              <span className="tnum text-[12.5px] font-medium">{x.snow ?? '—'}</span>
              {x.temps ? <span className="tnum font-mono text-[12px] whitespace-nowrap text-ink-2 max-sm:hidden">{x.temps}</span> : null}
            </div>
          )
        })}
      </div>
      <Tip active={!!d}>{tip}</Tip>
      {footer}
    </Card>
  )
}

export function PassDeadlinesCard({ card }: { card: PassCard }) {
  return (
    <Card title="Pass deadlines">
      {card.price ? (
        <div className="flex items-baseline gap-2.5">
          <span className="tnum text-[44px] leading-none font-light tracking-[-0.03em]">{card.price}</span>
          {card.priceNote ? <span className="text-[13px] leading-[1.4] text-ink-2">{card.priceNote}</span> : null}
        </div>
      ) : (
        <p className="m-0 text-[14px] text-ink-2">No dated pass prices on file.</p>
      )}
      {card.lines.map((l) => (
        <p key={l} className="m-0 text-[13px] leading-[1.45] text-ink-2">
          {l}
        </p>
      ))}
      <div className="mt-auto flex flex-wrap gap-2">
        <Link href="/passes" className="hud rounded-full border border-divider-strong px-2.5 py-1.5 text-ink-2 hover:text-ink">
          Passes &amp; costs →
        </Link>
        {card.confirmAtSource ? (
          card.sourceUrl ? (
            <a href={card.sourceUrl} target="_blank" rel="noreferrer" className="hud rounded-full border border-divider-strong px-2.5 py-1.5 text-ink-2 hover:text-ink">
              ◇ Researched · confirm at source
            </a>
          ) : (
            <span className="hud rounded-full border border-divider-strong px-2.5 py-1.5 text-ink-2">◇ Researched · confirm at source</span>
          )
        ) : null}
      </div>
    </Card>
  )
}
