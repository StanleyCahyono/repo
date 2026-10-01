'use client'
/**
 * Explore — map-first view of the whole catalog on one scenario (date + scoring mode), Glass HUD.
 *
 * - ≥ lg: a full-height map stage (mission-control HUD, clustered markers, region jumps) with a glass results rail
 *   on the right: search, filters, quick toggles, sort, the results of the current region and the compare bar.
 *   Hover a row → its marker lights up; choose a row's map pin or a marker → the map flies there, the row scrolls
 *   into view and a preview card opens over the map.
 * - < lg: the toolbar sticks under the top bar; a compact map sits above the list, and the List/Map toggle gives the
 *   map the whole screen (tapping a marker opens a bottom preview).
 * - Region jumps scope the list and frame the camera; filters, sort, view and jump live in the URL
 *   (use-explore-url), so returning from a resort restores them.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, ArrowUpDown, Info, List, Map as MapIcon, Search, X } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { passLineFromVerdict, type CardPassLine } from '@/components/resort/card-data'
import { COMPARE_MAX, COMPARE_MIN, useCompareSelection } from '@/components/resort/card-compare'
import { ResortCard } from '@/components/resort/resort-card'
import type { ExploreRow, ExploreView } from '@/lib/data/explore'
import type { ScoringMode } from '@/lib/domain/types'
import { CompareTray } from './compare-tray'
import { CountUp } from './count-up'
import { ExploreHeader } from './explore-header'
import { ExploreStage, type StagePoint } from './explore-stage'
import { compareHref } from './explore-tabs'
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
import { availableJumps, boundsOf, inJump, jumpOf, type Padding } from './geo'
import { ResortRail, metaLine, statusLine, toneOf } from './resort-rail'
import { ScenarioBar } from './scenario-bar'
import { useHydrated, useMediaQuery, usePrefersReducedMotion } from './use-client-state'
import { rememberQuery, useExploreUrl } from './use-explore-url'

const ASIDE_W = 408
const DESKTOP_PAD: Padding = { top: 76, right: ASIDE_W + 24, bottom: 112, left: 0 }
const MOBILE_PAD: Padding = { top: 60, right: 0, bottom: 16, left: 0 }

export function ExploreScreen({ view, eyebrow }: { view: ExploreView; eyebrow?: ReactNode }) {
  const url = useExploreUrl()
  const { filters, setFilters, setJump } = url
  const desktop = useMediaQuery('(min-width: 1024px)')
  const hydrated = useHydrated()
  const reduced = usePrefersReducedMotion()
  const compare = useCompareSelection()
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    rememberQuery('resorts', url.search)
  }, [url.search])

  // Sticky offsets follow the mobile toolbar's real height (it grows when filter chips wrap).
  useEffect(() => {
    const el = toolbarRef.current
    const root = rootRef.current
    if (!el || !root || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => root.style.setProperty('--explore-toolbar-h', `${el.offsetHeight}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [desktop])

  // Region jumps (only regions the catalog has). Unknown keys fall back to World.
  const jumps = useMemo(() => availableJumps(view.rows.map((r) => r.facets.regionGroup)), [view.rows])
  const jump = jumps.some((j) => j.def.key === url.jump) ? jumpOf(url.jump) : jumpOf('world')
  // The camera frames the region's catalog (stable while filters change).
  const frame = useMemo(() => boundsOf(view.rows.filter((r) => inJump(jump, r.facets.regionGroup)).map((r) => r.card)), [view.rows, jump])

  const { results, hiddenUnknown, unknownById } = useMemo(() => applyFilters(view.rows, filters), [view.rows, filters])
  const scoped = useMemo(() => results.filter((r) => inJump(jump, r.facets.regionGroup)), [results, jump])
  const sorted = useMemo(() => sortRows(scoped, filters.sort), [scoped, filters.sort])
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

  const points = useMemo<StagePoint[]>(
    () =>
      results.map((r) => {
        const c = r.card
        return {
          id: c.id,
          name: c.shortName,
          lon: c.lon,
          lat: c.lat,
          tone: toneOf(c),
          favorite: c.isFavorite,
          description: [statusLine(c), ...metaLine(c), c.isFavorite ? 'favourite' : null].filter(Boolean).join(', '),
        }
      }),
    [results],
  )

  /** Bring a row into view inside the desktop rail (without scrolling the page). */
  const revealRow = useCallback(
    (id: string) => {
      const box = railRef.current
      const card = box?.querySelector<HTMLElement>(`[data-resort-id="${CSS.escape(id)}"]`)
      if (!box || !card) return
      const top = card.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - box.clientHeight / 2 + card.offsetHeight / 2
      box.scrollTo({ top: Math.max(0, top), behavior: reduced ? 'auto' : 'smooth' })
    },
    [reduced],
  )

  /** Marker chosen on the map. If it is outside the current region, jump to World so its row exists. */
  const selectFromMap = useCallback(
    (id: string) => {
      setSelectedId(id)
      if (!scoped.some((r) => r.facets.id === id) && jump.key !== 'world') setJump('world')
      if (desktop) window.requestAnimationFrame(() => revealRow(id))
    },
    [desktop, revealRow, scoped, jump.key, setJump],
  )

  const { setView } = url
  /** Phones: switch to the map and scroll so it fills the screen under the sticky toolbar. */
  const showMap = useCallback(() => {
    setView('map')
    window.requestAnimationFrame(() => {
      const a = anchorRef.current
      if (!a) return
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
  const selectedRow = selected ? (results.find((r) => r.facets.id === selected) ?? null) : null
  const trayVisible = !desktop && compare.entries.length > 0

  const empty =
    scoped.length === 0 ? (
      results.length > 0 ? (
        <div className="flex flex-col items-start gap-3 px-2 py-6">
          <p className="text-[14px] text-ink-2">
            None of the {results.length} matching resorts are in <strong className="font-semibold text-ink">{jump.label}</strong>.
          </p>
          <Button variant="primary" onClick={() => setJump('world')}>
            Show all regions
          </Button>
        </div>
      ) : (
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
      )
    ) : null

  const list = empty ?? (
    <ResortRail
      groups={groups}
      highlightedId={highlighted}
      selectedId={selected}
      onHighlight={setHighlightedId}
      onLocate={locate}
      passLines={passLines}
      notes={notesMap}
      dense={desktop}
    />
  )

  const scenario = (
    <ScenarioBar
      date={view.date}
      dateLabel={view.dateLabel}
      quickDates={view.quickDates}
      bounds={view.seasonBounds}
      mode={view.mode}
      pending={url.pending}
      onDate={(d) => url.navigate({ date: d === view.today ? null : d })}
      onMode={(m: ScoringMode) => url.navigate({ mode: m })}
    />
  )

  const filterSheet = (
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
  )

  const jumpControl = <JumpPill jumps={jumps} current={jump.key} onPick={(k) => setJump(k)} />

  const chipRow = chips.length ? (
    <div className="flex items-start gap-2">
      <ul aria-label="Active filters" className="-my-1 flex min-w-0 flex-1 flex-wrap gap-1.5 py-1">
        {chips.map((c, i) => (
          <li key={c.key} className="min-w-0">
            <button
              type="button"
              data-chip-index={i}
              onClick={() => {
                setFilters(c.clear)
                window.requestAnimationFrame(() => {
                  const next =
                    document.querySelector<HTMLElement>(`[data-chip-index="${i}"]`) ??
                    document.querySelector<HTMLElement>(`[data-chip-index="${i - 1}"]`) ??
                    document.getElementById('explore-filters-button')
                  next?.focus()
                })
              }}
              className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full bg-ink-chip py-1 pr-2 pl-3 text-left text-[12.5px] font-medium text-on-ink-chip transition-opacity duration-150 hover:opacity-85 md:min-h-8"
            >
              <span className="min-w-0">{c.label}</span>
              <X aria-hidden className="size-3.5 shrink-0" />
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
        className="hud h-9 shrink-0 rounded-full px-2 text-teal hover:underline md:h-8"
      >
        Clear all
      </button>
    </div>
  ) : null

  const status = (
    <ResultsLine
      jumpLabel={jump.key === 'world' ? null : jump.label}
      shown={scoped.length}
      matching={results.length}
      total={view.counts.total}
      hidden={hiddenUnknown.length}
      reasons={reasons}
      preseason={view.preseason}
      onIncludeUnknown={() => setFilters((f) => ({ ...f, includeUnknown: true }))}
    />
  )

  const preview = selectedRow ? (
    <Preview
      key={selectedRow.card.id}
      row={selectedRow}
      passLine={passLineFor(selectedRow)}
      notes={notesFor(selectedRow)}
      onClose={() => setSelectedId(null)}
      placement={desktop ? 'top-left' : 'bottom'}
    />
  ) : null

  const desktopTree = (
        <>
          <section
            aria-label="Resort map and results"
            className="relative h-[calc(100dvh-210px)] max-h-[1000px] min-h-[640px] overflow-hidden rounded-[32px] border border-[var(--glass-edge)] shadow-[var(--glass-shadow-lg)]"
          >
            {hydrated ? <ExploreStage
              className="absolute inset-0"
              points={points}
              frame={frame}
              frameKey={jump.key}
              home={view.home}
              selectedId={selected}
              highlightedId={highlighted}
              onSelect={selectFromMap}
              onHighlight={setHighlightedId}
              padding={DESKTOP_PAD}
              top={jumpControl}
              caption="list has every resort"
              selectionInset={416}
              overlay={<AnimatePresence>{preview}</AnimatePresence>}
            /> : <StagePlaceholder />}
            <aside
              aria-label="Results"
              className="glass-strong absolute top-3 right-3 bottom-3 z-30 flex flex-col overflow-hidden rounded-[26px]"
              style={{ width: ASIDE_W }}
            >
              <div className="flex flex-col gap-3 border-b border-divider px-4 pt-4 pb-3">
                <div className="flex items-baseline justify-between gap-3 px-1">
                  <h2 className="min-w-0 text-[20px] leading-tight font-light tracking-[-0.02em] text-ink">{jump.key === 'world' ? 'Worldwide' : jump.label}</h2>
                  <span className="hud tnum shrink-0 text-ink-2">
                    <CountUp value={scoped.length} /> shown · of {view.counts.total}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <SearchBox value={filters.q} onChange={(q) => setFilters((f) => ({ ...f, q }))} />
                  {filterSheet}
                  <SortSelect value={filters.sort} onChange={(s) => setFilters((f) => ({ ...f, sort: s }))} compact />
                </div>
                <QuickToggles filters={filters} setFilters={setFilters} hasPass={view.owned.length > 0 || !!filters.product} />
                {chipRow}
                {status}
              </div>
              <div
                ref={railRef}
                id="explore-list"
                aria-busy={url.pending || undefined}
                className={cn('min-h-0 flex-1 overflow-y-auto px-2.5 py-3 scrollbar-thin transition-opacity duration-200', url.pending && 'pointer-events-none opacity-55')}
              >
                {list}
              </div>
              <CompareBar scenario={{ date: view.date, mode: view.mode, product: filters.product }} />
            </aside>
          </section>
          <Evidence view={view} />
        </>
  )

  const mobileTree = (
        <>
          <div ref={anchorRef} aria-hidden />
          <div
            ref={toolbarRef}
            className="glass sticky top-14 z-20 -mx-4 flex flex-col gap-2 rounded-none border-x-0 border-t-0 px-4 pt-2 pb-2.5 md:top-0 md:-mx-8 md:px-8"
          >
            <div className="flex items-center gap-2">
              <SearchBox value={filters.q} onChange={(q) => setFilters((f) => ({ ...f, q }))} />
              {filterSheet}
              <ViewToggle value={url.view} onChange={(v) => (v === 'map' ? showMap() : setView('list'))} />
            </div>
            {chipRow}
          </div>

          <div
            className={cn('relative mt-3 overflow-hidden rounded-[24px] border border-[var(--glass-edge)] shadow-[var(--glass-shadow)]', !mobileMap && 'h-[340px] sm:h-[400px]')}
            style={
              mobileMap
                ? { height: `calc(100dvh - 3.5rem - var(--explore-toolbar-h, 64px) - 4rem - env(safe-area-inset-bottom) - ${trayVisible ? '7.5rem' : '2rem'})`, minHeight: 360 }
                : undefined
            }
          >
            {hydrated ? <ExploreStage
              className="absolute inset-0"
              points={points}
              frame={frame}
              frameKey={jump.key}
              home={view.home}
              selectedId={selected}
              highlightedId={null}
              onSelect={(id) => {
                setSelectedId(id)
                if (!scoped.some((r) => r.facets.id === id) && jump.key !== 'world') setJump('world')
              }}
              padding={MOBILE_PAD}
              top={jumpControl}
              compact
              overlay={mobileMap ? <AnimatePresence>{preview}</AnimatePresence> : null}
            /> : <StagePlaceholder />}
          </div>

          <div className={cn('mt-4 mb-3 flex flex-col gap-2.5 px-1', mobileMap && 'hidden')}>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h2 className="text-[24px] leading-tight font-light tracking-[-0.02em] text-ink">{jump.key === 'world' ? 'Worldwide' : jump.label}</h2>
              <SortSelect value={filters.sort} onChange={(s) => setFilters((f) => ({ ...f, sort: s }))} />
            </div>
            <QuickToggles filters={filters} setFilters={setFilters} hasPass={view.owned.length > 0 || !!filters.product} />
            {status}
          </div>
          <div
            id="explore-list"
            aria-busy={url.pending || undefined}
            className={cn('transition-opacity duration-200', mobileMap && 'hidden', url.pending && 'pointer-events-none opacity-55')}
          >
            {list}
          </div>
          {!mobileMap ? <Evidence view={view} /> : null}
          {trayVisible ? <div aria-hidden className="h-20" /> : null}
          <CompareTray scenario={{ date: view.date, mode: view.mode, product: filters.product }} />
        </>
  )

  return (
    <div ref={rootRef} className="relative">
      <ExploreHeader eyebrow={eyebrow} title="Explore" actions={<div className="max-w-full max-lg:hidden">{scenario}</div>} className="mb-4 md:mb-5" />
      <div className="mb-4 lg:hidden">{scenario}</div>

      {hydrated ? (
        desktop ? (
          desktopTree
        ) : (
          mobileTree
        )
      ) : (
        // Before hydration the viewport is unknown: render both layouts with CSS (no maps yet), so neither flashes.
        <>
          <div className="max-lg:hidden">{desktopTree}</div>
          <div className="lg:hidden">{mobileTree}</div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function JumpPill({ jumps, current, onPick }: { jumps: { def: { key: string; label: string }; count: number }[]; current: string; onPick: (key: string) => void }) {
  return (
    <div role="group" aria-label="Jump to region" className="glass-strong pointer-events-auto flex max-w-full gap-1 overflow-x-auto rounded-full p-1.5 [scrollbar-width:none]">
      {jumps.map(({ def, count }) => {
        const on = def.key === current
        return (
          <button
            key={def.key}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(def.key)}
            className={cn(
              'relative flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 md:h-10',
              on ? 'text-on-ink-chip' : 'text-ink hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]',
            )}
          >
            {on ? <motion.span layoutId="explore-jump" transition={t.select} aria-hidden className="absolute inset-0 rounded-full bg-ink-chip" /> : null}
            <span className="relative">{def.label}</span>
            {def.key !== 'world' ? (
              <span className={cn('tnum relative text-[11.5px]', on ? 'text-on-ink-chip-2' : 'text-ink-3')}>
                <span className="sr-only">, </span>
                {count}
                <span className="sr-only"> resorts</span>
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

type Setter = (next: ExploreFilters | ((cur: ExploreFilters) => ExploreFilters)) => void

/** The mockup's status chips, wired to the real filters (each toggles one filter). */
function QuickToggles({ filters, setFilters, hasPass }: { filters: ExploreFilters; setFilters: Setter; hasPass: boolean }) {
  const items: { key: string; label: string; on: boolean; toggle: (f: ExploreFilters) => ExploreFilters; title: string }[] = [
    {
      key: 'open',
      label: 'Open now',
      on: filters.status.length === 1 && filters.status[0] === 'open',
      toggle: (f) => ({ ...f, status: f.status.length === 1 && f.status[0] === 'open' ? [] : ['open'] }),
      title: 'Open or partially open (reported status only)',
    },
    ...(hasPass
      ? [
          {
            key: 'pass',
            label: 'On my pass',
            on: filters.usable,
            toggle: (f: ExploreFilters) => ({ ...f, usable: !f.usable }),
            title: 'Only where your pass (or the chosen product) works on this day',
          },
        ]
      : []),
    {
      key: 'drive',
      label: 'Drivable',
      on: filters.travel === 'd360',
      toggle: (f) => ({ ...f, travel: f.travel === 'd360' ? null : 'd360' }),
      title: 'Drive of 6 hours or less (estimate)',
    },
    { key: 'fav', label: 'Favourites', on: filters.favorites, toggle: (f) => ({ ...f, favorites: !f.favorites }), title: 'Favourites only' },
  ]
  const none = !items.some((i) => i.on)
  return (
    <div role="group" aria-label="Quick filters" className="flex flex-wrap gap-1.5">
      <span
        aria-hidden
        className={cn(
          'inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-medium max-lg:h-10',
          none ? 'bg-ink-chip text-on-ink-chip' : 'bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] text-ink-2',
        )}
      >
        All status
      </span>
      {items.map((i) => (
        <button
          key={i.key}
          type="button"
          aria-pressed={i.on}
          title={i.title}
          onClick={() => setFilters(i.toggle)}
          className={cn(
            'inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-medium transition-[background-color,color,transform] duration-150 active:scale-95 max-lg:h-10',
            i.on ? 'bg-ink-chip text-on-ink-chip' : 'bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] text-ink hover:bg-[color-mix(in_srgb,var(--ink)_11%,transparent)]',
          )}
        >
          {i.label}
        </button>
      ))}
    </div>
  )
}

function ResultsLine({
  jumpLabel,
  shown,
  matching,
  total,
  hidden,
  reasons,
  preseason,
  onIncludeUnknown,
}: {
  jumpLabel: string | null
  shown: number
  matching: number
  total: number
  hidden: number
  reasons: { what: string; count: number }[]
  preseason: boolean
  onIncludeUnknown: () => void
}) {
  return (
    <div className="flex flex-col gap-1.5 px-1">
      <p role="status" aria-live="polite" className="text-[12.5px] leading-snug text-ink-2">
        <strong className="tnum font-semibold text-ink">{shown}</strong>
        {jumpLabel ? (
          <>
            {' '}
            in {jumpLabel} · <span className="tnum">{matching}</span> match worldwide
          </>
        ) : (
          <>
            {' '}
            of <span className="tnum">{total}</span> resorts match
          </>
        )}
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
      {preseason ? (
        <p className="flex items-start gap-1.5 text-[12px] leading-snug text-ink-2">
          <Info aria-hidden className="mt-px size-3.5 shrink-0 text-ink-3" />
          <span>
            <strong className="font-semibold text-ink">Preseason:</strong> no open reports or scores for this day yet — nothing is assumed open.
          </span>
        </p>
      ) : null}
    </div>
  )
}

function SortSelect({ value, onChange, compact = false }: { value: SortKey; onChange: (s: SortKey) => void; compact?: boolean }) {
  return (
    <label className={cn('relative flex shrink-0 items-center', compact ? '' : 'gap-2')} title="Sort results">
      <span className={cn(compact ? 'sr-only' : 'hud text-ink-2')}>Sort</span>
      {compact ? <ArrowUpDown aria-hidden className="pointer-events-none absolute left-3 size-4 text-ink-2" /> : null}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
        className={cn(
          'h-10 appearance-none rounded-full border border-[var(--glass-edge)] bg-glass-strong text-[13.5px] font-medium text-ink transition-colors hover:border-teal focus:border-teal focus-visible:outline-2 focus-visible:outline-offset-1 max-lg:h-11',
          compact ? 'w-10 pl-10 text-transparent' : 'pr-3 pl-3.5',
        )}
        aria-label={compact ? `Sort: ${SORT_LABEL[value]}` : undefined}
      >
        {SORTS.map((s) => (
          <option key={s} value={s} className="text-ink">
            {SORT_LABEL[s]}
          </option>
        ))}
      </select>
    </label>
  )
}

function SearchBox({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const [text, setText] = useState(value)
  const [synced, setSynced] = useState(value)
  if (value !== synced) {
    setSynced(value)
    setText(value)
  }
  return (
    <div className="relative min-w-0 flex-1">
      <label htmlFor="explore-search" className="sr-only">
        Search resorts by name, town or region
      </label>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" />
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
        className="h-11 w-full rounded-full border border-[var(--glass-edge)] bg-glass-strong pr-10 pl-10 text-[14.5px] text-ink placeholder:text-ink-3 transition-colors duration-150 hover:border-ink-3 focus:border-teal focus-visible:outline-2 focus-visible:outline-offset-1 lg:h-10 [&::-webkit-search-cancel-button]:hidden"
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
          className="absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-3 hover:bg-surface-3 hover:text-ink lg:size-8"
        >
          <X aria-hidden className="size-4" />
        </button>
      ) : null}
    </div>
  )
}

function ViewToggle({ value, onChange }: { value: 'list' | 'map'; onChange: (v: 'list' | 'map') => void }) {
  return (
    <div role="group" aria-label="Show results as" className="glass-strong inline-flex shrink-0 rounded-full p-1">
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
              'relative inline-flex h-9 min-w-10 items-center justify-center gap-1.5 rounded-full px-2.5 text-[13.5px] font-medium transition-colors duration-150',
              on ? 'text-on-ink-chip' : 'text-ink-2 hover:text-ink',
            )}
          >
            {on ? <motion.span layoutId="explore-view-toggle" transition={t.select} aria-hidden className="absolute inset-0 rounded-full bg-ink-chip" /> : null}
            <Icon aria-hidden className="relative size-4" />
            <span className="relative max-sm:sr-only">{label}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Desktop rail footer: the compare selection with its link (phones use the floating tray). */
function CompareBar({ scenario }: { scenario: { date: string; mode: string; product?: string | null } }) {
  const compare = useCompareSelection()
  const toast = useToast()
  const n = compare.entries.length
  const ready = n >= COMPARE_MIN
  const href = compareHref(compare.ids, new URLSearchParams({ date: scenario.date, mode: scenario.mode, ...(scenario.product ? { product: scenario.product } : {}) }))
  return (
    <div className="flex items-center gap-3 border-t border-divider bg-[color-mix(in_srgb,var(--surface)_45%,transparent)] px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-semibold text-ink">
          Compare · <span className="tnum">{n}</span> of {COMPARE_MAX}
        </span>
        <span className="text-[12px] leading-snug text-ink-2">{n ? compare.entries.map((e) => e.name).join(' · ') : 'Pick up to four'}</span>
      </div>
      {n ? (
        <button
          type="button"
          onClick={() => {
            const before = compare.entries
            compare.clear()
            toast.show('Comparison cleared', { tone: 'info', undo: () => compare.set(before) })
          }}
          className="hud shrink-0 rounded-full px-2 py-2 text-ink-2 hover:text-ink"
        >
          Clear
        </button>
      ) : null}
      {ready ? (
        <Link
          href={href}
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-ink-chip px-[18px] text-[13px] font-semibold text-on-ink-chip transition-transform duration-150 hover:-translate-y-px active:scale-95"
        >
          Compare
          <span className="sr-only"> {n} resorts</span>
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      ) : (
        <span
          title="Pick at least two resorts to compare"
          className="inline-flex h-11 shrink-0 items-center rounded-full border border-dashed border-divider-strong px-4 text-[12.5px] font-medium text-ink-3"
        >
          {n === 1 ? 'Pick 1 more' : 'Compare'}
        </span>
      )}
    </div>
  )
}

/** How much of the day's evidence exists — mission-control tiles that count up as they enter. */
function Evidence({ view }: { view: ExploreView }) {
  const c = view.counts
  const items = [
    { label: 'Status reported', n: c.total - c.statusUnknown },
    { label: 'Scored for the day', n: c.withScore },
    { label: 'Snow reports', n: c.withReport },
    { label: 'Complete day cost', n: c.costComplete },
  ]
  return (
    <section aria-label={`Evidence for ${view.isToday ? 'today' : view.dateLabel}`} className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
      {items.map((i, k) => (
        <motion.div
          key={i.label}
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '0px 0px -40px 0px' }}
          transition={{ ...t.pageIn, delay: k * 0.06 }}
          className="glass flex min-w-0 flex-col gap-2 rounded-[22px] px-4 py-3.5 md:px-5 md:py-4"
        >
          <span className="hud text-ink-2">{i.label}</span>
          <span className="flex items-baseline gap-1.5">
            <CountUp value={i.n} className={cn('tnum text-[34px] leading-none font-light tracking-[-0.03em] md:text-[40px]', i.n === 0 ? 'text-copper' : 'text-ink')} />
            <span className="tnum text-[13px] text-ink-2">/ {c.total}</span>
          </span>
          <span aria-hidden className="h-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink)_7%,transparent)]">
            <motion.span
              className="block h-full rounded-full bg-teal"
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: Math.max(0.015, i.n / Math.max(1, c.total)) }}
              viewport={{ once: true }}
              transition={{ ...t.bars, delay: 0.15 + k * 0.06 }}
              style={{ originX: 0 }}
            />
          </span>
        </motion.div>
      ))}
    </section>
  )
}

function StagePlaceholder() {
  return <div aria-hidden className="absolute inset-0 bg-[color-mix(in_srgb,var(--teal)_7%,var(--surface-2))]" />
}

/** The selected resort over the map (non-modal; Escape or × closes). */
function Preview({
  row,
  passLine,
  notes,
  onClose,
  placement,
}: {
  row: ExploreRow
  passLine: CardPassLine | null | undefined
  notes: string[] | undefined
  onClose: () => void
  placement: 'top-left' | 'bottom'
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (placement === 'bottom') ref.current?.focus({ preventScroll: true })
  }, [placement])
  return (
    <motion.div
      ref={ref}
      tabIndex={-1}
      role="region"
      aria-label={`Preview: ${row.card.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      initial={{ opacity: 0, y: placement === 'bottom' ? 24 : -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: t.sheet }}
      exit={{ opacity: 0, y: placement === 'bottom' ? 16 : -8, transition: { duration: 0.16 } }}
      className={cn(
        'glass-strong absolute z-30 overflow-y-auto rounded-[22px] outline-none scrollbar-thin',
        placement === 'top-left' ? 'top-[76px] left-4 max-h-[calc(100%-200px)] w-[400px]' : 'inset-x-2 bottom-2 max-h-[82%]',
      )}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-divider bg-glass-strong px-4 py-1.5">
        <span className="hud text-teal">Selected · on map</span>
        <button
          type="button"
          onClick={onClose}
          className="-mr-2 inline-flex h-10 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-ink-2 hover:bg-surface-3 hover:text-ink"
        >
          <X aria-hidden className="size-4" />
          Close
        </button>
      </div>
      <ResortCard resort={row.card} variant="row" density="compact" passLine={passLine} notes={notes} />
    </motion.div>
  )
}
