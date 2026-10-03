/**
 * Moved to the shared calendar model (src/components/ui/calendar-model.ts), which the app-wide date pickers use too.
 * Re-exported here so the trip calendars keep importing from './calendar-model'.
 */
export { addMonths, bandSegment, daysInMonth, monthGrid, monthOf, nightsOf, pickDay, weekdayIndex } from '@/components/ui/calendar-model'
