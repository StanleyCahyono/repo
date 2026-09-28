/**
 * Label-based extraction for resort condition pages. Works on plain text lines (see text.ts / structured.ts), in
 * priority order: the first plausible match per field wins.
 *
 * Design rules
 * - A number is only taken when it directly follows (or, with an explicit unit, directly precedes) a known label.
 *   Numbers followed by hours/days/%, °, feet/metres, times, "of N" or another label are rejected.
 * - Units: ″ " ” '' in inch(es) → inches; cm → cm. A single ' or ′ means FEET and is rejected for snow.
 *   Unitless snow values are read in the adapter's declared unit (US resorts: inches) only for labels that name
 *   a snow quantity; the assumption is surfaced as a limitation. Plain "Base"/"Summit" need an explicit unit.
 * - Implausible candidates (e.g. 90″ in 24 h, open > total) are skipped, not clamped.
 * - Status is only taken from explicit wording ("Status: Open", "closed for the season"). Trail counts never
 *   imply "open", and announced dates never do either.
 */
import { DateTime } from 'luxon'
import type { OperatingStatus, SnowWindow, SurfaceTag } from '@/lib/domain/types'
import { CM_PER_IN } from '@/lib/domain/units'

export type SnowUnit = 'in' | 'cm'

export interface SnowValue {
  cm: number
  unit: SnowUnit
  /** True when no unit was printed and the adapter's declared unit was used. */
  assumed: boolean
  text: string
  rangeCm?: [number, number]
}

export interface CountValue {
  open: number | null
  total: number | null
  text: string
}

export interface Extraction {
  snowfall: Partial<Record<SnowWindow, SnowValue>>
  baseDepth: (SnowValue & { location: string | null }) | null
  summitDepth: SnowValue | null
  trails: CountValue | null
  lifts: CountValue | null
  beginnerTrails: CountValue | null
  openAcres: { value: number; text: string } | null
  surface: { text: string; tags: SurfaceTag[] } | null
  grooming: { text: string } | null
  groomedRuns: { value: number; text: string } | null
  snowmaking: { text: string } | null
  status: { value: OperatingStatus; text: string } | null
  reportDate: (ReportDate & { text: string }) | null
}

export type AnchorKey =
  | 'snowfall'
  | 'baseDepth'
  | 'summitDepth'
  | 'trails'
  | 'lifts'
  | 'beginnerTrails'
  | 'openAcres'
  | 'surface'
  | 'grooming'
  | 'groomedRuns'
  | 'snowmaking'
  | 'status'
  | 'reportDate'

export function anchorsFound(x: Extraction): AnchorKey[] {
  const out: AnchorKey[] = []
  if (Object.keys(x.snowfall).length) out.push('snowfall')
  for (const k of ['baseDepth', 'summitDepth', 'trails', 'lifts', 'beginnerTrails', 'openAcres', 'surface', 'grooming', 'groomedRuns', 'snowmaking', 'status', 'reportDate'] as const) {
    if (x[k]) out.push(k)
  }
  return out
}

// ---------------------------------------------------------------------------
// Snow values

const SEP = /^[\s:=|–—-]*/
const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(½|¼|¾)?`
const UNIT = String.raw`(″|"|”|''|inch(?:es)?\b|in\b\.?|cm\b|centimet(?:er|re)s?\b)`
const BAD_AFTER =
  /^\s*(?:%|°|[′'’](?!')|:\d|hours?\b|hrs?\b|h\b|days?\b|am\b|pm\b|a\.m|p\.m|m\b|meters?\b|metres?\b|ft\b|feet\b|mi\b|km\b|miles?\b|acres?\b|trails?\b|runs?\b|lifts?\b|of\b|out\s+of\b|\/\s*\d|mph\b|km\/h)/i
const FRACTION: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75 }

function toNumber(n: string, frac: string | undefined): number {
  return Number(n.replace(/,/g, '')) + (frac ? FRACTION[frac] : 0)
}

