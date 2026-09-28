/**
 * Everything the resort page needs, in one call: the summary plus season dates and their change history,
 * published vs live hours (with timezone), latest reports and revisions, the history calendar, base/summit
 * forecast series, exact pass access per product for the date, grouped price snapshots, the day basket,
 * travel, hotels, events, links with link-check status, my rating and a source list for the source drawer.
 */
import 'server-only'
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import type { HotelRow, OperatingScheduleRow, PriceSnapshotRow, ResortRow, ResortSeasonRow } from '@/lib/db/rows'
import type { ResearchNotes, ResortLinks } from '@/lib/db/schema'
import { isExpired, priceNeedsSourceCheck, QUOTE_KIND_LABEL, type DayBasket } from '@/lib/domain/costs'
import { money, type Money } from '@/lib/domain/money'
import { evaluateAccess, latestRule, type AccessVerdict } from '@/lib/domain/passes'
import { isLocalDate, isoWeekday, seasonIdFor, zoneAbbrev } from '@/lib/domain/time'
import type { Provenance, ScheduleActivity, ScoringMode } from '@/lib/domain/types'
import { loadBundle, needsConfirmation, resortToday, seasonLabel, verificationLabel, type DataCtx, type LinkCheckRow } from './core'
import { getForecast, getHistoryCalendar, type HistoryCalendar, type ResortForecast } from './forecast'
import { buildSummaries, type ResortSummary } from './resorts'
import { dayBasket, eventView, reportView, type EventView, type ReportView, type TravelView } from './views'

export interface ScheduleView {
  id: number
  activity: ScheduleActivity
  label: string
  daysOfWeek: number[] | null
  startDate: string | null
  endDate: string | null
  exceptionDate: string | null
  opens: string | null
  closes: string | null
  closed: boolean
  /** Published schedule vs a live operations statement. Advertised hours do not mean every lift runs. */
  nature: 'published' | 'live'
  seasonId: string | null
  /** The schedule's season differs from the date's season (e.g. last season's published hours). */
  otherSeason: boolean
  prov: Provenance | null
}

export interface HoursForDate {
  activity: ScheduleActivity
  label: string
  opens: string | null
  closes: string | null
  closed: boolean
  nature: 'published' | 'live'
  source: 'exception' | 'weekly'
  prov: Provenance | null
}

export interface PriceView {
  id: number
  subjectType: PriceSnapshotRow['subjectType']
  subjectId: string
  item: string
  category: string | null
  amount: Money
  amountMax: Money | null
  dayType: string | null
  seasonId: string | null
  appliesFrom: string | null
  appliesTo: string | null
  purchaseBy: string | null
  includesTax: boolean | null
  feesText: string | null
  quoteKind: PriceSnapshotRow['quoteKind']
  quoteLabel: string
  observedAt: string
  expiresAt: string | null
  expired: boolean
  /** Research-grade price: "Researched — confirm at source". */
  confirmAtSource: boolean
  prov: Provenance
}

export interface PriceGroups {
  tickets: PriceView[]
  passes: PriceView[]
  rentals: PriceView[]
  lessons: PriceView[]
  parking: PriceView[]
  food: PriceView[]
  other: PriceView[]
}

export interface PassAccessRow {
  productId: string
  productName: string
  familyId: string
  familyName: string
  owned: boolean
  verdict: AccessVerdict
  ruleProv: Provenance | null
}

export interface HotelView {
  id: string
  name: string
  tier: HotelRow['tier']
  brand: string | null
  address: string | null
  lat: number | null
  lon: number | null
  officialUrl: string | null
  distanceText: string | null
  /** Only 'verified-yes' may be shown as ski-in/ski-out. */
  skiInOut: HotelRow['skiInOut']
  shuttle: string | null
  parking: string | null
  notes: string | null
  origin: HotelRow['origin']
  /** Sourced dated quotes only; otherwise the UI shows "Check rates". */
  quotes: PriceView[]
  priceNote: string | null
  prov: Provenance | null
}

export interface LinkView {
  key: string
  label: string
  url: string
  check: { ok: boolean | null; httpStatus: number | null; checkedAt: string; finalUrl: string | null; embeddable: boolean | null; error: string | null } | null
}

export interface SourceEntry {
  topic: string
  url: string | null
  provider: string | null
  kind: Provenance['kind']
  verification: Provenance['verification']
  verificationLabel: string
  confirmAtSource: boolean
  checkedAt: string | null
}

