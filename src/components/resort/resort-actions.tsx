'use client'
/**
 * Save · Compare · Add to trip — the three actions that must always be easy to reach. Rendered in the header
 * (desktop), compactly in the sticky section bar once the header scrolls away, and as a sticky bottom bar on mobile.
 */
import { Columns3, Plus } from 'lucide-react'
import { FavoriteButton } from '@/components/ui/favorite-button'
import { cn } from '@/lib/ui/cn'
import type { CompareCandidate, TripOption } from '@/lib/data/resort-page'
import type { ScoringMode } from '@/lib/domain/types'
import { CompareSheet } from './compare-sheet'
import { TripSheet } from './trip-sheet'

export interface ResortActionsProps {
  resortId: string
  name: string
  shortName: string
  isFavorite: boolean
  trips: TripOption[]
  candidates: CompareCandidate[]
  date: string
  mode: ScoringMode
  today: string
  flyIn: boolean
  demo: boolean
}

export function ResortActions({ variant, className, ...p }: ResortActionsProps & { variant: 'header' | 'compact' | 'bar'; className?: string }) {
  const compare = (
    <CompareSheet
      resortId={p.resortId}
      resortName={p.shortName}
      candidates={p.candidates}
      date={p.date}
      mode={p.mode}
      trigger={
        variant === 'compact' ? (
          <button type="button" aria-label={`Compare ${p.shortName} with other resorts`} title="Compare" className={iconBtn}>
            <Columns3 aria-hidden className="size-[18px]" strokeWidth={1.8} />
          </button>
        ) : (
          <button type="button" className={cn(textBtn, variant === 'bar' && barBtn)}>
            <Columns3 aria-hidden className="size-[18px]" strokeWidth={1.8} />
            Compare
          </button>
        )
      }
    />
  )
  const trip = (
    <TripSheet
      target={{ kind: 'resort', resortId: p.resortId, resortName: p.shortName }}
      trips={p.trips}
      date={p.date}
      today={p.today}
      flyIn={p.flyIn}
      demo={p.demo}
      trigger={
        variant === 'compact' ? (
          <button type="button" aria-label={`Add ${p.shortName} to a trip`} title="Add to trip" className={cn(iconBtn, 'border-teal bg-teal text-on-teal hover:bg-teal-strong hover:text-on-teal')}>
            <Plus aria-hidden className="size-[18px]" strokeWidth={2} />
          </button>
        ) : (
          <button type="button" className={cn(primaryBtn, variant === 'bar' && barBtn)}>
            <Plus aria-hidden className="size-[18px]" strokeWidth={2} />
            Add to trip
          </button>
        )
      }
    />
  )
  if (variant === 'compact') {
    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        <FavoriteButton resortId={p.resortId} name={p.shortName} initial={p.isFavorite} className="size-9" />
        {compare}
        {trip}
      </div>
    )
  }
  if (variant === 'bar') {
    return (
      <div className={cn('grid grid-cols-[auto_1fr_1.3fr] gap-2', className)}>
        <FavoriteButton resortId={p.resortId} name={p.shortName} initial={p.isFavorite} withLabel className="h-11 px-3.5" />
        {compare}
        {trip}
      </div>
    )
  }
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <FavoriteButton resortId={p.resortId} name={p.shortName} initial={p.isFavorite} withLabel />
      {compare}
      {trip}
    </div>
  )
}

const iconBtn =
  'inline-flex size-9 items-center justify-center rounded-md border border-divider-strong bg-surface text-ink-2 transition-colors duration-150 hover:border-teal hover:text-teal'
const textBtn =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-divider-strong bg-surface px-3.5 text-[14px] font-medium text-ink transition-colors duration-150 hover:border-teal hover:text-teal'
const primaryBtn =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-teal bg-teal px-4 text-[14px] font-medium text-on-teal transition-colors duration-150 hover:border-teal-strong hover:bg-teal-strong'
const barBtn = 'h-11 w-full px-2'
