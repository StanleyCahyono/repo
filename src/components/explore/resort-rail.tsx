'use client'
/**
 * Explore's result rows (Glass HUD): artwork with a status dot, name, the honest status/opening line, a mono
 * meta line (travel · score · passes · day cost) and Compare / Show-on-map actions. Grouped by the current sort
 * ("Great fit", "1–2 h drive"…). Hovering a row lights its marker; choosing "Show on map" flies the map there.
 *
 * The first rows rise in with a short stagger (CSS, so server HTML is never hidden; off under reduced motion).
 */
import { memo } from 'react'
import Link from 'next/link'
import { Check, MapPin, Plus, Star } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { useToast } from '@/components/ui/toast'
import { COMPARE_MAX, useCompareSelection } from '@/components/resort/card-compare'
import { type CardPassLine, type ResortCardData } from '@/components/resort/card-data'
import type { ExploreRow } from '@/lib/data/explore'
import type { RowGroup } from './filters'
import { TONE_DOT, TONE_LABEL, type StageTone } from './tones'
import { ResortArt } from './resort-art'

/** Marker / dot tone: a confirmed closure or reported open status first, then what is known about opening. */
export function toneOf(c: ResortCardData): StageTone {
  const s = c.status.status
  if (c.closure || s === 'closed-for-season' || s === 'temporarily-closed') return 'closed'
  if (s === 'open' || s === 'partially-open') return 'open'
  if (c.opening.label === 'announced') return 'announced'
  if (c.opening.label === 'estimated') return 'estimate'
  return 'unknown'
}

/** One honest status line: closure, reported status, or the opening information. */
export function statusLine(c: ResortCardData): string {
  if (c.closure) return `Closed on ${c.dateLabel} · ${c.closure.reason}`
  const s = c.status.status
  if (s === 'open' || s === 'partially-open' || s === 'closed-for-season' || s === 'temporarily-closed') {
    return [c.status.label, c.status.note, c.status.asOf].filter(Boolean).join(' · ')
  }
  return c.opening.text
}

const FAMILY_SHORT: Record<string, string> = { ikon: 'Ikon', epic: 'Epic', indy: 'Indy', 'mountain-collective': 'Mtn Collective', regional: 'Regional' }

/** Mono meta line: travel, score (if any), pass families, day cost. Unknown stays "unknown". */
export function metaLine(c: ResortCardData): string[] {
  const parts: string[] = []
  if (c.travel.mode === 'drive') parts.push(`${c.travel.estimate ? '≈' : ''}${c.travel.headline} drive`)
  else if (c.travel.mode === 'fly') parts.push(`Fly · ${c.travel.caption}`)
  else parts.push('Travel unknown')
  if (c.score.kind !== 'closed' && c.score.value !== null) parts.push(`Score ${c.score.value}${c.score.kind === 'conditions' ? '' : ' (partial)'}`)
  if (c.passes.length) parts.push(c.passes.map((p) => FAMILY_SHORT[p.familyId] ?? p.familyName).join(' · '))
  parts.push(c.expense.amount ? `${c.expense.label} ${c.expense.amount}` : 'Cost incomplete')
  return parts
}

