'use client'
/**
 * A number that counts up the first time it scrolls into view ("numbers that count up as they enter"). The server
 * renders the final text, so it is correct without JavaScript and for screen readers (the live text is aria-hidden
 * while it runs). Under reduced motion it never animates. Only the leading number of `text` moves: "2,100 ft",
 * "CHF 89" and "8,225/h" keep their prefix and unit; text without a number is rendered as is.
 */
import { useEffect, useRef } from 'react'
import { animate, useInView, useReducedMotion } from 'motion/react'

const NUM = /^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/s

export function CountUp({ text, className, duration = 1.1, delay = 0 }: { text: string; className?: string; duration?: number; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -12% 0px' })
  const reduce = useReducedMotion()
  const m = NUM.exec(text)

  useEffect(() => {
    const el = ref.current
    if (!el || !m || !inView || reduce) return
    const [, pre, num, post] = m
    const target = Number(num.replace(/,/g, ''))
    if (!Number.isFinite(target) || target === 0) return
    const decimals = num.includes('.') ? num.split('.')[1].length : 0
    const grouped = num.includes(',')
    const fmt = (n: number) => {
      const fixed = n.toFixed(decimals)
      return grouped ? Number(fixed).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : fixed
    }
    const controls = animate(0, target, {
      duration,
      delay,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (n) => {
        el.textContent = `${pre}${fmt(n)}${post}`
      },
      onComplete: () => {
        el.textContent = text
      },
    })
    return () => {
      controls.stop()
      el.textContent = text
    }
    // Run once per text when it enters the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduce, text])

  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  )
}
