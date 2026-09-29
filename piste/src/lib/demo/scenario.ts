/**
 * The demo world: which resorts are simulated, when they opened, and the scripted weather events the demo is built
 * around. Everything here is SIMULATED and lives only in the isolated demo database (data/piste-demo.db).
 *
 * Story (Fri 15 Jan 2027, 09:00 in Ithaca):
 * - Tracking started 1 Dec 2026; nothing is simulated before it (the history calendar shows the gap).
 * - Greek Peak opened 4 Dec, Labrador 12 Dec; Song Mountain announced 19 Dec, moved it to 9 Jan and is still not
 *   open (an announced date never becomes "Open").
 * - East: under-forecast storm on Sat 9 Jan, thaw with rain on Mon 11 Jan, hard freeze 12–13 Jan, clipper + a wind
 *   event at Jay Peak 14–15 Jan (Jay is temporarily closed on 15 Jan).
 * - Utah: ~40 cm at Alta on 13–14 Jan (fresh snow — never a better beginner day because of it).
 * - About ten catalog resorts get no simulated data at all, so their status stays "Status unavailable".
 */
import { DEMO_NOW } from '@/lib/clock'
import { provenance, type Provenance } from '@/lib/domain/types'

export { DEMO_NOW }

export const TRACKING_START = '2026-12-01'
/** Resort-local "today" at DEMO_NOW for every simulated resort (New York 09:00, Denver 07:00). */
export const DEMO_TODAY = '2027-01-15'
/** DEMO_NOW + 16 days: the end of the latest simulated forecast and of the assessed range. */
export const LAST_DATE = '2027-01-31'
export const SEASON_ID = '2026-27'

export const DEMO_PROVIDER = 'Piste demo generator'
export const DEMO_NOTE = 'Simulated'
export const DEMO_MODEL = 'piste-demo-synthetic-v1'
export const DEMO_VERSION = 'piste-demo/1'
/** Weather run provider id (weather_runs.provider). */
export const DEMO_WEATHER_PROVIDER = 'demo'

export const META_GENERATED = 'demo.generatedAt'
export const META_MARKER = 'demo.database'
export const META_VERSION = 'demo.version'
export const META_TRACKING = 'tracking.start'

/** "Simulated" or "Simulated — detail": every demo provenance note starts with the word Simulated. */
export function demoNote(detail?: string | null): string {
  return detail ? `${DEMO_NOTE} — ${detail}` : DEMO_NOTE
}

/** Provenance for simulated facts: kind 'demo', provider 'Piste demo generator', note 'Simulated…'. */
export function demoProv(extra: Partial<Provenance> = {}, detail?: string | null): Provenance {
  return provenance({ kind: 'demo', provider: DEMO_PROVIDER, sourceUrl: null, season: SEASON_ID, ...extra, note: demoNote(detail) })
}

// ---------------------------------------------------------------------------
// Regions and resorts

export type Region = 'east' | 'utah' | 'colorado'

export interface DemoAnnouncement {
  /** Resort-local date and time the announcement was published. */
  on: string
  at: string
  /** Announced target opening date. */
  date: string
  text: string
}

export interface DemoStatement {
  on: string
  at: string
  status: 'not-yet-open'
  note: string
}

export interface DemoResortProfile {
  id: string
  region: Region
  /** Actual opening (resort-local date); null = still not open at DEMO_NOW. */
  opening: string | null
  /** Days reported as 'partially-open' from the opening before 'open'. */
  partialDays: number
  /** One simulated forecast run per day (feeds the history calendar's "forecast then"). */
  dailyRuns: boolean
  /** Precipitation multiplier (orographic / lake-effect exposure). */
  snowFactor: number
  tempOffsetC: number
  windFactor: number
  lakeEffect: boolean
  snowmaking: boolean
  /** Elevations used by the simulation only when the catalog has none (never stored as facts). */
  simElevation: { base: number; summit: number }
  /**
   * Terrain totals used by simulated reports when the catalog has no count (the catalog value always wins).
   * Reports built on these say so in their notes and provenance.
   */
  simTerrain: { trails: number; lifts: number; beginnerTrails: number }
  /** Reported base depth at the first simulated report (cm). */
  baseDepthStartCm: number
  announcements?: DemoAnnouncement[]
  statements?: DemoStatement[]
  /** Inclusive local dates with no report at all (a feed outage). */
  gap?: { from: string; to: string }
}

