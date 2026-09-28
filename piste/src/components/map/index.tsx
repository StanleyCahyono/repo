'use client'
import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/states'

/** Lazy MapLibre map: the library (~800 kB) loads only when a map is on screen. */
export const LazyResortMap = dynamic(() => import('./resort-map'), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[240px] w-full rounded-[12px]" />,
})

export type { MapMarker, MapLine, ResortMapProps } from './resort-map'
