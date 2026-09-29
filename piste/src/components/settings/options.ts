/**
 * Option lists and labels for Settings (pure constants — shared by the forms, the settings read model and the
 * server actions that validate against them).
 */
import type { AbilityLevel, ScoringMode, UnitPrefs } from '@/lib/domain/types'
import type { GearPrefs } from '@/lib/db/schema'

export const DISPLAY_CURRENCIES = ['USD', 'CAD', 'EUR'] as const
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number]

export const CURRENCY_LABEL: Record<DisplayCurrency, string> = {
  USD: 'US dollar',
  CAD: 'Canadian dollar',
  EUR: 'Euro',
}

/** Currencies a budget can be kept in (amounts are stored in this currency, never converted). */
export const BUDGET_CURRENCIES = DISPLAY_CURRENCIES

export const ABILITY_TEXT: Record<AbilityLevel, { label: string; hint: string }> = {
  beginner: { label: 'Beginner', hint: 'First days on snow: carpets, beginner lifts and lessons' },
  novice: { label: 'Novice', hint: 'Linking turns on green runs' },
  intermediate: { label: 'Intermediate', hint: 'Comfortable on most blues' },
  advanced: { label: 'Advanced', hint: 'Blacks, variable snow, some off-piste' },
  expert: { label: 'Expert', hint: 'Anything open, including steeps' },
}

export const SCORING_TEXT: Record<ScoringMode, { label: string; hint: string }> = {
  learning: { label: 'Learning day', hint: 'Favours groomed, gentle, open beginner terrain' },
  'all-mountain': { label: 'All-mountain day', hint: 'Balanced: open terrain, surface and comfort' },
  powder: { label: 'Powder preference', hint: 'Weights fresh snow most' },
}

export const RENTAL_TEXT: Record<GearPrefs['rentalOption'], { label: string; hint: string }> = {
  'full-package': { label: 'Full package', hint: 'Skis, boots and poles' },
  'skis-only': { label: 'Skis only', hint: 'You bring boots' },
  'boots-only': { label: 'Boots only', hint: 'You bring skis' },
  none: { label: 'No rental', hint: 'You bring everything' },
}

export const LODGING_STYLES = ['day-trips', 'budget', 'mid-range', 'slopeside', 'condo', 'friends'] as const
export type LodgingStyle = (typeof LODGING_STYLES)[number]

export const LODGING_TEXT: Record<LodgingStyle, string> = {
  'day-trips': 'Day trips — no lodging',
  budget: 'Budget motel or hostel',
  'mid-range': 'Mid-range hotel',
  slopeside: 'Slopeside / ski-in',
  condo: 'Condo or rental',
  friends: 'Friends or family',
}

export const THEMES = ['system', 'light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

export const UNIT_ROWS: {
  key: keyof UnitPrefs
  label: string
  options: { value: string; label: string }[]
}[] = [
  { key: 'temperature', label: 'Temperature', options: [{ value: 'F', label: '°F' }, { value: 'C', label: '°C' }] },
  { key: 'snow', label: 'Snow & precipitation', options: [{ value: 'in', label: 'in' }, { value: 'cm', label: 'cm' }] },
  { key: 'distance', label: 'Distance', options: [{ value: 'mi', label: 'mi' }, { value: 'km', label: 'km' }] },
  { key: 'elevation', label: 'Elevation', options: [{ value: 'ft', label: 'ft' }, { value: 'm', label: 'm' }] },
  { key: 'speed', label: 'Wind speed', options: [{ value: 'mph', label: 'mph' }, { value: 'kmh', label: 'km/h' }] },
]

/** Segmented controls on Settings: 44px segments on phones (primary touch targets), the kit's height from 768px. */
export const TALL = '[&_[role=radio]]:h-11 md:[&_[role=radio]]:h-9'
