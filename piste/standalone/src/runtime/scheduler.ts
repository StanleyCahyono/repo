/**
 * The refresh scheduler, in the page. The Next app runs `npm run worker` next to the server; a single file has no
 * server, so while this page is open, online and in live mode it runs the same scheduler tick (src/lib/jobs/schedule.ts)
 * once a minute: weather, NWS alerts, FX, status, assessments, alerts, prune — each on its own cadence, with the same
 * bookkeeping (a failed refresh never advances "last successful update"). Nothing runs while the page is closed, and
 * Sources & Sync says so. Connectors a browser cannot use (official report pages, the link checker, Duffel) are
 * disabled in this build.
 */
import { nowFor } from '@/lib/clock'
import { MODE_COOKIE } from '@/lib/context'
import { defaultDeps } from '@/lib/jobs/deps'
import { reapInterruptedScheduledRuns } from '@/lib/jobs/runner'
import { cadencesFromEnv, newTickState, tick } from '@/lib/jobs/schedule'
import { setMeta } from '@/lib/jobs/util'
import { getDb } from '../db/client'
import { cookieStore } from '../shims/next-headers'

let timer: ReturnType<typeof setTimeout> | null = null
let busy = false
let started = false
const state = newTickState()
const cadences = cadencesFromEnv()
const clock = () => nowFor('live')

const live = () => cookieStore.get(MODE_COOKIE)?.value !== 'demo'

async function once() {
  if (stopped || busy || !live() || !navigator.onLine) return
  busy = true
  try {
    const db = await getDb('live')
    if (!started) {
      started = true
      await reapInterruptedScheduledRuns(db, clock())
      await setMeta(db, 'scheduler.startedAt', clock(), clock())
      await setMeta(db, 'scheduler.cadences', JSON.stringify(cadences), clock())
    }
    await tick({ db, deps: defaultDeps(), cadences, clock, state, log: (line) => console.debug(`[piste scheduler] ${line}`) })
  } catch (e) {
    console.warn('[piste scheduler] tick failed', e)
  } finally {
    busy = false
  }
}

let stopped = false

function loop() {
  if (stopped) return
  timer = setTimeout(async () => {
    await once()
    loop()
  }, cadences.tickSeconds * 1000)
}

/** This tab no longer owns the data (another tab took over). */
export function stopScheduler() {
  stopped = true
  if (timer) clearTimeout(timer)
}

export function startScheduler(delayMs = 2000) {
  if (timer) return
  timer = setTimeout(async () => {
    await once()
    loop()
  }, delayMs)
  window.addEventListener('online', () => void once())
}

export function onModeChange(mode: 'live' | 'demo') {
  if (mode === 'live' && timer) void once()
}
