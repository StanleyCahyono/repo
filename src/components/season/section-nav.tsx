'use client'
/**
 * Sticky, anchored section bar for My Season. Highlights the section in view (the highlight glides with a shared
 * layoutId) and keeps the active tab visible on narrow screens. Plain anchors, so it works without JavaScript.
 */
import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { useScrollEdges } from '@/lib/ui/use-scroll-edges'

export interface NavSection {
  id: string
  label: string
  count?: number | null
}

export function SeasonSectionNav({ sections }: { sections: NavSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? '')
  const listRef = useRef<HTMLUListElement>(null)
  useScrollEdges(listRef)
  const reduce = useReducedMotion()

  useEffect(() => {
    let raf = 0
    const measure = () => {
      raf = 0
      const line = window.innerWidth >= 768 ? 110 : 140
      let current = sections[0]?.id ?? ''
      for (const s of sections) {
        const el = document.getElementById(s.id)
        if (el && el.getBoundingClientRect().top <= line) current = s.id
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = sections[sections.length - 1]?.id ?? current
      setActive(current)
    }
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [sections])

  useEffect(() => {
    const list = listRef.current
    const item = list?.querySelector<HTMLElement>(`[data-tab="${active}"]`)
    if (!list || !item) return
    // 40px margins keep the active tab clear of the edge fade (scroll-fade-x).
    const left = item.offsetLeft - 40
    const right = item.offsetLeft + item.offsetWidth + 40
    if (left < list.scrollLeft) list.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' })
    else if (right > list.scrollLeft + list.clientWidth) list.scrollTo({ left: right - list.clientWidth, behavior: reduce ? 'auto' : 'smooth' })
  }, [active, reduce])

  return (
    <nav aria-label="My Season sections" className="sticky top-16 z-20 mb-8 min-w-0 md:top-3">
      <ul ref={listRef} className="glass scroll-fade-x scrollbar-thin flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-full p-[5px] [contain:inline-size] md:[contain:none]">
        {sections.map((s) => {
          const on = s.id === active
          return (
            <li key={s.id} data-tab={s.id} className="relative shrink-0">
              <a
                href={`#${s.id}`}
                aria-current={on ? 'true' : undefined}
                onClick={(e) => {
                  const el = document.getElementById(s.id)
                  if (!el) return
                  e.preventDefault()
                  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
                  history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}#${s.id}`)
                  setActive(s.id)
                  document.getElementById(`${s.id}-title`)?.focus({ preventScroll: true })
                }}
                className={cn('relative flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-medium whitespace-nowrap transition-colors duration-150', on ? 'text-on-ink-chip' : 'text-ink-2 hover:text-ink')}
              >
                {on ? <motion.span layoutId="season-nav-active" transition={t.select} aria-hidden className="absolute inset-0 rounded-full bg-ink-chip" /> : null}
                <span className="relative">{s.label}</span>
                {typeof s.count === 'number' && s.count > 0 ? <span className={cn('relative text-[12px] tnum', on ? 'text-on-ink-chip-2' : 'text-ink-3')}>{s.count}</span> : null}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
