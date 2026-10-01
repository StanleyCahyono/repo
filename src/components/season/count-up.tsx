'use client'
/** A number that counts up once when it scrolls into view (reduced motion: the final value at once). */
import { useEffect, useRef, useState } from 'react'
import { animate, useInView, useReducedMotion } from 'motion/react'

export function CountUp({ value, format = (n) => Math.round(n).toLocaleString('en-US'), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const reduce = useReducedMotion()
  // Server and first client render show the real value (no hydration mismatch, correct without JS); the count-up
  // starts from 0 once in view, while the card around it is still fading in.
  const [shown, setShown] = useState(value)
  const from = useRef(0)

  useEffect(() => {
    if (!inView) return
    // Reduced motion: jump straight to the value.
    const c = animate(reduce ? value : from.current, value, {
      duration: reduce ? 0 : Math.min(1.4, 0.5 + Math.log10(Math.abs(value) + 1) * 0.3),
      ease: [0.22, 0.8, 0.26, 1],
      onUpdate: setShown,
    })
    from.current = value
    return () => c.stop()
  }, [inView, value, reduce])

  return (
    <span ref={ref} className={className}>
      {/* Screen readers get the final value, not the animation. */}
      <span aria-hidden>{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  )
}
