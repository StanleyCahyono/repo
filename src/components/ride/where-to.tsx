'use client'
/**
 * "Where to?" — a combobox over every catalogued resort (name, region, country). Arrow keys move, Enter picks,
 * Escape closes. An empty query lists the quick picks first, then everything A–Z.
 */
import { useId, useMemo, useRef, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { formatDuration } from '@/lib/domain/units'
import type { RidePick } from '@/lib/data/ride'
import { cn } from '@/lib/ui/cn'

function norm(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export function WhereTo({
  resorts,
  picks,
  current,
  pending,
  onPick,
}: {
  resorts: readonly RidePick[]
  picks: readonly string[]
  current: { id: string; name: string; where: string } | null
  pending: boolean
  onPick: (id: string) => void
}) {
  const id = useId()
  const listId = `${id}-list`
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const q = norm(query.trim())
    if (!q) {
      const pickSet = new Set(picks)
      const first = picks.map((p) => resorts.find((r) => r.id === p)).filter((r): r is RidePick => !!r)
      return [...first, ...resorts.filter((r) => !pickSet.has(r.id))]
    }
    const scored = resorts
      .map((r) => {
        const n = norm(r.name)
        const sh = norm(r.short)
        const w = norm(r.where)
        const score = n.startsWith(q) || sh.startsWith(q) ? 0 : n.includes(q) || sh.includes(q) ? 1 : w.includes(q) ? 2 : -1
        return { r, score }
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score || a.r.name.localeCompare(b.r.name))
    return scored.map((x) => x.r)
  }, [query, resorts, picks])

  const shown = results.slice(0, 40)
  const pick = (r: RidePick | undefined) => {
    if (!r) return
    setOpen(false)
    setQuery('')
    input.current?.blur()
    onPick(r.id)
  }

  return (
    <div className="relative min-w-0 flex-1">
      <label htmlFor={`${id}-input`} className="sr-only">
        Where to? Search {resorts.length} resorts
      </label>
      <div className="flex items-center gap-2">
        <input
          ref={input}
          id={`${id}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${id}-opt-${shown[active].id}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={open ? query : query || ''}
          placeholder={current ? current.name : 'Where to?'}
          onFocus={() => {
            setOpen(true)
            setActive(0)
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setActive((a) => Math.min(shown.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter') {
              if (open && shown[active]) {
                e.preventDefault()
                pick(shown[active])
              }
            } else if (e.key === 'Escape') {
              setOpen(false)
              setQuery('')
            }
          }}
          className={cn(
            'h-11 w-full min-w-0 bg-transparent text-[21px] font-semibold tracking-[-0.02em] text-ink outline-none',
            current ? 'placeholder:text-ink' : 'placeholder:text-ink-3 placeholder:font-normal',
          )}
        />
        {pending ? (
          <Loader2 aria-label="Loading the route" className="size-5 shrink-0 animate-spin text-teal" />
        ) : query ? (
          <button
            type="button"
            aria-label="Clear search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setQuery('')}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:text-ink"
          >
            <X aria-hidden className="size-4" />
          </button>
        ) : (
          <Search aria-hidden className="size-4 shrink-0 text-ink-3" />
        )}
      </div>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Resorts"
          className="glass-strong scrollbar-thin absolute top-[calc(100%+10px)] right-[-16px] left-[-42px] z-30 max-h-[min(360px,52vh)] overflow-y-auto rounded-[18px] p-1.5 shadow-overlay"
        >
          {shown.length ? (
            shown.map((r, i) => (
              <li
                key={r.id}
                id={`${id}-opt-${r.id}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r)}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2',
                  i === active ? 'bg-glacier' : '',
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[14.5px] font-medium text-ink">{r.name}</span>
                  <span className="truncate text-[12.5px] text-ink-2">{r.where}</span>
                </span>
                <span className="hud shrink-0 text-[11px] text-ink-2">
                  {r.driveMinutes != null ? `${formatDuration(r.driveMinutes)} est.` : 'No drive est.'}
                </span>
              </li>
            ))
          ) : (
            <li className="px-3 py-3 text-[13.5px] text-ink-2">No resort matches “{query}”.</li>
          )}
          {results.length > shown.length ? <li className="hud px-3 py-2 text-[11px] text-ink-3">{results.length - shown.length} more · keep typing</li> : null}
        </ul>
      ) : null}
    </div>
  )
}
