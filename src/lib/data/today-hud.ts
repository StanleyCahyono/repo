/**
 * Today (Glass HUD): one read model for the redesigned dashboard.
 *
 * - Hero: the answer in one line ("Nothing near home is open yet." in preseason), a lead built from the next openings
 *   and the home mountain's opening, and the home mountain (nearest resort to home) with its drive estimate.
 * - World season: a Sep → Jul timeline for a handful of resorts in both hemispheres — open, announced, Piste-estimated
 *   and "end not known" spans, from stored season dates and status statements only. Nothing is turned into "Open"
 *   unless an opening or an open statement is on record.
 * - Opening countdown: the next openings worldwide (announced first-class, estimates labelled "est.").
 * - 7-day snow at the home mountain: stored modeled snowfall (the same strip engine as before), or "not fetched".
 * - Pass deadlines: a price change that just happened, else the next purchase-by date, else the home mountain's
 *   current pass price; other current adult prices on file; and dated notes on sales. Families with no price on file
 *   are simply not listed (nothing is invented in their place).
 */
import 'server-only'
import { and, count, gte, lt } from 'drizzle-orm'
import * as schema from '@/lib/db/schema'
import type { Ctx } from '@/lib/context'
import { getFreshness, type FreshnessView } from '@/lib/data/freshness'
import { getPassesView, type PassProductView } from '@/lib/data/passes'
import { greatCircleKm } from '@/lib/domain/geo'
import { formatMoney, type Money } from '@/lib/domain/money'
import { addDays, daysBetween, formatLocalDate, hemisphereOf } from '@/lib/domain/time'
import { formatDistance, formatDuration, formatElevation, formatSnow, formatTemp, snowValue } from '@/lib/domain/units'
import type { UnitPrefs } from '@/lib/domain/types'
import { currentReports, loadBundle, resortSeasonFor, type Bundle } from './core'
import { buildSummaries, type ResortSummary } from './resorts'
import { getRecommendation, stripFor } from './today'

export type SpanKind = 'open' | 'announced' | 'estimate' | 'fade' | 'past'

export interface SeasonSpan {
  kind: SpanKind
  /** Percent of the timeline window (0–100). */
  left: number
  width: number
}

export interface WorldRow {
  resortId: string
  name: string
  /** "NY", "AT", "JP" … */
  place: string
  home: boolean
  note: string
  spans: SeasonSpan[]
}

export interface WorldSeason {
  /** Month ticks across the window. */
  months: { label: string; left: number }[]
  todayLeft: number
  north: WorldRow[]
  south: WorldRow[]
  shown: number
  total: number
  /** Resorts with an open / partially-open statement or an actual opening on record (worldwide). */
  open: { id: string; name: string }[]
  /** "Driving range: nothing open" / "Driving range: Greek Peak open" */
  todayTitle: string
  /** "Open worldwide: … · Next: Hintertux, tomorrow" */
  todayDetail: string
  /** "Next: Hintertux, tomorrow" (the soonest opening in the countdown), or null. */
  nextLabel: string | null
}

export interface Countdown {
  resortId: string
  name: string
  date: string
  days: number
  estimate: boolean
  /** "2 OCT" / "EST. 28 NOV" */
  sub: string
  /** One sentence for the detail line. */
  detail: string
}

export interface SnowDay {
  date: string
  /** "THU 1" */
  label: string
  /** Larger of base/summit modeled snowfall; null = not fetched for that day. */
  snowCm: number | null
  snow: string | null
  /** The amount without a spaced unit, for narrow day columns: "1.2″" (inches) or "12" (cm; the unit is in the legend). */
  snowShort: string | null
  partial: boolean
  /** "27° / 13°" (for the detail line). */
  temps: string | null
  /** "27°" / "13°" — stacked high over low in the day column. */
  hi: string | null
  lo: string | null
}

