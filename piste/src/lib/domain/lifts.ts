/**
 * Lifts and runs mapped in OpenStreetMap: the compact extract Piste keeps (no geometry), and how it is shown.
 *
 * OpenStreetMap is community-mapped (© OpenStreetMap contributors, ODbL). A list can be incomplete or out of date, and
 * it never says whether a lift or run is open today. Lengths are measured along the mapped line (map distance), so a
 * steep lift or run is a little longer on the ground.
 *
 * Difficulty follows the resort's own convention and is always shown as text plus a symbol shape, never colour alone:
 * - North America, Australia and New Zealand: green circle, blue square, black diamond, double black diamond;
 * - Japan: green, red, black;
 * - Europe (and elsewhere): green (the beginner runs of France and others), blue, red, black, then freeride routes and
 *   itineraries (marked, but not groomed or patrolled like a piste).
 * Pure: no database or network.
 */

/** Who the data belongs to (shown with every list), and the licence page. */
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors'
export const OSM_LICENSE = 'ODbL'
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright'
export const OSM_PROVIDER = 'OpenStreetMap contributors (ODbL)'
/** Provenance note for anything read from OpenStreetMap. */
export const OSM_NOTE = 'Community-mapped (OpenStreetMap): may be incomplete or out of date; never live lift or run status'

/** 'way/123' → its page on openstreetmap.org. */
export const osmUrl = (osm: string) => `https://www.openstreetmap.org/${osm}`
/** The map at a point (zoom 14: a ski area). */
export const osmMapUrl = (lat: number, lon: number, zoom = 14) => `https://www.openstreetmap.org/#map=${zoom}/${lat.toFixed(4)}/${lon.toFixed(4)}`

export const LIFT_TYPES = ['cable_car', 'gondola', 'mixed_lift', 'chair_lift', 'funicular', 'drag_lift', 't-bar', 'j-bar', 'platter', 'rope_tow', 'magic_carpet'] as const
export type LiftType = (typeof LIFT_TYPES)[number]

/** OpenStreetMap `piste:difficulty` values. */
export const PISTE_DIFFICULTIES = ['novice', 'easy', 'intermediate', 'advanced', 'expert', 'freeride', 'extreme'] as const
export type PisteDifficulty = (typeof PISTE_DIFFICULTIES)[number]
/** A run whose difficulty is not mapped is 'unknown' — never guessed. */
export type RunDifficulty = PisteDifficulty | 'unknown'

export interface MappedLift {
  /** OpenStreetMap element, e.g. 'way/123456'. */
  osm: string
  name: string | null
  ref: string | null
  type: LiftType
  /** Along the mapped line (map distance), metres; null without geometry. */
  lengthM: number | null
  /** `aerialway:capacity`, people per hour. */
  capacityPerHour: number | null
  /** `aerialway:occupancy`: seats per chair, people per cabin. */
  occupancy: number | null
  /** `aerialway:duration`, minutes. */
  durationMin: number | null
}

export interface MappedRun {
  /** A route relation ('relation/…'), or the first mapped way of a named run ('way/…'). */
  osm: string
  name: string | null
  ref: string | null
  difficulty: RunDifficulty
  /** `piste:grooming` as mapped (classic, mogul, backcountry…). */
  grooming: string | null
  /** Sum of its mapped ways (map distance), metres; null without geometry. */
  lengthM: number | null
  /** Mapped ways the run is made of. */
  segments: number
}

/** Piste ways with neither name nor ref: they cannot be counted as runs, only as segments. */
export interface UnnamedSegments {
  difficulty: RunDifficulty
  segments: number
  lengthM: number
}

export const SKI_AREA_EXTRACT_VERSION = 1

export interface SkiAreaExtract {
  v: typeof SKI_AREA_EXTRACT_VERSION
  /** 'area': inside the mapped ski-area boundaries below; 'bbox': inside a bounding box (no usable boundary). */
  method: 'area' | 'bbox'
  /** The OpenStreetMap ski areas (landuse=winter_sports) searched; unnamed ones have a null name. */
  areas: { osm: string; name: string | null }[]
  /** The box searched when `method` is 'bbox': [south, west, north, east]. */
  bbox: [number, number, number, number] | null
  /** When the OpenStreetMap data the server answered from was last updated (its `osm_base`). */
  osmTimestamp: string | null
  lifts: MappedLift[]
  runs: MappedRun[]
  unnamed: UnnamedSegments[]
  /** Pistes mapped only as an outline (area): not listed, no length. */
  areaPistes: number
}

// ---------------------------------------------------------------------------------------------------------------------
// Lifts

