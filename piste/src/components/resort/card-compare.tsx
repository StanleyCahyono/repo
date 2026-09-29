'use client'
/**
 * Compare selection (2–4 resorts) shared by resort cards, the Explore tray, the compare page and the resort page.
 *
 * - Persisted in localStorage (`piste:compare`) so the tray survives navigating to a resort and back; every storage
 *   access is wrapped in try/catch and falls back to memory (private mode, blocked storage, previews).
 * - Synced across tabs via the `storage` event.
 * - Server snapshot is empty, so server HTML and the first client render always match (no hydration mismatch).
 *
 * Usage:
 *   const compare = useCompareSelection()
 *   compare.toggle({ id, name })        // 'added' | 'removed' | 'full'
 *   <CompareToggle id={id} name={name} /> // accessible toggle button (aria-pressed)
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { Check, Plus } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { useToast } from '@/components/ui/toast'

export interface CompareEntry {
  id: string
  name: string
}

export const COMPARE_MAX = 4
export const COMPARE_MIN = 2
const KEY = 'piste:compare'
const EMPTY: CompareEntry[] = []

let memory: CompareEntry[] = EMPTY
let loaded = false
const listeners = new Set<() => void>()

function sanitize(v: unknown): CompareEntry[] {
  if (!Array.isArray(v)) return EMPTY
  const out: CompareEntry[] = []
  for (const x of v) {
    if (!x || typeof x !== 'object') continue
    const { id, name } = x as Record<string, unknown>
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(id) || out.some((e) => e.id === id)) continue
    out.push({ id, name: typeof name === 'string' && name.trim() ? name.slice(0, 120) : id })
    if (out.length >= COMPARE_MAX) break
  }
  return out
}

function read(): CompareEntry[] {
  if (!loaded) {
    loaded = true
    try {
      const raw = window.localStorage.getItem(KEY)
      memory = raw ? sanitize(JSON.parse(raw)) : EMPTY
    } catch {
      memory = EMPTY
    }
  }
  return memory
}

function write(next: CompareEntry[]) {
  memory = next.length ? next : EMPTY
  try {
    if (memory.length) window.localStorage.setItem(KEY, JSON.stringify(memory))
    else window.localStorage.removeItem(KEY)
  } catch {
    // Storage unavailable: keep the in-memory selection for this page view.
  }
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    loaded = false
    read()
    cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

const serverSnapshot = () => EMPTY

export interface CompareSelection {
  entries: CompareEntry[]
  ids: string[]
  has: (id: string) => boolean
  full: boolean
  /** Add or remove; returns what happened ('full' = already 4 selected, nothing changed). */
  toggle: (entry: CompareEntry) => 'added' | 'removed' | 'full'
  remove: (id: string) => void
  clear: () => void
  /** Replace the selection (e.g. from a compare URL). Invalid/duplicate ids are dropped; max 4. */
  set: (entries: CompareEntry[]) => void
}

export function useCompareSelection(): CompareSelection {
  const entries = useSyncExternalStore(subscribe, read, serverSnapshot)
  const has = useCallback((id: string) => entries.some((e) => e.id === id), [entries])
  const toggle = useCallback((entry: CompareEntry) => {
    const cur = read()
    if (cur.some((e) => e.id === entry.id)) {
      write(cur.filter((e) => e.id !== entry.id))
      return 'removed' as const
    }
    if (cur.length >= COMPARE_MAX) return 'full' as const
    write(sanitize([...cur, entry]))
    return 'added' as const
  }, [])
  const remove = useCallback((id: string) => write(read().filter((e) => e.id !== id)), [])
  const clear = useCallback(() => write(EMPTY), [])
  const set = useCallback((next: CompareEntry[]) => {
    const clean = sanitize(next)
    const cur = read()
    if (clean.length === cur.length && clean.every((e, i) => e.id === cur[i].id && e.name === cur[i].name)) return
    write(clean)
  }, [])
  return useMemo(
    () => ({ entries, ids: entries.map((e) => e.id), has, full: entries.length >= COMPARE_MAX, toggle, remove, clear, set }),
    [entries, has, toggle, remove, clear, set],
  )
}

/**
 * Compare toggle for a resort. `aria-pressed` reflects membership; when four resorts are already selected the
 * button explains why nothing happens instead of silently failing.
 */
export function CompareToggle({
  id,
  name,
  size = 'md',
  withLabel = true,
  className,
}: {
  id: string
  name: string
  /** md = 36px desktop / 44px below md; lg = 44px everywhere. */
  size?: 'md' | 'lg'
  withLabel?: boolean
  className?: string
}) {
  const compare = useCompareSelection()
  const toast = useToast()
  const on = compare.has(id)
  const blocked = !on && compare.full
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-disabled={blocked || undefined}
      aria-label={withLabel ? undefined : on ? `Remove ${name} from comparison` : `Add ${name} to comparison`}
      title={blocked ? `Comparison holds up to ${COMPARE_MAX} resorts — remove one first` : on ? `Remove ${name} from comparison` : `Add ${name} to comparison`}
      onClick={() => {
        const r = compare.toggle({ id, name })
        if (r === 'full') toast.show(`Compare holds up to ${COMPARE_MAX} resorts — remove one first`, { tone: 'info' })
      }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border text-[13.5px] font-medium whitespace-nowrap transition-colors duration-150',
        size === 'lg' ? 'h-11' : 'h-11 md:h-9',
        withLabel ? 'px-3' : size === 'lg' ? 'w-11' : 'w-11 md:w-9',
        on ? 'border-teal bg-glacier text-teal' : 'border-divider-strong bg-surface text-ink-2 hover:border-teal hover:text-teal',
        blocked && 'opacity-60',
        className,
      )}
    >
      {on ? <Check aria-hidden className="size-4" strokeWidth={2.2} /> : <Plus aria-hidden className="size-4" />}
      {withLabel ? <span>{on ? 'Comparing' : 'Compare'}</span> : null}
    </button>
  )
}
