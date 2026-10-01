'use client'
/**
 * The scroll story's chapter bar: a floating glass pill whose dark highlight slides to the chapter in view (a shared
 * layoutId spring; instant under reduced motion). The first chapter is the resort itself (the hero and overview).
 * It keeps the planning date one tap away and shows compact Save / Compare / Add to trip once the hero's own actions
 * have scrolled out of view. Chapters are plain anchors, so it works without JavaScript.
 *
 * Sticky below the phone header (top 56px) and near the top on desktop, where the app header scrolls away; the
 * wrapper ignores the pointer so only the pill itself covers content.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { motion, useReducedMotion } from 'motion/react'
import { CalendarDays, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { useScrollEdges } from '@/lib/ui/use-scroll-edges'
import { addDays, formatLocalDate } from '@/lib/domain/time'
import { SECTIONS, dayLabel, dayLabelYear, type SectionId } from './format'
import { ResortActions, type ResortActionsProps } from './resort-actions'

/** '15 Jan' — the compact planning-date label on phones. */
const shortDay = (date: string) => formatLocalDate(date, 'd LLL')

const PILL = { type: 'spring', stiffness: 380, damping: 32, mass: 0.9 } as const

export function SectionNav({ date, today, actions, name }: { date: string; today: string; actions: ResortActionsProps; name: string }) {
  const [active, setActive] = useState<SectionId>('overview')
  const [heroHidden, setHeroHidden] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const reduce = useReducedMotion()

  // Scrollspy: the last chapter whose top has passed a line a little below the bar.
  useEffect(() => {
    let raf = 0
    const measure = () => {
      raf = 0
      const line = Math.min(window.innerHeight * 0.4, window.innerWidth >= 768 ? 260 : 300)
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

  // Compact actions appear once the hero (and its actions) is out of view.
  useEffect(() => {
    const el = document.getElementById('overview')
    if (!el) return
    let raf = 0
    const check = () => {
      raf = 0
      setHeroHidden(el.getBoundingClientRect().top < 200)
    }
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(check)
    }
    check()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [])

  // Keep the active chapter visible inside the horizontally scrolling list (never scrolls the page).
  useEffect(() => {
    const list = listRef.current
    const item = list?.querySelector<HTMLElement>(`[data-tab="${active}"]`)
    if (!list || !item) return
    const left = item.offsetLeft - 40
    const right = item.offsetLeft + item.offsetWidth + 40
    if (left < list.scrollLeft) list.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' })
    else if (right > list.scrollLeft + list.clientWidth) list.scrollTo({ left: right - list.clientWidth, behavior: reduce ? 'auto' : 'smooth' })
  }, [active, reduce])

  useScrollEdges(listRef)

  const go = useCallback(
    (id: SectionId) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      const el = document.getElementById(id)
      if (!el) return
      e.preventDefault()
      // The resort chapter starts at the top of the page (the hero).
      if (id === 'overview') window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
      else el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
      history.replaceState(history.state, '', `#${id}`)
      setActive(id)
      const h = document.getElementById(id === 'overview' ? 'resort-title' : `${id}-title`)
      if (h) {
        h.setAttribute('tabindex', '-1')
        h.focus({ preventScroll: true })
      }
    },
    [reduce],
  )

  return (
    <div data-resort-nav className="pointer-events-none sticky top-14 z-20 -mx-4 -mt-4 flex justify-center px-2 pt-1.5 md:top-3 md:mx-0 md:mt-0 md:px-0 md:pt-0">
      {/* Once the story is under way, text scrolling up fades out beneath the bar instead of running into it. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-x-0 -top-1.5 h-[76px] bg-[linear-gradient(var(--canvas)_45%,transparent)] transition-opacity duration-300 md:-top-3 md:-mx-8 md:h-[92px] lg:-mx-12',
          '[mask-image:linear-gradient(to_right,transparent,#000_4%,#000_96%,transparent)]',
          heroHidden ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div className="glass-strong pointer-events-auto relative flex h-[52px] max-w-full min-w-0 items-center gap-1 rounded-full p-[5px]">
        <nav aria-label="Resort chapters" className="relative min-w-0 flex-1">
          <ul ref={listRef} className="scroll-fade-x flex h-[42px] items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SECTIONS.map((s) => {
              const on = s.id === active
              const label = s.id === 'overview' ? name : s.label
              const short = s.id === 'overview' ? name : s.short
              return (
                <li key={s.id} data-tab={s.id} className="relative flex shrink-0">
                  {on ? (
                    <motion.span layoutId="resort-chapter-pill" transition={reduce ? { duration: 0 } : PILL} aria-hidden className="absolute inset-0 rounded-full bg-ink-chip shadow-[0_6px_16px_rgb(19_32_44/0.25)]" />
                  ) : null}
                  <a
                    href={s.id === 'overview' ? '#top' : `#${s.id}`}
                    onClick={go(s.id)}
                    aria-current={on ? 'location' : undefined}
                    className={cn(
                      'relative flex items-center rounded-full px-3.5 text-[14px] font-medium whitespace-nowrap transition-colors duration-300 md:px-4',
                      on ? 'text-on-ink-chip' : 'text-ink-2 hover:text-ink',
                    )}
                  >
                    <span className="lg:hidden">{short}</span>
                    <span className="hidden lg:inline">{label}</span>
                  </a>
                </li>
              )
            })}
          </ul>
        </nav>
        <span aria-hidden className="mx-1 hidden h-6 w-px bg-divider-strong md:block" />
        <DateControl date={date} today={today} />
        <motion.div
          initial={false}
          animate={heroHidden ? { opacity: 1, width: 'auto' } : { opacity: 0, width: 0 }}
          transition={{ duration: reduce ? 0 : 0.22 }}
          className={cn('hidden overflow-hidden md:block', !heroHidden && 'pointer-events-none')}
          aria-hidden={!heroHidden}
          inert={!heroHidden}
        >
          <ResortActions variant="compact" className="pl-1" {...actions} />
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
        className="hidden size-9 items-center justify-center rounded-full text-ink-2 hover:bg-surface-3 hover:text-ink xl:inline-flex"
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
            'inline-flex h-[42px] items-center gap-1.5 rounded-full border px-3 text-[13.5px] font-medium whitespace-nowrap tnum transition-colors duration-150',
            date === today ? 'border-transparent bg-transparent text-ink hover:bg-surface-3' : 'border-teal/60 bg-glacier/60 text-teal',
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
        className="hidden size-9 items-center justify-center rounded-full text-ink-2 hover:bg-surface-3 hover:text-ink xl:inline-flex"
      >
        <ChevronRight aria-hidden className="size-4" />
      </button>
      {date !== today ? (
        <button type="button" onClick={() => setDate(today)} className="hidden h-9 rounded-full px-2 text-[13px] font-medium text-teal hover:underline xl:inline-flex xl:items-center">
          Today
        </button>
      ) : null}
    </div>
  )
}
