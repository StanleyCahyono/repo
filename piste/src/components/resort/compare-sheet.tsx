'use client'
/**
 * "Compare" — pick up to three other resorts and open the side-by-side comparison with the same date and scoring
 * mode in every column. Shares the Explore compare tray (useCompareSelection, persisted in localStorage): the sheet
 * starts from the tray (else favourites), and opening the comparison writes the chosen set back to the tray so it is
 * still there when you return to Explore.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Columns3, Search } from 'lucide-react'
import { Sheet } from '@/components/ui/sheet'
import { TextInput } from '@/components/ui/form'
import { cn } from '@/lib/ui/cn'
import type { CompareCandidate } from '@/lib/data/resort-page'
import type { ScoringMode } from '@/lib/domain/types'
import { COMPARE_MAX, useCompareSelection } from './card-compare'
import { dayLabel } from './format'

const MAX_OTHERS = COMPARE_MAX - 1

export function CompareSheet({
  resortId,
  resortName,
  candidates,
  date,
  mode,
  trigger,
}: {
  resortId: string
  resortName: string
  candidates: CompareCandidate[]
  date: string
  mode: ScoringMode
  trigger: ReactNode
}) {
  const router = useRouter()
  const tray = useCompareSelection()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [q, setQ] = useState('')
  const known = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? candidates.filter((c) => `${c.name} ${c.region}`.toLowerCase().includes(needle)) : candidates
  }, [candidates, q])
  const favs = shown.filter((c) => c.favorite)
  const others = shown.filter((c) => !c.favorite)
  const ids = [resortId, ...picked]
  const href = `/explore/compare?ids=${ids.map(encodeURIComponent).join(',')}&date=${date}&mode=${mode}`
  const inTray = tray.entries.filter((e) => e.id !== resortId && known.has(e.id))

  const toggle = (id: string) => setPicked((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : xs.length >= MAX_OTHERS ? xs : [...xs, id]))

  const row = (c: CompareCandidate) => {
    const on = picked.includes(c.id)
    const disabled = !on && picked.length >= MAX_OTHERS
    return (
      <li key={c.id}>
        <label
          className={cn(
            'flex min-h-11 items-center gap-3 rounded-[10px] border px-3 py-2 transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus',
            on ? 'border-teal bg-glacier/50' : 'border-transparent hover:border-divider',
            disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
          )}
        >
          <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(c.id)} className="size-4 shrink-0 accent-[var(--teal)]" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-medium text-ink">{c.name}</span>
            <span className="block truncate text-[12.5px] text-ink-3">{c.region}</span>
          </span>
        </label>
      </li>
    )
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (o) {
          // Start from the shared tray (minus this resort), else favourites.
          const fromTray = tray.entries.filter((e) => e.id !== resortId && known.has(e.id)).map((e) => e.id)
          setPicked((fromTray.length ? fromTray : candidates.filter((c) => c.favorite).map((c) => c.id)).slice(0, MAX_OTHERS))
          setQ('')
        }
        setOpen(o)
      }}
      trigger={trigger}
      title={`Compare ${resortName} with…`}
      description={`Pick up to ${MAX_OTHERS}. Every column uses ${dayLabel(date)} and the same scoring mode.`}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-ink-2 tnum" aria-live="polite">
            {picked.length ? `${picked.length + 1} resorts selected` : 'Pick at least one resort'}
          </p>
          <button
            type="button"
            disabled={!picked.length}
            onClick={() => {
              tray.set(ids.map((id) => ({ id, name: id === resortId ? resortName : (known.get(id)?.name ?? id) })))
              setOpen(false)
              router.push(href)
            }}
            className={cn(
              'inline-flex h-11 items-center gap-2 rounded-md px-4 text-[14.5px] font-medium',
              picked.length ? 'bg-teal text-on-teal hover:bg-teal-strong' : 'cursor-not-allowed bg-surface-3 text-ink-3',
            )}
          >
            <Columns3 aria-hidden className="size-4" /> Compare
          </button>
        </div>
      }
    >
      {inTray.length ? (
        <p className="mb-3 rounded-md bg-surface-2 px-3 py-2 text-[12.5px] text-ink-2">
          Your compare tray: {inTray.map((e) => e.name).join(', ')} — preselected. The comparison you open replaces the tray.
        </p>
      ) : null}
      <div className="relative mb-3">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a resort" aria-label="Find a resort" className="pl-9" />
      </div>
      {favs.length ? (
        <>
          <p className="eyebrow mb-1.5">Favourites</p>
          <ul className="mb-4 flex flex-col gap-1">{favs.map(row)}</ul>
        </>
      ) : null}
      <p className="eyebrow mb-1.5">{favs.length ? 'Other resorts' : 'Resorts'}</p>
      {others.length ? <ul className="flex flex-col gap-1">{others.map(row)}</ul> : <p className="text-[13.5px] text-ink-3 italic">No match.</p>}
    </Sheet>
  )
}
