/**
 * Entry of the single-file build (standalone/index.html). Boot order:
 * 1. interceptors (history/fetch/click translation) — before any app code runs;
 * 2. SQLite (WebAssembly) and the saved databases from IndexedDB; the live database is migrated and, on first run,
 *    seeded with the embedded catalog; demo mode generates its database once if needed;
 * 3. the first route is loaded, then React renders it; the in-page scheduler starts (live mode, online).
 */
import { Suspense, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { getMode, MODE_COOKIE } from '@/lib/context'
import { closeAll, exportBytes, flushAll, onSave, resetDatabase, SchemaMismatchError, sqlite } from './db/client'
import { requestPersistence, storageAvailable, storageProblem } from './db/storage'
import { saveBlob } from './runtime/api'
import { App, initialEntry, type Entry } from './runtime/app'
import { enterDemo } from './runtime/demo'
import { installInterceptors } from './runtime/interceptors'
import { ensureLiveReady } from './runtime/live'
import { notify, setMemoryOnly, setSaveError } from './runtime/notices'
import { currentAppUrl } from './runtime/router'
import { startScheduler, stopScheduler } from './runtime/scheduler'
import { becomeOwner, setOnLost } from './runtime/tab-owner'
import { BootScreen, DemoOverlay, FatalBoundary, FatalScreen, MovedScreen, Notices, RecoveryScreen, StorageBanner } from './runtime/ui'
import { cookieStore } from './shims/next-headers'

type BootState =
  | { stage: 'booting'; text: string }
  | { stage: 'ready'; entry: Entry }
  | { stage: 'recovery'; error: SchemaMismatchError }
  | { stage: 'fatal'; error: unknown }
  | { stage: 'moved'; saved: boolean }

let boot: BootState = { stage: 'booting', text: 'Opening your data…' }
const listeners = new Set<() => void>()
function setBoot(next: BootState) {
  boot = next
  for (const l of listeners) l()
}
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

declare const __pisteBundleStart: number | undefined
/**
 * Milliseconds since navigation start: `bundleStart` is when the script began to run (HTML and JS parsed),
 * `scriptStart` when this entry module runs (every bundled module initialised).
 */
const timings: Record<string, number> = {
  bundleStart: typeof __pisteBundleStart === 'number' ? Math.round(__pisteBundleStart) : -1,
  scriptStart: Math.round(performance.now()),
}
;(window as unknown as { __piste: unknown }).__piste = { timings, flush: () => flushAll() }
const mark = (name: string) => (timings[name] = Math.round(performance.now()))

async function downloadLive() {
  try {
    const bytes = await exportBytes('live')
    saveBlob(new Blob([bytes as BlobPart], { type: 'application/vnd.sqlite3' }), 'piste-data.db')
  } catch (e) {
    notify({ tone: 'error', text: `Download failed: ${e instanceof Error ? e.message : String(e)}` })
  }
}

function Root() {
  const b = useSyncExternalStore(subscribe, () => boot)
  let body
  if (b.stage === 'ready') {
    body = (
      <FatalBoundary onDownload={() => void downloadLive()}>
        <Suspense fallback={<BootScreen text="Loading…" />}>
          <App initial={b.entry} onFirstCommit={afterFirstRender} />
        </Suspense>
      </FatalBoundary>
    )
  } else if (b.stage === 'recovery') {
    body = (
      <RecoveryScreen
        detail={b.error.detail}
        bytes={b.error.savedBytes}
        onReset={() => {
          void resetDatabase(b.error.mode).then(() => location.reload())
        }}
      />
    )
  } else if (b.stage === 'fatal') body = <FatalScreen error={b.error} />
  else if (b.stage === 'moved') body = <MovedScreen saved={b.saved} />
  else body = <BootScreen text={b.text} />
  return (
    <>
      <StorageBanner />
      {body}
      <DemoOverlay />
      <Notices />
    </>
  )
}

function afterFirstRender() {
  mark('firstRender')
  document.documentElement.dataset.pisteReady = 'true'
  window.dispatchEvent(new CustomEvent('piste:ready', { detail: { ...timings } }))
  startScheduler()
}

function polyfills() {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string }
  if (c && typeof c.randomUUID !== 'function') {
    c.randomUUID = () => {
      const b = c.getRandomValues(new Uint8Array(16))
      b[6] = (b[6] & 0x0f) | 0x40
      b[8] = (b[8] & 0x3f) | 0x80
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`
    }
  }
}

async function start() {
  polyfills()
  installInterceptors()
  const container = document.getElementById('piste-root')!
  createRoot(container).render(<Root />)

  try {
    // Only one tab may hold the data (the newest takes over and the old one steps back, having saved).
    setOnLost(async (saveFirst) => {
      stopScheduler()
      if (saveFirst) await flushAll()
      setBoot({ stage: 'moved', saved: saveFirst })
      await closeAll()
    })
    await becomeOwner((text) => setBoot({ stage: 'booting', text }))
    await sqlite()
    mark('sqlite')
    if (!(await storageAvailable())) setMemoryOnly(storageProblem() ?? 'IndexedDB is unavailable')
    else void requestPersistence()
    onSave((e) => setSaveError(e.ok ? null : (e.error ?? 'unknown error')))

    setBoot({ stage: 'booting', text: 'Opening your data…' })
    const live = await ensureLiveReady()
    mark(live.seeded ? 'liveSeeded' : 'liveOpened')

    if ((await getMode()) === 'demo') {
      setBoot({ stage: 'booting', text: 'Opening the demo data…' })
      if (!(await enterDemo())) {
        cookieStore.delete(MODE_COOKIE)
        notify({ tone: 'error', text: 'The demo data could not be built, so Piste opened your live data instead.' }, 10_000)
      }
      mark('demoOpened')
    }

    const entry = initialEntry(currentAppUrl())
    await entry.promise.catch(() => undefined)
    mark('firstRoute')
    setBoot({ stage: 'ready', entry })
  } catch (e) {
    if (e instanceof SchemaMismatchError) {
      console.warn(e.message)
      setBoot({ stage: 'recovery', error: e })
    } else {
      console.error(e)
      setBoot({ stage: 'fatal', error: e })
    }
  }

  const save = () => void flushAll()
  window.addEventListener('pagehide', save)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save()
  })
}

void start()
