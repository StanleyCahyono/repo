/**
 * The ONE place where read models import from jobs and providers. Everything else in src/lib/data depends on
 * this file only, so a rename in jobs/providers is a one-line fix here.
 */
import 'server-only'

export { providerStatus, type ConnectorStatus, type ConnectorRole, type ConnectorState } from '@/lib/providers/registry'
export { lastSuccess, lastAttemptRun } from '@/lib/jobs/runner'
/** What a finished run counts as a successful update for (job as a whole = null, and per resort). */
export { successTargets } from '@/lib/jobs/success'
export { JOB_NAMES, EXTERNAL_JOBS, type JobName } from '@/lib/jobs/types'
export { HEARTBEAT_KEY, DEFAULT_CADENCES, type Cadences } from '@/lib/jobs/schedule'
export { PRIMARY_WEATHER_PROVIDERS } from '@/lib/jobs/assessments'
export { reportOrigin, isPersonalReport, isResearchedReport, type ReportOrigin } from '@/lib/jobs/reports'
/** OpenStreetMap lifts & runs: the adapter id its fetch log uses, the stored-extract reader, the scheduled resorts. */
export { OSM_ADAPTER_ID } from '@/lib/providers/osm/overpass'
export { readSkiAreaExtract } from '@/lib/providers/osm/extract'
export { osmTargets } from '@/lib/jobs/osm'
export { runSemantics } from '@/lib/jobs/weather'
/** History selection rules, shared with the prune job so it keeps exactly what the history calendar reads. */
export { assessmentThenPick, FORECAST_KEPT_FROM_META, forecastThenHours, forecastThenPick, historyRunsFrom, HISTORY_POINTS, pickPrimaryRun } from '@/lib/jobs/retention'
/** Every external link Piste shows — the same set the link checker walks. */
export { collectLinks } from '@/lib/jobs/maintenance'
