'use client'
/**
 * Explore map: the current results as markers (favourites copper, confirmed closures muted, home dark), a region
 * "view" switch that frames part of a continent-spanning catalog (Northeast vs West vs Europe) without hiding the
 * other markers, and a legend. The list is always the full alternative to the map.
 *
 * Camera: framing changes jump (no animation); only an explicit selection flies (handled by ResortMap).
 */
import { useMemo, useState, type ReactNode } from 'react'
import { LazyResortMap, type MapMarker } from '@/components/map'
import { cn } from '@/lib/ui/cn'
import type { ExploreRow } from '@/lib/data/explore'

const HOME_ID = '__home'

/** Region groups in the order they are offered as map views. */
const VIEW_ORDER = ['Northeast US', 'Eastern Canada', 'Western US', 'Western Canada', 'Europe', 'International']
const VIEW_SHORT: Record<string, string> = {
  'Northeast US': 'Northeast',
  'Eastern Canada': 'E. Canada',
  'Western US': 'West',
  'Western Canada': 'W. Canada',
  Europe: 'Europe',
  International: 'Other',
}

function markerFor(r: ExploreRow): MapMarker {
  const c = r.card
  const score =
    c.score.kind === 'closed'
      ? `closed on ${c.dateLabel}`
      : c.score.value !== null
        ? `score ${c.score.value}${c.score.kind === 'conditions' ? '' : ' (partial)'}`
        : 'no score'
  const travel = c.travel.mode === 'drive' ? `${c.travel.headline} drive` : c.travel.mode === 'fly' ? `fly-in ${c.travel.caption}` : 'travel unknown'
  return {
    id: c.id,
    lat: c.lat,
    lon: c.lon,
    label: c.shortName,
    sublabel: `${c.status.label}, ${score}, ${travel}${c.isFavorite ? ', favourite' : ''}`,
    tone: c.closure ? 'muted' : c.isFavorite ? 'favorite' : 'default',
  }
}

export function ExploreMap({
  rows,
  home,
  selectedId,
  highlightedId,
  onSelect,
  overlay,
  className,
}: {
  rows: ExploreRow[]
  home: { name: string; lat: number; lon: number }
  selectedId: string | null
  highlightedId: string | null
  onSelect: (id: string) => void
  /** Rendered over the bottom of the map (the mobile preview panel). */
  overlay?: ReactNode
  className?: string
}) {
  const groups = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const r of rows) m.set(r.facets.regionGroup, [...(m.get(r.facets.regionGroup) ?? []), r.facets.id])
    return [...m.entries()].sort(([a], [b]) => ((VIEW_ORDER.indexOf(a) + 99) % 99) - ((VIEW_ORDER.indexOf(b) + 99) % 99) || a.localeCompare(b))
  }, [rows])
  const [pick, setPick] = useState<string | null>(null)
  // Default frame: the home region when the results span several regions; otherwise everything.
  const current =
    pick && (pick === 'all' || groups.some(([g]) => g === pick))
      ? pick
      : groups.length > 1 && groups.some(([g]) => g === 'Northeast US')
        ? 'Northeast US'
        : 'all'
  const fitIds = current === 'all' ? null : (groups.find(([g]) => g === current)?.[1] ?? null)

  const markers = useMemo<MapMarker[]>(
    () => [{ id: HOME_ID, lat: home.lat, lon: home.lon, label: 'Home', sublabel: `${home.name} (home)`, tone: 'home' }, ...rows.map(markerFor)],
    [rows, home.lat, home.lon, home.name],
  )
  const outside = fitIds ? rows.length - fitIds.length : 0

  return (
    <div className={cn('relative flex h-full min-h-0 flex-col', className)}>
      <LazyResortMap
        markers={markers}
        selectedId={selectedId}
        highlightedId={highlightedId}
        onSelect={(id) => (id === HOME_ID ? undefined : onSelect(id))}
        fitIds={fitIds ? [...fitIds, HOME_ID] : null}
        markerStyle={rows.length > 10 ? 'dot' : 'pill'}
        ariaLabel={`Map of ${rows.length} ${rows.length === 1 ? 'resort' : 'resorts'} in the current results`}
        fallbackCenter={[home.lon, home.lat]}
        className="min-h-0 w-full flex-1"
      />

      {groups.length > 1 ? (
        <div className="pointer-events-none absolute top-2 left-2 right-14 flex">
          <div
            role="group"
            aria-label="Map view"
            className="pointer-events-auto flex max-w-full gap-0.5 overflow-x-auto rounded-[10px] border border-divider bg-surface p-0.5 shadow-lift scrollbar-thin"
          >
            {[...groups.map(([g, ids]) => ({ key: g, label: VIEW_SHORT[g] ?? g, n: ids.length })), { key: 'all', label: 'All', n: rows.length }].map((v) => {
              const on = v.key === current
              return (
                <button
                  key={v.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPick(v.key)}
                  className={cn(
                    'inline-flex h-9 shrink-0 items-center gap-1 rounded-[8px] px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors duration-150',
                    on ? 'bg-glacier text-teal' : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
                  )}
                >
                  {v.label}
                  <span className="tnum text-[12px] text-ink-3">
                    <span className="sr-only">, </span>
                    {v.n}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[12px] text-ink-2">
        <Legend dot="bg-teal" label="Resort" />
        <Legend dot="bg-copper" label="Favourite" />
        <Legend dot="bg-surface-3 border border-divider-strong" label="Closed on the day" />
        <Legend dot="bg-ink" label="Home" />
        {outside > 0 ? (
          <span className="tnum text-ink-3">
            {outside} more outside this view — choose <span className="font-medium">All</span>
          </span>
        ) : null}
      </div>

      {overlay}
    </div>
  )
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn('inline-block size-2.5 rounded-full', dot)} />
      {label}
    </span>
  )
}
