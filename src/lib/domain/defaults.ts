import type { UserPreferencesRow } from '@/lib/db/rows'

/** Editable personal defaults (brief §1). Pass ownership deliberately starts empty. */
export const HOME_ITHACA = {
  homeName: 'Ithaca, NY',
  homeLat: 42.4406,
  homeLon: -76.4966,
  homeTimezone: 'America/New_York',
} as const

export const ACTIVE_SEASON = '2026-27'
export const INITIAL_FAVORITES = ['greek-peak', 'alta'] as const

export function defaultPreferences(now: string): UserPreferencesRow {
  return {
    id: 1,
    ...HOME_ITHACA,
    activeSeasonId: ACTIVE_SEASON,
    ability: 'beginner',
    companionAbility: null,
    companionName: null,
    units: { temperature: 'F', snow: 'in', distance: 'mi', elevation: 'ft', speed: 'mph' },
    currency: 'USD',
    scoringMode: 'learning',
    travel: { maxDriveHours: 4, willingToFly: true, originAirports: ['ITH', 'SYR', 'ELM', 'ROC', 'BUF'], winterBufferPct: 20 },
    gear: { ownsSkis: false, ownsBoots: false, ownsHelmet: false, rentalOption: 'full-package' },
    budget: { dayBudgetMinor: null, seasonBudgetMinor: null, currency: 'USD', lunchEstimateMinor: 2500 },
    lodgingStyle: null,
    weights: { conditions: 35, fit: 25, travel: 20, cost: 15, events: 5 },
    theme: 'system',
    onboardingDone: false,
    updatedAt: now,
  }
}
