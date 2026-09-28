/** Job name → job body. The runner (./runner.ts) wraps each in refresh_runs bookkeeping. */
import { evaluateAlerts } from './alerts'
import { refreshAssessments } from './assessments'
import { pruneAll, refreshFx, refreshLinks } from './maintenance'
import { refreshReports } from './reports'
import { deriveStatuses } from './status'
import type { JobName, JobWork } from './types'
import { refreshOfficialAlerts, refreshWeather } from './weather'

export const JOB_WORK: Record<JobName, JobWork> = {
  weather: (ctx) => refreshWeather(ctx),
  'nws-alerts': (ctx) => refreshOfficialAlerts(ctx),
  reports: (ctx) => refreshReports(ctx),
  status: (ctx) => deriveStatuses(ctx),
  assessments: (ctx) => refreshAssessments(ctx),
  alerts: (ctx) => evaluateAlerts(ctx),
  links: (ctx) => refreshLinks(ctx),
  fx: (ctx) => refreshFx(ctx),
  prune: (ctx) => pruneAll(ctx),
}
