'use client'
/**
 * A number that counts to its value (from the previous value, or from 0 on first view). Text is the real value for
 * assistive tech and before hydration; the animation only touches the visible digits. Off under reduced motion.
 */
import { useEffect, useRef } from 'react'
import { animate, useInView, useReducedMotion } from 'motion/react'

export function CountUp({ value, duration = 0.9, className, format = (n) => String(Math.round(n)) }: { value: number; duration?: number; className?: string; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const from = useRef<number | null>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' })
  const reduced = useReducedMotion()
  useEffect(() => {
    const el = ref.current
    if (!el || !inView) return
    const start = from.current ?? 0
    from.current = value
    if (reduced || start === value) {
      el.textContent = format(value)
      return
    }
    const c = animate(start, value, {
      duration,
      ease: [0.22, 0.8, 0.26, 1],
      onUpdate: (v) => {
        el.textContent = format(v)
      },
    })
    return () => c.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, inView, reduced])
  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  )
}