export interface PassPriceLine {
  productId: string
  /** "Ikon Pass", "Greek Peak Unlimited Season Pass" */
  name: string
  /** "$999" */
  price: string
  /** "Adult · until 9 Oct" */
  note: string | null
}

export interface PassTier {
  price: string
  /** "Until 30 Sep" / "From 1 Oct" */
  label: string
  /** The step on sale today. */
  current: boolean
  /** Its purchase-by date has passed. */
  past: boolean
}

export interface PassCard {
  /**
   * The headline price: a change that just happened ('change'), the next purchase-by deadline ('deadline'), or the
   * home mountain's (else the first) current adult price ('current'). Null when no current price is on file.
   */
  headline:
    | (PassPriceLine & {
        kind: 'change' | 'deadline' | 'current'
        detail: string | null
        sourceUrl: string | null
        /** The product's dated price steps for that category ("$799 until 30 Sep → $999 from 1 Oct"), when it has two or more. */
        tiers: PassTier[]
      })
    | null
  /** Other current adult prices on file (owned and the big families first), at most three. */
  others: PassPriceLine[]
  /** Dated notes on sales ("Indy Pass: sold out in Sept 2026."), at most two. */
  notes: string[]
}

export interface HomeMountain {
  id: string
  name: string
  href: string
  /** "33 MIN · 32 KM · 350–640 M" (missing parts left out, never invented). */
  facts: string
  /** "Greek Peak · est. 28 Nov – 5 Dec · Piste estimate" */
  chip: string
  chipTone: 'estimate' | 'announced' | 'open' | 'unknown'
}

export interface TodayHud {
  today: string
  /** "THURSDAY 1 OCTOBER 2026 · PRESEASON" */
  dateLine: string
  headline: string
  lead: string
  home: HomeMountain | null
  world: WorldSeason
  countdowns: Countdown[]
  snow: { resortName: string | null; days: SnowDay[]; fetchedAt: string | null; snowUnit: 'in' | 'cm'; tempUnit: '°F' | '°C' }
  passes: PassCard
  freshness: FreshnessView | null
  units: UnitPrefs
  /** Resorts open now (status statement or an actual opening on record), nearest by drive first, at most six. */
  openNow: { id: string; name: string; place: string; drive: string | null }[]
  /** Avatar caption facts: ability and ski days logged this season (real records only). */
  ability: string
  daysLogged: number
}

const MAX_NORTH = 7
const MAX_SOUTH = 3
const COUNTDOWN_HORIZON_DAYS = 90
const RING_SCALE_DAYS = 60

const isOpen = (s: string | null | undefined) => s === 'open' || s === 'partially-open'

function placeOf(s: Pick<ResortSummary, 'country' | 'stateProvince'>): string {
  return s.stateProvince && s.stateProvince.length <= 3 && (s.country === 'US' || s.country === 'CA' || s.country === 'AU') ? s.stateProvince : s.country
}

