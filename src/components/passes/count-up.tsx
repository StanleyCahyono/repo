'use client'
/**
 * A number that counts up to its value as it enters (and between values when it changes). Screen readers and
 * reduced motion get the final value straight away; the server renders the final value too.
 */
import { useEffect, useRef, useState } from 'react'
import { animate, useInView, useReducedMotion } from 'motion/react'
import { formatMoney, minorDigits, money } from '@/lib/domain/money'

export function CountUp({ value, format = (n) => String(Math.round(n)), duration = 0.9, className }: { value: number; format?: (n: number) => string; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -40px 0px' })
  const reduce = useReducedMotion()
  const from = useRef<number | null>(null)
  const [shown, setShown] = useState(value)

  useEffect(() => {
    if (!inView) return
    if (reduce) {
      from.current = value
      return
    }
    const start = from.current ?? 0
    from.current = value
    const c = animate(start, value, { duration, ease: [0.22, 0.8, 0.26, 1], onUpdate: setShown })
    return () => c.stop()
  }, [inView, value, reduce, duration])

  return (
    <span ref={ref} className={className}>
      <span aria-hidden>{format(reduce ? value : shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  )
}

/** Money that counts up (whole major units while counting, the exact formatted amount at rest). */
export function MoneyUp({ amountMinor, currency, className }: { amountMinor: number; currency: string; className?: string }) {
  const digits = minorDigits(currency)
  const exact = formatMoney(money(amountMinor, currency)) ?? ''
  const fmt = (n: number) => (Math.abs(n - amountMinor) < 0.5 ? exact : (formatMoney(money(Math.round(n / 10 ** digits) * 10 ** digits, currency)) ?? ''))
  return <CountUp value={amountMinor} format={fmt} className={className} />
}
