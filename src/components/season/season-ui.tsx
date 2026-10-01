'use client'
/**
 * Client context for My Season: the pickers every editor needs (resorts, trips, passes, skills), the app's "today",
 * demo labelling, and one shared ski-day sheet that any button can open ("Log a ski day" in the header, the journal,
 * an entry's Edit). A link can open it too: /season?log=1&resort=<id>&date=<YYYY-MM-DD>&trip=<id>, or ?day=<id> to
 * edit; the parameters are removed when the sheet closes.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SkiDayView } from '@/lib/data/season'
import type { PassOption, PickerResort, PickerTrip } from '@/lib/data/season-screen'
import { DaySheet, type DayPrefill } from './day-sheet'

export interface SkillOption {
  id: number
  label: string
  category: string | null
}

export interface SeasonUiData {
  today: string
  seasonId: string
  seasonLabel: string
  demo: boolean
  currency: string
  resorts: PickerResort[]
  trips: PickerTrip[]
  passOptions: PassOption[]
  skills: SkillOption[]
  personalReports: string[]
  days: SkiDayView[]
  /** Display unit for vertical (stored in metres). */
  elevationUnit: 'm' | 'ft'
}

export interface DayIntent {
  dayId?: number | null
  prefill?: DayPrefill
}

interface SeasonUiApi {
  data: SeasonUiData
  openDay: (intent?: DayIntent, opener?: HTMLElement | null) => void
  /** The day just logged — the journal gives it a brief completion mark. */
  justLogged: number | null
  /** Make the skier celebrate with a short HUD caption (a ski day logged, a skill confirmed, gear added). */
  celebrate: (label: string) => void
  celebration: { seq: number; label: string } | null
}

const Ctx = createContext<SeasonUiApi | null>(null)

export function useSeasonUi(): SeasonUiApi {
  const c = useContext(Ctx)
  if (!c) throw new Error('useSeasonUi must be used inside <SeasonUiProvider>')
  return c
}

export function SeasonUiProvider({ data, initialIntent, children }: { data: SeasonUiData; initialIntent: DayIntent | null; children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [intent, setIntent] = useState<DayIntent | null>(initialIntent)
  const [open, setOpen] = useState(!!initialIntent)
  const [justLogged, setJustLogged] = useState<number | null>(null)
  const [celebration, setCelebration] = useState<{ seq: number; label: string } | null>(null)
  const celebrate = useCallback((label: string) => setCelebration((c) => ({ seq: (c?.seq ?? 0) + 1, label })), [])
  useEffect(() => {
    if (!celebration) return
    const id = window.setTimeout(() => setCelebration(null), 2800)
    return () => window.clearTimeout(id)
  }, [celebration])
  // A fresh form per opening; closing keeps the instance so the sheet can animate out.
  const [seq, setSeq] = useState(0)
  const opener = useRef<HTMLElement | null>(null)
  const fromUrl = useRef(!!initialIntent)

  const openDay = useCallback((next: DayIntent = {}, from: HTMLElement | null = null) => {
    opener.current = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setIntent(next)
    setSeq((n) => n + 1)
    setOpen(true)
  }, [])

  const onOpenChange = useCallback(
    (v: boolean) => {
      setOpen(v)
      if (!v && fromUrl.current) {
        fromUrl.current = false
        router.replace(`${pathname}${window.location.hash}`, { scroll: false })
      }
    },
    [pathname, router],
  )

  // The completion mark stays ~2.6 s once the new entry is on screen (the refreshed list can arrive a moment later).
  const shown = justLogged !== null && data.days.some((d) => d.id === justLogged)
  useEffect(() => {
    if (justLogged === null) return
    const id = window.setTimeout(() => setJustLogged(null), shown ? 2600 : 10_000)
    return () => window.clearTimeout(id)
  }, [justLogged, shown])

  const api = useMemo(() => ({ data, openDay, justLogged, celebrate, celebration }), [data, openDay, justLogged, celebrate, celebration])
  const editing = intent?.dayId ? (data.days.find((d) => d.id === intent.dayId) ?? null) : null

  return (
    <Ctx.Provider value={api}>
      {children}
      <DaySheet
        key={seq}
        open={open}
        onOpenChange={onOpenChange}
        data={data}
        day={editing}
        prefill={editing ? undefined : intent?.prefill}
        onSaved={(id, created) => {
          if (created) {
            setJustLogged(id)
            celebrate('Ski day logged')
          }
        }}
        onCloseAutoFocus={(e) => {
          if (opener.current && document.contains(opener.current)) {
            e.preventDefault()
            opener.current.focus()
          }
        }}
      />
    </Ctx.Provider>
  )
}

/** Primary "Log a ski day" action. */
export function LogDayButton({ children = 'Log a ski day', variant = 'primary', className, prefill }: { children?: ReactNode; variant?: 'primary' | 'secondary'; className?: string; prefill?: DayPrefill }) {
  const { openDay } = useSeasonUi()
  return (
    <Button variant={variant} className={className ?? 'h-11 md:h-10'} onClick={(e) => openDay({ prefill }, e.currentTarget)}>
      <Plus aria-hidden className="size-4" /> {children}
    </Button>
  )
}