export const LIFT_TYPE_LABEL: Record<LiftType, string> = {
  cable_car: 'Cable car',
  gondola: 'Gondola',
  mixed_lift: 'Chair-gondola',
  chair_lift: 'Chairlift',
  funicular: 'Funicular',
  drag_lift: 'Drag lift',
  't-bar': 'T-bar',
  'j-bar': 'J-bar',
  platter: 'Platter',
  rope_tow: 'Rope tow',
  magic_carpet: 'Magic carpet',
}

export type LiftGroupKey = 'cable-cars' | 'gondolas' | 'mixed' | 'chairlifts' | 'funiculars' | 'surface' | 'carpets'

export const LIFT_GROUPS: readonly { key: LiftGroupKey; label: string; one: string; many: string; types: readonly LiftType[] }[] = [
  { key: 'cable-cars', label: 'Cable cars and trams', one: 'cable car', many: 'cable cars', types: ['cable_car'] },
  { key: 'gondolas', label: 'Gondolas', one: 'gondola', many: 'gondolas', types: ['gondola'] },
  { key: 'mixed', label: 'Chair-gondolas', one: 'chair-gondola', many: 'chair-gondolas', types: ['mixed_lift'] },
  { key: 'chairlifts', label: 'Chairlifts', one: 'chairlift', many: 'chairlifts', types: ['chair_lift'] },
  { key: 'funiculars', label: 'Funiculars', one: 'funicular', many: 'funiculars', types: ['funicular'] },
  { key: 'surface', label: 'Surface lifts', one: 'surface lift', many: 'surface lifts', types: ['drag_lift', 't-bar', 'j-bar', 'platter', 'rope_tow'] },
  { key: 'carpets', label: 'Magic carpets', one: 'magic carpet', many: 'magic carpets', types: ['magic_carpet'] },
]

