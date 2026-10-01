'use client'
/**
 * The Explore results as an editorial list: one ruled panel per group of the current sort ("Great fit",
 * "1–2 h drive", "$$ per person per day"…), each resort a <ResortCard variant="row">. The first four rows rise in
 * (220ms, staggered 45ms) with a CSS animation, so server-rendered content is never hidden while scripts load;
 * it is off under reduced motion, and later filter changes do not re-animate rows that stay.
 */
import { memo } from 'react'
import { cn } from '@/lib/ui/cn'
import { ResortCard } from '@/components/resort/resort-card'
import type { CardPassLine } from '@/components/resort/card-data'
import type { ExploreRow } from '@/lib/data/explore'
import type { RowGroup } from './filters'

export function ResortList({
  groups,
  highlightedId,
  selectedId,
  onHighlight,
  onLocate,
  passLines,
  notes,
}: {
  groups: RowGroup<ExploreRow>[]
  highlightedId: string | null
  selectedId: string | null
  onHighlight?: (id: string | null) => void
  onLocate?: (id: string) => void
  /** Per-resort override of the card's owned-pass line (e.g. the product chosen in the filters). */
  passLines?: ReadonlyMap<string, CardPassLine | null> | null
  /** Per-resort caution notes (e.g. which filtered values are unknown). */
  notes?: ReadonlyMap<string, string[]> | null
}) {
  let index = 0
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => {
        const headingId = `explore-group-${g.key.replace(/[^a-z0-9]+/gi, '-')}`
        return (
          <section key={g.key} aria-labelledby={headingId}>
            {g.label ? (
              <h2 id={headingId} className="mb-2 flex items-baseline gap-2 px-1 text-[15px] font-semibold text-ink">
                {g.label}
                <span className="tnum text-[13px] font-medium text-ink-3">
                  {g.rows.length}
                  <span className="sr-only"> {g.rows.length === 1 ? 'resort' : 'resorts'}</span>
                </span>
              </h2>
            ) : (
              <h2 id={headingId} className="sr-only">
                Results
              </h2>
            )}
            <ul className="divide-y divide-divider overflow-hidden rounded-[12px] border border-divider bg-surface">
              {g.rows.map((row) => {
                const id = row.card.id
                return (
                  <ResultRow
                    key={id}
                    row={row}
                    index={index++}
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

/** One list row. Memoised: hovering a card only re-renders the rows whose highlight changes. */
const ResultRow = memo(function ResultRow({
  row,
  index,
  highlighted,
  selected,
  onHighlight,
  onLocate,
  passLine,
  notes,
}: {
  row: ExploreRow
  index: number
  highlighted: boolean
  selected: boolean
  onHighlight?: (id: string | null) => void
  onLocate?: (id: string) => void
  passLine: CardPassLine | null | undefined
  notes: string[] | undefined
}) {
  return (
    <li
      className={cn(index < 4 && 'animate-[piste-pop-in_220ms_cubic-bezier(0.22,0.8,0.26,1)_both] motion-reduce:animate-none')}
      style={index > 0 && index < 4 ? { animationDelay: `${index * 45}ms` } : undefined}
    >
      <ResortCard
        resort={row.card}
        variant="row"
        highlighted={highlighted}
        selected={selected}
        onHighlight={onHighlight}
        onLocate={onLocate}
        passLine={passLine}
        notes={notes}
      />
    </li>
  )
})