export interface ResortDetail {
  summary: ResortSummary
  season: {
    seasonId: string
    label: string
    current: ResortSeasonRow | null
    /** Other seasons on file (history). */
    others: ResortSeasonRow[]
    /** Every change to announced/actual dates, newest first. */
    changes: (typeof s.openingDateHistory.$inferSelect)[]
  }
  hours: { timezone: string; zoneAbbrev: string; date: string; forDate: HoursForDate[]; schedules: ScheduleView[]; notes: string[] }
  reports: { date: string; revisions: ReportView[] }[]
  history: HistoryCalendar | null
  weather: { base: ResortForecast | null; summit: ResortForecast | null }
  passAccess: PassAccessRow[]
  prices: PriceGroups
  basket: DayBasket
  travel: TravelView
  hotels: HotelView[]
  events: { upcoming: EventView[]; past: EventView[]; undated: EventView[] }
  links: LinkView[]
  myRating: { rating: number | null; review: string | null; updatedAt: string } | null
  mySkiDays: (typeof s.skiDayLogs.$inferSelect)[]
  sources: SourceEntry[]
  research: ResearchNotes | null
  demo: boolean
}

export const LINK_LABEL: Record<Exclude<keyof ResortLinks, 'more'>, string> = {
  official: 'Official website',
  trailMap: 'Trail map',
  interactiveMap: 'Interactive map',
  snowReport: 'Snow report',
  hours: 'Hours',
  tickets: 'Lift tickets',
  seasonPass: 'Season pass',
  lessons: 'Lessons',
  rentals: 'Rentals',
  webcams: 'Webcams',
  parking: 'Parking',
  roadInfo: 'Road & transit',
  lodging: 'Lodging',
  events: 'Events',
  tourism: 'Tourism office',
  avalanche: 'Avalanche information',
  openSkiMap: 'OpenSkiMap',
}

function priceView(p: PriceSnapshotRow, ctx: DataCtx): PriceView {
  return {
    id: p.id,
    subjectType: p.subjectType,
    subjectId: p.subjectId,
    item: p.item,
    category: p.category,
    amount: money(p.amountMinor, p.currency),
    amountMax: p.amountMaxMinor != null && p.amountMaxMinor > p.amountMinor ? money(p.amountMaxMinor, p.currency) : null,
    dayType: p.dayType,
    seasonId: p.seasonId,
    appliesFrom: p.appliesFrom,
    appliesTo: p.appliesTo,
    purchaseBy: p.purchaseBy,
    includesTax: p.includesTax,
    feesText: p.feesText,
    quoteKind: p.quoteKind,
    quoteLabel: QUOTE_KIND_LABEL[p.quoteKind] ?? p.quoteKind,
    observedAt: p.observedAt,
    expiresAt: p.expiresAt,
    expired: isExpired(p.expiresAt, ctx.now, ctx.today),
    confirmAtSource: priceNeedsSourceCheck(p),
    prov: p.prov,
  }
}

const byNewest = (a: PriceView, b: PriceView) => (a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : b.id - a.id)

/** Published hours for one date: a dated exception wins over the weekly pattern; live statements over published. */
export function hoursForDate(schedules: readonly OperatingScheduleRow[], date: string): HoursForDate[] {
  const season = seasonIdFor(date)
  const wd = isoWeekday(date)
  const applicable = schedules.filter((x) => !x.seasonId || x.seasonId === season)
  const liveFirst = (a: OperatingScheduleRow, b: OperatingScheduleRow) => (a.nature === b.nature ? a.id - b.id : a.nature === 'live' ? -1 : 1)
  const out: HoursForDate[] = []
  for (const activity of [...new Set(applicable.map((x) => x.activity))]) {
    const rows = applicable.filter((x) => x.activity === activity)
    const exception = rows.filter((x) => x.exceptionDate === date).sort(liveFirst)
    const weekly = rows
      .filter((x) => !x.exceptionDate && x.daysOfWeek?.includes(wd) && (!x.startDate || x.startDate <= date) && (!x.endDate || x.endDate >= date))
      .sort(liveFirst)
    const pick = exception[0] ?? null
    if (pick) out.push({ activity, label: pick.label, opens: pick.opens, closes: pick.closes, closed: pick.closed, nature: pick.nature, source: 'exception', prov: pick.prov })
    else for (const w of weekly) out.push({ activity, label: w.label, opens: w.opens, closes: w.closes, closed: w.closed, nature: w.nature, source: 'weekly', prov: w.prov })
  }
  return out
}