function unitOf(token: string | undefined, following: string): SnowUnit | null {
  if (!token) return null
  const t = token.toLowerCase()
  if (t.startsWith('c')) return 'cm'
  // "2 in the last 24 hours": "in" is a preposition there, not a unit.
  if ((t === 'in' || t === 'in.') && /^\s+(?:the|last|past|a|an)\b/i.test(following)) return null
  return 'in'
}

const round1 = (v: number) => Math.round(v * 10) / 10
const toCm = (v: number, u: SnowUnit) => round1(u === 'in' ? v * CM_PER_IN : v)

/**
 * Parse a snow amount at the start of `rest` (text right after a label). `assumedUnit` is used only when no unit
 * is printed; pass null to require an explicit unit.
 */
export function parseSnowAt(rest: string, assumedUnit: SnowUnit | null): SnowValue | null {
  let s = rest.replace(SEP, '')
  let headerUnit: SnowUnit | null = null
  const header = s.match(/^\((in|inches|cm)\)\s*[:=|–—-]?\s*/i)
  if (header) {
    headerUnit = header[1].toLowerCase().startsWith('c') ? 'cm' : 'in'
    s = s.slice(header[0].length)
  }
  if (/^(?:trace|tr\.?)\b/i.test(s)) {
    return { cm: 0, unit: headerUnit ?? assumedUnit ?? 'in', assumed: false, text: s.match(/^\S+/)![0] }
  }
  const range = new RegExp(`^${NUM}\\s*${UNIT}?\\s*(?:-|–|to)\\s*${NUM}\\s*${UNIT}?`, 'i').exec(s)
  if (range) {
    const after = s.slice(range[0].length)
    const u = unitOf(range[6], after) ?? unitOf(range[3], after) ?? headerUnit
    if (!u && BAD_AFTER.test(after)) return null
    const unit = u ?? assumedUnit
    if (!unit) return null
    const lo = toCm(toNumber(range[1], range[2]), unit)
    const hi = toCm(toNumber(range[4], range[5]), unit)
    if (hi < lo) return null
    return { cm: lo, unit, assumed: !u, text: range[0].trim(), rangeCm: [lo, hi] }
  }
  const single = new RegExp(`^${NUM}\\s*${UNIT}?`, 'i').exec(s)
  if (!single) return null
  const after = s.slice(single[0].length)
  const explicit = unitOf(single[3], after)
  if (!explicit) {
    // A unit token that was a preposition ("2 in the last…") leaves the value unitless.
    if (BAD_AFTER.test(single[3] ? s.slice(single[0].length - single[3].length) : after)) return null
  }
  const u = explicit ?? headerUnit
  const unit = u ?? assumedUnit
  if (!unit) return null
  return { cm: toCm(toNumber(single[1], single[2]), unit), unit, assumed: !u, text: (explicit ? single[0] : `${single[1]}${single[2] ?? ''}`).trim() }
}

// ---------------------------------------------------------------------------
// Labels

interface Hit {
  label: string
  rest: string
}

/** Every occurrence of `label` in `line`; when nothing but separators follows, the next line is the value. */
const globalCache = new Map<RegExp, RegExp>()
function globalOf(label: RegExp): RegExp {
  let re = globalCache.get(label)
  if (!re) {
    re = new RegExp(label.source, label.flags.includes('g') ? label.flags : `${label.flags}g`)
    globalCache.set(label, re)
  }
  re.lastIndex = 0
  return re
}

function hits(line: string, next: string | undefined, label: RegExp): Hit[] {
  const re = globalOf(label)
  const out: Hit[] = []
  for (const m of line.matchAll(re)) {
    // A value sits right after its label; a bounded window keeps huge single-line pages linear.
    const start = m.index! + m[0].length
    let rest = line.slice(start, start + 240)
    // Stop at the next table cell so "24 Hour | 48 Hour" never reads across cells.
    const cell = rest.search(/\s\|\s/)
    const cellRest = cell >= 0 ? rest.slice(0, cell) : rest
    if (cellRest.replace(SEP, '') === '' && cell < 0 && next !== undefined && start >= line.length - 240) rest = next.slice(0, 240)
    else rest = cellRest
    out.push({ label: m[0], rest })
  }
  return out
}