function relDays(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

const short = (d: string) => formatLocalDate(d, 'd LLL')

/** The resort with the shortest drive (name only). */
const nearestName = (list: ResortSummary[]) => {
  const s = [...list].sort((a, b) => (a.travel.driveMinutes ?? Infinity) - (b.travel.driveMinutes ?? Infinity))[0]
  return s.shortName || s.name
}

/** The planning season's window: 1 Sep of its first year to 1 Jul of the next. */
function windowOf(seasonId: string): { from: string; to: string } {
  const y = Number(seasonId.slice(0, 4))
  return { from: `${y}-09-01`, to: `${y + 1}-07-01` }
}

function makeScale(from: string, to: string) {
  const span = daysBetween(from, to)
  const pct = (d: string) => Math.max(0, Math.min(100, (daysBetween(from, d) / span) * 100))
  const seg = (kind: SpanKind, a: string, b: string): SeasonSpan | null => {
    const l = pct(a < from ? from : a)
    const r = pct(b > to ? to : b)
    return r > l ? { kind, left: +l.toFixed(2), width: +(r - l).toFixed(2) } : null
  }
  return { pct, seg }
}

function worldRow(b: Bundle, s: ResortSummary, homeId: string | null, win: { from: string; to: string }, today: string): WorldRow {
  const { seg } = makeScale(win.from, win.to)
  const rec = b.byId.get(s.id)!.row
  const st = b.status.get(s.id)
  const spans: (SeasonSpan | null)[] = []
  const notes: string[] = []
  const south = hemisphereOf(s.lat) === 'south'
  // The winter running now (south: the planning season before), then the next one.
  const nowRow = b.seasons.get(`${s.id}|${resortSeasonFor(rec, today)}`)
  const nextRow = b.seasons.get(`${s.id}|${b.seasonId}`)

  const openNow = isOpen(st?.status) || (!!nowRow?.actualOpening && nowRow.actualOpening <= today && !(nowRow.actualClosing && nowRow.actualClosing <= today))
  if (openNow) {
    const start = nowRow?.actualOpening ?? today
    const end = nowRow?.announcedClosing
    if (end) {
      spans.push(seg('open', start, end))
      notes.push(`Open · until ${short(end)}`)
    } else {
      spans.push(seg('open', start, today), seg('fade', today, addDays(today, 45)))
      notes.push('Open · end not announced')
    }
  } else if (st?.status === 'closed-for-season' && st.localDate && st.localDate >= win.from) {
    spans.push(seg('past', win.from, st.localDate))
    notes.push(`Closed ${short(st.localDate)}`)
  }

  const row = south ? nextRow : (nextRow ?? nowRow)
  if (row && !(openNow && row === nowRow)) {
    if (row.actualOpening && row.actualOpening <= today) {
      // Opened (on record) and not running now: closed since.
    } else if (row.announcedOpening) {
      const days = daysBetween(today, row.announcedOpening)
      if (row.announcedClosing) spans.push(seg('announced', row.announcedOpening, row.announcedClosing))
      else spans.push(seg('fade', row.announcedOpening, addDays(row.announcedOpening, 80)))
      // An announced date that has passed never turns into "Open": without an open statement it stays announced.
      if (days < 0) notes.push(`Announced ${short(row.announcedOpening)} · no status yet`)
      else if (row.announcedClosing && days > 1) notes.push(`${short(row.announcedOpening)} – ${short(row.announcedClosing)}`)
      else notes.push(`Opens ${short(row.announcedOpening)}${days <= 7 ? ` · ${relDays(days)}` : ''}`)
    } else if (row.estimatedOpenFrom) {
      spans.push(seg('estimate', row.estimatedOpenFrom, addDays(row.estimatedOpenFrom, 55)))
      notes.push(south ? `Est. ${formatLocalDate(row.estimatedOpenFrom, 'd LLL yyyy')}` : `Est. ${short(row.estimatedOpenFrom)} · not announced`)
    } else if (!openNow) notes.push('Not announced')
  } else if (!row && !openNow) notes.push('Not announced')

  return {
    resortId: s.id,
    name: s.shortName || s.name,
    place: s.id === homeId ? `${placeOf(s)} · HOME` : placeOf(s),
    home: s.id === homeId,
    note: notes.map((n, i) => (i > 0 && n.startsWith('Est.') ? `est.${n.slice(4)}` : n)).join(' · '),
    spans: spans.filter((x): x is SeasonSpan => !!x),
  }
}

/** When a resort's next opening is (announced or the start of a Piste estimate), for ordering. */
function nextOpening(s: ResortSummary): string | null {
  return s.opening.label === 'announced' || s.opening.label === 'estimated' ? s.opening.date : null
}

function pickRows(list: ResortSummary[], max: number, first: (s: ResortSummary) => boolean): ResortSummary[] {
  const picked: ResortSummary[] = []
  const take = (s: ResortSummary) => {
    if (picked.length < max && !picked.includes(s)) picked.push(s)
  }
  list.filter(first).forEach(take)
  list.filter((s) => s.isFavorite).forEach(take)
  list.filter((s) => s.status.status === 'open' || s.status.status === 'partially-open').forEach(take)
  const dated = list.filter((s) => nextOpening(s)).sort((a, b) => Number(b.opening.label === 'announced') - Number(a.opening.label === 'announced') || nextOpening(a)!.localeCompare(nextOpening(b)!))
  // Announced openings by date, then estimates by date (so a full row of estimates never hides an announced date) —
  // first one per country, so the timeline spans regions, then the rest.
  const seen = new Set(picked.map((p) => p.country))
  for (const d of dated) {
    if (seen.has(d.country)) continue
    seen.add(d.country)
    take(d)
  }
  dated.forEach(take)
  list.filter((s) => s.status.status === 'closed-for-season').forEach(take)
  return picked.sort((a, b) => Number(first(b)) - Number(first(a)) || (nextOpening(a) ?? '9999').localeCompare(nextOpening(b) ?? '9999') || a.name.localeCompare(b.name))
}

function countdowns(summaries: ResortSummary[], today: string): Countdown[] {
  return summaries
    .filter((s) => {
      const d = nextOpening(s)
      return d && d > today && daysBetween(today, d) <= COUNTDOWN_HORIZON_DAYS
    })
    .sort((a, b) => nextOpening(a)!.localeCompare(nextOpening(b)!) || Number(b.opening.label === 'announced') - Number(a.opening.label === 'announced') || a.name.localeCompare(b.name))
    .slice(0, 6)
    .map((s) => {
      const date = nextOpening(s)!
      const est = s.opening.label === 'estimated'
      const name = s.shortName || s.name
      const days = daysBetween(today, date)
      const detail = est
        ? `${name}: ${short(date)}${s.opening.to ? ` – ${short(s.opening.to)}` : ''} is a Piste estimate${s.opening.basis ? ` (${s.opening.basis.replace(/^Piste estimate /, '').replace(/\.$/, '')})` : ''}. The resort hasn’t announced.`
        : `${name} opens ${formatLocalDate(date, 'ccc d LLL')}${s.opening.text ? `. ${s.opening.text.replace(/\.$/, '')}` : ''}.`
      return { resortId: s.id, name, date, days, estimate: est, sub: `${est ? 'EST. ' : ''}${formatLocalDate(date, 'd LLL').toUpperCase()}`, detail }
    })
}

const BIG_FAMILIES = ['ikon', 'epic', 'indy', 'mountain-collective']
/** A stored amount as display text (amounts here are never null). */
const price = (m: Money) => formatMoney(m) ?? ''
const productName = (p: PassProductView) => p.name.replace(/ 20\d\d-\d\d$/, '')
const categoryLabel = (c: string | null) => (c ? c[0].toUpperCase() + c.slice(1).toLowerCase() : 'Adult')

/** A product's price steps for one category, in purchase-by order (open-ended last); empty with fewer than two. */
function tiersOf(p: PassProductView, category: string | null, currentId: number | null): PassTier[] {
  const same = p.prices
    .filter((x) => (x.category ?? '').toLowerCase() === (category ?? '').toLowerCase() && !x.expired && x.quoteKind !== 'demo')
    .sort((a, b) => (a.purchaseBy ?? '9999-12-31').localeCompare(b.purchaseBy ?? '9999-12-31'))
  if (same.length < 2) return []
  return same.map((x, i) => {
    const prevBy = i > 0 ? same[i - 1].purchaseBy : null
    const label = x.purchaseBy ? `Until ${formatLocalDate(x.purchaseBy, 'd LLL')}` : prevBy ? `From ${formatLocalDate(addDays(prevBy, 1), 'd LLL')}` : 'Later'
    return { price: price(x.amount), label, current: x.id === currentId, past: x.purchaseClosed }
  })
}

const HEARSAY = /^(reports?|rumou?rs?|sources)\s+(say|said|suggest|indicate)|\breportedly\b|\bunconfirmed\b/i

function passCard(products: PassProductView[], homeId: string | null, today: string): PassCard {
  let headline: PassCard['headline'] = null

  // A price change that has just happened (a purchase-by tier passed in the last 14 days), home mountain first.
  const changes = products.flatMap((p) => {
    const cur = p.currentPrice
    if (!cur) return []
    const prev = p.prices
      .filter((x) => x.purchaseBy && x.purchaseBy < today && daysBetween(x.purchaseBy, today) <= 14 && (x.category ?? '') === (cur.category ?? '') && x.amount.amountMinor !== cur.amount.amountMinor)
      .sort((a, b) => b.purchaseBy!.localeCompare(a.purchaseBy!))[0]
    return prev ? [{ p, cur, prev }] : []
  })
  changes.sort((a, b) => Number(b.p.resortId === homeId) - Number(a.p.resortId === homeId) || Number(b.p.ownedByMe) - Number(a.p.ownedByMe))
  const ch = changes[0]
  if (ch) {
    headline = {
      kind: 'change',
      productId: ch.p.id,
      name: productName(ch.p),
      price: price(ch.cur.amount),
      note: categoryLabel(ch.cur.category),
      detail: `New price from ${formatLocalDate(addDays(ch.prev.purchaseBy!, 1), 'd LLL')} · was ${formatMoney(ch.prev.amount)}`,
      sourceUrl: ch.cur.prov.sourceUrl ?? null,
      tiers: tiersOf(ch.p, ch.cur.category, ch.cur.id),
    }
  } else {
    // Otherwise the next purchase-by date.
    const next = products
      .flatMap((p) => p.prices.filter((x) => x.purchaseBy && x.purchaseBy >= today && !x.purchaseClosed && !x.expired && x.quoteKind !== 'demo').map((x) => ({ p, x })))
      .sort((a, b) => a.x.purchaseBy!.localeCompare(b.x.purchaseBy!))[0]
    if (next) {
      const days = daysBetween(today, next.x.purchaseBy!)
      headline = {
        kind: 'deadline',
        productId: next.p.id,
        name: productName(next.p),
        price: price(next.x.amount),
        note: categoryLabel(next.x.category),
        detail: `Until ${formatLocalDate(next.x.purchaseBy!, 'd LLL')} · ${days === 0 ? 'last day' : days === 1 ? '1 day left' : `${days} days left`}`,
        sourceUrl: next.x.prov.sourceUrl ?? null,
        tiers: tiersOf(next.p, next.x.category, next.x.id),
      }
    } else {
      // Otherwise the price you could buy at today: your own pass first, then the home mountain's, then a big family's.
      const cur = products
        .filter((p) => p.currentPrice)
        .sort(
          (a, b) =>
            Number(b.ownedByMe) - Number(a.ownedByMe) ||
            Number(b.resortId === homeId && !!homeId) - Number(a.resortId === homeId && !!homeId) ||
            Number(BIG_FAMILIES.includes(b.familyId)) - Number(BIG_FAMILIES.includes(a.familyId)),
        )[0]
      if (cur?.currentPrice) {
        headline = {
          kind: 'current',
          productId: cur.id,
          name: productName(cur),
          price: price(cur.currentPrice.amount),
          note: categoryLabel(cur.currentPrice.category),
          detail: 'Current price',
          sourceUrl: cur.currentPrice.prov.sourceUrl ?? null,
          tiers: tiersOf(cur, cur.currentPrice.category, cur.currentPrice.id),
        }
      }
    }
  }

  // Other current adult prices: your passes, then the big families, then the home mountain's, then other resorts'.
  const rank = (p: PassProductView) => (p.ownedByMe ? 0 : BIG_FAMILIES.includes(p.familyId) ? 1 : p.resortId === homeId && homeId ? 2 : 3)
  const others: PassPriceLine[] = products
    .filter((p) => p.currentPrice && p.id !== headline?.productId)
    .sort((a, b) => rank(a) - rank(b) || a.currentPrice!.amount.amountMinor - b.currentPrice!.amount.amountMinor)
    .slice(0, 3)
    .map((p) => ({
      productId: p.id,
      name: productName(p),
      price: price(p.currentPrice!.amount),
      note: [categoryLabel(p.currentPrice!.category), p.currentPrice!.purchaseBy ? `until ${formatLocalDate(p.currentPrice!.purchaseBy, 'd LLL')}` : null].filter(Boolean).join(' · '),
    }))

  // Sales notes (deduplicated wording) — the big families always, resort passes only for the home mountain.
  const byText = new Map<string, string[]>()
  for (const p of products) {
    const text = p.salesDeadline?.text?.trim()
    if (!text || p.id === headline?.productId) continue
    // Hearsay ("Reports say …", flagged unconfirmed in the catalog) is not a verified fact, so Today leaves it out.
    if (HEARSAY.test(text)) continue
    if (p.familyId === 'regional' && p.resortId !== homeId) continue
    if (p.prices.some((x) => x.purchaseBy && x.purchaseBy < today) && !p.prices.some((x) => !x.purchaseClosed)) continue
    byText.set(text, [...(byText.get(text) ?? []), p.familyId === 'regional' ? (p.resortName ?? p.familyName) : p.familyName])
  }
  const notes = [...byText].slice(0, 2).map(([text, fams]) => {
    const names = [...new Set(fams)]
    return names.some((n) => text.includes(n.replace(/ Pass$/, ''))) ? text : `${names.join(', ')}: ${text}`
  })
  return { headline, others, notes }
}

export async function getTodayHud(ctx: Ctx): Promise<TodayHud> {
  const today = ctx.today
  const units = ctx.prefs.units
  const b = await loadBundle(ctx, { seasons: [ctx.prefs.activeSeasonId] })
  const win = windowOf(b.seasonId)
  const [summaries, reportsNow, rec, pv, freshness, [logged]] = await Promise.all([
    buildSummaries(b, { date: today, mode: ctx.prefs.scoringMode }),
    currentReports(b),
    getRecommendation(ctx),
    getPassesView(ctx),
    getFreshness(ctx),
    ctx.db
      .select({ n: count() })
      .from(schema.skiDayLogs)
      .where(and(gte(schema.skiDayLogs.date, addDays(win.from, -60)), lt(schema.skiDayLogs.date, win.to))),
  ])

  // Home mountain: the nearest resort to home.
  const homePt = { lat: ctx.prefs.homeLat, lon: ctx.prefs.homeLon }
  const nearest = summaries
    .filter((s) => typeof s.lat === 'number' && typeof s.lon === 'number')
    .map((s) => ({ s, km: greatCircleKm(homePt, { lat: s.lat!, lon: s.lon! }) }))
    .sort((a, b2) => a.km - b2.km)[0]
  const hs = nearest && nearest.km < 300 ? nearest.s : null

  let home: HomeMountain | null = null
  if (hs) {
    const tr = hs.travel
    const elev = hs.baseElevationM != null && hs.summitElevationM != null ? `${formatElevation(hs.baseElevationM, units)?.replace(/ ?(m|ft)$/, '')}–${formatElevation(hs.summitElevationM, units)}` : null
    const facts = [tr.driveMinutes != null ? `${tr.isEstimate ? '~' : ''}${tr.driveMinutes} min` : null, tr.km != null ? formatDistance(tr.km, units) : null, elev].filter(Boolean).join(' · ').toUpperCase()
    const o = hs.opening
    const name = hs.shortName || hs.name
    const chip =
      isOpen(hs.status.status) || o.label === 'opened'
        ? { chip: `${name} · open`, tone: 'open' as const }
        : o.label === 'announced' && o.date
          ? { chip: `${name} · opens ${short(o.date)} · announced`, tone: 'announced' as const }
          : o.label === 'estimated' && o.date
            ? { chip: `${name} · est. ${short(o.date)}${o.to ? ` – ${short(o.to)}` : ''} · Piste estimate`, tone: 'estimate' as const }
            : { chip: `${name} · opening not announced`, tone: 'unknown' as const }
    home = { id: hs.id, name, href: `/resorts/${hs.id}`, facts, chip: chip.chip, chipTone: chip.tone }
  }

  // World season.
  const { pct } = makeScale(win.from, win.to)
  const north = summaries.filter((s) => hemisphereOf(s.lat) === 'north')
  const south = summaries.filter((s) => hemisphereOf(s.lat) === 'south')
  const homeId = hs?.id ?? null
  const northRows = pickRows(north, MAX_NORTH, (s) => s.id === homeId).map((s) => worldRow(b, s, homeId, win, today))
  const southRows = pickRows(south, MAX_SOUTH, () => false).map((s) => worldRow(b, s, homeId, win, today))
  const months: WorldSeason['months'] = []
  for (let d = win.from; d < win.to; d = addDays(d, 32).slice(0, 8) + '01') months.push({ label: formatLocalDate(d, 'LLL').toUpperCase(), left: +pct(d).toFixed(2) })
  const openAll = summaries.filter((s) => isOpen(s.status.status) || s.opening.label === 'opened')
  const nearOpen = openAll.filter((s) => s.travel.driveMinutes != null && (ctx.prefs.travel.maxDriveHours == null || s.travel.driveMinutes <= ctx.prefs.travel.maxDriveHours * 60))
  const cds = countdowns(summaries, today)
  const next = cds[0]
  const world: WorldSeason = {
    months,
    todayLeft: +pct(today).toFixed(2),
    north: northRows,
    south: southRows,
    shown: northRows.length + southRows.length,
    total: summaries.length,
    open: openAll.map((s) => ({ id: s.id, name: s.shortName || s.name })),
    todayTitle: !nearOpen.length
      ? 'Driving range: nothing open'
      : nearOpen.length === 1
        ? `Driving range: ${nearOpen[0].shortName || nearOpen[0].name} open`
        : `Driving range: ${nearOpen.length} open · ${nearestName(nearOpen)} nearest`,
    todayDetail: [
      openAll.length ? `Open worldwide: ${openAll.map((s) => s.shortName || s.name).join(', ')}` : 'No open status on record worldwide',
      next ? `Next: ${next.name}, ${relDays(next.days)}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    nextLabel: next ? `Next: ${next.name}, ${relDays(next.days)}` : null,
  }

  // Seven-day snow at the home mountain.
  const dates7 = Array.from({ length: 7 }, (_, i) => addDays(today, i))
  const strip = homeId ? await stripFor(b, [homeId], dates7, new Set(), ctx.prefs.scoringMode, reportsNow) : []
  const days: SnowDay[] = dates7.map((date, i) => {
    const c = strip[i]?.cells[0]
    const vals = c ? [c.snowfallCm.base, c.snowfallCm.summit].filter((x): x is number => x != null) : []
    const cm = vals.length ? Math.max(...vals) : null
    const hi = formatTemp(c?.tempMaxC, units)?.replace(/[CF]$/, '') ?? null
    const lo = formatTemp(c?.tempMinC, units)?.replace(/[CF]$/, '') ?? null
    const sv = snowValue(cm, units)
    return {
      date,
      label: formatLocalDate(date, 'ccc d').toUpperCase(),
      snowCm: cm,
      snow: cm != null ? formatSnow(cm, units) : null,
      snowShort: sv == null ? null : units.snow === 'in' ? `${sv}″` : String(sv),
      partial: !!c?.partial,
      temps: hi && lo ? `${hi} / ${lo}` : null,
      hi,
      lo,
    }
  })

  // Hero copy.
  const headline = nearOpen.length
    ? `${nearOpen[0].shortName || nearOpen[0].name} is open.`
    : rec.preseason || !rec.winner
      ? 'Nothing near home is open yet.'
      : `${rec.winner.name} looks best ${rec.winner.date === today ? 'today' : formatLocalDate(rec.winner.date, 'cccc')}.`
  const leadParts: string[] = []
  if (next) leadParts.push(`${next.name} ${next.estimate ? `is estimated to open ${relDays(next.days)}` : `opens ${relDays(next.days)}`}${next.days > 1 ? ` (${short(next.date)})` : ''}.`)
  const laterAnnounced = cds.filter((c) => !c.estimate && c !== next).slice(0, 2)
  if (laterAnnounced.length) leadParts.push(`Then ${laterAnnounced.map((c) => `${c.name} on ${short(c.date)}`).join(' and ')}.`)
  if (hs && home) {
    if (home.chipTone === 'estimate' || home.chipTone === 'unknown') leadParts.push(`${home.name} hasn’t announced its opening.`)
    else if (home.chipTone === 'announced' && hs.opening.date) leadParts.push(`${home.name} opens ${formatLocalDate(hs.opening.date, 'ccc d LLL')}.`)
  }
  if (!leadParts.length && openAll.length) leadParts.push(`${openAll.length} ${openAll.length === 1 ? 'resort is' : 'resorts are'} open worldwide.`)
  // The snowiest of the next seven days at the home mountain (modeled, so "Likely"), when it is worth a sentence.
  const snowiest = days.reduce<SnowDay | null>((best, d) => (d.snowCm != null && d.snowCm >= 1 && (!best || d.snowCm > (best.snowCm ?? 0)) ? d : best), null)
  if (snowiest && home && leadParts.length < 3) {
    leadParts.push(`Likely ${snowiest.partial ? 'at least ' : ''}${snowiest.snow} of snow at ${home.name} ${snowiest.date === today ? 'today' : `on ${formatLocalDate(snowiest.date, 'cccc')}`}.`)
  }

  const phase = rec.preseason ? 'PRESEASON' : 'IN SEASON'
  return {
    today,
    dateLine: `${formatLocalDate(today, 'cccc d LLLL yyyy').toUpperCase()} · ${phase}`,
    headline,
    lead: leadParts.join(' '),
    home,
    world,
    countdowns: cds,
    snow: {
      resortName: home?.name ?? null,
      days,
      fetchedAt: hs?.freshness.weatherFetchedAt ?? null,
      snowUnit: units.snow === 'in' ? 'in' : 'cm',
      tempUnit: units.temperature === 'F' ? '°F' : '°C',
    },
    passes: passCard(pv.products, homeId, today),
    freshness,
    units,
    openNow: openAll
      .map((s) => ({ s, minutes: s.travel.driveMinutes }))
      .sort((a, b2) => (a.minutes ?? Infinity) - (b2.minutes ?? Infinity) || a.s.name.localeCompare(b2.s.name))
      .slice(0, 6)
      .map(({ s, minutes }) => ({
        id: s.id,
        name: s.shortName || s.name,
        place: placeOf(s),
        drive: minutes != null ? `${s.travel.isEstimate ? '~' : ''}${formatDuration(minutes)} drive` : null,
      })),
    ability: ctx.prefs.ability,
    daysLogged: logged?.n ?? 0,
  }
}

/** Ring fill (0–1): fuller as opening day approaches, on a 60-day scale. */
export const ringFill = (days: number) => Math.max(0.03, Math.min(1, 1 - days / RING_SCALE_DAYS))