export interface LiftGroup {
  key: LiftGroupKey
  label: string
  lifts: MappedLift[]
  /** Sum of the mapped capacities; null when no lift in the group states one. */
  capacityPerHour: number | null
  /** Lifts in the group that state a capacity. */
  capacityKnown: number
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Named first (natural order: "Lift 2" before "Lift 10"), then ref-only ones by ref, unnamed last. */
function byName<T extends { name: string | null; ref: string | null }>(a: T, b: T): number {
  const rank = (x: T) => (x.name ? 0 : x.ref ? 1 : 2)
  return rank(a) - rank(b) || collator.compare(a.name ?? a.ref ?? '', b.name ?? b.ref ?? '') || collator.compare(a.ref ?? '', b.ref ?? '')
}

export function groupLifts(lifts: readonly MappedLift[]): LiftGroup[] {
  return LIFT_GROUPS.map((g) => {
    const list = lifts.filter((l) => g.types.includes(l.type)).sort(byName)
    const known = list.filter((l) => l.capacityPerHour !== null)
    return {
      key: g.key,
      label: g.label,
      lifts: list,
      capacityPerHour: known.length ? known.reduce((n, l) => n + l.capacityPerHour!, 0) : null,
      capacityKnown: known.length,
    }
  }).filter((g) => g.lifts.length > 0)
}

/** '2 gondolas · 9 chairlifts · 4 surface lifts'. */
export function liftCountsText(groups: readonly LiftGroup[]): string {
  return groups
    .map((g) => {
      const def = LIFT_GROUPS.find((x) => x.key === g.key)!
      return `${g.lifts.length} ${g.lifts.length === 1 ? def.one : def.many}`
    })
    .join(' · ')
}

/** 'Collins' · 'Lift C3' · 'Unnamed chairlift'. */
export function liftName(l: Pick<MappedLift, 'name' | 'ref' | 'type'>): string {
  return l.name ?? (l.ref ? `Lift ${l.ref}` : `Unnamed ${LIFT_TYPE_LABEL[l.type].toLowerCase()}`)
}

/** '4-seat chairlift', '8-person gondola', 'T-bar'. */
export function liftKindText(l: Pick<MappedLift, 'type' | 'occupancy'>): string {
  const label = LIFT_TYPE_LABEL[l.type]
  if (l.occupancy === null) return label
  if (l.type === 'chair_lift') return `${l.occupancy}-seat chairlift`
  if (l.type === 'gondola' || l.type === 'cable_car' || l.type === 'funicular' || l.type === 'mixed_lift') return `${label}, ${l.occupancy} per cabin`
  return label
}

// ---------------------------------------------------------------------------------------------------------------------
// Difficulty conventions

export type DifficultyConvention = 'north-america' | 'europe' | 'japan'

/** North American trail signs are used in the US and Canada, and in Australia and New Zealand. */
const NORTH_AMERICAN_SIGNS = new Set(['US', 'CA', 'AU', 'NZ'])

export function difficultyConvention(country: string | null | undefined): DifficultyConvention {
  const c = (country ?? '').toUpperCase()
  if (NORTH_AMERICAN_SIGNS.has(c)) return 'north-america'
  if (c === 'JP') return 'japan'
  return 'europe'
}

export const CONVENTION_LABEL: Record<DifficultyConvention, string> = {
  'north-america': 'North American trail signs',
  europe: 'European piste colours',
  japan: 'Japanese course colours',
}

/** Symbol shape drawn beside the text: the shape carries the meaning together with the words, never colour alone. */
export type PisteShape = 'circle' | 'square' | 'diamond' | 'double-diamond' | 'bar' | 'route' | 'none'
export type PisteTone = 'green' | 'blue' | 'red' | 'black' | 'orange' | 'neutral'

export interface DifficultyStyle {
  /** Group key within a convention: difficulties that share a sign (novice and easy in North America) share a key. */
  key: string
  /** 'Black diamond', 'Red', 'Freeride / itinerary'. */
  label: string
  /** For counts: '12 black diamond'. */
  countLabel: string
  shape: PisteShape
  tone: PisteTone
  order: number
  /** What the sign means, e.g. 'Most difficult'. */
  meaning: string
}

type Styles = Record<RunDifficulty, DifficultyStyle>

const style = (key: string, label: string, shape: PisteShape, tone: PisteTone, order: number, meaning: string): DifficultyStyle => ({
  key,
  label,
  countLabel: label.charAt(0).toLowerCase() + label.slice(1),
  shape,
  tone,
  order,
  meaning,
})

const UNKNOWN = style('unknown', 'Difficulty not mapped', 'none', 'neutral', 99, 'OpenStreetMap does not say how difficult it is')

const NORTH_AMERICA: Styles = {
  novice: style('green', 'Green circle', 'circle', 'green', 1, 'Easiest'),
  easy: style('green', 'Green circle', 'circle', 'green', 1, 'Easiest'),
  intermediate: style('blue', 'Blue square', 'square', 'blue', 2, 'More difficult'),
  advanced: style('black', 'Black diamond', 'diamond', 'black', 3, 'Most difficult'),
  expert: style('double-black', 'Double black diamond', 'double-diamond', 'black', 4, 'Experts only'),
  extreme: style('extreme', 'Extreme terrain', 'double-diamond', 'black', 5, 'Extreme: mountaineering skills or gear may be needed'),
  freeride: style('freeride', 'Freeride terrain', 'route', 'orange', 6, 'Off-piste style terrain, not a groomed trail'),
  unknown: UNKNOWN,
}

const EUROPE: Styles = {
  novice: style('green', 'Green', 'bar', 'green', 1, 'Beginner (green runs, as in France)'),
  easy: style('blue', 'Blue', 'bar', 'blue', 2, 'Easy'),
  intermediate: style('red', 'Red', 'bar', 'red', 3, 'Intermediate'),
  advanced: style('black', 'Black', 'bar', 'black', 4, 'Difficult'),
  expert: style('freeride', 'Freeride / itinerary', 'route', 'orange', 5, 'Marked ski route: not groomed or patrolled like a piste'),
  freeride: style('freeride', 'Freeride / itinerary', 'route', 'orange', 5, 'Marked ski route: not groomed or patrolled like a piste'),
  extreme: style('extreme', 'Extreme', 'route', 'black', 6, 'Mountaineering terrain'),
  unknown: UNKNOWN,
}

const JAPAN: Styles = {
  novice: style('green', 'Green', 'bar', 'green', 1, 'Beginner'),
  easy: style('green', 'Green', 'bar', 'green', 1, 'Beginner'),
  intermediate: style('red', 'Red', 'bar', 'red', 2, 'Intermediate'),
  advanced: style('black', 'Black', 'bar', 'black', 3, 'Advanced'),
  expert: style('black-expert', 'Black (expert)', 'bar', 'black', 4, 'Expert'),
  freeride: style('freeride', 'Off-piste (gate access)', 'route', 'orange', 5, 'Off-piste terrain, not groomed'),
  extreme: style('extreme', 'Extreme', 'route', 'black', 6, 'Mountaineering terrain'),
  unknown: UNKNOWN,
}

const STYLES: Record<DifficultyConvention, Styles> = { 'north-america': NORTH_AMERICA, europe: EUROPE, japan: JAPAN }

export function difficultyStyle(d: RunDifficulty, convention: DifficultyConvention): DifficultyStyle {
  return STYLES[convention][d] ?? UNKNOWN
}

/** The signs of a convention in display order (for a legend). */
export function conventionLegend(convention: DifficultyConvention): DifficultyStyle[] {
  const seen = new Map<string, DifficultyStyle>()
  for (const d of PISTE_DIFFICULTIES) {
    const s = STYLES[convention][d]
    if (!seen.has(s.key)) seen.set(s.key, s)
  }
  return [...seen.values()].sort((a, b) => a.order - b.order)
}

// ---------------------------------------------------------------------------------------------------------------------
// Runs

export interface RunGroup {
  style: DifficultyStyle
  /** Difficulties folded into this group (e.g. novice and easy as green circle). */
  difficulties: RunDifficulty[]
  runs: MappedRun[]
  /** Unnamed piste ways of this difficulty (not counted as runs). */
  unnamed: { segments: number; lengthM: number } | null
  /** Mapped length of the named runs, metres (only runs with geometry). */
  lengthM: number
}

export function groupRuns(extract: Pick<SkiAreaExtract, 'runs' | 'unnamed'>, convention: DifficultyConvention): RunGroup[] {
  const groups = new Map<string, RunGroup>()
  const get = (d: RunDifficulty): RunGroup => {
    const st = difficultyStyle(d, convention)
    let g = groups.get(st.key)
    if (!g) groups.set(st.key, (g = { style: st, difficulties: [], runs: [], unnamed: null, lengthM: 0 }))
    if (!g.difficulties.includes(d)) g.difficulties.push(d)
    return g
  }
  for (const r of extract.runs) {
    const g = get(r.difficulty)
    g.runs.push(r)
    g.lengthM += r.lengthM ?? 0
  }
  for (const u of extract.unnamed) {
    if (u.segments <= 0) continue
    const g = get(u.difficulty)
    g.unnamed = { segments: (g.unnamed?.segments ?? 0) + u.segments, lengthM: (g.unnamed?.lengthM ?? 0) + u.lengthM }
  }
  for (const g of groups.values()) g.runs.sort(byName)
  return [...groups.values()].sort((a, b) => a.style.order - b.style.order)
}

/** '12 black diamond · 3 double black diamond' — named runs only; unnamed segments are not runs. */
export function runCountsText(groups: readonly RunGroup[]): string {
  return groups
    .filter((g) => g.runs.length > 0)
    .map((g) => (g.style.key === 'unknown' ? `${g.runs.length} without a mapped difficulty` : `${g.runs.length} ${g.style.countLabel}`))
    .join(' · ')
}

/** 'Ballroom' · 'Run 12' · 'Unnamed run'. */
export function runName(r: Pick<MappedRun, 'name' | 'ref'>): string {
  if (r.name && r.ref && r.ref !== r.name) return `${r.name} (${r.ref})`
  return r.name ?? (r.ref ? `Run ${r.ref}` : 'Unnamed run')
}

/** `piste:grooming` in words; null for values that say nothing useful to a skier. */
export function groomingText(g: string | null): string | null {
  if (!g) return null
  if (g.includes('mogul')) return 'Moguls'
  if (g.includes('backcountry')) return 'Ungroomed'
  if (g.includes('classic') || g.includes('skating')) return 'Groomed'
  return null
}

export interface SkiAreaTotals {
  lifts: number
  runs: number
  unnamedSegments: number
  /** Sum of the lifts that state a capacity; null when none does. */
  capacityPerHour: number | null
  capacityKnown: number
  liftLengthM: number
  runLengthM: number
}

export function skiAreaTotals(e: Pick<SkiAreaExtract, 'lifts' | 'runs' | 'unnamed'>): SkiAreaTotals {
  const withCapacity = e.lifts.filter((l) => l.capacityPerHour !== null)
  return {
    lifts: e.lifts.length,
    runs: e.runs.length,
    unnamedSegments: e.unnamed.reduce((n, u) => n + u.segments, 0),
    capacityPerHour: withCapacity.length ? withCapacity.reduce((n, l) => n + l.capacityPerHour!, 0) : null,
    capacityKnown: withCapacity.length,
    liftLengthM: e.lifts.reduce((n, l) => n + (l.lengthM ?? 0), 0),
    runLengthM: e.runs.reduce((n, r) => n + (r.lengthM ?? 0), 0) + e.unnamed.reduce((n, u) => n + u.lengthM, 0),
  }
}
