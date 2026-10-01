'use client'
/**
 * Small client-only state hooks built on useSyncExternalStore, so the server render and the first client render
 * agree (no hydration mismatch) and no state is set synchronously inside effects.
 */
import { useCallback, useSyncExternalStore } from 'react'

/** `matchMedia` as state; `serverValue` is used for SSR and the hydration pass. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', cb)
      return () => mql.removeEventListener('change', cb)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  )
}

const noop = () => () => {}

/** false during SSR and the hydration pass, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  )
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)', false)
}

// ---------------------------------------------------------------------------
// A number persisted in localStorage (every access wrapped: storage can be blocked or throw).

const numberListeners = new Map<string, Set<() => void>>()

function readNumber(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function writeNumber(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(Math.round(value * 10) / 10))
  } catch {
    // Unavailable storage: the value just is not remembered.
  }
  numberListeners.get(key)?.forEach((l) => l())
}

export function usePersistentNumber(key: string, fallback: number, min: number, max: number): [number, (v: number) => void] {
  const subscribe = useCallback(
    (cb: () => void) => {
      const set = numberListeners.get(key) ?? new Set()
      set.add(cb)
      numberListeners.set(key, set)
      const onStorage = (e: StorageEvent) => {
        if (e.key === key) cb()
      }
      window.addEventListener('storage', onStorage)
      return () => {
        set.delete(cb)
        window.removeEventListener('storage', onStorage)
      }
    },
    [key],
  )
  const value = useSyncExternalStore(
    subscribe,
    () => {
      const v = readNumber(key)
      return v !== null && v >= min && v <= max ? v : fallback
    },
    () => fallback,
  )
  const set = useCallback((v: number) => writeNumber(key, Math.min(max, Math.max(min, v))), [key, min, max])
  return [value, set]
}
