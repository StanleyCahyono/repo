'use client'
/**
 * Lightweight toasts: brief confirmation with optional Undo and an optional in-app link (e.g. "Open trip").
 * Announced politely to screen readers (errors assertively). Glass HUD: a dark HUD chip that springs up from the
 * bottom, with a tone icon (check / alert / info) so colour is never the only cue.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Info, TriangleAlert, X } from 'lucide-react'
import { t as motionT } from '@/lib/ui/motion'

interface ToastItem {
  id: number
  message: string
  tone: 'success' | 'error' | 'info'
  undo?: () => void | Promise<void>
  /** Optional in-app link shown beside the message, e.g. { href: '/trips/abc', label: 'Open trip' }. */
  link?: { href: string; label: string }
}

interface ToastApi {
  show: (message: string, opts?: { tone?: ToastItem['tone']; undo?: ToastItem['undo']; link?: ToastItem['link']; durationMs?: number }) => void
}

const Ctx = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), [])

  const show = useCallback<ToastApi['show']>(
    (message, opts = {}) => {
      const id = ++seq.current
      setItems((xs) => [...xs.slice(-2), { id, message, tone: opts.tone ?? 'success', undo: opts.undo, link: opts.link }])
      window.setTimeout(() => dismiss(id), opts.durationMs ?? (opts.undo || opts.link ? 6000 : 3200))
    },
    [dismiss],
  )

  const api = useMemo(() => ({ show }), [show])

  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className={
          'pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-8 ' +
          // Stay clear of fixed bottom bars (the resort action bar on phones, the comparison tray) so a toast never
          // covers the buttons that were just used.
          'max-md:[body:has([data-mobile-actions],[data-bottom-bar])_&]:bottom-[calc(140px+env(safe-area-inset-bottom))] md:[body:has([data-bottom-bar])_&]:bottom-28'
        }
      >
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
              transition={motionT.spring}
              role={item.tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex min-h-12 max-w-[min(92vw,480px)] items-center gap-3 rounded-[22px] bg-ink-chip py-2 pr-2 pl-3 text-[14px] text-on-ink-chip shadow-[var(--glass-shadow-lg)]"
            >
              <motion.span
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ ...motionT.favorite, delay: 0.05 }}
                aria-hidden
                className={
                  'inline-flex size-6 shrink-0 items-center justify-center rounded-full ' +
                  (item.tone === 'success' ? 'bg-positive text-surface' : item.tone === 'error' ? 'bg-critical text-surface' : 'bg-on-ink-chip-2/25 text-on-ink-chip')
                }
              >
                {item.tone === 'success' ? (
                  <Check className="size-3.5" strokeWidth={3} />
                ) : item.tone === 'error' ? (
                  <TriangleAlert className="size-3.5" strokeWidth={2.4} />
                ) : (
                  <Info className="size-3.5" strokeWidth={2.4} />
                )}
              </motion.span>
              <span className="min-w-0 flex-1 py-1 leading-snug break-words">{item.message}</span>
              {item.link ? (
                <Link
                  href={item.link.href}
                  onClick={() => dismiss(item.id)}
                  className="inline-flex min-h-9 shrink-0 items-center rounded-full px-3 font-semibold whitespace-nowrap text-on-ink-chip-accent underline underline-offset-2 hover:no-underline"
                >
                  {item.link.label}
                </Link>
              ) : null}
              {item.undo ? (
                <button
                  type="button"
                  className="inline-flex min-h-9 shrink-0 items-center rounded-full bg-on-ink-chip/10 px-3 font-semibold text-on-ink-chip-accent hover:bg-on-ink-chip/20"
                  onClick={async () => {
                    dismiss(item.id)
                    await item.undo?.()
                  }}
                >
                  Undo
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Dismiss"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-on-ink-chip-2 transition-colors hover:bg-on-ink-chip/10 hover:text-on-ink-chip"
                onClick={() => dismiss(item.id)}
              >
                <X aria-hidden className="size-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  )
}
