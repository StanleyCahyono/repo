'use client'
/**
 * Client context for one trip page: opens the item editor from anywhere on the page (server-rendered sections embed
 * small client buttons) and runs server actions with a pending state, a checkmark toast and Undo where it applies.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { TripItemRow, TripRow } from '@/lib/db/rows'
import type { TripItemType } from '@/lib/db/schema'
import type { ItemConversion } from '@/lib/data/trip-plan'
import { ItemEditor } from './item-editor'
import { useRunAction, type Run } from './use-run'

export interface TripUiData {
  tripId: string
  tripName: string
  status: TripRow['status']
  startDate: string
  endDate: string
  partySize: number
  /** Display currency. */
  currency: string
  today: string
  demo: boolean
  originAirport: string | null
  /** Resorts on this trip first (ski days), then the rest of the catalog. */
  resorts: { id: string; name: string; shortName: string; onTrip: boolean }[]
  skills: { id: number; label: string; category: string | null; status: string }[]
  lessons: { id: number; resortId: string; date: string | null; kind: string | null; instructor: string | null; focusSkills: number[]; bookingRef: string | null; bookingUrl: string | null }[]
  airports: { iata: string; name: string; timezone: string | null }[]
  rates: { currency: string; rate: string; rateDate: string; provider: string }[]
  /** Item id → its price in the display currency (with rate and date) or why it is not converted. */
  conversions: Record<string, ItemConversion>
}

export type EditorTarget =
  | { mode: 'add'; type: TripItemType; defaults?: Partial<Pick<TripItemRow, 'refId' | 'title' | 'date' | 'endDate' | 'status' | 'costBasis'>> & { details?: Record<string, unknown> } }
  | { mode: 'edit'; item: TripItemRow }

interface TripUi {
  data: TripUiData
  openEditor: (t: EditorTarget) => void
  run: Run
  pending: boolean
}

const Ctx = createContext<TripUi | null>(null)

export function useTripUi(): TripUi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTripUi must be used inside <TripUiProvider>')
  return v
}

export function TripUiProvider({ data, children }: { data: TripUiData; children: ReactNode }) {
  const [target, setTarget] = useState<EditorTarget | null>(null)
  const [open, setOpen] = useState(false)
  // Each opening starts a fresh form from the item as it is now (not a stale earlier render).
  const [opens, setOpens] = useState(0)
  const { run, pending } = useRunAction()
  const openEditor = useCallback((t: EditorTarget) => {
    setTarget(t)
    setOpens((n) => n + 1)
    setOpen(true)
  }, [])
  const value = useMemo(() => ({ data, openEditor, run, pending }), [data, openEditor, run, pending])
  return (
    <Ctx.Provider value={value}>
      {children}
      {target ? (
        <ItemEditor
          key={opens}
          target={target}
          open={open}
          onOpenChange={setOpen}
          data={data}
          run={run}
        />
      ) : null}
    </Ctx.Provider>
  )
}
