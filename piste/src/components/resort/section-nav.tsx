'use client'
/**
 * Sticky, anchored section bar for the resort page. Highlights the section in view (the highlight glides with a
 * shared layoutId), keeps the planning date one tap away, and shows compact Save / Compare / Add to trip once the
 * header's own actions have scrolled out of view. Sections are plain anchors, so it works without JavaScript.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { motion, useReducedMotion } from 'motion/react'
import { CalendarDays, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { useScrollEdges } from '@/lib/ui/use-scroll-edges'
import { addDays, formatLocalDate } from '@/lib/domain/time'
import { SECTIONS, dayLabel, dayLabelYear, type SectionId } from './format'
import { ResortActions, type ResortActionsProps } from './resort-actions'

/** '15 Jan' — the compact planning-date label on phones. */
const shortDay = (date: string) => formatLocalDate(date, 'd LLL')

export function SectionNav({ date, today, actions }: { date: string; today: string; actions: ResortActionsProps }) {
  const [active, setActive] = useState<SectionId>('overview')
  const [headerHidden, setHeaderHidden] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const reduce = useReducedMotion()

  // Scrollspy: the last section whose top has passed a line just below the sticky bars.
  useEffect(() => {
    let raf = 0
    const measure = () => {
      raf = 0
      const line = window.innerWidth >= 768 ? 120 : 150
      let current: SectionId = SECTIONS[0].id
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id)
        if (el && el.getBoundingClientRect().top <= line) current = s.id
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = SECTIONS[SECTIONS.length - 1].id
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
  }, [])

  // Compact actions appear once the header's actions are out of view.
  useEffect(() => {
    const el = document.getElementById('resort-header-actions')
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setHeaderHidden(!e.isIntersecting), { rootMargin: '-64px 0px 0px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Keep the active tab visible inside the horizontally scrolling list (never scrolls the page).
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

  useScrollEdges(listRef)
  const page = (dir: 1 | -1) => {
    const list = listRef.current
    if (list) list.scrollBy({ left: dir * Math.max(120, list.clientWidth * 0.7), behavior: reduce ? 'auto' : 'smooth' })
  }

  const go = useCallback(
    (id: SectionId) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      const el = document.getElementById(id)
      if (!el) return
      e.preventDefault()
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
      history.replaceState(history.state, '', `#${id}`)
      setActive(id)
      // Move focus to the section heading for keyboard and screen-reader users (without a second scroll).
      const h = document.getElementById(`${id}-title`)
      if (h) {
        h.setAttribute('tabindex', '-1')
        h.focus({ preventScroll: true })
      }
    },
    [reduce],
  )

  return (
    <div data-resort-nav className="sticky top-14 z-20 -mx-4 border-b border-divider bg-canvas md:top-0 md:-mx-8">
      <div className="flex h-12 items-center gap-2 px-4 md:h-14 md:gap-4 md:px-8">
        <nav aria-label="Resort sections" className="relative min-w-0 flex-1">
          <ul
            ref={listRef}
            className="peer scroll-fade-x flex h-12 items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none] md:h-14 [&::-webkit-scrollbar]:hidden"
          >
            {SECTIONS.map((s) => {
              const on = s.id === active
              return (
                <li key={s.id} data-tab={s.id} className="relative flex shrink-0">
                  <a
                    href={`#${s.id}`}
                    onClick={go(s.id)}
                    aria-current={on ? 'location' : undefined}
                    className={cn(
                      'relative flex items-center rounded-md px-2.5 text-[14px] font-medium whitespace-nowrap transition-colors duration-150 md:px-3',
                      on ? 'text-teal' : 'text-ink-2 hover:text-ink',
                    )}
                  >
                    <span className="lg:hidden">{s.short}</span>
                    <span className="hidden lg:inline">{s.label}</span>
                  </a>
                  {on ? <motion.span layoutId="resort-section-active" transition={t.select} aria-hidden className="absolute inset-x-2 bottom-0 h-[3px] rounded-t-full bg-teal" /> : null}
                </li>
              )
            })}
          </ul>
          {/* Pointer hint for tabs past the edge (keyboard users reach every tab with Tab; phones swipe). */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => page(-1)}
            className="absolute inset-y-0 left-0 my-auto hidden size-8 items-center justify-center rounded-full border border-divider bg-surface text-ink-2 transition-colors duration-150 hover:border-teal hover:text-teal md:peer-data-[more-start]:inline-flex"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => page(1)}
            className="absolute inset-y-0 right-0 my-auto hidden size-8 items-center justify-center rounded-full border border-divider bg-surface text-ink-2 transition-colors duration-150 hover:border-teal hover:text-teal md:peer-data-[more-end]:inline-flex"
          >
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </nav>
        <DateControl date={date} today={today} />
        <motion.div
          initial={false}
          animate={headerHidden ? { opacity: 1, x: 0 } : { opacity: 0, x: 6 }}
          transition={t.hover}
          className={cn('hidden md:block', !headerHidden && 'pointer-events-none')}
          aria-hidden={!headerHidden}
          inert={!headerHidden}
        >
          <ResortActions variant="compact" {...actions} />
        </motion.div>
      </div>
    </div>
  )
}

/** Planning date for every date-specific fact on the page (status, score, weather, access, hours, basket). URL state. */
export function DateControl({ date, today, className }: { date: string; today: string; className?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, start] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const setDate = (d: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return
    const next = new URLSearchParams(params.toString())
    if (d === today) next.delete('date')
    else next.set('date', d)
    const qs = next.toString()
    start(() => router.push(`${pathname}${qs ? `?${qs}` : ''}${window.location.hash}`, { scroll: false }))
  }

  return (
    <div className={cn('flex shrink-0 items-center gap-1', className)} role="group" aria-label="Planning date">
      <button
        type="button"
        onClick={() => setDate(addDays(date, -1))}
        aria-label={`Previous day (${dayLabel(addDays(date, -1))})`}
        className="hidden size-9 items-center justify-center rounded-md text-ink-2 hover:bg-surface-3 hover:text-ink lg:inline-flex"
      >
        <ChevronLeft aria-hidden className="size-4" />
      </button>
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            const el = inputRef.current
            if (!el) return
            try {
              el.showPicker()
            } catch {
              el.focus()
            }
          }}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-md border px-2.5 text-[13.5px] font-medium tnum transition-colors duration-150 md:h-9',
            date === today ? 'border-divider-strong bg-surface text-ink' : 'border-teal/60 bg-glacier/60 text-teal',
          )}
          aria-label={`Planning date: ${dayLabelYear(date)}${date === today ? ' (today)' : ''}. Change date`}
        >
          {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <CalendarDays aria-hidden className="size-4" />}
          <span className="sm:hidden">{date === today ? 'Today' : shortDay(date)}</span>
          <span className="hidden sm:inline">{date === today ? `Today · ${dayLabel(date)}` : dayLabel(date)}</span>
        </button>
        <input
          ref={inputRef}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        />
      </div>
      <button
        type="button"
        onClick={() => setDate(addDays(date, 1))}
        aria-label={`Next day (${dayLabel(addDays(date, 1))})`}
        className="hidden size-9 items-center justify-center rounded-md text-ink-2 hover:bg-surface-3 hover:text-ink lg:inline-flex"
      >
        <ChevronRight aria-hidden className="size-4" />
      </button>
      {date !== today ? (
        <button type="button" onClick={() => setDate(today)} className="hidden h-9 rounded-md px-2 text-[13px] font-medium text-teal hover:underline lg:inline-flex lg:items-center">
          Today
        </button>
      ) : null}
    </div>
  )
}
