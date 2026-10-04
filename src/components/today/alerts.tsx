'use client'
/**
 * Unread in-app alerts (opening changes, pass deadlines, snow thresholds, deterioration, events …) with "Mark read"
 * per alert and for all, each undoable from the toast. Rows leave at once (optimistic) and the server re-renders the
 * list and the navigation badge. In-app only: nothing here promises a notification from a closed tab.
 */
import { useOptimistic, useTransition } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'motion/react'
import { BellOff, Check, CheckCheck } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { useToast } from '@/components/ui/toast'
import { markAlertsRead } from '@/lib/actions/today'
import { Block } from './section'

export interface AlertItem {
  id: number
  type: string
  title: string
  body: string
  link: string | null
  firedAt: string
  /** "3 h ago" (server clock). */
  age: string
}

const TYPE_LABEL: Record<string, string> = {
  'opening-date-change': 'Opening date',
  'resort-opened': 'Opened',
  'pass-deadline': 'Pass deadline',
  'snow-threshold': 'Snow watch',
  'forecast-deterioration': 'Forecast change',
  event: 'Event',
  'price-change': 'Price change',
}

export function UnreadAlerts({ alerts, demo }: { alerts: AlertItem[]; demo: boolean }) {
  const toast = useToast()
  const [, start] = useTransition()
  const [hidden, hide] = useOptimistic<number[], number[]>([], (state, ids) => [...state, ...ids])
  const shown = alerts.filter((a) => !hidden.includes(a.id))

  const mark = (ids: number[]) =>
    start(async () => {
      hide(ids)
      const res = await markAlertsRead({ ids, read: true })
      if (!res.ok) {
        toast.show(res.error, { tone: 'error' })
        return
      }
      const changed = res.data.ids
      toast.show(res.message ?? 'Marked read', {
        undo: changed.length
          ? async () => {
              const back = await markAlertsRead({ ids: changed, read: false })
              if (!back.ok) toast.show(back.error, { tone: 'error' })
            }
          : undefined,
      })
    })

  return (
    <div id="alerts" className="scroll-mt-20">
      <Block
        id="alerts-title"
        eyebrow={demo ? 'In-app · demo' : 'In-app'}
        title={
          <>
            Unread alerts <span className="tnum font-normal text-ink-3">· {shown.length}</span>
          </>
        }
        actions={
          shown.length > 1 ? (
            <button
              type="button"
              onClick={() => mark(shown.map((a) => a.id))}
              className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium text-teal transition-colors duration-150 hover:bg-chip-hover md:h-9"
            >
              <CheckCheck aria-hidden className="size-4" /> Mark all read
            </button>
          ) : null
        }
      >
        {shown.length ? (
          <ul className="divide-y divide-divider border-t border-divider">
            <AnimatePresence initial={false}>
              {shown.map((a) => (
                <motion.li
                  key={a.id}
                  layout
                  exit={{ opacity: 0, x: 12, transition: { duration: 0.16 } }}
                  transition={t.select}
                  className="flex items-start gap-3 py-3"
                >
                  <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-caution" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
                      {TYPE_LABEL[a.type] ?? a.type.replace(/-/g, ' ')} · <span className="tnum tracking-normal normal-case">{a.age}</span>
                    </p>
                    <p className="mt-0.5 text-[14px] font-semibold text-ink">
                      {a.link ? (
                        <Link href={a.link} className="hover:text-teal hover:underline">
                          {a.title}
                        </Link>
                      ) : (
                        a.title
                      )}
                    </p>
                    <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{a.body}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => mark([a.id])}
                    aria-label={`Mark read: ${a.title}`}
                    title="Mark read"
                    className={cn(
                      'glass-strong inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2 transition-[color,transform] duration-150 hover:-translate-y-px hover:text-teal md:size-9',
                    )}
                  >
                    <Check aria-hidden className="size-4" />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-[13.5px] text-ink-2">
            <BellOff aria-hidden className="size-4 text-ink-3" /> You’re up to date.{' '}
            <Link href="/settings" className="font-medium text-teal hover:underline">
              Alert rules
            </Link>
          </p>
        )}
      </Block>
    </div>
  )
}
