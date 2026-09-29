'use client'
/**
 * Horizontal rows that scroll (section tabs, chip rows): marks the element with `data-more-start` / `data-more-end`
 * while content is hidden past that edge, so the `scroll-fade-x` utility (globals.css) fades exactly those edges —
 * a fade says "more this way", and nothing fades when everything fits. Attributes are written directly (no
 * re-render); without JavaScript the row simply scrolls.
 */
import { useEffect, type RefObject } from 'react'

export function useScrollEdges(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const update = () => {
      raf = 0
      const max = el.scrollWidth - el.clientWidth
      el.toggleAttribute('data-more-start', el.scrollLeft > 1)
      el.toggleAttribute('data-more-end', max - el.scrollLeft > 1)
    }
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(update)
    }
    update()
    el.addEventListener('scroll', schedule, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    ro?.observe(el)
    for (const child of Array.from(el.children)) ro?.observe(child)
    return () => {
      el.removeEventListener('scroll', schedule)
      ro?.disconnect()
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [ref])
}
