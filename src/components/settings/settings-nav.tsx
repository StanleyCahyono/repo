'use client'
/**
 * Section index for Settings and Sources & Sync. One <nav>: a sticky glass pill strip on phones and tablets, a
 * sticky vertical glass index beside the content from 1280px. The section in view gets the dark HUD chip, which
 * glides between items (shared layoutId; instant under reduced motion). Plain anchors, so it works without JavaScript.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { useScrollEdges } from '@/lib/ui/use-scroll-edges'

export interface NavSection {
  id: string
  label: string
  /** Shorter label for the horizontal strip. */
  short?: string
  /** Small count or state beside the label (e.g. "3 failing"). */
  badge?: string | null
  tone?: 'critical' | 'caution' | 'neutral'
}

export function SettingsNav({ sections, label, vertical = true }: { sections: NavSection[]; label: string; /** Vertical index from 1280px (else always a strip). */ vertical?: boolean }) {
  const [active, setActive] = useState(sections[0]?.id)
  const listRef = useRef<HTMLUListElement>(null)
  useScrollEdges(listRef)
  const reduce = useReducedMotion()

  useEffect(() => {
    let raf = 0
    const measure = () => {
      raf = 0
      const line = vertical && window.innerWidth >= 1280 ? 96 : window.innerWidth >= 768 ? 110 : 150
      let current = sections[0]?.id
      for (const s of sections) {
        const el = document.getElementById(s.id)
        if (el && el.getBoundingClientRect().top <= line) current = s.id
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = sections[sections.length - 1]?.id
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
  }, [sections, vertical])

  // Keep the active item visible inside the horizontal strip (never scrolls the page).
  useEffect(() => {
    const list = listRef.current
    if (!list || list.scrollWidth <= list.clientWidth) return
    const item = list.querySelector<HTMLElement>(`[data-nav="${active}"]`)
    if (!item) return
    // 40px margins keep the active tab clear of the edge fade (scroll-fade-x).
    const left = item.offsetLeft - 40
    const right = item.offsetLeft + item.offsetWidth + 40
    if (left < list.scrollLeft) list.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' })
    else if (right > list.scrollLeft + list.clientWidth) list.scrollTo({ left: right - list.clientWidth, behavior: reduce ? 'auto' : 'smooth' })
  }, [active, reduce])

  const go = useCallback(
    (id: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      const el = document.getElementById(id)
      if (!el) return
      e.preventDefault()
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
      history.replaceState(history.state, '', `#${id}`)
      setActive(id)
      const h = document.getElementById(`${id}-title`)
      if (h) {
        h.setAttribute('tabindex', '-1')
        h.focus({ preventScroll: true })
      }
    },
    [reduce],
  )

  return (
    <div
      className={cn(
        'sticky top-[64px] z-20 mb-6 md:top-3',
        vertical && 'xl:top-8 xl:mb-0 xl:self-start',
      )}
    >
      <nav aria-label={label} className={cn('glass rounded-full p-1', vertical && 'xl:rounded-[24px] xl:p-2')}>
        {vertical ? <p className="eyebrow mb-1 hidden px-3 pt-2 pb-1 xl:block">On this page</p> : null}
        <ul
          ref={listRef}
          className={cn(
            'scroll-fade-x flex h-11 items-stretch gap-0.5 overflow-x-auto rounded-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            vertical && 'xl:h-auto xl:flex-col xl:overflow-visible xl:rounded-none',
          )}
        >
          {sections.map((s) => {
            const on = s.id === active
            return (
              <li key={s.id} data-nav={s.id} className="relative flex shrink-0">
                <a
                  href={`#${s.id}`}
                  onClick={go(s.id)}
                  aria-current={on ? 'location' : undefined}
                  className={cn(
                    'relative flex w-full items-center gap-2 rounded-full px-3.5 text-[14px] font-medium whitespace-nowrap transition-colors duration-150',
                    vertical && 'xl:min-h-10 xl:rounded-[14px] xl:px-3',
                    on ? 'text-on-ink-chip' : 'text-ink-2 hover:bg-chip-hover hover:text-ink',
                  )}
                >
                  {on ? (
                    <motion.span
                      layoutId="settings-nav-active"
                      transition={t.select}
                      aria-hidden
                      className={cn('absolute inset-0 rounded-full bg-ink-chip shadow-[0_6px_16px_-8px_rgb(19_32_44/0.55)]', vertical && 'xl:rounded-[14px]')}
                    />
                  ) : null}
                  <span className={cn('relative', vertical ? 'xl:hidden' : 'lg:hidden')}>{s.short ?? s.label}</span>
                  <span className={cn('relative hidden', vertical ? 'xl:inline' : 'lg:inline')}>{s.label}</span>
                  {s.badge ? (
                    <span
                      className={cn(
                        'relative ml-auto rounded-full px-2 text-[12px] leading-5 font-medium tnum',
                        s.tone === 'critical' ? 'bg-critical-bg text-critical' : s.tone === 'caution' ? 'bg-caution-bg text-caution' : 'bg-surface-3 text-ink-2',
                      )}
                    >
                      {s.badge}
                    </span>
                  ) : null}
                </a>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
