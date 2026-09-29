'use client'
/** Run a server action in a transition with a checkmark toast (optionally with Undo) or an error toast. */
import { useCallback, useTransition } from 'react'
import { useToast } from '@/components/ui/toast'
import type { ActionResult } from '@/lib/actions/trips'

export type RunOptions<T> = {
  /** Toast text on success (defaults to the action's message). `false` = no toast. */
  success?: string | ((data: T) => string) | false
  /** Offer Undo in the toast. */
  undo?: (data: T) => Promise<unknown> | unknown
  onDone?: (data: T) => void
  onError?: (r: Extract<ActionResult<T>, { ok: false }>) => void
}

export type Run = <T>(fn: () => Promise<ActionResult<T>>, opts?: RunOptions<T>) => void

export function useRunAction(): { run: Run; pending: boolean } {
  const toast = useToast()
  const [pending, start] = useTransition()
  const run = useCallback(
    <T,>(fn: () => Promise<ActionResult<T>>, opts: RunOptions<T> = {}) =>
      start(async () => {
        try {
          const r = await fn()
          if (!r.ok) {
            opts.onError?.(r)
            toast.show(r.error, { tone: 'error' })
            return
          }
          opts.onDone?.(r.data)
          const msg = opts.success === false ? null : typeof opts.success === 'function' ? opts.success(r.data) : (opts.success ?? r.message ?? null)
          if (msg) toast.show(msg, { undo: opts.undo ? async () => void (await opts.undo!(r.data)) : undefined })
        } catch {
          toast.show('That did not save — check the connection and try again', { tone: 'error' })
        }
      }),
    [toast],
  )
  return { run, pending }
}
