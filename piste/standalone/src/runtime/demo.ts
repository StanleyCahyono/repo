/**
 * Demo mode in the single-file build. The demo database is far too large to embed (~50 MB), so the first switch to
 * demo mode runs the real generator (src/lib/demo/generate.ts) in this page, with a progress screen, and saves the
 * result in IndexedDB. It lives in its own database: nothing is ever written to the live one.
 */
import { getMeta } from '@/lib/catalog/seed'
import { generateDemoData } from '@/lib/demo/generate'
import { META_GENERATED } from '@/lib/demo/scenario'
import { getClient, getDb, hasSavedData, holdSaves, isOpen, resetDatabase, SchemaMismatchError } from '../db/client'
import { setDemoProgress } from './notices'

/** Rough sizes of the generated data (from a reference run) — used only to move the progress bar. */
const EXPECTED_WEATHER_POINTS = 178_656
const EXPECTED_ASSESSMENTS = 5_172

export async function demoReady(): Promise<boolean> {
  try {
    const db = await getDb('demo')
    return Boolean(await getMeta(db, META_GENERATED))
  } catch (e) {
    if (e instanceof SchemaMismatchError) {
      // Demo data from an older build of this file: it is simulated, so it is simply regenerated.
      await resetDatabase('demo')
      return false
    }
    throw e
  }
}

/** Is there generated demo data, without loading it when it is not open yet? (Only complete data is ever saved.) */
export async function hasDemoData(): Promise<boolean> {
  if (isOpen('demo')) return demoReady()
  return hasSavedData('demo')
}

let running: Promise<boolean> | null = null

/** Make sure the demo database exists (generating it once). Resolves false if generation failed. */
export function enterDemo(): Promise<boolean> {
  running ??= (async () => {
    try {
      if (await demoReady()) return true
      await generate()
      return true
    } catch (e) {
      console.error(e)
      setDemoProgress({ phase: 'The demo data could not be built', fraction: 0, startedAt: performance.now(), error: e instanceof Error ? e.message : String(e) })
      return false
    } finally {
      running = null
    }
  })()
  return running
}

export let lastDemoGenerationMs: number | null = null

/** Share of the bar per phase, from a reference run (weather ~35 % of the time, assessments ~55 %). */
const PHASES: { key: string; label: string; from: number; to: number }[] = [
  { key: 'catalog', label: 'Loading the resort catalog', from: 0.02, to: 0.05 },
  { key: 'weather', label: 'Simulating a season of modeled weather', from: 0.05, to: 0.38 },
  { key: 'operations', label: 'Simulating resort reports and operations', from: 0.38, to: 0.42 },
  { key: 'personal', label: 'Adding a demo skier’s trips, passes and ski days', from: 0.42, to: 0.43 },
  { key: 'assessments', label: 'Scoring conditions day by day', from: 0.43, to: 0.96 },
]

async function generate() {
  const startedAt = performance.now()
  let phase = 0
  let rowsInPhase = 0
  let shownAt = 0
  let shownLabel = ''
  const show = (fraction: number, label = PHASES[phase]?.label ?? 'Finishing') => {
    // Throttled: the store re-renders the progress screen on every update.
    const now = performance.now()
    if (label === shownLabel && now - shownAt < 120) return
    shownAt = now
    shownLabel = label
    setDemoProgress({ phase: label, fraction, startedAt, elapsed: Math.round((now - startedAt) / 1000) })
  }
  show(0.01, 'Preparing the demo database')

  const db = await getDb('demo')
  const client = await getClient('demo')
  await holdSaves('demo', true)
  client.setYieldEvery(40)
  client.hooks.onStatement = (sql, argCount) => {
    const p = PHASES[phase]
    if (!p) return
    const tuples = sql.startsWith('insert into') ? (sql.match(/\),\s*\(/g)?.length ?? 0) + 1 : 0
    if (p.key === 'weather' && sql.startsWith('insert into "weather_points"')) rowsInPhase += tuples
    else if (p.key === 'assessments' && sql.startsWith('insert into "conditions_assessments"')) rowsInPhase += tuples
    else if (argCount) rowsInPhase += 0.02
    const expected = p.key === 'weather' ? EXPECTED_WEATHER_POINTS : p.key === 'assessments' ? EXPECTED_ASSESSMENTS : 400
    const within = Math.min(0.98, rowsInPhase / expected)
    show(p.from + (p.to - p.from) * within)
  }
  try {
    show(PHASES[0].from)
    await generateDemoData(db, {
      log: (line) => {
        // "demo: <phase> … ms" marks the END of a phase.
        const done = PHASES.findIndex((p) => line.startsWith(`demo: ${p.key}`))
        if (done >= 0) {
          phase = done + 1
          rowsInPhase = 0
          show(PHASES[done].to)
        }
      },
    })
  } finally {
    client.setYieldEvery(0)
    client.hooks.onStatement = undefined
  }
  show(0.97, 'Saving the demo data in this browser')
  await holdSaves('demo', false)
  lastDemoGenerationMs = Math.round(performance.now() - startedAt)
  setDemoProgress({ phase: 'Demo data ready', fraction: 1, startedAt, done: true })
  setTimeout(() => setDemoProgress(null), 400)
}
