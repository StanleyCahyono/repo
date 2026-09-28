/** Row types inferred from the schema, for use across the app. */
import type * as s from './schema'

export type ResortRow = typeof s.resorts.$inferSelect
export type ResortSeasonRow = typeof s.resortSeasons.$inferSelect
export type OperatingScheduleRow = typeof s.operatingSchedules.$inferSelect
export type StatusEventRow = typeof s.statusEvents.$inferSelect
export type OperationalReportRow = typeof s.operationalReports.$inferSelect
export type WeatherRunRow = typeof s.weatherRuns.$inferSelect
export type WeatherPointRow = typeof s.weatherPoints.$inferSelect
export type WeatherAlertRow = typeof s.weatherAlerts.$inferSelect
export type ConditionsAssessmentRow = typeof s.conditionsAssessments.$inferSelect
export type SourceRecordRow = typeof s.sourceRecords.$inferSelect
export type LinkCheckRow = typeof s.linkChecks.$inferSelect
export type PassFamilyRow = typeof s.passFamilies.$inferSelect
export type PassProductRow = typeof s.passProducts.$inferSelect
export type PassAccessRuleRow = typeof s.passAccessRules.$inferSelect
export type PriceSnapshotRow = typeof s.priceSnapshots.$inferSelect
export type FxRateRow = typeof s.fxRates.$inferSelect
export type AirportRow = typeof s.airports.$inferSelect
export type TravelOptionRow = typeof s.travelOptions.$inferSelect
export type HotelRow = typeof s.hotels.$inferSelect
export type EventRow = typeof s.events.$inferSelect
export type UserPreferencesRow = typeof s.userPreferences.$inferSelect
export type FavoriteRow = typeof s.favorites.$inferSelect
export type PassOwnershipRow = typeof s.passOwnership.$inferSelect
export type PassUsageRow = typeof s.passUsage.$inferSelect
export type TripRow = typeof s.trips.$inferSelect
export type TripItemRow = typeof s.tripItems.$inferSelect
export type SkiDayLogRow = typeof s.skiDayLogs.$inferSelect
export type SkillRow = typeof s.skillChecklist.$inferSelect
export type LessonRow = typeof s.lessons.$inferSelect
export type ExpenseRow = typeof s.expenses.$inferSelect
export type AlertRuleRow = typeof s.alertRules.$inferSelect
export type AlertRow = typeof s.alerts.$inferSelect
export type RefreshRunRow = typeof s.refreshRuns.$inferSelect
