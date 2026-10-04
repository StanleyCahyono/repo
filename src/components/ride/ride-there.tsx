'use client'
/**
 * "Ride there" — the Uber-style journey map. A full-bleed animated map (online MapLibre or the offline schematic) with
 * a glass "Where to?" sheet: a side panel from 1024px, a bottom sheet over the map below that.
 *
 * Reusable: pass a plan (from `getRidePlan`) for one resort. With an `index` it shows the resort search and drives the
 * /ride URL (`?to=&mode=&via=&from=`); without one it is a fixed-destination embed (resort page, trip planner).
 */
import { useCallback, useId, useMemo, useState, useSyncExternalStore, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'motion/react'
import type { RideIndex, RidePlan } from '@/lib/data/ride'
import { DEFAULT_UNITS } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'
import { JourneyMap } from './journey-map'
import { RideSheet } from './ride-sheet'
import { availableModes, buildJourney, resolveSelection, type RideSelection } from './journey-model'

export interface RideThereProps {
  plan: RidePlan | null
  /** Resort search + URL sync (the /ride page). Omit for an embed with a fixed destination. */
  index?: RideIndex | null
  initial?: Partial<RideSelection>
  /** Fallback home when there is no plan yet. */
  home: { name: string; lat: number; lon: number }
  className?: string
}

const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia('(min-width: 1024px)')
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
const getWide = () => window.matchMedia('(min-width: 1024px)').matches

export function RideThere({ plan, index = null, initial, home, className }: RideThereProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const reduced = useReducedMotion() ?? false
  const wide = useSyncExternalStore(subscribeWide, getWide, () => true)
  const listId = useId()
  const [replay, setReplay] = useState(0)

  // Selection is per resort: switching resorts starts from the URL / recommended option again.
  const [choice, setChoice] = useState<{ resortId: string | null; sel: Partial<RideSelection> }>({ resortId: plan?.resort.id ?? null, sel: initial ?? {} })
  const req = choice.resortId === (plan?.resort.id ?? null) ? choice.sel : {}
  const sel = plan ? resolveSelection(plan, req) : null
  const modes = plan ? availableModes(plan) : []
  const journey = useMemo(() => (plan && sel ? buildJourney(plan, sel) : null), [plan, sel?.mode, sel?.via, sel?.from]) // eslint-disable-line react-hooks/exhaustive-deps

  const syncUrl = useCallback(
    (resortId: string, s: Partial<RideSelection>) => {
      if (!index) return
      const q = new URLSearchParams({ to: resortId })
      if (s.mode) q.set('mode', s.mode)
      if (s.mode === 'fly' && s.via) q.set('via', s.via)
      if (s.mode === 'fly' && s.from) q.set('from', s.from)
      window.history.replaceState(null, '', `/ride?${q.toString()}`)
    },
    [index],
  )

  const onPick = useCallback(
    (id: string) => {
      if (id === plan?.resort.id) {
        setReplay((r) => r + 1)
        return
      }
      setChoice({ resortId: id, sel: {} })
      startTransition(() => router.push(`/ride?to=${encodeURIComponent(id)}`, { scroll: false }))
    },
    [plan?.resort.id, router],
  )

  const onSelect = useCallback(
    (s: Partial<RideSelection>) => {
      if (!plan || !sel) return
      const next = resolveSelection(plan, { ...sel, ...s })
      setChoice({ resortId: plan.resort.id, sel: next })
      syncUrl(plan.resort.id, next)
    },
    [plan, sel, syncUrl],
  )

  // The side panel covers the left 456px from 1024px; the map measures its own overlays for top and bottom.
  const padding = useMemo(() => (wide ? { top: 24, right: 32, bottom: 24, left: 488 } : { top: 16, right: 16, bottom: 36, left: 16 }), [wide])
  const context = useMemo(() => (index ? index.resorts.map((r) => ({ lat: r.lat, lon: r.lon })) : []), [index])
  const homeName = plan?.home.name ?? home.name

  return (
    <section aria-labelledby="ride-title" className={cn('relative', className)}>
      <div
        className={cn(
          'relative overflow-hidden',
          '-mx-4 -mt-6 h-[54svh] min-h-[360px] md:mx-0 md:mt-0 md:h-[58vh] md:rounded-[28px] md:border md:border-[var(--glass-edge)] md:shadow-[var(--glass-shadow-lg)]',
          'lg:h-[calc(100dvh-140px)] lg:min-h-[640px]',
        )}
      >
        <JourneyMap
          journey={journey}
          home={plan?.home ?? home}
          context={context}
          replay={replay}
          reduced={reduced}
          padding={padding}
          units={plan?.units ?? DEFAULT_UNITS}
          resortName={plan?.resort.short ?? null}
          compact={!wide}
          describedBy={journey ? listId : undefined}
        />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 30, mass: 0.9 }}
        className={cn(
          'glass-strong relative z-10 -mx-4 -mt-7 rounded-t-[28px] rounded-b-none md:mx-0 md:rounded-[28px]',
          'lg:absolute lg:top-4 lg:bottom-4 lg:left-4 lg:mx-0 lg:mt-0 lg:w-[440px] lg:overflow-y-auto lg:overscroll-contain',
          'scrollbar-thin',
        )}
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-ink/15 lg:hidden" />
        <RideSheet
          plan={plan}
          index={index}
          sel={sel}
          journey={journey}
          modes={modes}
          pending={pending}
          replay={replay}
          listId={listId}
          onPick={onPick}
          onSelect={onSelect}
          onReplay={() => setReplay((r) => r + 1)}
          homeName={homeName}
        />
      </motion.div>
    </section>
  )
}
