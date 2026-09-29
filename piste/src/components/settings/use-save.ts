'use client'
/**
 * Run a settings server action in a transition: checkmark toast with Undo on success, an error toast (and field
 * errors for the form) on failure. Network failures are reported to the offline banner.
 */
import { useCallback, useTransition } from 'react'
import { useToast } from '@/components/ui/toast'
import { reportNetworkFailure, reportNetworkOk } from '@/components/ui/offline-banner'

export type Result<T> = { ok: true; data: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> }

export interface SaveOptions<T> {
  /** Toast text (defaults to the action's message); false = no toast. */
  success?: string | ((data: T) => string) | false
  undo?: (data: T) => unknown
  onDone?: (data: T) => void
  onError?: (r: Extract<Result<T>, { ok: false }>) => void
}

export function useSave() {
  const toast = useToast()
  const [pending, start] = useTransition()
  const run = useCallback(
    <T,>(fn: () => Promise<Result<T>>, opts: SaveOptions<T> = {}) =>
      start(async () => {
        let r: Result<T>
        try {
          r = await fn()
          reportNetworkOk()
        } catch {
          reportNetworkFailure()
          const error = 'Not saved — Piste’s server could not be reached. Try again when you are back online.'
          opts.onError?.({ ok: false, error })
          toast.show(error, { tone: 'error', durationMs: 6000 })
          return
        }
        if (!r.ok) {
          opts.onError?.(r)
          toast.show(r.error, { tone: 'error' })
          return
        }
        const data = r.data
        opts.onDone?.(data)
        const msg = opts.success === false ? null : typeof opts.success === 'function' ? opts.success(data) : (opts.success ?? r.message ?? 'Saved')
        if (msg) toast.show(msg, { undo: opts.undo ? async () => void (await opts.undo!(data)) : undefined })
      }),
    [toast],
  )
  return { run, pending }
}
