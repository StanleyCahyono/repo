'use client'
/**
 * Lightweight toasts: brief confirmation with optional Undo and an optional in-app link (e.g. "Open trip").
 * Announced politely to screen readers.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'motion/react'
import { Check, X } from 'lucide-react'
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
        className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, transition: { duration: 0.15 } }}
              transition={motionT.select}
              role={item.tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex min-h-11 max-w-[min(92vw,460px)] items-center gap-3 rounded-[12px] border border-divider bg-ink px-4 py-2 text-[14px] text-canvas shadow-overlay"
            >
              {item.tone === 'success' ? (
                <motion.span
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ ...motionT.favorite, delay: 0.05 }}
                  className="inline-flex size-5 items-center justify-center rounded-full bg-positive text-surface"
                >
                  <Check aria-hidden className="size-3.5" strokeWidth={3} />
                </motion.span>
              ) : null}
              <span className="min-w-0 flex-1">{item.message}</span>
              {item.link ? (
                <Link
                  href={item.link.href}
                  onClick={() => dismiss(item.id)}
                  className="rounded-sm px-2 py-1 font-semibold whitespace-nowrap text-glacier underline underline-offset-2 hover:no-underline"
                >
                  {item.link.label}
                </Link>
              ) : null}
              {item.undo ? (
                <button
                  type="button"
                  className="rounded-sm px-2 py-1 font-semibold text-glacier underline-offset-2 hover:underline"
                  onClick={async () => {
                    dismiss(item.id)
                    await item.undo?.()
                  }}
                >
                  Undo
                </button>
              ) : null}
              <button type="button" aria-label="Dismiss" className="-mr-1 rounded-sm p-1 opacity-70 hover:opacity-100" onClick={() => dismiss(item.id)}>
                <X aria-hidden className="size-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  )
}