const east = (p: Omit<DemoResortProfile, 'region' | 'snowmaking'> & { snowmaking?: boolean }): DemoResortProfile => ({ region: 'east', snowmaking: true, ...p })
const west = (region: 'utah' | 'colorado', p: Omit<DemoResortProfile, 'region' | 'snowmaking' | 'lakeEffect'>): DemoResortProfile => ({
  region,
  snowmaking: false,
  lakeEffect: false,
  ...p,
})

export const DEMO_RESORTS: readonly DemoResortProfile[] = [
  // --- Central / western New York
  east({
    id: 'greek-peak',
    opening: '2026-12-04',
    partialDays: 8,
    dailyRuns: true,
    snowFactor: 1,
    tempOffsetC: 0,
    windFactor: 1,
    lakeEffect: true,
    simElevation: { base: 350, summit: 640 },
    simTerrain: { trails: 55, lifts: 8, beginnerTrails: 20 },
    baseDepthStartCm: 38,
    announcements: [{ on: '2026-12-01', at: '10:00', date: '2026-12-04', text: 'Targeting Friday, December 4 for opening day, conditions permitting' }],
  }),
  east({
    id: 'labrador-mountain',
    opening: '2026-12-12',
    partialDays: 6,
    dailyRuns: true,
    snowFactor: 1.05,
    tempOffsetC: -0.5,
    windFactor: 1,
    lakeEffect: true,
    simElevation: { base: 400, summit: 610 },
    simTerrain: { trails: 22, lifts: 4, beginnerTrails: 6 },
    baseDepthStartCm: 30,
    announcements: [{ on: '2026-12-03', at: '12:00', date: '2026-12-12', text: 'Opening Saturday, December 12 (weather permitting)' }],
  }),
  east({
    id: 'song-mountain',
    opening: null,
    partialDays: 6,
    dailyRuns: false,
    snowFactor: 1.05,
    tempOffsetC: -0.3,
    windFactor: 1,
    lakeEffect: true,
    simElevation: { base: 390, summit: 590 },
    simTerrain: { trails: 24, lifts: 5, beginnerTrails: 7 },
    baseDepthStartCm: 25,
    announcements: [
      { on: '2026-12-01', at: '09:30', date: '2026-12-19', text: 'Hoping to open Saturday, December 19' },
      { on: '2026-12-16', at: '10:00', date: '2027-01-09', text: 'Opening moved to Saturday, January 9 — we need more cold nights for snowmaking' },
    ],
    statements: [
      { on: '2027-01-12', at: '10:00', status: 'not-yet-open', note: 'Not open yet: Monday’s rain set back snowmaking. A new opening date will be announced.' },
    ],
  }),
  east({
    id: 'bristol-mountain',
    opening: '2026-12-05',
    partialDays: 7,
    dailyRuns: true,
    snowFactor: 1.05,
    tempOffsetC: 0,
    windFactor: 1,
    lakeEffect: true,
    simElevation: { base: 305, summit: 671 },
    simTerrain: { trails: 39, lifts: 5, beginnerTrails: 12 },
    baseDepthStartCm: 40,
  }),
  east({
    id: 'holiday-valley',
    opening: '2026-12-04',
    partialDays: 6,
    dailyRuns: false,
    snowFactor: 1.15,
    tempOffsetC: -0.3,
    windFactor: 0.95,
    lakeEffect: true,
    simElevation: { base: 457, summit: 686 },
    simTerrain: { trails: 60, lifts: 13, beginnerTrails: 17 },
    baseDepthStartCm: 40,
    gap: { from: '2026-12-20', to: '2026-12-23' },
  }),
  east({
    id: 'whiteface',
    opening: '2026-11-27',
    partialDays: 8,
    dailyRuns: false,
    snowFactor: 1,
    tempOffsetC: -1.5,
    windFactor: 1.1,
    lakeEffect: false,
    simElevation: { base: 372, summit: 1337 },
    simTerrain: { trails: 90, lifts: 11, beginnerTrails: 17 },
    baseDepthStartCm: 45,
  }),
  east({
    id: 'gore-mountain',
    opening: '2026-11-27',
    partialDays: 8,
    dailyRuns: false,
    snowFactor: 0.95,
    tempOffsetC: -1.2,
    windFactor: 1,
    lakeEffect: false,
    simElevation: { base: 324, summit: 1097 },
    simTerrain: { trails: 110, lifts: 14, beginnerTrails: 14 },
    baseDepthStartCm: 45,
  }),
  east({
    id: 'hunter-mountain',
    opening: '2026-12-03',
    partialDays: 7,
    dailyRuns: false,
    snowFactor: 0.9,
    tempOffsetC: -0.3,
    windFactor: 1,
    lakeEffect: false,
    simElevation: { base: 488, summit: 975 },
    simTerrain: { trails: 67, lifts: 13, beginnerTrails: 14 },
    baseDepthStartCm: 40,
    announcements: [{ on: '2026-12-01', at: '11:00', date: '2026-12-03', text: 'Opening Thursday, December 3' }],
  }),
  // --- Vermont
  east({
    id: 'killington',
    opening: '2026-11-21',
    partialDays: 10,
    dailyRuns: true,
    snowFactor: 1.1,
    tempOffsetC: -1,
    windFactor: 1,
    lakeEffect: false,
    simElevation: { base: 363, summit: 1293 },
    simTerrain: { trails: 155, lifts: 21, beginnerTrails: 29 },
    baseDepthStartCm: 50,
  }),
  east({
    id: 'stowe',
    opening: '2026-11-26',
    partialDays: 8,
    dailyRuns: false,
    snowFactor: 1.15,
    tempOffsetC: -1.5,
    windFactor: 1,
    lakeEffect: false,
    simElevation: { base: 386, summit: 1105 },
    simTerrain: { trails: 116, lifts: 12, beginnerTrails: 19 },
    baseDepthStartCm: 45,
  }),
  east({
    id: 'jay-peak',
    opening: '2026-11-28',
    partialDays: 8,
    dailyRuns: true,
    snowFactor: 1.25,
    tempOffsetC: -2,
    windFactor: 1.15,
    lakeEffect: false,
    simElevation: { base: 553, summit: 1176 },
    simTerrain: { trails: 81, lifts: 9, beginnerTrails: 16 },
    baseDepthStartCm: 45,
  }),
  east({
    id: 'okemo',
    opening: '2026-11-27',
    partialDays: 8,
    dailyRuns: false,
    snowFactor: 1,
    tempOffsetC: -1,
    windFactor: 0.95,
    lakeEffect: false,
    simElevation: { base: 349, summit: 1019 },
    simTerrain: { trails: 121, lifts: 20, beginnerTrails: 36 },
    baseDepthStartCm: 45,
  }),
  // --- Utah
  west('utah', {
    id: 'alta',
    opening: '2026-11-27',
    partialDays: 7,
    dailyRuns: true,
    snowFactor: 1.25,
    tempOffsetC: 0,
    windFactor: 1,
    simElevation: { base: 2600, summit: 3216 },
    simTerrain: { trails: 119, lifts: 7, beginnerTrails: 18 },
    baseDepthStartCm: 105,
  }),
  west('utah', {
    id: 'snowbird',
    opening: '2026-11-21',
    partialDays: 10,
    dailyRuns: true,
    snowFactor: 1.25,
    tempOffsetC: -0.3,
    windFactor: 1.1,
    simElevation: { base: 2365, summit: 3353 },
    simTerrain: { trails: 140, lifts: 11, beginnerTrails: 13 },
    baseDepthStartCm: 110,
  }),
  west('utah', {
    id: 'brighton',
    opening: '2026-11-20',
    partialDays: 8,
    dailyRuns: false,
    snowFactor: 1.15,
    tempOffsetC: 0,
    windFactor: 1,
    simElevation: { base: 2669, summit: 3200 },
    simTerrain: { trails: 66, lifts: 7, beginnerTrails: 14 },
    baseDepthStartCm: 100,
  }),
  west('utah', {
    id: 'solitude',
    opening: '2026-11-26',
    partialDays: 8,
    dailyRuns: false,
    snowFactor: 1.15,
    tempOffsetC: 0,
    windFactor: 1,
    simElevation: { base: 2435, summit: 3197 },
    simTerrain: { trails: 88, lifts: 8, beginnerTrails: 11 },
    baseDepthStartCm: 95,
  }),
  west('utah', {
    id: 'deer-valley',
    opening: '2026-12-05',
    partialDays: 7,
    dailyRuns: false,
    snowFactor: 0.85,
    tempOffsetC: 0.5,
    windFactor: 0.9,
    simElevation: { base: 2003, summit: 2917 },
    simTerrain: { trails: 103, lifts: 21, beginnerTrails: 28 },
    baseDepthStartCm: 70,
    announcements: [{ on: '2026-12-01', at: '09:00', date: '2026-12-05', text: 'Opening day Saturday, December 5' }],
  }),
  west('utah', {
    id: 'park-city-mountain',
    opening: '2026-11-21',
    partialDays: 10,
    dailyRuns: false,
    snowFactor: 0.85,
    tempOffsetC: 0.5,
    windFactor: 0.9,
    simElevation: { base: 2073, summit: 3056 },
    simTerrain: { trails: 330, lifts: 41, beginnerTrails: 28 },
    baseDepthStartCm: 75,
  }),
  // --- Colorado
  west('colorado', {
    id: 'breckenridge',
    opening: '2026-11-20',
    partialDays: 10,
    dailyRuns: true,
    snowFactor: 0.95,
    tempOffsetC: -0.5,
    windFactor: 1.1,
    simElevation: { base: 2926, summit: 3962 },
    simTerrain: { trails: 187, lifts: 35, beginnerTrails: 28 },
    baseDepthStartCm: 75,
  }),
  west('colorado', {
    id: 'vail',
    opening: '2026-11-20',
    partialDays: 10,
    dailyRuns: false,
    snowFactor: 0.95,
    tempOffsetC: 0,
    windFactor: 1,
    simElevation: { base: 2475, summit: 3527 },
    simTerrain: { trails: 195, lifts: 31, beginnerTrails: 30 },
    baseDepthStartCm: 70,
  }),
  west('colorado', {
    id: 'copper-mountain',
    opening: '2026-11-21',
    partialDays: 10,
    dailyRuns: false,
    snowFactor: 0.9,
    tempOffsetC: -0.3,
    windFactor: 1.05,
    simElevation: { base: 2960, summit: 3753 },
    simTerrain: { trails: 150, lifts: 24, beginnerTrails: 32 },
    baseDepthStartCm: 70,
  }),
  west('colorado', {
    id: 'steamboat',
    opening: '2026-11-26',
    partialDays: 8,
    dailyRuns: false,
    snowFactor: 1.15,
    tempOffsetC: -0.5,
    windFactor: 0.9,
    simElevation: { base: 2103, summit: 3221 },
    simTerrain: { trails: 180, lifts: 23, beginnerTrails: 25 },
    baseDepthStartCm: 80,
  }),
]

