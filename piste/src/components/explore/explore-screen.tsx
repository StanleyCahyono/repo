'use client'
/**
 * Explore — list, map and filters for the whole catalog on one scenario (date + scoring mode).
 *
 * - ≥ lg: synchronized list/map split with an adjustable divider. Hover/focus a card → its marker highlights;
 *   choosing a marker → the card scrolls into view, is highlighted and receives focus; "Show on map" or choosing a
 *   marker flies the map (explicit selection only).
 * - < lg: full-width list with a List/Map toggle; tapping a marker opens a bottom preview over the map.
 * - Filters, sort and view live in the URL (see use-explore-url), so returning from a resort restores them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Info, List, Map as MapIcon, Search, X } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/states'
import { passLineFromVerdict, type CardPassLine } from '@/components/resort/card-data'
import { useCompareSelection } from '@/components/resort/card-compare'
import { ResortCard } from '@/components/resort/resort-card'
import type { ExploreRow, ExploreView } from '@/lib/data/explore'
import type { ScoringMode } from '@/lib/domain/types'
import { CompareTray } from './compare-tray'
import { ExploreMap } from './explore-map'
import { FilterButton, FilterSheet } from './filter-sheet'
import {
  SORTS,
  SORT_LABEL,
  activeChips,
  activeCount,
  applyFilters,
  clearFilters,
  groupRows,
  sortRows,
  unknownReasons,
  type ExploreFilters,
  type SortKey,
} from './filters'
import { ResortList } from './resort-list'
import { ScenarioBar } from './scenario-bar'
import { SplitView } from './split-view'
import { useMediaQuery, usePrefersReducedMotion } from './use-client-state'
import { rememberQuery, useExploreUrl } from './use-explore-url'

export function ExploreScreen({ view }: { view: ExploreView }) {
  const url = useExploreUrl()
  const { filters, setFilters } = url
  const desktop = useMediaQuery('(min-width: 1024px)')
  const reduced = usePrefersReducedMotion()
  const compare = useCompareSelection()
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // Remember this view for the Explore tabs (returning from Events restores it).
  useEffect(() => {
    rememberQuery('resorts', url.search)
  }, [url.search])

  // Sticky offsets follow the toolbar's real height (it grows when filter chips wrap).
  useEffect(() => {
    const el = toolbarRef.current
    const root = rootRef.current
    if (!el || !root || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => root.style.setProperty('--explore-toolbar-h', `${el.offsetHeight}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { results, hiddenUnknown, unknownById } = useMemo(() => applyFilters(view.rows, filters), [view.rows, filters])
  const sorted = useMemo(() => sortRows(results, filters.sort), [results, filters.sort])
  const groups = useMemo(() => groupRows(sorted, filters.sort), [sorted, filters.sort])
  const reasons = useMemo(() => (hiddenUnknown.length ? unknownReasons(hiddenUnknown, filters) : []), [hiddenUnknown, filters])
  const selected = selectedId && results.some((r) => r.facets.id === selectedId) ? selectedId : null
  const highlighted = highlightedId && results.some((r) => r.facets.id === highlightedId) ? highlightedId : null

  const productName = useMemo(() => new Map(view.products.map((p) => [p.id, p.name])), [view.products])
  const familyName = useMemo(() => new Map(view.families.map((f) => [f.id as string, f.name])), [view.families])
  const chips = activeChips(filters, {
    family: (id) => familyName.get(id) ?? id,
    product: (id) => productName.get(id) ?? id,
    dateLabel: view.isToday ? 'today' : view.dateLabel.replace(/ \d{4}$/, ''),
  })
  const nActive = activeCount(filters)

  const passLineFor = useCallback(
    (row: ExploreRow): CardPassLine | null | undefined => {
      if (!filters.product) return undefined
      const v = row.facets.products.find((p) => p.id === filters.product)
      const name = productName.get(filters.product) ?? filters.product
      return v
        ? passLineFromVerdict({ productName: name, status: v.status, canSki: v.canSki, headline: v.headline, confirmAtSource: v.confirmAtSource })
        : { status: 'not-covered', productName: name, headline: 'Not included', confirmAtSource: false }
    },
    [filters.product, productName],
  )
  const notesFor = useCallback(
    (row: ExploreRow) => {
      const u = unknownById.get(row.facets.id)
      return u?.length ? [`Unknown for your filters: ${u.join(', ')}`] : undefined
    },
    [unknownById],
  )
  // Stable per-row props, so hover highlighting only re-renders the rows that change.
  const passLines = useMemo(
    () => (filters.product ? new Map(results.map((r) => [r.facets.id, passLineFor(r) ?? null])) : null),
    [filters.product, results, passLineFor],
  )
  const notesMap = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const r of results) {
      const n = notesFor(r)
      if (n) m.set(r.facets.id, n)
    }
    return m
  }, [results, notesFor])

  /** Marker chosen on the desktop map: bring its card into view and move focus to it. */
  const selectFromMap = useCallback(
    (id: string) => {
      setSelectedId(id)
      if (!desktop) return
      const card = document.querySelector<HTMLElement>(`#explore-list [data-resort-id="${CSS.escape(id)}"]`)
      if (!card) return
      card.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
      card.querySelector<HTMLElement>('h3 a, h2 a')?.focus({ preventScroll: true })
    },
    [desktop, reduced],
  )
  const { setView } = url
  /** Phones: switch to the map and scroll so it fills the screen under the sticky toolbar. */
  const showMap = useCallback(() => {
    setView('map')
    window.requestAnimationFrame(() => {
      const a = anchorRef.current
      if (!a) return
      // Align the toolbar under the 56px mobile top bar, whether the list was scrolled past it or not.
      const top = Math.max(0, a.getBoundingClientRect().top + window.scrollY - 56)
      if (Math.abs(window.scrollY - top) > 1) window.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' })
    })
  }, [setView, reduced])
  const locate = useCallback(
    (id: string) => {
      setSelectedId(id)
      if (!desktop) showMap()
    },
    [desktop, showMap],
  )

  const mobileMap = !desktop && url.view === 'map'
  const previewRow = mobileMap && selected ? (results.find((r) => r.facets.id === selected) ?? null) : null
  const trayVisible = compare.entries.length > 0

  const list =
    results.length === 0 ? (
      <EmptyState
        seed="explore-empty"
        title="No resorts match these filters"
        body={
          hiddenUnknown.length ? (
            <>
              {hiddenUnknown.length} {hiddenUnknown.length === 1 ? 'resort is' : 'resorts are'} hidden only because a value is unknown (
              {reasons.map((r) => r.what).join(', ')}). Unknown is never counted as a match.
            </>
          ) : (
            'Try widening the travel time or removing a filter.'
          )
        }
        action={
          <>
            {hiddenUnknown.length ? (
              <Button variant="secondary" onClick={() => setFilters((f) => ({ ...f, includeUnknown: true }))}>
                Include {hiddenUnknown.length} with unknown values
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => setFilters(clearFilters)}>
              Clear filters
            </Button>
          </>
        }
      />
    ) : (
      <ResortList
        groups={groups}
        highlightedId={highlighted}
        selectedId={selected}
        onHighlight={setHighlightedId}
        onLocate={locate}
        passLines={passLines}
        notes={notesMap}
      />
    )

  return (
    <div ref={rootRef} className="relative">
      <ScenarioBar
        date={view.date}
        dateLabel={view.dateLabel}
        quickDates={view.quickDates}
        bounds={view.seasonBounds}
        mode={view.mode}
        pending={url.pending}
        onDate={(d) => url.navigate({ date: d === view.today ? null : d })}
        onMode={(m: ScoringMode) => url.navigate({ mode: m })}
        className="mb-4"
      />

      {/* Toolbar: search, filters, list/map toggle, active chips. Sticky under the mobile top bar / at the top. */}
      <div ref={anchorRef} aria-hidden />
      <div ref={toolbarRef} className="sticky top-14 z-20 -mx-4 border-b border-divider bg-canvas px-4 pt-2 pb-2.5 md:top-0 md:-mx-8 md:px-8">
        <div className="flex items-center gap-2">
          <SearchBox value={filters.q} onChange={(q) => setFilters((f) => ({ ...f, q }))} />
          <FilterSheet
            view={view}
            filters={filters}
            setFilters={setFilters}
            resultCount={results.length}
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            onMode={(m) => url.navigate({ mode: m })}
            trigger={<FilterButton id="explore-filters-button" count={nActive} />}
          />
          <ViewToggle value={url.view} onChange={(v) => (v === 'map' ? showMap() : setView('list'))} className="lg:hidden" />
        </div>
        {chips.length ? (
          <div className="mt-2 flex items-center gap-2">
            <ul aria-label="Active filters" className="-my-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-1 scrollbar-thin md:flex-wrap md:overflow-visible">
              {chips.map((c, i) => (
                <li key={c.key} className="shrink-0">
                  <button
                    type="button"
                    data-chip-index={i}
                    onClick={() => {
                      setFilters(c.clear)
                      // Keep keyboard focus in the chip row: the next chip, else the previous one, else Filters.
                      window.requestAnimationFrame(() => {
                        const next =
                          document.querySelector<HTMLElement>(`[data-chip-index="${i}"]`) ??
                          document.querySelector<HTMLElement>(`[data-chip-index="${i - 1}"]`) ??
                          document.getElementById('explore-filters-button')
                        next?.focus()
                      })
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-teal/40 bg-glacier/60 pr-2 pl-3 text-[13px] font-medium text-ink transition-colors duration-150 hover:border-teal md:h-8"
                  >
                    {c.label}
                    <X aria-hidden className="size-3.5 text-ink-2" />
                    <span className="sr-only">— remove filter</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                setFilters(clearFilters)
                window.requestAnimationFrame(() => document.getElementById('explore-filters-button')?.focus())
              }}
              className="h-9 shrink-0 rounded-md px-2 text-[13px] font-medium text-teal hover:underline md:h-8"
            >
              Clear all
            </button>
          </div>
        ) : null}
      </div>

      <ResultsBar
        className={cn(mobileMap && 'max-lg:hidden')}
        view={view}
        filters={filters}
        shown={results.length}
        hidden={hiddenUnknown.length}
        reasons={reasons}
        onIncludeUnknown={() => setFilters((f) => ({ ...f, includeUnknown: true }))}
        onSort={(s) => setFilters((f) => ({ ...f, sort: s }))}
      />

      {mobileMap ? (
        <div
          className="relative mt-3 min-h-[20rem] lg:hidden"
          style={{
            // Fill the screen between the sticky toolbar and the bottom navigation (and the compare tray if shown).
            height: `calc(100dvh - 3.5rem - var(--explore-toolbar-h, 64px) - 4rem - env(safe-area-inset-bottom) - ${trayVisible ? '7.5rem' : '3rem'})`,
          }}
        >
          <ExploreMap
            rows={results}
            home={view.home}
            selectedId={selected}
            highlightedId={null}
            onSelect={setSelectedId}
            className="h-full"
            overlay={
              <AnimatePresence>
                {previewRow ? (
                  <MapPreview
                    key={previewRow.card.id}
                    row={previewRow}
                    passLine={passLineFor(previewRow)}
                    notes={notesFor(previewRow)}
                    onClose={() => setSelectedId(null)}
                  />
                ) : null}
              </AnimatePresence>
            }
          />
          {results.length === 0 ? <p className="mt-3 text-[13.5px] text-ink-2">No resorts to show on the map — adjust the filters.</p> : null}
        </div>
      ) : null}

      <div
        id="explore-list"
        aria-busy={url.pending || undefined}
        className={cn('transition-opacity duration-200', mobileMap && 'max-lg:hidden', url.pending && 'pointer-events-none opacity-55')}
      >
        <SplitView
          stickyTop="calc(var(--explore-toolbar-h, 64px) + 16px)"
          bottomInset={trayVisible ? 96 : 16}
          list={list}
          map={
            desktop ? (
              <ExploreMap rows={results} home={view.home} selectedId={selected} highlightedId={highlighted} onSelect={selectFromMap} className="h-full" />
            ) : null
          }
        />
      </div>

      {trayVisible ? <div aria-hidden className="h-20" /> : null}
      <CompareTray scenario={{ date: view.date, mode: view.mode, product: filters.product }} />
    </div>
  )
}

function SearchBox({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  // Local state keeps typing smooth; the URL follows on every change (history.replaceState is cheap).
  const [text, setText] = useState(value)
  const [synced, setSynced] = useState(value)
  if (value !== synced) {
    // The URL changed from elsewhere (clear all, back/forward): adopt it.
    setSynced(value)
    setText(value)
  }
  return (
    <div className="relative min-w-0 flex-1 lg:max-w-[26rem]">
      <label htmlFor="explore-search" className="sr-only">
        Search resorts by name, town or region
      </label>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
      <input
        id="explore-search"
        type="search"
        value={text}
        placeholder="Search resorts, towns, regions"
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value)
          setSynced(e.target.value)
          onChange(e.target.value)
        }}
        className="h-11 w-full rounded-md border border-divider-strong bg-surface pr-10 pl-9 text-[15px] text-ink placeholder:text-ink-3 transition-colors duration-150 hover:border-ink-3 focus:border-teal focus-visible:outline-2 focus-visible:outline-offset-1 md:h-10 [&::-webkit-search-cancel-button]:hidden"
      />
      {text ? (
        <button
          type="button"
          onClick={() => {
            setText('')
            setSynced('')
            onChange('')
          }}
          aria-label="Clear search"
          className="absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-ink md:size-8"
        >
          <X aria-hidden className="size-4" />
        </button>
      ) : null}
    </div>
  )
}

function ViewToggle({ value, onChange, className }: { value: 'list' | 'map'; onChange: (v: 'list' | 'map') => void; className?: string }) {
  return (
    <div
      role="group"
      aria-label="Show results as"
      className={cn('inline-flex shrink-0 overflow-hidden rounded-md border border-divider-strong bg-surface', className)}
    >
      {(
        [
          { v: 'list', label: 'List', Icon: List },
          { v: 'map', label: 'Map', Icon: MapIcon },
        ] as const
      ).map(({ v, label, Icon }) => {
        const on = value === v
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(v)}
            className={cn(
              'inline-flex h-[42px] min-w-11 items-center justify-center gap-1.5 px-2.5 text-[13.5px] font-medium transition-colors duration-150 md:h-[38px]',
              on ? 'bg-glacier text-teal' : 'text-ink-2 hover:text-ink',
            )}
          >
            <Icon aria-hidden className="size-4" />
            <span className="max-sm:sr-only">{label}</span>
          </button>
        )
      })}
    </div>
  )
}

