'use client'
/**
 * Small travel map: the resort, its recorded airports and home, with straight dashed lines that are labelled as
 * straight lines — never routes or driving times. Lazy MapLibre (falls back to a schematic when tiles are blocked).
 * The section renders a list alternative next to it.
 */
import { useState } from 'react'
import { LazyResortMap, type MapLine, type MapMarker } from '@/components/map'

export function TravelMap({ markers, lines, fitIds, label }: { markers: MapMarker[]; lines: MapLine[]; fitIds: string[]; label: string }) {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <LazyResortMap
      markers={markers}
      lines={lines}
      fitIds={fitIds}
      selectedId={selected}
      onSelect={(id) => setSelected((s) => (s === id ? null : id))}
      ariaLabel={label}
      className="h-[260px] w-full md:h-[320px]"
    />
  )
}
