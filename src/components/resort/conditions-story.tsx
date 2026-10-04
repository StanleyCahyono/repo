'use client'
/**
 * The conditions story's two diagrams.
 *
 * Snowpack strata: new snow, base depth and season total as stacked layers that fill in (rise from the ground) as
 * they enter the view. Only reported values fill a layer; anything not reported is a dashed, empty layer saying so —
 * nothing is estimated, and modeled snowfall is never added to a reported depth.
 *
 * 7-day snowfall: modeled new snow per resort-local day as glass columns that grow in, with snow drifting down inside
 * the days that have some. Hovering or focusing a day lifts it, dims the rest and fills the line underneath
 * ("Likely …", modeled, never observed). The table alternative lives in the conditions drawer.
 */
import { useState } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/ui/cn'

const LIFT = 'transition-[opacity,transform] duration-[350ms] ease-[cubic-bezier(.3,1.4,.5,1)]'

export interface StrataLayer {
  key: 'new' | 'base' | 'season'
  label: string
  /** Display value ("12 cm") or null when not reported. */
  value: string | null
  cm: number | null
  note: string | null
}

const EMPTY_H: Record<StrataLayer['key'], number> = { new: 34, base: 56, season: 78 }

/** Strata fills: fresh snow bright, the base compacted (fine bedding lines), the season total deep. Tokens only. */
const FILL: Record<StrataLayer['key'], string> = {
  new: 'linear-gradient(180deg, var(--surface), color-mix(in srgb, var(--glacier) 80%, var(--surface)))',
  base: 'repeating-linear-gradient(0deg, transparent 0 9px, color-mix(in srgb, var(--teal) 18%, transparent) 9px 10px), color-mix(in srgb, var(--teal) 24%, var(--surface))',
  season: 'repeating-linear-gradient(0deg, transparent 0 7px, color-mix(in srgb, var(--surface) 20%, transparent) 7px 8px), color-mix(in srgb, var(--teal) 70%, var(--ink-chip))',
}
const EMPTY_HATCH = 'repeating-linear-gradient(0deg, transparent 0 9px, color-mix(in srgb, var(--teal) 6%, transparent) 9px 10px)'

export function Snowpack({ layers, source }: { layers: StrataLayer[]; source: string }) {
  const known = layers.filter((l) => l.cm !== null && l.cm > 0)
  const max = Math.max(1, ...known.map((l) => Math.sqrt(l.cm!)))
  const height = (l: StrataLayer) => (l.cm !== null && l.cm > 0 ? Math.round(30 + (Math.sqrt(l.cm) / max) * 74) : EMPTY_H[l.key])
  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex flex-1 flex-col justify-end gap-1.5" role="list" aria-label="Snowpack layers">
        {layers.map((l, i) => {
          const filled = l.cm !== null
          return (
            <motion.div
              key={l.key}
              role="listitem"
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '0px 0px -10% 0px' }}
              transition={{ duration: 0.6, delay: (layers.length - 1 - i) * 0.12, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ minHeight: height(l), background: filled ? FILL[l.key] : l.key !== 'new' ? EMPTY_HATCH : undefined }}
              className={cn(
                'relative flex items-center justify-between gap-3 overflow-hidden rounded-[12px] px-3.5 text-[13px]',
                filled
                  ? l.key === 'season'
                    ? 'text-surface'
                    : 'text-ink shadow-[inset_0_1px_0_var(--glass-shine)]'
                  : 'border-[1.5px] border-dashed border-[color-mix(in_srgb,var(--teal)_38%,transparent)] text-ink-2',
              )}
            >
              <span className="min-w-0">
                <span className={cn('block', filled && 'font-medium')}>{l.label}</span>
                {l.note ? <span className={cn('block text-[12px]', filled && l.key === 'season' ? 'opacity-85' : 'text-ink-2')}>{l.note}</span> : null}
              </span>
              <span className={cn('shrink-0 tnum', filled ? 'text-[20px] font-light tracking-[-0.02em]' : 'italic')}>{l.value ?? 'Not reported'}</span>
            </motion.div>
          )
        })}
        <span aria-hidden className="mt-0.5 h-[3px] rounded-full bg-[color-mix(in_srgb,var(--ink)_14%,transparent)]" />
      </div>
      <p className="m-0 text-[12.5px] text-ink-2">{source}</p>
    </div>
  )
}

export interface SnowDayDatum {
  date: string
  /** 'THU' */
  dow: string
  /** '1' */
  day: string
  /** 'Thursday 1 October' */
  full: string
  cm: number | null
  /** '1.2 cm' / '0.5″' */
  text: string | null
  partial: boolean
  trend: boolean
  planning: boolean
}

