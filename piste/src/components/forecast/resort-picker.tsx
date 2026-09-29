'use client'
/**
 * Choose up to four resorts to compare. Changes are staged inside the sheet and applied once (one server round
 * trip). Favourites come first; resorts without a stored forecast are marked, not hidden.
 */
import { useMemo, useState } from 'react'
import { Plus, Search, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import type { PickerResort } from '@/lib/data/forecast-screen'
import { cn } from '@/lib/ui/cn'
import { MAX_COMPARE } from './params'

export function ResortPicker({
  catalog,
  selected,
  onApply,
  triggerClassName,
}: {
  catalog: PickerResort[]
  selected: string[]
  onApply: (ids: string[]) => void
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string[]>(selected)
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (r: PickerResort) => !q || [r.name, r.shortName, r.region, r.stateProvince ?? '', r.country].some((f) => f.toLowerCase().includes(q))
    const list = catalog.filter(match)
    const favs = list.filter((r) => r.isFavorite)
    const rest = list.filter((r) => !r.isFavorite)
    const byRegion = new Map<string, PickerResort[]>()
    for (const r of rest) {
      const key = r.stateProvince && !r.region.toLowerCase().includes(r.stateProvince.toLowerCase()) ? `${r.region} · ${r.stateProvince}` : r.region
      byRegion.set(key, [...(byRegion.get(key) ?? []), r])
    }
    return [
      ...(favs.length ? [{ label: 'Favourites', items: favs }] : []),
      ...[...byRegion.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, items]) => ({ label, items: items.sort((a, b) => a.name.localeCompare(b.name)) })),
    ]
  }, [catalog, query])

  const full = draft.length >= MAX_COMPARE
  const toggle = (id: string) => setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : d.length >= MAX_COMPARE ? d : [...d, id]))

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setDraft(selected)
          setQuery('')
        }
      }}
      title="Choose resorts to compare"
      description={`Up to ${MAX_COMPARE}. Favourites are listed first.`}
      trigger={
        <Button variant="secondary" size="sm" className={cn('h-10 md:h-9', triggerClassName)}>
          <Plus aria-hidden className="size-4" />
          {selected.length ? 'Change resorts' : 'Choose resorts'}
        </Button>
      }
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-ink-2 tnum" aria-live="polite">
            {draft.length} of {MAX_COMPARE} selected
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="md" onClick={() => setDraft([])} disabled={!draft.length}>
              Clear
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                onApply(draft)
                setOpen(false)
              }}
            >
              Show forecast
            </Button>
          </div>
        </div>
      }
    >
      <label className="relative mb-3 block">
        <span className="sr-only">Search resorts</span>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or region"
          className="h-11 w-full rounded-md border border-divider-strong bg-surface pr-3 pl-9 text-[15px] text-ink placeholder:text-ink-3 focus:border-teal focus-visible:outline-2 focus-visible:outline-offset-1"
        />
      </label>
      {full ? <p className="mb-2 text-[13px] text-caution">Four resorts selected — remove one to add another.</p> : null}
      {groups.length === 0 ? <p className="py-6 text-center text-[14px] text-ink-3">No resorts match “{query}”.</p> : null}
      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <fieldset key={g.label} className="min-w-0">
            <legend className="eyebrow mb-1.5">{g.label}</legend>
            <ul className="flex flex-col">
              {g.items.map((r) => {
                const on = draft.includes(r.id)
                const disabled = !on && full
                return (
                  <li key={r.id}>
                    <label
                      className={cn(
                        'flex min-h-11 items-center gap-3 rounded-[10px] px-2 py-1.5 transition-colors duration-150',
                        disabled ? 'opacity-55' : 'cursor-pointer hover:bg-surface-3',
                        on && 'bg-glacier/60',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={disabled}
                        onChange={() => toggle(r.id)}
                        className="size-[18px] shrink-0 accent-[var(--teal)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[14.5px] font-medium text-ink">
                          {r.name}
                          {r.isFavorite ? <Star aria-label="Favourite" className="size-3.5 text-copper" fill="currentColor" strokeWidth={1.8} /> : null}
                        </span>
                        <span className="block text-[12.5px] text-ink-3">
                          {[r.stateProvince, r.country].filter(Boolean).join(', ')}
                          {r.hasForecast ? '' : ' · no forecast stored yet'}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </fieldset>
        ))}
      </div>
    </Sheet>
  )
}
