'use client'
/**
 * Sticky, anchored section bar for My Season. Highlights the section in view (the highlight glides with a shared
 * layoutId) and keeps the active tab visible on narrow screens. Plain anchors, so it works without JavaScript.
 */
import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'

export interface NavSection {
  id: string
  label: string
  count?: number | null
}

export function SeasonSectionNav({ sections }: { sections: NavSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? '')
  const listRef = useRef<HTMLUListElement>(null)
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
    const left = item.offsetLeft - 16
    const right = item.offsetLeft + item.offsetWidth + 16
    if (left < list.scrollLeft) list.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' })
    else if (right > list.scrollLeft + list.clientWidth) list.scrollTo({ left: right - list.clientWidth, behavior: reduce ? 'auto' : 'smooth' })
  }, [active, reduce])

  return (
    <nav aria-label="My Season sections" className="sticky top-14 z-20 -mx-4 mb-8 border-b border-divider bg-canvas/95 px-4 backdrop-blur-sm md:top-0 md:-mx-8 md:px-8">
      <ul ref={listRef} className="scrollbar-thin flex gap-1 overflow-x-auto py-2 max-lg:pr-6 max-lg:[mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)]">
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
                className={cn('relative flex h-10 items-center gap-1.5 rounded-[8px] px-3 text-[13.5px] font-medium whitespace-nowrap transition-colors duration-150', on ? 'text-teal' : 'text-ink-2 hover:text-ink')}
              >
                {on ? <motion.span layoutId="season-nav-active" transition={t.select} aria-hidden className="absolute inset-0 rounded-[8px] bg-glacier" /> : null}
                <span className="relative">{s.label}</span>
                {typeof s.count === 'number' && s.count > 0 ? <span className="relative text-[12px] text-ink-3 tnum">{s.count}</span> : null}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
