/** Piste Conditions v1 — public API. See docs/methodology.md ("Conditions model"). */
export { CONDITIONS_CONFIG_V1 } from './config.v1'
export { assessDay, combineComponents, describeScore } from './score'
export { interpretSurface, reportedFreshSnowCm, type SurfaceContext, type SurfaceResult, type ReportState } from './surface'
export {
  surfaceComponent,
  terrainComponent,
  windComponent,
  visibilityComponent,
  comfortComponent,
  windChillC,
  type ComponentContext,
  type PointPick,
} from './components'
export { assessConfidence, type ConfidenceResult } from './confidence'
export {
  aggregateDay,
  aggregateDays,
  prepareSeries,
  rollingSum,
  rollingWindows,
  sumBetween,
  slotsWithin,
  localWindowMs,
  HOUR_MS,
  type DailyWeatherAggregate,
  type PreparedSeries,
  type HourSlot,
  type WindowSum,
  type AccumulationVariable,
} from './aggregate'
export { evalCurve, isValidCurve } from './curve'
export type * from './types'
