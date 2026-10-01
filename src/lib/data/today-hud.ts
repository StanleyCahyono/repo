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
 * - Pass deadlines: a price change that just happened or the next purchase-by date, research notes on sales, and the
 *   pass families whose prices are not in the catalog.
 */
import 'server-only'
import { and, count, gte, lt } from 'drizzle-orm'
import * as schema from '@/lib/db/schema'
import type { Ctx } from '@/lib/context'
import { getFreshness, type FreshnessView } from '@/lib/data/freshness'
import { getPassesView, type PassProductView } from '@/lib/data/passes'
import { greatCircleKm } from '@/lib/domain/geo'
import { formatMoney } from '@/lib/domain/money'
import { addDays, daysBetween, formatLocalDate, hemisphereOf } from '@/lib/domain/time'
import { formatDistance, formatElevation, formatSnow, formatTemp } from '@/lib/domain/units'
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
  partial: boolean
  temps: string | null
}

export interface PassCard {
  /** Headline number (a current price), or null when no dated price is on file. */
  price: string | null
  priceNote: string | null
  lines: string[]
  confirmAtSource: boolean
  sourceUrl: string | null
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
  snow: { resortName: string | null; days: SnowDay[]; fetchedAt: string | null }
  passes: PassCard
  freshness: FreshnessView | null
  units: UnitPrefs
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
      if (row.announcedClosing) {
        spans.push(seg('announced', row.announcedOpening, row.announcedClosing))
        notes.push(days <= 1 ? `Opens ${short(row.announcedOpening)} · ${relDays(days)}` : `${short(row.announcedOpening)} – ${short(row.announcedClosing)}`)
      } else {
        spans.push(seg('fade', row.announcedOpening, addDays(row.announcedOpening, 80)))
        notes.push(`Opens ${short(row.announcedOpening)}${days <= 7 ? ` · ${relDays(days)}` : ''}`)
      }
    } else if (row.estimatedOpenFrom) {
      spans.push(seg('estimate', row.estimatedOpenFrom, addDays(row.estimatedOpenFrom, 55)))
      notes.push(`${south ? `${row.estimatedOpenFrom.slice(0, 4)} est.` : 'Est.'} ${short(row.estimatedOpenFrom)} · not announced`)
    } else if (!openNow) notes.push('Not announced')
  } else if (!row && !openNow) notes.push('Not announced')

  return {
    resortId: s.id,
    name: s.shortName || s.name,
    place: s.id === homeId ? `${placeOf(s)} · HOME` : placeOf(s),
    home: s.id === homeId,
    note: notes.join(' · '),
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

function passCard(products: PassProductView[], homeId: string | null, today: string): PassCard {
  const lines: string[] = []
  let price: string | null = null
  let priceNote: string | null = null
  let confirm = false
  let sourceUrl: string | null = null

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
    price = formatMoney(ch.cur.amount)
    priceNote = `${ch.p.name.replace(/ 20\d\d-\d\d$/, '')}${ch.cur.category ? ` · ${ch.cur.category.toLowerCase()}` : ''} from ${formatLocalDate(addDays(ch.prev.purchaseBy!, 1), 'd LLL')} · was ${formatMoney(ch.prev.amount)}`
    confirm ||= ch.cur.confirmAtSource
    sourceUrl = ch.cur.prov.sourceUrl ?? null
  } else {
    // Otherwise the next purchase-by date.
    const next = products
      .flatMap((p) => p.prices.filter((x) => x.purchaseBy && x.purchaseBy >= today && !x.purchaseClosed).map((x) => ({ p, x })))
      .sort((a, b) => a.x.purchaseBy!.localeCompare(b.x.purchaseBy!))[0]
    if (next) {
      price = formatMoney(next.x.amount)
      const days = daysBetween(today, next.x.purchaseBy!)
      priceNote = `${next.p.name} until ${formatLocalDate(next.x.purchaseBy!, 'd LLL')} · ${days === 0 ? 'last day' : `${days} days left`}`
      confirm ||= next.x.confirmAtSource
      sourceUrl = next.x.prov.sourceUrl ?? null
    }
  }

  // Sales notes (deduplicated wording), then families whose products carry no price at all.
  const notes = new Map<string, string[]>()
  for (const p of products) {
    const text = p.salesDeadline?.text?.trim()
    if (!text || (ch && p.resortId === ch.p.resortId)) continue
    // Resort passes only for the home mountain; the big families always.
    if (p.familyId === 'regional' && p.resortId !== homeId) continue
    if (p.prices.some((x) => x.purchaseBy && x.purchaseBy < today) && !p.prices.some((x) => !x.purchaseClosed)) continue
    notes.set(text, [...(notes.get(text) ?? []), p.familyId === 'regional' ? (p.resortName ?? p.familyName) : p.familyName])
    confirm ||= p.confirmAtSource
  }
  for (const [text, fams] of [...notes].slice(0, 2)) {
    const names = [...new Set(fams)]
    lines.push(names.some((n) => text.includes(n.replace(/ Pass$/, ''))) ? text : `${names.join(', ')}: ${text}`)
  }
  const byFamily = new Map<string, { name: string; priced: boolean }>()
  for (const p of products) {
    if (p.familyId === 'regional') continue
    const f = byFamily.get(p.familyId) ?? { name: p.familyName, priced: false }
    f.priced ||= p.prices.length > 0
    byFamily.set(p.familyId, f)
  }
  const unpriced = [...byFamily.values()].filter((f) => !f.priced).map((f) => f.name)
  if (unpriced.length) lines.push(`${unpriced.join(', ').replace(/, ([^,]*)$/, ' and $1')} prices: not in catalog.`)
  return { price, priceNote, lines, confirmAtSource: confirm, sourceUrl }
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
    todayTitle: nearOpen.length ? `Driving range: ${nearOpen.map((s) => s.shortName || s.name).join(', ')} open` : 'Driving range: nothing open',
    todayDetail: [
      openAll.length ? `Open worldwide: ${openAll.map((s) => s.shortName || s.name).join(', ')}` : 'No open status on record worldwide',
      next ? `Next: ${next.name}, ${relDays(next.days)}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  }

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

  // Seven-day snow at the home mountain.
  const dates7 = Array.from({ length: 7 }, (_, i) => addDays(today, i))
  const strip = homeId ? await stripFor(b, [homeId], dates7, new Set(), ctx.prefs.scoringMode, reportsNow) : []
  const days: SnowDay[] = dates7.map((date, i) => {
    const c = strip[i]?.cells[0]
    const vals = c ? [c.snowfallCm.base, c.snowfallCm.summit].filter((x): x is number => x != null) : []
    const cm = vals.length ? Math.max(...vals) : null
    const hi = formatTemp(c?.tempMaxC, units)
    const lo = formatTemp(c?.tempMinC, units)
    return {
      date,
      label: formatLocalDate(date, 'ccc d').toUpperCase(),
      snowCm: cm,
      snow: cm != null ? formatSnow(cm, units) : null,
      partial: !!c?.partial,
      temps: hi && lo ? `${hi.replace(/[CF]$/, '')} / ${lo.replace(/[CF]$/, '')}` : null,
    }
  })

  const phase = rec.preseason ? 'PRESEASON' : 'IN SEASON'
  return {
    today,
    dateLine: `${formatLocalDate(today, 'cccc d LLLL yyyy').toUpperCase()} · ${phase}`,
    headline,
    lead: leadParts.join(' '),
    home,
    world,
    countdowns: cds,
    snow: { resortName: home?.name ?? null, days, fetchedAt: hs?.freshness.weatherFetchedAt ?? null },
    passes: passCard(pv.products, homeId, today),
    freshness,
    units,
    ability: ctx.prefs.ability,
    daysLogged: logged?.n ?? 0,
  }
}

/** Ring fill (0–1): fuller as opening day approaches, on a 60-day scale. */
export const ringFill = (days: number) => Math.max(0.03, Math.min(1, 1 - days / RING_SCALE_DAYS))
