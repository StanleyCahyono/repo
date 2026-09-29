'use client'
import { useCallback, useRef, useState } from 'react'

/**
 * Measure an element's content width with a ResizeObserver. Returns `null` until measured (first client paint), so
 * charts can render an empty frame of the right height on the server and during hydration — no layout jump.
 */
export function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number | null] {
  const [width, setWidth] = useState<number | null>(null)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    const measure = (w: number) => setWidth((prev) => (prev !== null && Math.abs(prev - w) < 0.5 ? prev : Math.round(w)))
    measure(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (typeof w === 'number') measure(w)
    })
    observer.current.observe(el)
  }, [])
  return [ref, width]
}
