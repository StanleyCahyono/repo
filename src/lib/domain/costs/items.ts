/**
 * Reading price items the way people write them. Researchers record prices with readable names — "Adult ski + boots +
 * poles, per day", "1-day adult lift pass (16–64)", "Twilight ticket (4 PM-close)", category "adult (half day)" — so
 * the day basket cannot match on exact ids. These helpers classify an item and its category:
 *
 * - who it is for (adult, child, senior, a club or college rate…), from the category first and the item text second;
 * - whether a lift ticket prices one full day (not half-day, twilight, night, multi-day, packs or season products), and
 *   whether it only applies on named weekdays ("Tuesdays", "Friday (non-holiday)");
 * - what a rental is (full ski package, skis only, boots only, snowboard) and whether it is a premium tier;
 * - what a lesson is (group or private) — lessons are never part of the day basket's total.
 *
 * Pure, no I/O. Unknown wording is treated conservatively: an item that might be for children, part of a day or several
 * days is left out rather than stretched to fit.
 */

/** Lowercase, unified dashes and spaces. */
export function normItem(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const ADULT = /\badults?\b/
/** People other than a regular adult: children, seniors, students… */
const OTHER_PEOPLE =
  /\bchild(?:ren)?\b|\bkids?\b|\bjunior|\bjr\b|\byouth\b|\bteens?\b|\btoddlers?\b|\binfants?\b|\bseniors?\b|\bstudents?\b|\bcollege\b|\buniversity\b|\bmilitary\b|\bveterans?\b|\bfamily\b|\bages? \d+ (?:and|&) (?:under|younger)\b|\bunder \d+\b|\b\d+ (?:and|&) under\b|\b(?:3|4|5|6|7) ?(?:-|to) ?(?:8|9|10|11|12)\b/
/** Rates for a club, group or employer rather than a walk-up buyer. */
const SPECIAL_RATE = /\bclub\b|\bmembers?\b|\bgroups?\b|\bcorporate\b|\bemployees?\b|\bstaff\b|\bresidents?\b|\blocals?\b/
const NOT_ADULT = new RegExp(`${OTHER_PEOPLE.source}|${SPECIAL_RATE.source}`)
/** "Price shown (age category not captured)", "category not stated": the audience is simply not recorded. */
const AUDIENCE_UNSTATED = /\b(?:age )?categor(?:y|ies) not (?:captured|stated|recorded)\b|\bnot stated\b|\bany age\b|\ball ages\b|\bprice shown\b/

export type Audience = 'adult' | 'unstated' | 'other'

/** Who a category (or item) is for. null text → 'unstated'. */
export function audienceOf(text: string | null | undefined): Audience {
  const t = normItem(text)
  if (!t) return 'unstated'
  if (NOT_ADULT.test(t)) return 'other'
  if (ADULT.test(t)) return 'adult'
  if (AUDIENCE_UNSTATED.test(t)) return 'unstated'
  return 'other'
}

/**
 * How standard an adult category is, lower first: "Adult" 0 · "Adult (23+)" / "adults 18–64" 1 · other adult wording
 * ("Young adult (19–22)", "Adult add-on") 2 · category not recorded 3 · not adult 9.
 */
export function adultRank(category: string | null | undefined): number {
  const c = normItem(category)
  const a = audienceOf(c || null)
  if (a === 'other') return 9
  if (a === 'unstated') return 3
  if (/^adults?$/.test(c)) return 0
  if (/^adults?\b[\s(,:-]*(?:\(?\s*(?:ages?\s*)?\d+\s*(?:\+|-\s*\d+|and (?:over|up)|years?)?\s*\)?)?$/.test(c)) return 1
  return 2
}

/**
 * Does a price row fit the wanted category? 'adult' accepts any adult wording ("Adult (19–64)", "adults 18+") and rows
 * whose category is not recorded — but not child, senior, college, club or family-member rates, and not when the item
 * text itself names another audience. Other categories match by prefix ("child" ⊂ "child (6–12)").
 */
export function categoryFits(
  category: string | null | undefined,
  item: string | null | undefined,
  wanted: string | null | undefined,
  opts: { allowGroup?: boolean } = {},
): boolean {
  const w = normItem(wanted)
  if (!w) return true
  const cat = normItem(category)
  if (w === 'adult') {
    const a = audienceOf(cat || null)
    if (a === 'other' && !(opts.allowGroup && ADULT.test(cat) && !OTHER_PEOPLE.test(cat))) return false
    // The item may still say who it is for ("Lift ticket, ages 6 and under" with no category).
    const it = normItem(item)
    if (it && (opts.allowGroup ? OTHER_PEOPLE : NOT_ADULT).test(it)) return false
    return true
  }
  return !cat || cat === w || cat.startsWith(`${w} `) || cat.startsWith(`${w}(`)
}

/** Half-day, twilight, night, morning/afternoon or a short timed ticket. */
const PART_DAY =
  /\bhalf\b|\bhalf-?days?\b|\bhalfday\b|\btwilight\b|\bnight\b|\bnights\b|\bevening\b|\bafternoon\b|\bmorning\b|\bp\.?m\.?\s*-\s*close\b|\b\d{1,2}\s*(?:pm|p\.m\.)\b|\b[1-6]\s*-?\s*(?:hours?|hrs?|h)\b|\bfirst tracks\b|\bsingle ride\b|\bone ride\b|\bpoints?\b|\bscenic\b|\bsightseeing\b|\bfoot passengers?\b|\bpedestrians?\b|\bnon-?skier\b/
/** Several days, a pack, a season product or a weekly ticket ("week 8" as a calendar week is fine). */
const MULTI_DAY = /(?<!within )\b(?:[2-9]|1\d|2\d)\s*-?\s*(?:days?|tag(?:e)?|jours?)\b(?!\s*(?:ahead|in advance|before|prior|or more))|\bmulti-?days?\b|\bpacks?\b|\bseason (?:pass|ticket)\b|\bweekly\b|\b\d+\s*-?\s*weeks?\b|\bper week\b|\bweek (?:pass|ticket)\b|\bcards?\b|\bvouchers?\b|\bpunch\b/
/** Bundles that include a lesson or rental — not a plain lift ticket. */
const BUNDLE = /\blessons?\b|\blearn\b|\bbeginner\b|\bfirst-?timer\b|\bclinic\b|\bpackage\b|\bincl(?:\.|udes|uding)? (?:rental|lesson)/

export function isPartDay(text: string | null | undefined): boolean {
  return PART_DAY.test(normItem(text))
}

export function isMultiDay(text: string | null | undefined): boolean {
  return MULTI_DAY.test(normItem(text))
}

const WEEKDAYS: [RegExp, number][] = [
  [/\bmondays?\b/, 1],
  [/\btuesdays?\b/, 2],
  [/\bwednesdays?\b/, 3],
  [/\bthursdays?\b/, 4],
  [/\bfridays?\b/, 5],
  [/\bsaturdays?\b/, 6],
  [/\bsundays?\b/, 7],
]

/** ISO weekdays (1 = Mon … 7 = Sun) an item is limited to ("Tuesdays", "Friday (non-holiday)"); [] when none. */
export function weekdaysNamed(text: string | null | undefined): number[] {
  const t = normItem(text)
  // "Monday to Friday" / "Mon–Fri" describe a day type, not a single-day special.
  if (/\bmonday (?:to|through|-) friday\b|\bsaturday (?:and|&|-) sunday\b/.test(t)) return []
  return WEEKDAYS.filter(([re]) => re.test(t)).map(([, n]) => n)
}

/** ISO weekday of a 'YYYY-MM-DD' date (UTC calendar arithmetic). */
function isoWeekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return w === 0 ? 7 : w
}

/**
 * A lift ticket that prices one adult full day on `date`: adult (or audience not recorded), not part of a day, not
 * several days, not a lesson/rental bundle, and — when it names weekdays — sold for that weekday.
 */
export function isAdultDayLiftTicket(s: { item: string; category: string | null }, date?: string | null): boolean {
  const item = normItem(s.item)
  const cat = normItem(s.category)
  if (!categoryFits(cat, item, 'adult')) return false
  if (PART_DAY.test(item) || PART_DAY.test(cat)) return false
  if (MULTI_DAY.test(item) || MULTI_DAY.test(cat)) return false
  if (BUNDLE.test(item)) return false
  if (date) {
    const days = weekdaysNamed(item)
    if (days.length && !days.includes(isoWeekdayOf(date))) return false
  }
  return true
}

// ---------------------------------------------------------------------------------------------------------------------
// Rentals

export type RentalKind = 'full-package' | 'skis-only' | 'boots-only' | 'snowboard'

const RENTAL_IDS: Record<string, RentalKind> = {
  'full-package': 'full-package',
  package: 'full-package',
  'ski-package': 'full-package',
  'full-rental': 'full-package',
  full: 'full-package',
  'ski-boot-pole-package': 'full-package',
  'skis-only': 'skis-only',
  skis: 'skis-only',
  'ski-only': 'skis-only',
  'boots-only': 'boots-only',
  boots: 'boots-only',
  'boot-only': 'boots-only',
}

/**
 * What a rental item is, from an option id ("full-package") or readable wording ("Adult ski + boots + poles, per day",
 * "Skis only (no boots)", "Adult ski boots", "Snowboard + boots"). null when it is not a day rental of skis, boots or a
 * board (helmets, goggles, lessons, multi-day or half-day rentals, children's sizes).
 */
export function rentalKindOf(item: string, category?: string | null): RentalKind | null {
  const id = normItem(item).replace(/\s+/g, '-')
  if (RENTAL_IDS[id]) return RENTAL_IDS[id]
  const t = normItem(item)
  const cat = normItem(category)
  if (!categoryFits(cat, t, 'adult')) return null
  if (PART_DAY.test(t) || PART_DAY.test(cat) || MULTI_DAY.test(t) || /\blessons?\b|\blift\b|\bticket\b/.test(t)) return null
  // "Ski boots" / "ski poles" are boots and poles, not skis.
  const skis = /\bskis?\b/.test(t.replace(/\bski\s*(?:boots?|poles?)\b/g, ' '))
  const boots = /\bboots?\b/.test(t)
  const board = /\bsnowboards?\b|\bboard\b/.test(t)
  const pkg = /\bpackages?\b|\bpkg\b|\bsets?\b|\bkits?\b|\bcombos?\b|\bbundles?\b|\bfull\b|\bcomplete\b/.test(t)
  if (skis && /\bskis? only\b|\bonly skis?\b|\bno boots\b|\bwithout boots\b/.test(t)) return 'skis-only'
  if (boots && /\bboots? only\b|\bonly boots\b|\bno skis\b|\bwithout skis\b/.test(t)) return board && !skis ? 'snowboard' : 'boots-only'
  if (board && !skis) return 'snowboard'
  if (skis && (boots || pkg || /\brental\b/.test(t))) return 'full-package'
  if (boots && !skis && !pkg) return 'boots-only'
  if (skis) return 'skis-only'
  if (pkg || /\bfull rental\b|\bequipment\b/.test(t)) return 'full-package'
  return null
}

/** Rental snapshots match the basket's rental option by option id or readable wording. */
export function rentalItemMatches(item: string, option: Exclude<RentalKind, 'snowboard'>, category?: string | null): boolean {
  return rentalKindOf(item, category) === option
}

/** 0 = standard / sport (preferred for the basket), 1 = performance, premium or demo gear. */
export function rentalTier(item: string): 0 | 1 {
  return /\bperformance\b|\bpremium\b|\bdemo\b|\bhigh-?end\b|\belite\b|\bvip\b|\bplatinum\b|\bgold\b|\bexpert\b|\btest\b/.test(normItem(item)) ? 1 : 0
}

// ---------------------------------------------------------------------------------------------------------------------
// Lessons

export type LessonKind = 'group' | 'private'

/** Group or private lesson; null for children's programmes or anything not recognisably an adult lesson. */
export function lessonKindOf(item: string, category?: string | null): LessonKind | null {
  const t = normItem(item)
  if (!categoryFits(category, t, 'adult', { allowGroup: true })) return null
  if (/\bprivate\b|\b1\s*(?:on|-|:)\s*1\b|\bone-?on-?one\b/.test(t)) return 'private'
  if (/\bgroup\b|\bclass\b|\bclinic\b|\bschool\b|\blessons?\b|\bbeginner\b|\blearn\b/.test(t)) return 'group'
  return null
}