export function ResortRail({
  groups,
  highlightedId,
  selectedId,
  onHighlight,
  onLocate,
  passLines,
  notes,
  dense = false,
}: {
  groups: RowGroup<ExploreRow>[]
  highlightedId: string | null
  selectedId: string | null
  onHighlight?: (id: string | null) => void
  onLocate?: (id: string) => void
  passLines?: ReadonlyMap<string, CardPassLine | null> | null
  notes?: ReadonlyMap<string, string[]> | null
  /** Narrow column (the desktop aside). */
  dense?: boolean
}) {
  let index = 0
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => {
        const headingId = `explore-group-${g.key.replace(/[^a-z0-9]+/gi, '-')}`
        return (
          <section key={g.key} aria-labelledby={headingId}>
            {g.label ? (
              <h2 id={headingId} className="hud mb-1.5 flex items-baseline gap-2 px-2 text-ink-2">
                {g.label}
                <span className="tnum text-ink-3">
                  {g.rows.length}
                  <span className="sr-only"> {g.rows.length === 1 ? 'resort' : 'resorts'}</span>
                </span>
              </h2>
            ) : (
              <h2 id={headingId} className="sr-only">
                Results
              </h2>
            )}
            <ul className="flex flex-col gap-1.5">
              {g.rows.map((row) => {
                const id = row.card.id
                return (
                  <RailRow
                    key={id}
                    row={row}
                    index={index++}
                    dense={dense}
                    highlighted={highlightedId === id}
                    selected={selectedId === id}
                    onHighlight={onHighlight}
                    onLocate={onLocate}
                    passLine={passLines ? passLines.get(id) : undefined}
                    notes={notes?.get(id)}
                  />
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

const PASS_TONE: Record<CardPassLine['status'], string> = { covered: 'text-positive', 'not-covered': 'text-ink-2' }

const RailRow = memo(function RailRow({
  row,
  index,
  dense,
  highlighted,
  selected,
  onHighlight,
  onLocate,
  passLine,
  notes,
}: {
  row: ExploreRow
  index: number
  dense: boolean
  highlighted: boolean
  selected: boolean
  onHighlight?: (id: string | null) => void
  onLocate?: (id: string) => void
  passLine: CardPassLine | null | undefined
  notes: string[] | undefined
}) {
  const c = row.card
  const tone = toneOf(c)
  const pass = passLine === undefined ? c.pass : passLine
  return (
    <li
      className={cn(index < 8 && 'animate-[piste-pop-in_280ms_cubic-bezier(0.22,0.8,0.26,1)_both] motion-reduce:animate-none')}
      style={index > 0 && index < 8 ? { animationDelay: `${index * 40}ms` } : undefined}
    >
      <article
        data-resort-id={c.id}
        aria-labelledby={`rail-${c.id}`}
        onMouseEnter={onHighlight ? () => onHighlight(c.id) : undefined}
        onMouseLeave={onHighlight ? () => onHighlight(null) : undefined}
        onFocus={onHighlight ? () => onHighlight(c.id) : undefined}
        onBlur={
          onHighlight
            ? (e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHighlight(null)
              }
            : undefined
        }
        className={cn(
          'group/row relative flex items-start gap-3 rounded-[18px] border p-2.5 transition-[transform,background-color,border-color,box-shadow] duration-200 ease-[var(--ease-out-soft)]',
          'hover:-translate-y-px hover:border-[var(--glass-edge)] hover:bg-glass-strong hover:shadow-[0_10px_26px_rgb(19_32_44/0.1)]',
          selected
            ? 'border-teal/70 bg-glass-strong shadow-[0_10px_26px_rgb(19_32_44/0.12)]'
            : highlighted
              ? 'border-[var(--glass-edge)] bg-glass-strong'
              : 'border-[color-mix(in_srgb,var(--ink)_6%,transparent)] bg-[color-mix(in_srgb,var(--surface)_55%,transparent)]',
        )}
      >
        {onLocate ? (
          <button
            type="button"
            onClick={() => onLocate(c.id)}
            aria-label={`Show ${c.shortName} on the map`}
            title="Show on map"
            className="group/thumb relative shrink-0 rounded-[14px] outline-offset-2"
          >
            <Thumb c={c} tone={tone} dense={dense} />
            <span
              aria-hidden
              className={cn(
                'absolute inset-0 flex items-center justify-center rounded-[14px] bg-[color-mix(in_srgb,var(--ink-chip)_55%,transparent)] text-on-ink-chip opacity-0 transition-opacity duration-150 group-hover/thumb:opacity-100 group-focus-visible/thumb:opacity-100',
                selected && 'opacity-100',
              )}
            >
              <MapPin className="size-5" />
            </span>
          </button>
        ) : (
          <div className="relative shrink-0">
            <Thumb c={c} tone={tone} dense={dense} />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 id={`rail-${c.id}`} className="flex min-w-0 flex-wrap items-start gap-x-1.5 gap-y-0.5 text-[15px] leading-snug font-semibold text-ink">
            <Link href={c.href} title={c.name} className="min-w-0 rounded-sm [overflow-wrap:anywhere] decoration-teal/60 underline-offset-[3px] transition-colors duration-150 hover:text-teal hover:underline">
              {c.shortName}
              {c.shortName !== c.name ? <span className="sr-only"> ({c.name})</span> : null}
            </Link>
            {c.isFavorite ? (
              <Star aria-label="Favourite" className="mt-[3px] size-3.5 shrink-0 fill-copper text-copper" />
            ) : null}
            {c.demo ? <span className="hud mt-[2px] shrink-0 rounded-full bg-demo-bg px-1.5 text-[11px] text-demo">Demo</span> : null}
          </h3>
          <p className="text-[12.5px] leading-snug text-ink-2">
            <span className="sr-only">{TONE_LABEL[tone]}. </span>
            {statusLine(c)}
          </p>
          <p className="font-mono text-[11.5px] leading-[1.45] font-medium tracking-[0.02em] text-ink-2 uppercase">
            {metaLine(c).map((m, i) => (
              <span key={i}>
                {i ? <span aria-hidden className="text-ink-3"> · </span> : null}
                {m}
              </span>
            ))}
          </p>
          {pass ? (
            <p className={cn('text-[12.5px] leading-snug font-medium', PASS_TONE[pass.status])}>
              {pass.productName}: {pass.headline}
            </p>
          ) : null}
          {notes?.map((n) => (
            <p key={n} className="text-[12px] leading-snug text-caution">
              {n}
            </p>
          ))}
        </div>
        <ComparePill id={c.id} name={c.shortName} className="mt-0.5" />
      </article>
    </li>
  )
})

function Thumb({ c, tone, dense }: { c: ResortCardData; tone: StageTone; dense: boolean }) {
  return (
    <>
      <ResortArt id={c.id} name={c.name} media={c.media} className={cn('rounded-[14px]', dense ? 'size-14' : 'size-16 sm:h-[76px] sm:w-[92px]')} />
      <i
        aria-hidden
        title={TONE_LABEL[tone]}
        className={cn('absolute right-1 bottom-1 size-3 rounded-full border-2 border-surface shadow-[0_1px_4px_rgb(0_0_0/0.25)]', TONE_DOT[tone])}
      />
    </>
  )
}

/** The mockup's Compare / Added pill (aria-pressed), sharing the persisted compare selection. */
export function ComparePill({ id, name, className }: { id: string; name: string; className?: string }) {
  const compare = useCompareSelection()
  const toast = useToast()
  const on = compare.has(id)
  const blocked = !on && compare.full
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-disabled={blocked || undefined}
      aria-label={on ? `Remove ${name} from comparison` : `Add ${name} to comparison`}
      title={blocked ? `Comparison holds up to ${COMPARE_MAX} resorts — remove one first` : undefined}
      onClick={() => {
        const r = compare.toggle({ id, name })
        if (r === 'full') toast.show(`Compare holds up to ${COMPARE_MAX} resorts — remove one first`, { tone: 'info' })
      }}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-[12.5px] font-medium whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 active:scale-95 max-lg:h-11',
        on
          ? 'border-transparent bg-ink-chip text-on-ink-chip'
          : 'border-[color-mix(in_srgb,var(--ink)_16%,transparent)] text-ink hover:border-ink-chip hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]',
        blocked && 'opacity-55',
        className,
      )}
    >
      {on ? <Check aria-hidden className="size-3.5" strokeWidth={2.4} /> : <Plus aria-hidden className="size-3.5" />}
      {on ? 'Added' : 'Compare'}
    </button>
  )
}
