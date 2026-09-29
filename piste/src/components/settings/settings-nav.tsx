'use client'
/**
 * Section index for Settings and Sources & Sync. One <nav>: a sticky horizontal strip on phones and tablets, a
 * sticky vertical index beside the content from 1280px. Highlights the section in view (the marker glides with a
 * shared layoutId). Plain anchors, so it works without JavaScript.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'

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
    const left = item.offsetLeft - 16
    const right = item.offsetLeft + item.offsetWidth + 16
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
        'sticky top-14 z-20 -mx-4 mb-6 border-b border-divider bg-canvas md:top-0 md:-mx-8',
        vertical && 'xl:top-8 xl:mx-0 xl:mb-0 xl:self-start xl:border-b-0 xl:bg-transparent',
      )}
    >
      <nav aria-label={label}>
        {vertical ? <p className="eyebrow mb-2 hidden px-3 xl:block">On this page</p> : null}
        <ul
          ref={listRef}
          className={cn(
            'flex h-12 items-stretch gap-0.5 overflow-x-auto px-3 [scrollbar-width:none] md:h-14 md:px-6 [&::-webkit-scrollbar]:hidden',
            vertical && 'xl:h-auto xl:flex-col xl:overflow-visible xl:px-0',
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
                    'relative flex w-full items-center gap-2 rounded-md px-2.5 text-[14px] font-medium whitespace-nowrap transition-colors duration-150',
                    vertical && 'xl:min-h-9 xl:px-3',
                    on ? 'text-teal' : 'text-ink-2 hover:text-ink',
                  )}
                >
                  {on ? (
                    <motion.span
                      layoutId="settings-nav-active"
                      transition={t.select}
                      aria-hidden
                      className={cn(
                        'absolute inset-x-2 bottom-0 h-[3px] rounded-t-full bg-teal',
                        vertical && 'xl:inset-x-0 xl:inset-y-0 xl:h-auto xl:rounded-md xl:bg-glacier',
                      )}
                    />
                  ) : null}
                  <span className={cn('relative', vertical ? 'xl:hidden' : 'lg:hidden')}>{s.short ?? s.label}</span>
                  <span className={cn('relative hidden', vertical ? 'xl:inline' : 'lg:inline')}>{s.label}</span>
                  {s.badge ? (
                    <span
                      className={cn(
                        'relative ml-auto rounded-sm px-1.5 text-[12px] leading-5 font-medium tnum',
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
