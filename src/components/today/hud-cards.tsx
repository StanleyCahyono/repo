'use client'
/**
 * Today's three glass cards: opening countdown rings, 7-day snow at the home mountain, and pass deadlines.
 *
 * - Countdown: each resort is a real link to its page (ring, name and date). Hovering or focusing one lifts it, dims
 *   the rest, shows an arrow badge and fills the detail line underneath. Rings draw their arc once on arrival.
 * - Snow: seven day columns (weekday over date, a bar that grows once, the amount, then high over low), stacked so
 *   nothing can collide at any card width; the unit legend sits under the columns. Hover or focus a day for detail.
 * - Passes: the headline price (a change that just happened, the next deadline, or the current price), other current
 *   prices on file, and dated notes on sales.
 *
 * Motion is CSS only (rings: stroke-dashoffset once; bars: scaleY once; hover: transform/opacity), so server-rendered
 * content never waits for hydration, and reduced motion shows the final state at once.
 */
import { useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight, CalendarClock, Snowflake, Ticket } from 'lucide-react'
import type { Countdown, PassCard, SnowDay } from '@/lib/data/today-hud'
import { cn } from '@/lib/ui/cn'

const RING_SCALE_DAYS = 60
const fill = (days: number) => Math.max(0.03, Math.min(1, 1 - days / RING_SCALE_DAYS))
/** Item hover/focus: ≤ 2px lift and a soft dim of the others (transform + opacity only, 160ms). */
const ITEM_MOTION = 'transition-[opacity,transform] duration-[160ms] ease-[var(--ease-out-soft)]'
const delay = (ms: number) => ({ '--rise-delay': `${ms}ms` }) as CSSProperties