function sourcesFor(r: ResortRow, extra: { topic: string; prov: Provenance | null | undefined }[]): SourceEntry[] {
  const all: { topic: string; prov: Provenance | null | undefined }[] = [
    { topic: 'Location', prov: r.locationProv },
    { topic: 'Elevation', prov: r.elevationProv },
    { topic: 'Terrain', prov: r.terrain?.prov },
    { topic: 'Features', prov: r.features?.prov },
    ...extra,
  ]
  const seen = new Set<string>()
  const out: SourceEntry[] = []
  for (const { topic, prov } of all) {
    if (!prov) continue
    const key = `${topic}|${prov.sourceUrl ?? prov.provider ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      topic,
      url: prov.sourceUrl ?? null,
      provider: prov.provider ?? null,
      kind: prov.kind,
      verification: prov.verification ?? null,
      verificationLabel: verificationLabel(prov),
      confirmAtSource: needsConfirmation(prov),
      checkedAt: prov.fetchedAt ?? prov.publishedAt ?? null,
    })
  }
  return out
}

export async function getResortDetail(ctx: DataCtx, id: string, opts: { date?: string; mode?: ScoringMode } = {}): Promise<ResortDetail | null> {
  const { db, now } = ctx
  const date = opts.date && isLocalDate(opts.date) ? opts.date : ctx.today
  const mode = opts.mode ?? ctx.prefs.scoringMode
  const b = await loadBundle(ctx, { ids: [id], seasons: [seasonIdFor(date)] })
  const rec = b.byId.get(id)
  if (!rec) return null
  const r = rec.row
  const linkUrls = [
    ...Object.entries(r.links)
      .filter(([k, v]) => k !== 'more' && typeof v === 'string')
      .map(([, v]) => v as string),
    ...(r.links.more ?? []).map((m) => m.url),
  ]

  const [[summary], seasonRows, changes, schedules, reportRows, passPrices, hotelRows, linkRows, rating, skiDays, history, base, summit] = await Promise.all([
    buildSummaries(b, { date, mode }),
    db.select().from(s.resortSeasons).where(eq(s.resortSeasons.resortId, id)),
    db.select().from(s.openingDateHistory).where(eq(s.openingDateHistory.resortId, id)).orderBy(desc(s.openingDateHistory.changedAt), desc(s.openingDateHistory.id)),
    db.select().from(s.operatingSchedules).where(eq(s.operatingSchedules.resortId, id)),
    db
      .select()
      .from(s.operationalReports)
      .where(
        and(
          eq(s.operationalReports.resortId, id),
          lte(s.operationalReports.localDate, date),
          sql`(${s.operationalReports.reportedAt} is null or ${s.operationalReports.reportedAt} <= ${now})`,
          sql`not (${s.operationalReports.kind} = 'manual' and coalesce(json_extract(${s.operationalReports.prov}, '$.note'), '') = 'personal')`,
          b.live ? sql`${s.operationalReports.kind} <> 'demo'` : undefined,
        ),
      )
      .orderBy(desc(s.operationalReports.localDate), desc(s.operationalReports.revision), desc(s.operationalReports.id))
      .limit(40),
    b.pass.products.length
      ? db
          .select()
          .from(s.priceSnapshots)
          .where(
            and(
              eq(s.priceSnapshots.subjectType, 'pass-product'),
              inArray(
                s.priceSnapshots.subjectId,
                b.pass.products.map((p) => p.id),
              ),
              b.live ? sql`${s.priceSnapshots.quoteKind} <> 'demo'` : undefined,
            ),
          )
      : Promise.resolve([] as PriceSnapshotRow[]),
    db.select().from(s.hotels).where(eq(s.hotels.resortId, id)),
    linkUrls.length ? db.select().from(s.linkChecks).where(inArray(s.linkChecks.url, linkUrls)) : Promise.resolve([] as LinkCheckRow[]),
    db.select().from(s.myRatings).where(eq(s.myRatings.resortId, id)),
    db.select().from(s.skiDayLogs).where(eq(s.skiDayLogs.resortId, id)).orderBy(desc(s.skiDayLogs.date)),
    getHistoryCalendar(ctx, id, date.slice(0, 7), { mode }),
    getForecast(ctx, [id], { point: 'base' }),
    getForecast(ctx, [id], { point: 'summit' }),
  ])

  const hotelQuotes = hotelRows.length
    ? await db
        .select()
        .from(s.priceSnapshots)
        .where(
          and(
            eq(s.priceSnapshots.subjectType, 'lodging'),
            inArray(
              s.priceSnapshots.subjectId,
              hotelRows.map((h) => h.id),
            ),
          ),
        )
    : []

  // Seasons
  const current = b.seasons.get(`${id}|${b.seasonId}`) ?? null
  const others = seasonRows.filter((x) => x.seasonId !== b.seasonId).sort((x, y) => y.seasonId.localeCompare(x.seasonId))

  // Hours
  const dateSeason = seasonIdFor(date)
  const scheduleViews: ScheduleView[] = schedules
    .map((x) => ({
      id: x.id,
      activity: x.activity,
      label: x.label,
      daysOfWeek: x.daysOfWeek,
      startDate: x.startDate,
      endDate: x.endDate,
      exceptionDate: x.exceptionDate,
      opens: x.opens,
      closes: x.closes,
      closed: x.closed,
      nature: x.nature,
      seasonId: x.seasonId,
      otherSeason: !!x.seasonId && x.seasonId !== dateSeason,
      prov: x.prov,
    }))
    .sort((x, y) => x.activity.localeCompare(y.activity) || (x.exceptionDate ?? '').localeCompare(y.exceptionDate ?? '') || x.id - y.id)
  const forDate = hoursForDate(schedules, date)
  const hourNotes: string[] = [`Times are resort-local (${r.timezone}).`, 'Published hours do not mean every lift is running.']
  if (!forDate.length) {
    hourNotes.unshift(
      scheduleViews.some((x) => x.otherSeason)
        ? `Hours for ${seasonLabel(dateSeason)} are not published yet — the schedules below are from another season`
        : 'Hours for this date are not recorded',
    )
  }

  // Reports grouped by local date (newest first), all revisions.
  const reportDates = [...new Set(reportRows.map((x) => x.localDate))].slice(0, 7)
  const reports = reportDates.map((d) => ({
    date: d,
    revisions: reportRows
      .filter((x) => x.localDate === d)
      .map((x) => reportView(x, now)!)
      .sort((x, y) => y.revision - x.revision),
  }))

  // Pass access for the date: owned products first, then every product with a rule here (or resort-specific).
  const fam = new Map(b.pass.families.map((f) => [f.id, f.name]))
  const mine = b.pass.owned.filter((o) => o.ownership.holder === 'me')
  const ownedIds = new Set(mine.map((o) => o.product.id))
  const relevant = b.pass.products.filter((p) => ownedIds.has(p.id) || p.resortId === id || b.pass.rules.some((x) => x.productId === p.id && x.resortId === id))
  const passAccess: PassAccessRow[] = relevant
    .map((p) => {
      const productRules = b.pass.rules.filter((x) => x.productId === p.id)
      const rule = latestRule(productRules, p.id, id)
      const usage = mine.filter((o) => o.product.id === p.id).flatMap((o) => o.usage)
      return {
        productId: p.id,
        productName: p.name,
        familyId: p.familyId,
        familyName: fam.get(p.familyId) ?? p.familyId,
        owned: ownedIds.has(p.id),
        verdict: evaluateAccess({ product: p, rule, resortId: id, date, usage, poolRules: productRules, today: ctx.today, names: b.names }),
        ruleProv: rule?.prov ?? null,
      }
    })
    .sort((x, y) => Number(y.owned) - Number(x.owned) || x.familyName.localeCompare(y.familyName) || x.productName.localeCompare(y.productName))

  // Prices
  const resortPrices = (b.prices.get(id) ?? []).map((p) => priceView(p, ctx))
  const relevantProductIds = new Set(relevant.map((p) => p.id))
  const prices: PriceGroups = {
    tickets: resortPrices.filter((p) => p.subjectType === 'lift-ticket').sort(byNewest),
    passes: passPrices
      .filter((p) => relevantProductIds.has(p.subjectId))
      .map((p) => priceView(p, ctx))
      .sort(byNewest),
    rentals: resortPrices.filter((p) => p.subjectType === 'rental').sort(byNewest),
    lessons: resortPrices.filter((p) => p.subjectType === 'lesson').sort(byNewest),
    parking: resortPrices.filter((p) => p.subjectType === 'parking').sort(byNewest),
    food: resortPrices.filter((p) => p.subjectType === 'food').sort(byNewest),
    other: resortPrices.filter((p) => p.subjectType === 'other').sort(byNewest),
  }

  // Basket (with my pass where it can be used)
  const canSki = summary.myPass.verdicts.find((v) => v.canSki) ?? summary.myPass.verdicts[0] ?? null
  const basket = dayBasket(b, id, date, canSki)

  // Hotels
  const hotels: HotelView[] = hotelRows
    .map((h) => {
      const quotes = hotelQuotes
        .filter((q) => q.subjectId === h.id)
        .map((q) => priceView(q, ctx))
        .filter((q) => !q.expired)
        .sort(byNewest)
      return {
        id: h.id,
        name: h.name,
        tier: h.tier,
        brand: h.brand,
        address: h.address,
        lat: h.lat,
        lon: h.lon,
        officialUrl: h.officialUrl,
        distanceText: h.distanceText,
        skiInOut: h.skiInOut,
        shuttle: h.shuttle,
        parking: h.parking,
        notes: h.notes,
        origin: h.origin,
        quotes,
        priceNote: quotes.length ? null : 'Check rates',
        prov: h.prov,
      }
    })
    .sort((x, y) => (x.tier ?? 'z').localeCompare(y.tier ?? 'z') || x.name.localeCompare(y.name))

  // Events
  const allEvents = b.events.filter((e) => e.resortId === id).map(eventView)
  const today = resortToday(r, now)
  const events = {
    upcoming: allEvents.filter((e) => e.startDate && (e.endDate ?? e.startDate) >= today).sort((x, y) => x.startLocal!.localeCompare(y.startLocal!)),
    past: allEvents.filter((e) => e.startDate && (e.endDate ?? e.startDate) < today).sort((x, y) => y.startLocal!.localeCompare(x.startLocal!)),
    undated: allEvents.filter((e) => !e.startDate).sort((x, y) => x.title.localeCompare(y.title)),
  }

  // Links
  const checks = new Map(linkRows.map((l) => [l.url, l]))
  const check = (url: string): LinkView['check'] => {
    const c = checks.get(url)
    return c ? { ok: c.ok, httpStatus: c.httpStatus, checkedAt: c.checkedAt, finalUrl: c.finalUrl, embeddable: c.embeddable, error: c.error } : null
  }
  const links: LinkView[] = [
    ...(Object.keys(LINK_LABEL) as (keyof typeof LINK_LABEL)[])
      .filter((k) => typeof r.links[k] === 'string' && r.links[k])
      .map((k) => ({ key: k, label: LINK_LABEL[k], url: r.links[k] as string, check: check(r.links[k] as string) })),
    ...(r.links.more ?? []).map((m, i) => ({ key: `more-${i}`, label: m.label, url: m.url, check: check(m.url) })),
  ]

  const sources = sourcesFor(r, [
    { topic: 'Announced opening', prov: current?.announcedOpeningProv },
    { topic: 'Actual opening', prov: current?.actualOpeningProv },
    { topic: 'Announced closing', prov: current?.announcedClosingProv },
    { topic: 'Actual closing', prov: current?.actualClosingProv },
    { topic: 'Operating status', prov: summary.status.prov },
    { topic: 'Snow report', prov: summary.snow.report?.prov },
    { topic: 'Weather (base)', prov: summary.snow.forecast.base?.run.prov },
    { topic: 'Weather (summit)', prov: summary.snow.forecast.summit?.run.prov },
    ...schedules.map((x) => ({ topic: 'Hours', prov: x.prov })),
    ...[...prices.tickets, ...prices.rentals, ...prices.lessons, ...prices.parking].map((p) => ({ topic: 'Prices', prov: p.prov })),
    { topic: 'Drive from home', prov: summary.travel.prov },
    ...summary.travel.airports.map((a) => ({ topic: `Airport ${a.iata}`, prov: a.prov })),
    ...summary.travel.transfers.map((t) => ({ topic: 'Transfers', prov: t.prov })),
    ...passAccess.map((p) => ({ topic: `Pass access: ${p.productName}`, prov: p.ruleProv })),
    ...hotels.map((h) => ({ topic: `Hotel: ${h.name}`, prov: h.prov })),
    ...allEvents.map((e) => ({ topic: `Event: ${e.title}`, prov: e.prov })),
    ...summary.officialAlerts.map((a) => ({ topic: `Official alert: ${a.event}`, prov: a.prov })),
  ])

  return {
    summary,
    season: { seasonId: b.seasonId, label: seasonLabel(b.seasonId), current, others, changes },
    hours: { timezone: r.timezone, zoneAbbrev: zoneAbbrev(now, r.timezone), date, forDate, schedules: scheduleViews, notes: hourNotes },
    reports,
    history,
    weather: { base: base.resorts[0] ?? null, summit: summit.resorts[0] ?? null },
    passAccess,
    prices,
    basket,
    travel: summary.travel,
    hotels,
    events,
    links,
    myRating: rating[0] ? { rating: rating[0].rating, review: rating[0].review, updatedAt: rating[0].updatedAt } : null,
    mySkiDays: skiDays,
    sources,
    research: r.research,
    demo: !b.live,
  }
}