export const DEMO_RESORT_IDS: readonly string[] = DEMO_RESORTS.map((r) => r.id)

export function demoProfile(id: string): DemoResortProfile {
  const p = DEMO_RESORTS.find((r) => r.id === id)
  if (!p) throw new Error(`Not a simulated demo resort: ${id}`)
  return p
}

export interface DemoRevision {
  resortId: string
  date: string
  /** Added to that day's 06:30 report, which has `extraLifts` / `extraTrails` fewer open (null on a storm-hold day). */
  morningNote: string | null
  /** The 11:00 revision's note; the revision opens `extraLifts` / `extraTrails` more than the 06:30 report. */
  note: string
  extraLifts: number
  extraTrails: number
}

/** Resort-local report revisions at 11:00: the morning report had terrain on a delayed start (or a hold). */
export const REVISIONS: readonly DemoRevision[] = [
  {
    resortId: 'greek-peak',
    date: '2027-01-09',
    morningNote: 'Two lifts on a delayed start this morning; update to follow.',
    note: '11:00 update: two more lifts are now running.',
    extraLifts: 2,
    extraTrails: 5,
  },
  { resortId: 'alta', date: '2027-01-14', morningNote: null, note: '11:00 update: upper-mountain lifts opened after avalanche mitigation.', extraLifts: 3, extraTrails: 40 },
  {
    resortId: 'killington',
    date: '2026-12-26',
    morningNote: 'More terrain opens later this morning once overnight snowmaking wraps up; update to follow.',
    note: '11:00 update: more terrain open after overnight snowmaking.',
    extraLifts: 2,
    extraTrails: 6,
  },
]

