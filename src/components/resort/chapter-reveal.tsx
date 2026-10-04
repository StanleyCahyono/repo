'use client'
/**
 * Marks the resort chapters that start below the fold and reveals each one as it scrolls into view (CSS in
 * section.tsx). Runs only after hydration and never under reduced motion, so server-rendered content is never hidden
 * while the page loads; without IntersectionObserver nothing changes.
 */
import { useEffect } from 'react'
import { useReducedMotion } from 'motion/react'

export function ChapterReveal() {
  const reduce = useReducedMotion()
  useEffect(() => {
    if (reduce || typeof IntersectionObserver === 'undefined') return
    const els = [...document.querySelectorAll<HTMLElement>('[data-section]')].filter((el) => el.getBoundingClientRect().top > window.innerHeight * 0.92)
    if (!els.length) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          ;(e.target as HTMLElement).dataset.reveal = 'in'
          io.unobserve(e.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.02 },
    )
    for (const el of els) {
      el.dataset.reveal = 'wait'
      io.observe(el)
    }
    return () => {
      io.disconnect()
      for (const el of els) delete el.dataset.reveal
    }
  }, [reduce])
  return null
}