function Card({ title, icon, aside, children, labelId }: { title: string; icon: ReactNode; aside?: ReactNode; children: ReactNode; labelId: string }) {
  return (
    <section aria-labelledby={labelId} className="glass lift @container flex min-w-0 flex-1 flex-col gap-4 rounded-[28px] px-[22px] pt-5 pb-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h2 id={labelId} className="hud m-0 flex min-w-0 items-start gap-2 tracking-[0.14em] text-ink-2">
          <span aria-hidden className="mt-px text-teal [&>svg]:size-3.5">
            {icon}
          </span>
          <span className="min-w-0">{title}</span>
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** The detail line under a card's items: quiet by default, the dark HUD chip while an item is active. */
function Tip({ active, tipKey, children }: { active: boolean; tipKey: string; children: ReactNode }) {
  return (
    <p
      aria-live="polite"
      className={cn(
        'm-0 mt-auto min-h-[calc(3lh+20px)] rounded-[14px] px-3.5 py-2.5 text-[13px] leading-[1.4] transition-colors duration-200 @min-[560px]:min-h-[calc(2lh+20px)]',
        active ? 'bg-ink-chip text-on-ink-chip' : 'bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] text-ink-2',
      )}
    >
      <span key={tipKey} className="piste-fade block">
        {children}
      </span>
    </p>
  )
}

function Ring({ days, estimate, on, index }: { days: number; estimate: boolean; on: boolean; index: number }) {
  const offset = +(100 - fill(days) * 100).toFixed(2)
  return (
    <span className={cn('relative grid size-[60px] shrink-0 place-items-center rounded-full transition-shadow duration-200', on && 'shadow-[0_10px_24px_-6px_rgb(19_32_44/0.35)]')}>
      <svg viewBox="0 0 60 60" aria-hidden className="absolute inset-0 size-full -rotate-90">
        <circle cx="30" cy="30" r="26.5" fill="none" strokeWidth="5" className="stroke-[color-mix(in_srgb,var(--teal)_14%,transparent)]" />
        <circle
          cx="30"
          cy="30"
          r="26.5"
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100 100"
          className={cn('piste-ring-fill transition-[stroke] duration-200', on ? 'stroke-ink-chip' : estimate ? 'stroke-copper' : 'stroke-teal')}
          style={{ strokeDashoffset: offset, ...delay(160 + index * 70) }}
        />
      </svg>
      <span
        className={cn(
          'tnum relative grid size-[46px] place-items-center rounded-full text-[17px] font-semibold transition-colors duration-200',
          on ? 'bg-ink-chip text-on-ink-chip' : 'bg-surface-2 text-ink',
        )}
      >
        {days}
      </span>
      {/* "Go" badge: appears on hover/focus so the ring reads as a link. */}
      <span
        aria-hidden
        className={cn(
          'absolute -top-0.5 -right-1 grid size-[22px] place-items-center rounded-full bg-teal text-on-teal shadow-[0_0_0_2px_var(--surface)] transition-[opacity,transform] duration-[160ms]',
          on ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
        )}
      >
        <ArrowUpRight className="size-3.5" strokeWidth={2.2} />
      </span>
    </span>
  )
}

export interface OpenNowItem {
  id: string
  name: string
  place: string
  drive: string | null
}

export function CountdownCard({ items, openNow, openCount }: { items: Countdown[]; openNow: OpenNowItem[]; openCount: number }) {
  const [hc, setHc] = useState<number | null>(null)
  const leave = (i: number) => setHc((v) => (v === i ? null : v))
  const active = hc !== null ? items[hc] : null
  if (!items.length) return <OpenNowCard openNow={openNow} openCount={openCount} />
  return (
    <Card title="Opening countdown · days" labelId="countdown-title" icon={<CalendarClock />}>
      <ol className="m-0 grid list-none grid-cols-3 gap-x-1 gap-y-3 p-0 @min-[620px]:grid-cols-6 @min-[620px]:gap-x-2">
        {items.map((c, i) => {
          const on = hc === i
          const dim = hc !== null && !on
          return (
            <li key={c.resortId} className="flex min-w-0">
              <Link
                href={`/resorts/${c.resortId}`}
                onMouseEnter={() => setHc(i)}
                onMouseLeave={() => leave(i)}
                onFocus={() => setHc(i)}
                onBlur={() => leave(i)}
                aria-label={`${c.name}: opens in ${c.days} ${c.days === 1 ? 'day' : 'days'}, ${c.estimate ? 'Piste estimate' : 'announced'}, ${c.sub.replace('EST. ', '').toLowerCase()}. Open the resort page.`}
                className={cn(
                  'flex min-w-0 flex-1 flex-col items-center gap-2 rounded-[18px] px-0.5 pt-1.5 pb-2 text-center outline-offset-2',
                  ITEM_MOTION,
                  dim ? 'opacity-45' : 'opacity-100',
                  on && '-translate-y-0.5',
                )}
              >
                <Ring days={c.days} estimate={c.estimate} on={on} index={i} />
                <span
                  className={cn(
                    'line-clamp-2 w-full text-[13px] leading-[1.25] font-medium break-words hyphens-auto text-ink decoration-teal decoration-[1.5px] underline-offset-[3px] @max-[300px]:text-[12px]',
                    on && 'underline',
                  )}
                >
                  {c.name}
                </span>
                <span className={cn('font-mono text-[12px] leading-none tracking-[0.04em]', c.estimate ? 'text-copper' : 'text-ink-2')}>{c.sub}</span>
              </Link>
            </li>
          )
        })}
      </ol>
      <Tip active={!!active} tipKey={active?.resortId ?? 'idle'}>
        {active ? (
          <>
            {active.detail} <span className="whitespace-nowrap text-on-ink-chip-accent">Open page →</span>
          </>
        ) : (
          'Rings fill as opening day nears; copper rings are Piste estimates. Select a resort to open its page.'
        )}
      </Tip>
    </Card>
  )
}

/** Mid-season (nothing left to count down): the resorts open now, nearest first, each linking to its page. */
function OpenNowCard({ openNow, openCount }: { openNow: OpenNowItem[]; openCount: number }) {
  return (
    <Card title={openNow.length ? 'Open now · nearest first' : 'Opening countdown · days'} labelId="countdown-title" icon={<CalendarClock />}>
      {openNow.length ? (
        <ul className="m-0 grid list-none gap-1 p-0 @min-[620px]:grid-cols-2 @min-[620px]:gap-x-4">
          {openNow.map((r, i) => (
            <li key={r.id} className="piste-rise-soft" style={delay(320 + i * 40)}>
              <Link
                href={`/resorts/${r.id}`}
                className="group -mx-2 flex min-h-11 items-center gap-3 rounded-[14px] px-2 py-1.5 transition-[background-color,transform] duration-150 ease-[var(--ease-out-soft)] hover:-translate-y-px hover:bg-chip-hover"
              >
                <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-positive-bg">
                  <i className="size-2 rounded-full bg-positive" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink decoration-teal decoration-[1.5px] underline-offset-[3px] group-hover:underline">{r.name}</span>
                  <span className="block truncate font-mono text-[12px] text-ink-2">
                    {r.place}
                    {r.drive ? ` · ${r.drive}` : ''}
                  </span>
                </span>
                <ArrowRight aria-hidden className="size-4 shrink-0 text-ink-3 transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-teal" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="m-0 mt-auto text-[13px] leading-[1.5] text-ink-2">
        No openings due in the next 90 days.
        {openCount > 0 ? (
          <>
            {' '}
            {openCount} {openCount === 1 ? 'resort is' : 'resorts are'} open worldwide:{' '}
            <Link href="/explore" className="font-medium text-teal underline-offset-2 hover:underline">
              see them in Explore
            </Link>
            .
          </>
        ) : null}
      </p>
    </Card>
  )
}

export function SnowCard({
  resortName,
  days,
  status,
  snowUnit,
  tempUnit,
  footer,
}: {
  resortName: string | null
  days: SnowDay[]
  status: string
  snowUnit: 'in' | 'cm'
  tempUnit: '°F' | '°C'
  footer?: ReactNode
}) {
  const [hd, setHd] = useState<number | null>(null)
  const leave = (i: number) => setHd((v) => (v === i ? null : v))
  const max = Math.max(2, ...days.map((d) => d.snowCm ?? 0))
  const d = hd !== null ? days[hd] : null
  const fetched = days.some((x) => x.snowCm != null)
  const tip = d
    ? d.snow == null
      ? `${d.label}: not fetched yet.`
      : `${d.label}: likely ${d.partial ? 'at least ' : ''}${d.snow} of snow${d.hi && d.lo ? `, high ${d.hi} / low ${d.lo}` : ''}. Modeled, not observed.`
    : fetched
      ? 'Hover or focus a day for detail. Modeled snowfall: a forecast, not a report.'
      : 'No forecast stored for these days yet.'
  return (
    <Card
      title={`7-day snow${resortName ? ` · ${resortName}` : ''}`}
      labelId="snow-title"
      icon={<Snowflake />}
      aside={<span className={cn('hud text-right', fetched ? 'text-ink-2' : 'text-copper')}>{status}</span>}
    >
      <ol className="m-0 grid list-none grid-cols-7 gap-1 p-0 @min-[340px]:gap-1.5 @min-[420px]:gap-2.5">
        {days.map((x, i) => {
          const on = hd === i
          const dim = hd !== null && !on
          const h = x.snowCm != null ? Math.max(4, (x.snowCm / max) * 100) : 0
          const [dow, dom] = x.label.split(' ')
          return (
            <li
              key={x.date}
              tabIndex={0}
              onMouseEnter={() => setHd(i)}
              onMouseLeave={() => leave(i)}
              onFocus={() => setHd(i)}
              onBlur={() => leave(i)}
              aria-label={`${x.label}: ${x.snow == null ? 'not fetched' : `likely ${x.partial ? 'at least ' : ''}${x.snow}${x.hi && x.lo ? `, high ${x.hi}, low ${x.lo}` : ''}`}`}
              className={cn('flex min-w-0 cursor-default flex-col items-center gap-2 rounded-[12px] outline-offset-2', ITEM_MOTION, dim ? 'opacity-45' : 'opacity-100', on && '-translate-y-0.5')}
            >
              <div
                aria-hidden
                className={cn(
                  'relative h-16 w-full overflow-hidden rounded-[12px] transition-[background-color,box-shadow] duration-200',
                  on ? 'bg-[color-mix(in_srgb,var(--teal)_14%,transparent)] shadow-[0_10px_22px_-8px_color-mix(in_srgb,var(--teal)_45%,transparent)]' : 'bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]',
                )}
              >
                {h ? (
                  <div className="absolute inset-x-0 bottom-0" style={{ height: `${h}%` }}>
                    <div
                      className="piste-grow-y size-full rounded-[10px]"
                      style={{ background: `linear-gradient(180deg, var(--snow-top), ${on ? 'var(--ink-chip)' : 'var(--teal)'})`, ...delay(200 + i * 45) }}
                    />
                  </div>
                ) : null}
              </div>
              <span className={cn('flex flex-col items-center font-mono text-[12px] leading-[1.25]', i === 0 ? 'text-teal' : 'text-ink-2')}>
                <span className="tracking-[0.06em]">{dow}</span>
                <span className="tnum">{dom}</span>
              </span>
              <span className="tnum text-[13px] leading-none font-semibold whitespace-nowrap text-ink">{x.snowShort ?? '—'}</span>
              {x.hi && x.lo ? (
                <span className="tnum flex flex-col items-center font-mono text-[12px] leading-[1.25] whitespace-nowrap">
                  <span className="text-ink">{x.hi}</span>
                  <span className="text-ink-2">{x.lo}</span>
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
      {fetched ? (
        <p aria-hidden className="m-0 -mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[12px] tracking-[0.04em] text-ink-2">
          <span className="flex items-center gap-1.5">
            <i className="h-2.5 w-1.5 rounded-full bg-[linear-gradient(180deg,var(--snow-top),var(--teal))]" />
            Snow, {snowUnit}
          </span>
          <span>High / low, {tempUnit}</span>
        </p>
      ) : null}
      <Tip active={!!d} tipKey={d?.date ?? 'idle'}>
        {tip}
      </Tip>
      {footer}
    </Card>
  )
}

const KIND_LABEL = { change: 'Price change', deadline: 'Next deadline', current: 'Current price' } as const

export function PassDeadlinesCard({ card }: { card: PassCard }) {
  const h = card.headline
  return (
    <Card title="Pass deadlines" labelId="passes-title" icon={<Ticket />}>
      {h ? (
        <div className="flex flex-col gap-2">
          <p className={cn('hud m-0', h.kind === 'current' ? 'text-ink-2' : 'text-copper')}>{KIND_LABEL[h.kind]}</p>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1.5">
            <span className="tnum text-[46px] leading-[0.95] font-light tracking-[-0.03em] text-ink">{h.price}</span>
            <span className="min-w-0 flex-1 basis-[160px] pb-0.5 text-[13px] leading-[1.35] text-ink-2">
              <span className="block font-medium text-ink">{h.name}</span>
              {[h.note, h.kind !== 'current' && !h.tiers.length ? h.detail : null].filter(Boolean).join(' · ')}
            </span>
          </div>
        </div>
      ) : (
        <p className="m-0 text-[14px] text-ink-2">No current pass prices on file.</p>
      )}
      {h?.tiers.length ? (
        <ol className="m-0 flex list-none gap-1 rounded-[16px] bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] px-3.5 pt-3 pb-2.5" aria-label={`${h.name} price steps`}>
          {h.tiers.map((t, i) => (
            <li key={`${t.label}-${t.price}`} className="flex min-w-0 flex-1 flex-col gap-1">
              <span aria-hidden className="flex items-center gap-1.5">
                <i
                  className={cn(
                    'size-2.5 shrink-0 rounded-full border-2',
                    t.current ? 'border-teal bg-teal shadow-[0_0_0_3px_color-mix(in_srgb,var(--teal)_20%,transparent)]' : t.past ? 'border-divider-strong bg-transparent' : 'border-teal bg-transparent',
                  )}
                />
                {i < h.tiers.length - 1 ? <i className="h-px flex-1 bg-divider-strong" /> : null}
              </span>
              <span className={cn('tnum text-[15px] leading-tight font-medium', t.past ? 'text-ink-2 line-through decoration-1' : 'text-ink')}>{t.price}</span>
              <span className={cn('font-mono text-[12px] leading-tight', t.current ? 'text-teal' : 'text-ink-2')}>
                {t.label}
                {t.current ? ' · now' : ''}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {card.others.length ? (
        <ul className="m-0 flex list-none flex-col border-t border-divider p-0" aria-label="Other current prices">
          {card.others.map((o) => (
            <li key={o.productId} className="flex items-center justify-between gap-3 border-b border-divider py-2 text-[13px]">
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{o.name}</span>
                {o.note ? <span className="block text-[12px] text-ink-2">{o.note}</span> : null}
              </span>
              <span className="tnum shrink-0 text-[15px] font-medium text-ink">{o.price}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {card.notes.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {card.notes.map((l) => (
            <li key={l} className="flex gap-2 text-[13px] leading-[1.45] text-ink-2">
              <i aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-copper" />
              <span className="min-w-0">{l}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Link
          href="/passes"
          className="group inline-flex min-h-9 items-center gap-1.5 rounded-full bg-ink-chip px-3.5 text-[13px] font-medium text-on-ink-chip transition-transform duration-150 hover:-translate-y-px"
        >
          Passes &amp; costs <ArrowRight aria-hidden className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
        </Link>
        {h?.sourceUrl ? (
          <a
            href={h.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="glass-strong inline-flex min-h-9 items-center gap-1 rounded-full px-3.5 text-[13px] font-medium text-ink-2 transition-[color,transform] duration-150 hover:-translate-y-px hover:text-ink"
          >
            Price source <ArrowUpRight aria-hidden className="size-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
      </div>
    </Card>
  )
}