/** The resort closed on DEMO day after Monday's rain and a wind event. */
export const CLOSED_TODAY = { resortId: 'jay-peak', date: DEMO_TODAY }
/** The small NY area whose announced opening has passed without opening. */
export const NOT_OPEN_RESORT = 'song-mountain'

// ---------------------------------------------------------------------------
// Scripted weather (resort-local wall times in the region's zone)

export const REGION_TZ: Record<Region, string> = { east: 'America/New_York', utah: 'America/Denver', colorado: 'America/Denver' }

export interface ScriptedStorm {
  id: string
  region: Region
  /** 'YYYY-MM-DDTHH:mm' in the region's zone. */
  start: string
  hours: number
  /** Regional liquid-water total (mm) before resort multipliers. */
  waterMm: number
  windBoostKmh: number
  /** Forecast busts: runs fetched at these instants saw only `factor` of this storm's precipitation. */
  bust?: { fetchedAt: string; factor: number }[]
}

export const SCRIPTED_STORMS: readonly ScriptedStorm[] = [
  {
    id: 'east-jan09',
    region: 'east',
    start: '2027-01-09T06:00',
    hours: 16,
    waterMm: 16,
    windBoostKmh: 12,
    bust: [
      { fetchedAt: '2027-01-07T11:00:00.000Z', factor: 0.5 },
      { fetchedAt: '2027-01-08T11:00:00.000Z', factor: 0.3 },
    ],
  },
  { id: 'east-jan11-rain', region: 'east', start: '2027-01-11T03:00', hours: 19, waterMm: 20, windBoostKmh: 22 },
  { id: 'east-jan14-clipper', region: 'east', start: '2027-01-14T18:00', hours: 14, waterMm: 3, windBoostKmh: 10 },
  { id: 'utah-jan13', region: 'utah', start: '2027-01-13T04:00', hours: 30, waterMm: 19.5, windBoostKmh: 18 },
  { id: 'utah-jan14-showers', region: 'utah', start: '2027-01-14T12:00', hours: 14, waterMm: 4.5, windBoostKmh: 6 },
  { id: 'co-jan13', region: 'colorado', start: '2027-01-13T06:00', hours: 26, waterMm: 11, windBoostKmh: 16 },
]