const SNOW_LABEL_SPECS: { window: SnowWindow; re: RegExp; unitless: boolean }[] = [
  { window: '24h', re: /\b(?:(?:past|last)\s+)?24[\s-]*(?:hours?|hrs?\.?|h)\b(?:\s+(?:new\s+)?(?:snow(?:fall)?|total|accumulation))?/i, unitless: true },
  { window: '48h', re: /\b(?:(?:past|last)\s+)?48[\s-]*(?:hours?|hrs?\.?|h)\b(?:\s+(?:new\s+)?(?:snow(?:fall)?|total|accumulation))?/i, unitless: true },
  { window: '72h', re: /\b(?:(?:past|last)\s+)?72[\s-]*(?:hours?|hrs?\.?|h)\b(?:\s+(?:new\s+)?(?:snow(?:fall)?|total|accumulation))?/i, unitless: true },
  { window: '7d', re: /\b(?:(?:past|last)\s+(?:7[\s-]*days?|seven\s+days|week)|7[\s-]*days?(?:\s+(?:snow(?:fall)?|total))?)\b/i, unitless: true },
  { window: 'storm', re: /\bstorm\s+total\b/i, unitless: true },
  {
    window: 'season',
    re: /\b(?:season(?:al)?\s+(?:total|snowfall|to\s+date)(?:\s+snowfall)?|(?:year|season)[\s-]to[\s-]date(?:\s+snowfall)?|total\s+snowfall(?:\s+to\s+date)?|season\s+total\s+snowfall)\b/i,
    unitless: true,
  },
  {
    window: 'overnight',
    re: /(?<!\d\s*(?:hours?|hrs?|h|days?)\s*)\b(?:new\s+snow(?:fall)?|overnight(?:\s+snow(?:fall)?)?|fresh\s+snow(?:fall)?)\b/i,
    unitless: true,
  },
]

/** Each window label plus its value-before-label form with an explicit unit (`2" new snow`, `5 cm in the last 24 hours`). */
const SNOW_LABELS = SNOW_LABEL_SPECS.map((spec) => ({
  ...spec,
  reverse: new RegExp(`${NUM}\\s*${UNIT}\\s*(?:of\\s+)?(?:in\\s+the\\s+)?(?:${spec.re.source})`, 'i'),
}))

/** Plausibility bounds in cm (per window / field). Beyond → candidate skipped. */
const MAX_CM: Record<SnowWindow | 'depth', number> = {
  overnight: 200,
  '24h': 250,
  '48h': 350,
  '72h': 450,
  '7d': 750,
  storm: 1000,
  season: 3000,
  depth: 1500,
}

const BASE_LABEL =
  /\b(?:(?:mid[\s-]mountain|upper[\s-]mountain|lower[\s-]mountain|base[\s-]area|average|settled)\s+)?(?:base\s+depth|snow\s+depth|depth\s+at\s+(?:the\s+)?base|base\s+range|base)\b(?:\s*\((?:in|inches|cm)\))?/i
const SUMMIT_LABEL = /\b(?:summit(?:\s+(?:depth|base))?|upper[\s-]mountain\s+depth|top\s+(?:of\s+mountain\s+)?depth)\b/i

const TRAIL_WORD = String.raw`(?:trails?|runs?|slopes?)`
const LIFT_WORD = String.raw`(?:lifts?|chair\s*lifts?|chairs?)`
const TRAIL_LABEL = String.raw`(?<!(?:beginner|green|easiest|groomed|night|glades?|nordic|cross[\s-]country|xc|tubing|snowshoe|uphill)\s)${TRAIL_WORD}`
const LIFT_LABEL = String.raw`(?<!(?:surface|tubing)\s)${LIFT_WORD}`
const BEGINNER_LABEL = String.raw`(?:beginner|green|easiest|novice)\s+(?:trails?|runs?|slopes?|terrain)`

