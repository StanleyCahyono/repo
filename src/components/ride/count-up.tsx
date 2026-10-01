'use client'
/** A number that counts up to its value once (≈0.9s, ease-out) whenever `runKey` changes. Instant under reduced motion. */
import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'

export function CountUp({ value, format, runKey, delay = 0 }: { value: number; format: (n: number) => string; runKey: string; delay?: number }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(value)
  useEffect(() => {
    if (reduce) return
    let raf = 0
    const t0 = performance.now() + delay
    const dur = 900
    const step = (now: number) => {
      const f = Math.max(0, Math.min(1, (now - t0) / dur))
      const e = 1 - (1 - f) ** 3
      setShown(value * e)
      if (f < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, runKey, reduce, delay])
  return (
    <>
      <span aria-hidden>{format(reduce ? value : shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  )
}
