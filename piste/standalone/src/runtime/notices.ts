/**
 * Small store for standalone-only UI state outside the route tree: transient notices (export failures, saves that
 * failed), the demo-generation progress, and whether this browser keeps the data.
 */
import { useSyncExternalStore } from 'react'

export interface Notice {
  id: number
  tone: 'info' | 'error' | 'success'
  text: string
}

export interface DemoProgress {
  phase: string
  /** 0..1, approximate. */
  fraction: number
  startedAt: number
  error?: string
  done?: boolean
}

export interface ChromeState {
  notices: Notice[]
  demo: DemoProgress | null
  /** null = persisted in IndexedDB; otherwise why the data is memory-only. */
  memoryOnly: string | null
  saveError: string | null
}

let state: ChromeState = { notices: [], demo: null, memoryOnly: null, saveError: null }
const listeners = new Set<() => void>()
let seq = 0

function set(patch: Partial<ChromeState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getChrome(): ChromeState {
  return state
}

export function useChrome(): ChromeState {
  return useSyncExternalStore(subscribe, getChrome, getChrome)
}

export function notify(n: Omit<Notice, 'id'>, ms = 6000) {
  const id = ++seq
  set({ notices: [...state.notices, { ...n, id }] })
  setTimeout(() => dismiss(id), ms)
}

export function dismiss(id: number) {
  set({ notices: state.notices.filter((n) => n.id !== id) })
}

export function setDemoProgress(p: DemoProgress | null) {
  set({ demo: p })
}

export function setMemoryOnly(reason: string | null) {
  set({ memoryOnly: reason })
}

export function setSaveError(error: string | null) {
  if (error !== state.saveError) set({ saveError: error })
}