type CountPattern = { re: RegExp; kind: 'both' | 'open' | 'total' }
const countCache = new Map<string, { patterns: CountPattern[]; trailing: RegExp }>()

function countPatterns(label: string): { patterns: CountPattern[]; trailing: RegExp } {
  const cached = countCache.get(label)
  if (cached) return cached
  const OF = String.raw`\s*(?:of|\/|out\s+of)\s*`
  const patterns: CountPattern[] = [
    { re: new RegExp(String.raw`(?:open\s+)?\b${label}\b(?:\s+open(?:ed)?)?\s*[:=|–—-]?\s*(\d{1,3})${OF}(\d{1,3})\b`, 'i'), kind: 'both' },
    { re: new RegExp(String.raw`\b(\d{1,3})${OF}(\d{1,3})\s+${label}\b`, 'i'), kind: 'both' },
    { re: new RegExp(String.raw`(?:\bopen\s+${label}\b|\b${label}\s+open\b)\s*[:=|–—-]?\s*(\d{1,3})\b(?!\s*(?:of\b|\/|out\b|%|\.\d))`, 'i'), kind: 'open' },
    { re: new RegExp(String.raw`\b(\d{1,3})\s+${label}\s+open\b`, 'i'), kind: 'open' },
    { re: new RegExp(String.raw`\btotal\s+${label}\b\s*[:=|–—-]?\s*(\d{1,3})\b(?!\s*(?:of\b|\/))`, 'i'), kind: 'total' },
  ]
  const entry = { patterns, trailing: new RegExp(String.raw`\b${label}\b(?:\s+open)?\s*[:=]?\s*$`, 'i') }
  countCache.set(label, entry)
  return entry
}

function parseCount(line: string, next: string | undefined, label: string, max: number): CountValue | null {
  const { patterns, trailing } = countPatterns(label)
  const candidates = [line]
  if (next !== undefined && trailing.test(line)) candidates.push(`${line} ${next}`)
  for (const text of candidates) {
    for (const p of patterns) {
      const m = p.re.exec(text)
      if (!m) continue
      const a = Number(m[1])
      const b = m[2] !== undefined ? Number(m[2]) : null
      const v: CountValue =
        p.kind === 'both' ? { open: a, total: b, text: m[0].trim() } : p.kind === 'open' ? { open: a, total: null, text: m[0].trim() } : { open: null, total: a, text: m[0].trim() }
      if (v.total !== null && (v.total === 0 || v.total > max)) continue
      if (v.open !== null && v.open > max) continue
      if (v.open !== null && v.total !== null && v.open > v.total) continue
      return v
    }
  }
  return null
}

function mergeCount(prev: CountValue | null, next: CountValue | null): CountValue | null {
  if (!prev) return next
  if (!next) return prev
  // Separate "Trails Open: 32" and "Total Trails: 55" lines combine; conflicting values keep the first.
  const open = prev.open ?? next.open
  const total = prev.total ?? next.total
  if (open !== null && total !== null && open > total) return prev
  return { open, total, text: prev.open !== null && prev.total !== null ? prev.text : `${prev.text}; ${next.text}` }
}

// Surface ---------------------------------------------------------------------

const SURFACE_LABEL = /\b(?:(?:primary|snow)\s+)?surface(?:\s+conditions?)?|\bsnow\s+conditions?|\bconditions(?=\s*[:=–—-])/i
const SURFACE_WORDS = /powder|packed|groom|hard|firm|\bic[ey]\b|granular|wet|slush|spring|corn|variable|crust|wind|machine|frozen|loose|soft|mixed|sticky|heavy/i

