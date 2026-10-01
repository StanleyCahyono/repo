'use client'
/**
 * Sticky comparison tray: the 2–4 resorts picked with the cards' Compare toggles (persisted in localStorage by
 * useCompareSelection, so it survives visiting a resort and coming back). It floats above the content — above the
 * bottom navigation on phones — and links to /explore/compare with the current scenario (date, mode, product), so
 * every column is compared on identical terms.
 */
import Link from 'next/link'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Columns3, X } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { useToast } from '@/components/ui/toast'
import { ScrollRow } from '@/components/ui/scroll-row'
import { COMPARE_MAX, COMPARE_MIN, useCompareSelection } from '@/components/resort/card-compare'
import { compareHref } from './explore-tabs'

export function CompareTray({ scenario }: { scenario: { date: string; mode: string; product?: string | null } }) {
  const compare = useCompareSelection()
  const toast = useToast()
  const entries = compare.entries
  const n = entries.length
  const ready = n >= COMPARE_MIN
  const params = new URLSearchParams({ date: scenario.date, mode: scenario.mode, ...(scenario.product ? { product: scenario.product } : {}) })
  const href = compareHref(compare.ids, params)

  return (
    <AnimatePresence>
      {n ? (
        <motion.div
          key="tray"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0, transition: t.sheet }}
          exit={{ opacity: 0, y: 12, transition: { duration: 0.16 } }}
          className="pointer-events-none fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 md:bottom-0 md:pl-[76px] xl:pl-[232px]"
        >
          <div className="mx-auto max-w-[1320px] px-3 pb-2 md:px-8 md:pb-4">
            <section
              data-bottom-bar
              aria-label="Comparison tray"
              className="pointer-events-auto flex items-center gap-2 rounded-[14px] border border-divider-strong bg-surface py-2 pr-2 pl-3 shadow-overlay md:gap-3 md:pl-4"
            >
              <p className="flex shrink-0 items-center gap-2 text-[13.5px] font-semibold text-ink">
                <Columns3 aria-hidden className="size-4 text-teal" />
                <span className="hidden sm:inline">Compare</span>
                <span className="tnum font-medium text-ink-3">
                  {n}/{COMPARE_MAX}
                  <span className="sr-only"> resorts selected</span>
                </span>
              </p>
              <ScrollRow as="ul" className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 scrollbar-thin">
                {entries.map((e) => (
                  <li key={e.id} className="shrink-0">
                    <span className="inline-flex h-11 items-center gap-1 rounded-full border border-teal/40 bg-glacier/60 pr-1 pl-3 text-[13px] font-medium text-ink md:h-9">
                      <span className="max-w-[9.5rem] truncate">{e.name}</span>
                      <button
                        type="button"
                        onClick={() => compare.remove(e.id)}
                        aria-label={`Remove ${e.name} from comparison`}
                        className="inline-flex size-9 items-center justify-center rounded-full text-ink-2 hover:bg-surface hover:text-ink md:size-7"
                      >
                        <X aria-hidden className="size-3.5" />
                      </button>
                    </span>
                  </li>
                ))}
                {Array.from({ length: COMPARE_MAX - n }, (_, i) => (
                  <li key={`slot-${i}`} aria-hidden className="hidden shrink-0 lg:block">
                    <span className="inline-flex h-9 items-center rounded-full border border-dashed border-divider-strong px-3 text-[12.5px] text-ink-3">
                      {i === 0 && !ready ? 'Add one more' : 'Empty slot'}
                    </span>
                  </li>
                ))}
              </ScrollRow>
              <button
                type="button"
                onClick={() => {
                  const before = entries
                  compare.clear()
                  toast.show('Comparison cleared', { tone: 'info', undo: () => compare.set(before) })
                }}
                className="hidden h-10 shrink-0 items-center rounded-md px-2.5 text-[13.5px] font-medium text-ink-2 hover:bg-surface-3 hover:text-ink md:inline-flex"
              >
                Clear
              </button>
              {ready ? (
                <Link
                  href={href}
                  className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-teal bg-teal px-3.5 text-[14px] font-medium text-on-teal transition-colors duration-150 hover:border-teal-strong hover:bg-teal-strong md:h-10"
                >
                  Compare
                  <span className="sr-only"> {n} resorts</span>
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
              ) : (
                <span
                  className={cn('inline-flex h-11 shrink-0 items-center rounded-md border border-divider px-3 text-[13px] font-medium text-ink-3 md:h-10')}
                  title="Pick at least two resorts to compare"
                >
                  Pick 1 more
                </span>
              )}
            </section>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
