'use client'
/**
 * Offline / unreachable-server banner (brief §11: offline viewing of saved data with timestamps).
 *
 * - Shows when the browser reports no network (`navigator.onLine`), or when a client request to Piste's own server
 *   failed (`reportNetworkFailure()`, called by client code on a failed fetch/Server Function) — cleared again by
 *   the `online` event or `reportNetworkOk()`.
 * - Says what still works: everything already on screen stays readable, with the time it was loaded; pages are
 *   rendered from the local database, so on the machine running Piste they keep working without internet. Nothing is
 *   cached in the browser (no map tiles, no paid content), so a remote Piste needs its server to be reachable.
 *
 * Place it once per page (it is sticky at the top of the content), or once in the app shell.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { WifiOff, ServerOff } from 'lucide-react'
import { t } from '@/lib/ui/motion'
import { cn } from '@/lib/ui/cn'

const EVENT = 'piste:network'

/** Call when a request to Piste's server failed at the network level (not for HTTP errors). */
export function reportNetworkFailure() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: 'fail' }))
}

/** Call after a request to Piste's server succeeded. */
export function reportNetworkOk() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: 'ok' }))
}

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

const isLocalHost = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'

export function OfflineBanner({ className }: { className?: string }) {
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  )
  const [unreachable, setUnreachable] = useState(false)
  const [loadedAt, setLoadedAt] = useState<string | null>(null)
  const [local, setLocal] = useState(true)

  useEffect(() => {
    // Client-only facts, read once after mount (the server render never shows the banner).
    const id = window.setTimeout(() => {
      setLoadedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
      setLocal(isLocalHost(window.location.hostname))
    }, 0)
    const onNet = (e: Event) => setUnreachable((e as CustomEvent<string>).detail === 'fail')
    const onOnline = () => setUnreachable(false)
    window.addEventListener(EVENT, onNet)
    window.addEventListener('online', onOnline)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener(EVENT, onNet)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  const state: 'offline' | 'unreachable' | null = !online ? 'offline' : unreachable ? 'unreachable' : null
  const since = loadedAt ? ` (loaded at ${loadedAt})` : ''

  return (
    <AnimatePresence initial={false}>
      {state ? (
        <motion.div
          key={state}
          role="status"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={t.pageIn}
          className={cn('sticky top-16 z-20 mb-5 md:top-4', className)}
        >
          <div className="flex gap-3 rounded-[10px] border border-divider-strong bg-surface-3 px-4 py-3 text-[13.5px] text-ink shadow-lift">
            {state === 'offline' ? <WifiOff aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-2" /> : <ServerOff aria-hidden className="mt-0.5 size-4 shrink-0 text-critical" />}
            <div className="min-w-0">
              <p className="font-semibold">{state === 'offline' ? 'You’re offline' : 'Can’t reach Piste’s server'}</p>
              <p className="mt-0.5 text-ink-2">
                {state === 'offline'
                  ? local
                    ? `Piste reads your saved data from this computer, so pages still open. Forecasts, reports and exchange rates can’t refresh until you’re back online. What you see${since} keeps its timestamps.`
                    : `Everything on this page${since} stays readable with its timestamps. Other pages and saving need a connection to your Piste server.`
                  : `Your last change or refresh didn’t reach the server. What’s on screen${since} is unchanged — try again in a moment.`}
              </p>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