function ResultsBar({
  view,
  filters,
  shown,
  hidden,
  reasons,
  onIncludeUnknown,
  onSort,
  className,
}: {
  className?: string
  view: ExploreView
  filters: ExploreFilters
  shown: number
  hidden: number
  reasons: { what: string; count: number }[]
  onIncludeUnknown: () => void
  onSort: (s: SortKey) => void
}) {
  const c = view.counts
  return (
    <div className={cn('mt-4 mb-4 flex flex-col gap-2.5', className)}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <p role="status" aria-live="polite" className="text-[14px] text-ink-2">
          <strong className="tnum font-semibold text-ink">{shown}</strong> of <span className="tnum">{c.total}</span> resorts
          {hidden ? (
            <>
              {' · '}
              <button type="button" onClick={onIncludeUnknown} className="font-medium text-teal underline-offset-2 hover:underline">
                {hidden} hidden — unknown{' '}
                {reasons
                  .slice(0, 2)
                  .map((r) => r.what)
                  .join(' or ')}
              </button>
            </>
          ) : null}
        </p>
        <Coverage view={view} className="order-last w-full lg:order-none lg:w-auto lg:flex-1" />
        <label className="ml-auto flex items-center gap-2 text-[13.5px] text-ink-2">
          Sort
          <select
            value={filters.sort}
            onChange={(e) => onSort(e.target.value as SortKey)}
            className="h-10 rounded-md border border-divider-strong bg-surface px-2.5 text-[14px] font-medium text-ink hover:border-ink-3 focus:border-teal focus:outline-none md:h-9"
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {view.preseason ? (
        <p className="flex items-start gap-2 text-[12.5px] text-ink-2">
          <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
          <span>
            <strong className="font-semibold text-ink">Preseason:</strong> no open reports or scores for this day yet, and nothing is assumed open.
            <span className="max-sm:hidden"> Opening estimates, passes, travel and learning suitability still help you plan.</span>
          </span>
        </p>
      ) : null}
    </div>
  )
}

