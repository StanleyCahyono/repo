/**
 * Shared job vocabulary. Jobs receive their providers through `JobDeps` (dependency injection) so tests run with
 * fakes and the worker/API wire in the real adapters from `src/lib/providers/registry.ts` (see ./deps.ts).
 */
import type { Db } from '@/lib/db/client'
import type { RefreshItemOutcome } from '@/lib/db/schema'
import type {
  AlertsProvider,
  FxProvider,
  LinkCheckResult,
  ResortReportProvider,
  WeatherProvider,
} from '@/lib/providers/types'

export const JOB_NAMES = ['weather', 'nws-alerts', 'reports', 'status', 'assessments', 'alerts', 'links', 'fx', 'prune'] as const
export type JobName = (typeof JOB_NAMES)[number]

/** Jobs that call external sources (never run against the demo database). */
export const EXTERNAL_JOBS: readonly JobName[] = ['weather', 'nws-alerts', 'reports', 'links', 'fx']

export type Trigger = 'schedule' | 'manual' | 'startup'

export type RunStatus = 'running' | 'ok' | 'partial' | 'error' | 'skipped'

export interface JobDeps {
  /** In preference order: the first provider is the primary forecast; later ones are stored as alternates. */
  weatherProviders: readonly WeatherProvider[]
  alertsProvider: AlertsProvider | null
  fxProvider: FxProvider | null
  reportProviders: readonly ResortReportProvider[]
  checkLink: ((url: string) => Promise<LinkCheckResult>) | null
  /** True when the database is the demo database: derived rows are kind 'demo' and nothing external is fetched. */
  demo: boolean
  log?: (line: string) => void
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>
}

export interface JobContext {
  db: Db
  /** App clock instant (never read the system clock inside jobs). */
  now: string
  deps: JobDeps
  /** Resort id (or other subject) for targeted runs; null for global runs. */
  target: string | null
  trigger: Trigger
  /** Shutdown request: long jobs stop between items (the item in progress finishes). */
  signal?: AbortSignal
}

export const STOPPED_NOTE = 'Stopped early: shutdown requested (remaining items run next time)'

export type ItemOutcome = RefreshItemOutcome

export interface JobWorkResult {
  items: ItemOutcome[]
  notes?: string[]
}

export type JobWork = (ctx: JobContext) => Promise<JobWorkResult>

export function emptyDeps(overrides: Partial<JobDeps> = {}): JobDeps {
  return {
    weatherProviders: [],
    alertsProvider: null,
    fxProvider: null,
    reportProviders: [],
    checkLink: null,
    demo: false,
    ...overrides,
  }
}
