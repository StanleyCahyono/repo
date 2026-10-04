'use client'
/**
 * Scroll-triggered entrance that never hides server-rendered content: everything renders in its final state on the
 * server and on the first client paint. After hydration, a block that is still below the fold is "armed" (its marks
 * hidden), then plays its entrance once it scrolls into view. A block already in view on mount just stays as it is,
 * so nothing blinks; reduced motion never arms.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useInView, useReducedMotion } from 'motion/react'

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export type RevealPhase = 'shown' | 'armed'

export function useReveal<T extends HTMLElement>(margin = '-60px'): [React.RefObject<T | null>, RevealPhase] {
  const ref = useRef<T>(null)
  const reduce = useReducedMotion()
  const [armed, setArmed] = useState(false)
  const inView = useInView(ref, { once: true, margin: margin as `${number}px` })

  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el || reduce) return
    if (el.getBoundingClientRect().top > window.innerHeight) setArmed(true)
  }, [])

  return [ref, armed && !inView ? 'armed' : 'shown']
}