/** No random storms inside these windows (the scripted story needs them quiet). */
export const PROTECTED_WINDOWS: Record<Region, readonly [string, string][]> = {
  east: [['2027-01-07T12:00', '2027-01-15T20:00']],
  utah: [['2027-01-09T12:00', '2027-01-18T00:00']],
  colorado: [['2027-01-10T00:00', '2027-01-17T00:00']],
}

/**
 * Temperature-anomaly keyframes (°C, region-local times). Between the first and last keyframe the scripted anomaly
 * replaces the random one (ramping in/out over the first/last segment).
 */
export const ANOMALY_SCRIPTS: Record<Region, readonly [string, number][]> = {
  east: [
    ['2027-01-07T12:00', 0],
    ['2027-01-08T06:00', -2],
    ['2027-01-09T12:00', -1.5],
    ['2027-01-10T06:00', -3],
    ['2027-01-10T18:00', 2],
    ['2027-01-11T06:00', 9],
    ['2027-01-11T13:00', 12.5],
    ['2027-01-11T21:00', 10],
    ['2027-01-12T01:00', -3],
    ['2027-01-12T06:00', -8],
    ['2027-01-12T18:00', -10],
    ['2027-01-13T07:00', -11],
    ['2027-01-13T18:00', -8],
    ['2027-01-14T08:00', -5],
    ['2027-01-14T18:00', -3],
    ['2027-01-15T12:00', -4],
    ['2027-01-15T20:00', 0],
  ],
  utah: [
    ['2027-01-09T12:00', 0],
    ['2027-01-10T06:00', 1],
    ['2027-01-12T12:00', 1.5],
    ['2027-01-13T04:00', -1],
    ['2027-01-14T10:00', -3],
    ['2027-01-15T06:00', -5],
    ['2027-01-16T12:00', -3],
    ['2027-01-18T00:00', 0],
  ],
  colorado: [],
}

/** Jay Peak wind event (region-local times): summit sustained ~55–70 km/h, gusts ~95–115 km/h. */
export const WIND_EVENT = { resortId: 'jay-peak', from: '2027-01-14T16:00', to: '2027-01-15T16:00', summitKmh: [52, 18] as const, baseKmh: [24, 10] as const }