function Flakes({ n, seed }: { n: number; seed: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const left = 14 + ((i * 37 + seed * 23) % 72)
        const dur = 2.4 + ((i * 13 + seed) % 10) / 6
        return (
          <motion.span
            key={i}
            aria-hidden
            className="absolute top-0 size-[3px] rounded-full bg-surface shadow-[0_0_4px_var(--surface)] motion-reduce:hidden"
            style={{ left: `${left}%` }}
            initial={{ y: -6, opacity: 0 }}
            animate={{ y: [-6, 90], opacity: [0, 1, 1, 0] }}
            transition={{ duration: dur, repeat: Infinity, delay: (i * 0.45 + seed * 0.2) % 2.2, ease: 'linear' }}
          />
        )
      })}
    </>
  )
}

export function SnowfallWeek({ days, point, empty }: { days: SnowDayDatum[]; point: string; empty: string | null }) {
  const [hd, setHd] = useState<number | null>(null)
  const leave = (i: number) => setHd((v) => (v === i ? null : v))
  const max = Math.max(2, ...days.map((d) => d.cm ?? 0))
  const d = hd !== null ? days[hd] : null
  const tip = d
    ? d.cm === null
      ? `${d.full}: not fetched yet.`
      : `${d.full}: likely ${d.partial ? 'at least ' : ''}${d.text} of new snow at the ${point.toLowerCase()}. Modeled, not observed${d.trend ? '; a less certain trend' : ''}.`
    : (empty ?? 'Hover or focus a day for detail. Amounts are likely, from modeled weather.')
  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="grid flex-1 grid-cols-7 items-end gap-1.5 sm:gap-2">
        {days.map((x, i) => {
          const on = hd === i
          const dim = hd !== null && !on
          const h = x.cm !== null && x.cm > 0 ? Math.max(4, (x.cm / max) * 100) : 0
          return (
            <div
              key={x.date}
              tabIndex={0}
              onMouseEnter={() => setHd(i)}
              onMouseLeave={() => leave(i)}
              onFocus={() => setHd(i)}
              onBlur={() => leave(i)}
              aria-label={`${x.full}: ${x.cm === null ? 'not fetched' : `likely ${x.partial ? 'at least ' : ''}${x.text}`}`}
              className={cn('flex min-w-0 cursor-default flex-col items-center gap-1.5 rounded-[14px] outline-offset-4', LIFT, dim ? 'opacity-35' : 'opacity-100', on && '-translate-y-1.5')}
            >
              <div
                className={cn(
                  'relative h-[120px] w-full overflow-hidden rounded-[14px] transition-[background-color,box-shadow] duration-[250ms]',
                  on ? 'bg-[color-mix(in_srgb,var(--teal)_14%,transparent)] shadow-[0_10px_24px_color-mix(in_srgb,var(--teal)_26%,transparent)]' : 'bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]',
                  x.planning && 'ring-1 ring-teal/60',
                )}
              >
                {x.cm !== null && x.cm > 0 ? (
                  <motion.div
                    className={cn(
                      'absolute inset-x-0 bottom-0 origin-bottom rounded-[14px]',
                      on ? 'bg-[linear-gradient(180deg,var(--snow-top),var(--ink-chip))]' : 'bg-[linear-gradient(180deg,var(--snow-top),var(--teal))]',
                      x.trend && 'opacity-70',
                    )}
                    style={{ height: `${h}%` }}
                    initial={{ scaleY: 0 }}
                    whileInView={{ scaleY: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.9, delay: i * 0.06, ease: [0.2, 0.8, 0.2, 1] }}
                  />
                ) : (
                  <span
                    aria-hidden
                    className={cn('absolute inset-x-2 bottom-2', x.cm === null ? 'border-t-[1.5px] border-dashed border-[color-mix(in_srgb,var(--ink)_25%,transparent)]' : 'h-[3px] rounded-full bg-[color-mix(in_srgb,var(--teal)_45%,transparent)]')}
                  />
                )}
                {x.cm !== null && x.cm > 0.2 ? <Flakes n={Math.min(6, Math.ceil(x.cm / 1.5))} seed={i} /> : null}
              </div>
              <span className="flex max-w-full flex-wrap items-baseline justify-center gap-x-[3px] text-center text-[12px] leading-tight font-semibold text-ink tnum">
                {x.cm === null || !x.text ? '—' : x.text.split(' ').map((part, k) => (k ? <span key={k} className="font-normal text-ink-2">{part}</span> : <span key={k}>{part}</span>))}
              </span>
              <span className="font-mono text-[12px] tracking-[0.04em] text-ink-2">{x.dow}</span>
            </div>
          )
        })}
      </div>
      <p
        aria-live="polite"
        className={cn(
          'm-0 min-h-[42px] rounded-[14px] px-3.5 py-2.5 text-[13px] leading-[1.4] transition-colors duration-[250ms]',
          d ? 'bg-ink-chip text-on-ink-chip' : 'bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] text-ink-2',
        )}
      >
        {tip}
      </p>
    </div>
  )
}