/** How much of the day's evidence exists — a quiet, honest dashboard line. */
function Coverage({ view, className }: { view: ExploreView; className?: string }) {
  const c = view.counts
  const items = [
    { label: 'Status reported', short: 'Status', n: c.total - c.statusUnknown },
    { label: 'Scored', short: 'Scored', n: c.withScore },
    { label: 'Snow reports', short: 'Snow', n: c.withReport },
    { label: 'Complete day cost', short: 'Cost', n: c.costComplete },
  ]
  return (
    <dl
      aria-label={`Evidence for ${view.isToday ? 'today' : view.dateLabel}`}
      className={cn(
        'flex flex-wrap gap-x-4 gap-y-1 rounded-[10px] border border-divider bg-surface-2 px-3 py-2 text-[12.5px] text-ink-2 lg:border-0 lg:bg-transparent lg:p-0',
        className,
      )}
    >
      {items.map((i) => (
        <div key={i.label} className="flex items-baseline gap-1.5">
          <dt>
            <span className="sm:hidden" aria-hidden>
              {i.short}
            </span>
            <span className="max-sm:sr-only">{i.label}</span>
          </dt>
          <dd className={cn('tnum font-semibold', i.n === 0 ? 'text-caution' : 'text-ink')}>
            {i.n}/{c.total}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Mobile: the resort behind a tapped marker, over the bottom of the map (non-modal; Escape or × closes). */
function MapPreview({
  row,
  passLine,
  notes,
  onClose,
}: {
  row: ExploreRow
  passLine: CardPassLine | null | undefined
  notes: string[] | undefined
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])
  return (
    <motion.div
      ref={ref}
      tabIndex={-1}
      role="region"
      aria-label={`Preview: ${row.card.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0, transition: t.sheet }}
      exit={{ opacity: 0, y: 16, transition: { duration: 0.16 } }}
      className="absolute inset-x-2 bottom-9 z-20 max-h-[82%] overflow-y-auto rounded-[14px] border border-divider-strong bg-surface shadow-overlay outline-none scrollbar-thin"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-divider bg-surface px-4 py-1.5">
        <span aria-hidden className="h-1 w-10 rounded-full bg-divider-strong" />
        <button
          type="button"
          onClick={onClose}
          className="-mr-2 inline-flex h-11 items-center gap-1 rounded-md px-2 text-[13.5px] font-medium text-ink-2 hover:bg-surface-3 hover:text-ink"
        >
          <X aria-hidden className="size-4" />
          Close preview
        </button>
      </div>
      <ResortCard resort={row.card} variant="row" density="compact" passLine={passLine} notes={notes} />
    </motion.div>
  )
}
