'use client'
/**
 * Local draft for a settings form: current values, the last saved baseline, a dirty flag and field errors.
 *
 * When the saved value from the server changes (after this form saved, after Undo, or after another screen changed
 * the same preference) the baseline follows it; the visible values follow too unless there are unsaved edits.
 */
import { useCallback, useState } from 'react'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function useDraft<T extends object>(saved: T) {
  const [seen, setSeen] = useState(saved)
  const [baseline, setBaseline] = useState(saved)
  const [values, setValues] = useState(saved)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Adjust state while rendering when the server value changed (React's recommended pattern; no effect needed).
  if (!same(seen, saved)) {
    setSeen(saved)
    setBaseline(saved)
    if (same(values, baseline)) setValues(saved)
  }

  const set = useCallback((patch: Partial<T>, clear: string[] = Object.keys(patch)) => {
    setValues((v) => ({ ...v, ...patch }))
    if (clear.length) {
      setErrors((e) => {
        const keys = Object.keys(e).filter((k) => clear.some((c) => k === c || k.startsWith(`${c}.`)))
        if (!keys.length) return e
        const next = { ...e }
        for (const k of keys) delete next[k]
        return next
      })
    }
  }, [])

  /** Mark `v` as saved (after a successful save or undo). */
  const commit = useCallback((v: T) => {
    setBaseline(v)
    setValues(v)
    setErrors({})
  }, [])

  const discard = useCallback(() => {
    setValues(baseline)
    setErrors({})
  }, [baseline])

  return { values, baseline, dirty: !same(values, baseline), errors, setErrors, set, commit, discard }
}

/** First error for a field path (exact, or any nested key under it). */
export function errorFor(errors: Record<string, string>, key: string): string | undefined {
  if (errors[key]) return errors[key]
  const nested = Object.keys(errors).find((k) => k.startsWith(`${key}.`))
  return nested ? errors[nested] : undefined
}