export function surfaceTagsFor(text: string): SurfaceTag[] {
  const tags = new Set<SurfaceTag>()
  let t = text.toLowerCase()
  if (/packed\s+powder/.test(t)) {
    tags.add('packed-powder')
    t = t.replace(/packed\s+powder/g, ' ')
  }
  if (/\bpowder\b|\bfresh\s+snow\b|\bnew\s+snow\b/.test(t)) tags.add('fresh-snow')
  if (/hard\s*-?\s*pack(?:ed)?|\bfirm\b/.test(t)) tags.add('firm')
  if (/\bicy\b|\bice\b|frozen\s+granular|re-?frozen|\bboilerplate\b/.test(t)) tags.add('icy-refrozen')
  if (/\bwet\b|\bslush/.test(t)) tags.add('wet-slushy')
  if (/\bspring\s+(?:snow|conditions)\b|\bcorn\b/.test(t)) tags.add('spring-snow')
  if (/\bwind[\s-]*(?:blown|affected|packed|scoured|buff|crust)/.test(t)) tags.add('wind-affected')
  if (/\bvariable\b|\bmixed\b/.test(t)) tags.add('mixed')
  return [...tags]
}

// Status ----------------------------------------------------------------------

function parseStatus(line: string): { value: OperatingStatus; text: string } | null {
  let m = line.match(/\bclosed\s+for\s+the\s+(?:\d{4}\s*[/–-]\s*\d{2,4}\s+)?season\b/i)
  if (m) return { value: 'closed-for-season', text: m[0] }
  m = line.match(/\bnot\s+yet\s+open(?:\s+for\s+the\s+(?:\d{4}\s*[/–-]\s*\d{2,4}\s+)?season)?\b/i)
  if (m) return { value: 'not-yet-open', text: m[0] }
  // "Mountain Status: Open" / "Status: Closed" — but not legends such as "Status: Open / Closed".
  m = line.match(
    /\b(?:(?:mountain|resort|operating|operations|lift\s+operations|today'?s?|current)\s+status\s*[:=|–—-]?|status\s*:)\s*(open|closed|partially\s+open|limited\s+operations|on\s+hold|delayed(?:\s+opening)?)\b(?!\s*(?:[/|,]|or\b|and\b)?\s*(?:open|closed)\b)/i,
  )
  if (m) {
    const w = m[1].toLowerCase()
    const value: OperatingStatus = w === 'open' ? 'open' : w.startsWith('partially') || w.startsWith('limited') ? 'partially-open' : 'temporarily-closed'
    return { value, text: m[0] }
  }
  m = line.match(/\b(?:we\s+are|the\s+mountain\s+is|the\s+resort\s+is|mountain\s+is)\s+(open|closed)\s+today\b/i)
  if (m) return { value: m[1].toLowerCase() === 'open' ? 'open' : 'temporarily-closed', text: m[0] }
  return null
}

const DATE_LABEL = /\b(?:last\s+updated|updated|report\s+date|reported(?:\s+on)?|conditions\s+as\s+of|as\s+of)\b\s*(?:on|at)?\s*[:=|–—-]?\s*/i

// ---------------------------------------------------------------------------

export function emptyExtraction(): Extraction {
  return {
    snowfall: {},
    baseDepth: null,
    summitDepth: null,
    trails: null,
    lifts: null,
    beginnerTrails: null,
    openAcres: null,
    surface: null,
    grooming: null,
    groomedRuns: null,
    snowmaking: null,
    status: null,
    reportDate: null,
  }
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * Extract labelled facts from lines, in order (earlier lines win per field). `assumedSnowUnit` applies only to
 * unitless values after snow-quantity labels.
 */
export function extractFromLines(
  lines: readonly string[],
  opts: { assumedSnowUnit: SnowUnit | null; timezone: string; now: string },
): Extraction {
  const x = emptyExtraction()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const next = lines[i + 1]

    for (const spec of SNOW_LABELS) {
      if (x.snowfall[spec.window]) continue
      for (const h of hits(line, next, spec.re)) {
        const v = parseSnowAt(h.rest, spec.unitless ? opts.assumedSnowUnit : null)
        if (v && v.cm <= MAX_CM[spec.window]) {
          x.snowfall[spec.window] = { ...v, text: `${h.label.trim()} ${v.text}` }
          break
        }
      }
      if (!x.snowfall[spec.window]) {
        // Value-before-label with an explicit unit: `2" new snow`, `5 cm in the last 24 hours`.
        const rev = spec.reverse.exec(line)
        if (rev) {
          const unit = rev[3].toLowerCase().startsWith('c') ? 'cm' : 'in'
          const cm = toCm(toNumber(rev[1], rev[2]), unit)
          if (cm <= MAX_CM[spec.window]) x.snowfall[spec.window] = { cm, unit, assumed: false, text: rev[0].trim() }
        }
      }
    }

    if (!x.baseDepth) {
      for (const h of hits(line, next, BASE_LABEL)) {
        const namesDepth = /depth|\((?:in|inches|cm)\)/i.test(h.label)
        const v = parseSnowAt(h.rest, namesDepth ? opts.assumedSnowUnit : null)
        if (v && (v.rangeCm?.[1] ?? v.cm) <= MAX_CM.depth) {
          const loc = h.label.match(/mid[\s-]mountain|upper[\s-]mountain|lower[\s-]mountain|base[\s-]area/i)?.[0] ?? null
          x.baseDepth = { ...v, text: `${h.label.trim()} ${v.text}`, location: loc }
          break
        }
      }
    }
    if (!x.summitDepth) {
      for (const h of hits(line, next, SUMMIT_LABEL)) {
        const v = parseSnowAt(h.rest, /depth/i.test(h.label) ? opts.assumedSnowUnit : null)
        if (v && v.cm <= MAX_CM.depth) {
          x.summitDepth = { ...v, text: `${h.label.trim()} ${v.text}` }
          break
        }
      }
    }

    if (!x.beginnerTrails || x.beginnerTrails.total === null) x.beginnerTrails = mergeCount(x.beginnerTrails, parseCount(line, next, BEGINNER_LABEL, 400))
    if (!x.trails || x.trails.open === null || x.trails.total === null) x.trails = mergeCount(x.trails, parseCount(line, next, TRAIL_LABEL, 400))
    if (!x.lifts || x.lifts.open === null || x.lifts.total === null) x.lifts = mergeCount(x.lifts, parseCount(line, next, LIFT_LABEL, 60))

    if (!x.openAcres) {
      const m = line.match(/\b(?:open\s+acres|acres\s+open|skiable\s+acres\s+open|open\s+terrain\s*\(acres\))\s*[:=|–—-]?\s*(\d{1,3}(?:,\d{3})*|\d+)\b|\b(\d{1,3}(?:,\d{3})*|\d+)\s+acres\s+open\b/i)
      if (m) {
        const value = Number((m[1] ?? m[2]).replace(/,/g, ''))
        if (value <= 20_000) x.openAcres = { value, text: m[0].trim() }
      }
    }

    if (!x.surface) {
      for (const h of hits(line, next, SURFACE_LABEL)) {
        const text = h.rest.replace(SEP, '').trim()
        if (text.length >= 3 && text.length <= 160 && SURFACE_WORDS.test(text) && !/\d{1,3}\s*(?:of|\/)\s*\d/.test(text)) {
          x.surface = { text: cut(text, 160), tags: surfaceTagsFor(text) }
          break
        }
      }
    }

    if (!x.groomedRuns) {
      const m =
        line.match(/\bgroomed\s+(?:trails|runs|slopes)\s*[:=|–—-]?\s*(\d{1,3})\b(?:\s*(?:of|\/)\s*\d{1,3})?(?!\s*%)/i) ??
        line.match(/\b(\d{1,3})\s+(?:trails|runs|slopes)\s+groomed\b/i)
      if (m && Number(m[1]) <= 400) x.groomedRuns = { value: Number(m[1]), text: m[0].trim() }
    }
    if (!x.grooming) {
      const m = line.match(/\bgrooming(?:\s+report)?\s*[:=|–—-]\s*(.{3,200})/i)
      if (m) x.grooming = { text: cut(m[1].trim(), 200) }
      else if (/\b(?:were|was|have\s+been|has\s+been|are)\s+groomed\b|\bgroomed\s+(?:overnight|last\s+night|this\s+morning)\b/i.test(line) && line.length <= 200) {
        x.grooming = { text: line }
      }
    }
    if (!x.snowmaking) {
      const m = line.match(/\bsnowmaking\s*[:=|–—-]\s*(.{3,200})/i)
      if (m) x.snowmaking = { text: cut(m[1].trim(), 200) }
    }
    if (!x.status) x.status = parseStatus(line)
    if (!x.reportDate) {
      // Only a parseable date counts: "Stay updated…" or "updated 3 times daily" must not block a later stamp.
      const m = DATE_LABEL.exec(line)
      if (m) {
        const rest = line.slice(m.index + m[0].length).trim() || (next ?? '')
        const d = /\d/.test(rest) ? parseReportDate(rest.slice(0, 80), opts.timezone, opts.now) : null
        if (d) x.reportDate = { ...d, text: cut(rest, 80) }
      }
    }
  }
  return x
}

// ---------------------------------------------------------------------------
// Report dates

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export interface ReportDate {
  localDate: string
  /** Null when the page gives a date but no time (no invented precision). */
  instant: string | null
}

/**
 * Parse a report timestamp printed on the page, interpreted in the resort zone. Accepts ISO-8601, "January 15,
 * 2027 7:02 AM", "Jan 15 7:02am", "1/15/2027 7:02 AM", "Friday, January 15, 2027". A missing year is taken from
 * `now` (previous year if that would be > 1 day in the future). Future stamps (> now + 6 h) are rejected.
 */
export function parseReportDate(text: string, tz: string, now: string): ReportDate | null {
  const nowDt = DateTime.fromISO(now, { zone: 'utc' }).setZone(tz)
  const finish = (dt: DateTime, hasTime: boolean): ReportDate | null => {
    if (!dt.isValid) return null
    if (dt.toMillis() > nowDt.toMillis() + 6 * 3_600_000) return null
    return { localDate: dt.toISODate()!, instant: hasTime ? dt.toUTC().toISO()! : null }
  }

  const iso = text.match(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/)
  if (iso) {
    const hasTime = /[T ]\d{2}:\d{2}/.test(iso[0])
    return finish(DateTime.fromISO(iso[0].replace(' ', 'T'), { zone: tz }).setZone(tz), hasTime)
  }

  const t = text.replace(/\b(a|p)\.\s?m\.?/gi, '$1m')
  const time = t.match(/\b(\d{1,2}):(\d{2})\s*([ap])m\b/i) ?? t.match(/\b(\d{1,2})\s*([ap])m\b/i)
  let hour: number | null = null
  let minute = 0
  if (time) {
    const h = Number(time[1])
    const meridiem = (time.length === 4 ? time[3] : time[2]).toLowerCase()
    minute = time.length === 4 ? Number(time[2]) : 0
    if (h >= 1 && h <= 12 && minute < 60) hour = (h % 12) + (meridiem === 'p' ? 12 : 0)
  } else {
    const h24 = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
    if (h24) {
      hour = Number(h24[1])
      minute = Number(h24[2])
    }
  }

  let year: number | null = null
  let month: number | null = null
  let day: number | null = null
  const named = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b,?\s*(\d{4})?/i)
  const numeric = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)
  if (named) {
    month = MONTHS.indexOf(named[1].toLowerCase().slice(0, 3)) + 1
    day = Number(named[2])
    year = named[3] ? Number(named[3]) : null
  } else if (numeric) {
    month = Number(numeric[1])
    day = Number(numeric[2])
    year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : null
  } else {
    return null
  }
  if (year === null) {
    year = nowDt.year
    const probe = DateTime.fromObject({ year, month, day }, { zone: tz })
    if (probe.isValid && probe.toMillis() > nowDt.plus({ days: 1 }).toMillis()) year -= 1
  }
  const dt = DateTime.fromObject({ year, month, day, hour: hour ?? 0, minute }, { zone: tz })
  return finish(dt, hour !== null)
}
