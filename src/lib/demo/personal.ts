/**
 * Personal demo records: a pass I own (with its linked purchase expense, so it is counted once), logged pass days,
 * two trips (a draft Alta trip with estimate ranges and one unpriced item; a booked Greek Peak Saturday), four ski-day
 * logs whose surface feedback matches that day's simulated report, skills progress (self- and instructor-confirmed),
 * lessons, expenses, alert rules with a few fired alerts, demo FX rates and my rating of Greek Peak.
 *
 * Tables without a kind column are labelled in their text: notes start with "Demo", trip-item details carry
 * `demo: true`, fired alerts end with "Demo data — simulated.". Nothing here invents a flight number, a booking
 * reference, an instructor's name or a room rate.
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import {
  alertRules,
  alerts,
  checklistTemplates,
  expenses,
  fxRates,
  hotels,
  lessons,
  myRatings,
  openingDateHistory,
  passOwnership,
  passProducts,
  passUsage,
  resorts,
  skiDayLogs,
  skillChecklist,
  travelOptions,
  tripChecklist,
  tripItems,
  trips,
} from '@/lib/db/schema'
import type { OperationalReportRow, SkiDayLogRow } from '@/lib/db/rows'
import type { AlertType } from '@/lib/db/schema'
import { prepareSeries, slotsWithin } from '@/lib/domain/conditions'
import { formatLocalDate, localDateOf, localTimeToInstant } from '@/lib/domain/time'
import type { SurfaceTag, UnitPrefs } from '@/lib/domain/types'
import { formatSnow } from '@/lib/domain/units'
import { dedupeKeyOf, ensureDefaultAlertRules, fireCandidate, type AlertCandidate } from '@/lib/jobs/alerts'
import type { HourlyWeather } from '@/lib/providers/types'
import { rng } from './prng'
import { DEMO_MODEL, DEMO_PROVIDER, NOT_OPEN_RESORT } from './scenario'

export const INDY_PRODUCT = 'indy-base-pass-2026-27'
export const PASS_DEADLINE_PRODUCT = 'skicny-season-pass-2026-27'
export const ALTA_TRIP = 'demo-alta-presidents-day'
export const GREEK_TRIP = 'demo-greek-peak-saturday'
const DEMO_SUFFIX = 'Demo data — simulated.'

export interface PersonalInputs {
  now: string
  units: UnitPrefs
  trackingStartInstant: string
  /** Revision-1 simulated report for a resort and local date. */
  reportFor: (resortId: string, date: string) => OperationalReportRow | null
  /** Alta's summit (or base) series from the forecast fetched on 12 Jan at 11:00Z, for the snow alert. */
  altaForecast: { fetchedAt: string; pointKey: string; hourly: HourlyWeather[] } | null
}

export interface PersonalResult {
  logs: SkiDayLogRow[]
}

const at = (date: string, hhmm: string, tz = 'America/New_York') => localTimeToInstant(date, hhmm, tz)

async function skillIds(db: Db): Promise<Map<string, number>> {
  const rows = await db.select({ id: skillChecklist.id, label: skillChecklist.label }).from(skillChecklist)
  return new Map(rows.map((r) => [r.label, r.id]))
}

function surfaceNote(tags: readonly SurfaceTag[]): string {
  if (tags.includes('fresh-snow')) return 'Soft new snow — slower, but forgiving when I fell.'
  if (tags.includes('icy-refrozen')) return 'Icy patches on the steeper bits; stayed on the easiest green.'
  if (tags.includes('firm')) return 'Firm by the afternoon; edges mattered.'
  if (tags.includes('wet-slushy')) return 'Heavy, wet snow.'
  return 'Nice packed groomers.'
}

/** A beginner's day rating follows the surface they met: icy or slushy days rate a point lower. */
function ratingFor(base: number, tags: readonly SurfaceTag[]): number {
  return tags.includes('icy-refrozen') || tags.includes('wet-slushy') ? Math.max(1, base - 1) : base
}

/** How the surface was on a visit, for my review (written that evening, from what I logged). */
function visitSurface(tags: readonly SurfaceTag[]): string {
  if (tags.includes('icy-refrozen')) return 'icy patches after a refreeze'
  if (tags.includes('fresh-snow')) return 'soft new snow'
  if (tags.includes('wet-slushy')) return 'heavy, wet snow'
  if (tags.includes('firm')) return 'firm, fast groomers'
  return 'well-groomed packed powder'
}

export async function seedPersonalRecords(db: Db, p: PersonalInputs): Promise<PersonalResult> {
  const skills = await skillIds(db)
  const ids = (labels: readonly string[]) => labels.map((l) => skills.get(l)).filter((x): x is number => typeof x === 'number')

  // --- Skills progress -------------------------------------------------------------------------------------------
  const progress: [string, 'self-confirmed' | 'instructor-confirmed' | 'practicing', string | null, string][] = [
    ['Walk and glide on the flat with skis on', 'self-confirmed', '2026-12-19', 'Demo (simulated): comfortable on the flat.'],
    ['Get up after a fall', 'self-confirmed', '2026-12-19', 'Demo (simulated).'],
    ['Straight glide on a gentle slope', 'self-confirmed', '2026-12-19', 'Demo (simulated).'],
    ['Controlled stopping (wedge)', 'instructor-confirmed', '2026-12-19', 'Demo (simulated): confirmed by the instructor in the 19 Dec group lesson.'],
    ['Ride the magic carpet / surface lift', 'self-confirmed', '2026-12-19', 'Demo (simulated).'],
    ['Load and unload a chairlift', 'self-confirmed', '2026-12-28', 'Demo (simulated): first chairlift rides at Labrador.'],
    ['Control speed with a wedge on green terrain', 'self-confirmed', '2027-01-02', 'Demo (simulated).'],
    ['Wedge turns left and right', 'practicing', null, 'Demo (simulated): better turning left than right.'],
    ['Link turns on a green run', 'practicing', null, 'Demo (simulated): a few linked turns on the easiest green.'],
    ['Traverse and sideslip', 'practicing', null, 'Demo (simulated).'],
  ]
  for (const [label, status, confirmedOn, notes] of progress) {
    const id = skills.get(label)
    if (id !== undefined) await db.update(skillChecklist).set({ status, confirmedOn, notes }).where(eq(skillChecklist.id, id))
  }

  // --- Pass, usage and the linked purchase expense ---------------------------------------------------------------
  const product = (await db.select().from(passProducts).where(eq(passProducts.id, INDY_PRODUCT)))[0]
  let ownershipId: number | null = null
  if (product) {
    const [own] = await db
      .insert(passOwnership)
      .values({
        productId: product.id,
        holder: 'me',
        purchasedOn: '2026-09-20',
        pricePaidMinor: 36900,
        currency: 'USD',
        notes: 'Demo record (simulated purchase and price).',
        createdAt: p.trackingStartInstant,
      })
      .returning({ id: passOwnership.id })
    ownershipId = own.id
    await db.insert(passUsage).values(
      ['2026-12-19', '2027-01-02'].map((date) => ({ ownershipId: own.id, resortId: 'greek-peak', date, notes: 'Demo pass day (simulated).', createdAt: at(date, '19:20') })),
    )
  }

  // --- Ski-day logs (surface feedback = that day's simulated report) ----------------------------------------------
  const logDefs: { date: string; resortId: string; rating: number; preferredTime: string; crowdGuess: string; skills: string[]; hours: number; lead: string }[] = [
    {
      date: '2026-12-19',
      resortId: 'greek-peak',
      rating: 4,
      preferredTime: 'Morning, before 11:00',
      crowdGuess: 'Moderate — my guess',
      skills: ['Walk and glide on the flat with skis on', 'Straight glide on a gentle slope', 'Controlled stopping (wedge)', 'Ride the magic carpet / surface lift'],
      hours: 3.5,
      lead: 'First day: group lesson in the morning, practised in the beginner area after lunch.',
    },
    {
      date: '2026-12-28',
      resortId: 'labrador-mountain',
      rating: 3,
      preferredTime: 'Late morning',
      crowdGuess: 'Busy — holiday week, my guess',
      skills: ['Wedge turns left and right', 'Load and unload a chairlift'],
      hours: 3,
      lead: 'First chairlift rides.',
    },
    {
      date: '2027-01-02',
      resortId: 'greek-peak',
      rating: 5,
      preferredTime: 'Morning',
      crowdGuess: 'Quiet — my guess',
      skills: ['Control speed with a wedge on green terrain', 'Wedge turns left and right', 'Link turns on a green run'],
      hours: 4,
      lead: 'Linked my first few turns.',
    },
    {
      date: '2027-01-10',
      resortId: 'labrador-mountain',
      rating: 4,
      preferredTime: 'Morning, before it got tracked out',
      crowdGuess: 'Moderate — my guess',
      skills: ['Link turns on a green run', 'Traverse and sideslip'],
      hours: 3,
      lead: 'Practised linking turns.',
    },
  ]
  const logs: SkiDayLogRow[] = []
  for (const d of logDefs) {
    const report = p.reportFor(d.resortId, d.date)
    const tags: SurfaceTag[] = report?.surfaceTags.length ? report.surfaceTags.filter((t) => t !== 'unknown') : ['packed-powder']
    const [row] = await db
      .insert(skiDayLogs)
      .values({
        date: d.date,
        resortId: d.resortId,
        tripId: null,
        rating: ratingFor(d.rating, tags),
        surfaceFeedback: tags,
        preferredTime: d.preferredTime,
        crowdGuess: d.crowdGuess,
        skillsPracticed: ids(d.skills),
        hoursSkied: d.hours,
        // Money lives in expenses (the season budget counts those); a log spend note is never added to the budget.
        spendMinor: null,
        currency: null,
        notes: `Demo log (simulated). ${d.lead} ${surfaceNote(tags)}`,
        createdAt: at(d.date, '19:30'),
      })
      .returning()
    logs.push(row)
  }

  // --- Trips -----------------------------------------------------------------------------------------------------
  const altaHotel =
    (await db.select().from(hotels).where(eq(hotels.id, 'alta-peruvian-lodge')))[0] ?? (await db.select().from(hotels).where(eq(hotels.resortId, 'alta')))[0] ?? null
  const altaResort = (await db.select({ links: resorts.links }).from(resorts).where(eq(resorts.id, 'alta')))[0]
  const greekResort = (await db.select({ links: resorts.links }).from(resorts).where(eq(resorts.id, 'greek-peak')))[0]
  const greekDrive = (await db.select().from(travelOptions).where(and(eq(travelOptions.resortId, 'greek-peak'), eq(travelOptions.mode, 'drive-from-home'))))[0] ?? null

  const altaCreated = '2026-12-20T02:15:00.000Z'
  await db.insert(trips).values({
    id: ALTA_TRIP,
    name: 'Alta — Presidents’ Day',
    status: 'draft',
    startDate: '2027-02-13',
    endDate: '2027-02-17',
    partySize: 2,
    originAirport: 'SYR',
    companions: [{ name: 'Jordan (demo companion)', ability: 'advanced' }],
    notes: 'Demo trip (simulated). Every price is your own estimate range, not a quote; the lesson is not priced yet.',
    createdAt: altaCreated,
    updatedAt: '2027-01-10T01:40:00.000Z',
  })
  type ItemDef = Omit<typeof tripItems.$inferInsert, 'tripId' | 'createdAt' | 'sortOrder'>
  const altaDefs: ItemDef[] = [
    {
      type: 'flight',
      refId: 'SLC',
      title: 'Flights SYR ⇄ SLC (your estimate)',
      date: '2027-02-13',
      endDate: '2027-02-17',
      status: 'draft',
      costMinor: 38000,
      costMaxMinor: 56000,
      currency: 'USD',
      costKind: 'estimate',
      costBasis: 'per-person',
      details: {
        demo: true,
        origin: 'SYR',
        destination: 'SLC',
        estimateBy: 'you',
        alternatives: ['ITH', 'ELM', 'ROC', 'BUF'],
        note: 'Your estimate range — no live fares, schedules or flight numbers. Compare ITH, ELM, ROC and BUF before booking.',
      },
    },
    {
      type: 'transfer',
      refId: 'alta',
      title: 'Rental car from SLC, 4 days (your estimate)',
      date: '2027-02-13',
      endDate: '2027-02-17',
      status: 'draft',
      costMinor: 26000,
      costMaxMinor: 38000,
      currency: 'USD',
      costKind: 'estimate',
      costBasis: 'shared',
      details: { demo: true, transferType: 'rental-car', from: 'SLC', estimateBy: 'you', note: 'Your estimate. Check canyon road and traction rules before driving.' },
    },
    {
      type: 'lodging',
      refId: altaHotel?.id ?? null,
      title: `${altaHotel?.name ?? 'Alta lodging'} — 4 nights (your estimate)`,
      date: '2027-02-13',
      endDate: '2027-02-17',
      status: 'draft',
      costMinor: 180000,
      costMaxMinor: 260000,
      currency: 'USD',
      costKind: 'estimate',
      costBasis: 'shared',
      details: {
        demo: true,
        hotelId: altaHotel?.id ?? null,
        nights: 4,
        occupancy: 2,
        estimateBy: 'you',
        note: 'Your estimate range — not a quote. No sourced room rate: check rates with the lodge.',
      },
    },
    ...['2027-02-14', '2027-02-15', '2027-02-16'].map(
      (date): ItemDef => ({
        type: 'resort-day',
        refId: 'alta',
        title: 'Ski day at Alta',
        date,
        status: 'draft',
        costMinor: null,
        costMaxMinor: null,
        currency: null,
        costKind: null,
        costBasis: 'per-person',
        details: { demo: true, note: 'Day costs are itemised separately (lift tickets, rental, food).' },
      }),
    ),
    {
      type: 'lift-ticket',
      refId: 'alta',
      title: 'Alta lift tickets, 3 days (your estimate)',
      date: '2027-02-14',
      endDate: '2027-02-16',
      status: 'draft',
      costMinor: 57000,
      costMaxMinor: 69000,
      currency: 'USD',
      costKind: 'estimate',
      costBasis: 'per-person',
      details: { demo: true, days: 3, estimateBy: 'you', note: 'Alta is not on the Indy Base Pass. Your estimate — check the official ticket prices.' },
    },
    {
      type: 'lesson',
      refId: 'alta',
      title: 'Group lesson at Alta (price not checked yet)',
      date: '2027-02-14',
      status: 'draft',
      costMinor: null,
      costMaxMinor: null,
      currency: null,
      costKind: null,
      costBasis: 'per-person',
      details: { demo: true, bookingUrl: altaResort?.links.lessons ?? null, note: 'No price yet — check with the ski school.' },
    },
    {
      type: 'rental',
      refId: 'alta',
      title: 'Ski rental for me, 3 days (your estimate)',
      date: '2027-02-14',
      endDate: '2027-02-16',
      status: 'draft',
      costMinor: 15000,
      costMaxMinor: 21000,
      currency: 'USD',
      costKind: 'estimate',
      costBasis: 'shared',
      details: { demo: true, estimateBy: 'you', note: 'One rental package (Jordan brings their own skis).' },
    },
    {
      type: 'food',
      refId: 'alta',
      title: 'Food, 5 days (your estimate)',
      date: '2027-02-13',
      endDate: '2027-02-17',
      status: 'draft',
      costMinor: 25000,
      costMaxMinor: 40000,
      currency: 'USD',
      costKind: 'estimate',
      costBasis: 'shared',
      details: { demo: true, estimateBy: 'you' },
    },
  ]
  await db.insert(tripItems).values(altaDefs.map((i, n) => ({ ...i, tripId: ALTA_TRIP, sortOrder: n, createdAt: altaCreated })))
  const templates = await db.select().from(checklistTemplates).orderBy(checklistTemplates.sortOrder, checklistTemplates.id)
  if (templates.length) {
    // Two things are already done a month out; nothing is booked yet (every price above is still an estimate).
    const altaDone = new Set(['Helmet, goggles, gloves, base layers, ski socks', 'Download trail map'])
    await db.insert(tripChecklist).values(
      templates.map((t, n) => ({ tripId: ALTA_TRIP, label: t.label, category: t.category, done: altaDone.has(t.label), link: null, sortOrder: n })),
    )
  }

  const greekCreated = '2027-01-12T15:05:00.000Z'
  await db.insert(trips).values({
    id: GREEK_TRIP,
    name: 'Greek Peak Saturday',
    status: 'booked',
    startDate: '2027-01-16',
    endDate: '2027-01-16',
    partySize: 1,
    originAirport: null,
    companions: [],
    notes: 'Demo trip (simulated). Both Indy Base Pass days at Greek Peak are used, so this day needs a lift ticket.',
    createdAt: greekCreated,
    updatedAt: '2027-01-14T01:10:00.000Z',
  })
  const driveText = greekDrive?.minutes != null ? ` (about ${greekDrive.minutes} min${greekDrive.km != null ? `, ${greekDrive.km} km` : ''})` : ''
  const greekDefs: ItemDef[] = [
    {
      type: 'resort-day',
      refId: 'greek-peak',
      title: 'Ski day at Greek Peak',
      date: '2027-01-16',
      status: 'booked',
      costMinor: null,
      costMaxMinor: null,
      currency: null,
      costKind: null,
      costBasis: 'per-person',
      details: { demo: true, note: 'Day costs are itemised separately.' },
    },
    {
      type: 'drive',
      refId: 'greek-peak',
      title: `Drive from Ithaca${driveText}`,
      date: '2027-01-16',
      status: 'draft',
      costMinor: 900,
      costMaxMinor: 1400,
      currency: 'USD',
      costKind: 'estimate',
      costBasis: 'shared',
      details: { demo: true, minutes: greekDrive?.minutes ?? null, km: greekDrive?.km ?? null, estimateBy: 'you', note: 'Fuel estimate for the round trip.' },
    },
    {
      type: 'lift-ticket',
      refId: 'greek-peak',
      title: 'Adult day ticket, bought online',
      date: '2027-01-16',
      status: 'booked',
      costMinor: 8900,
      costMaxMinor: null,
      currency: 'USD',
      costKind: 'actual',
      costBasis: 'per-person',
      details: { demo: true, note: 'Simulated price. Indy Base Pass: 2 of 2 Greek Peak days already used (19 Dec, 2 Jan).' },
    },
    {
      type: 'rental',
      refId: 'greek-peak',
      title: 'Rental package (skis, boots, poles)',
      date: '2027-01-16',
      status: 'booked',
      costMinor: 4500,
      costMaxMinor: null,
      currency: 'USD',
      costKind: 'actual',
      costBasis: 'per-person',
      details: { demo: true, note: 'Simulated price.' },
    },
    {
      type: 'food',
      refId: 'greek-peak',
      title: 'Lunch at the lodge',
      date: '2027-01-16',
      status: 'draft',
      costMinor: 2500,
      costMaxMinor: null,
      currency: 'USD',
      costKind: 'estimate',
      costBasis: 'per-person',
      details: { demo: true, estimateBy: 'you' },
    },
  ]
  await db.insert(tripItems).values(greekDefs.map((i, n) => ({ ...i, tripId: GREEK_TRIP, sortOrder: n, createdAt: greekCreated })))
  const pickTemplates = ['Helmet, goggles, gloves, base layers, ski socks', 'Reserve rentals', 'Lift ticket bought / pass reservation made', 'Check forecast and resort report']
  const greekList = pickTemplates.map((label) => templates.find((t) => t.label === label)).filter((t): t is (typeof templates)[number] => !!t)
  if (greekList.length) {
    await db.insert(tripChecklist).values(
      greekList.map((t, n) => ({ tripId: GREEK_TRIP, label: t.label, category: t.category, done: t.label !== 'Check forecast and resort report', link: null, sortOrder: n })),
    )
  }

  // --- Lessons ---------------------------------------------------------------------------------------------------
  await db.insert(lessons).values([
    {
      resortId: 'greek-peak',
      tripId: null,
      date: '2026-12-19',
      kind: 'group',
      instructor: null,
      focusSkills: ids(['Walk and glide on the flat with skis on', 'Straight glide on a gentle slope', 'Controlled stopping (wedge)']),
      bookingRef: null,
      bookingUrl: greekResort?.links.lessons ?? null,
      costMinor: 7900,
      currency: 'USD',
      costKind: 'actual',
      notes: 'Demo lesson (simulated price): first-timer group lesson; the instructor confirmed my wedge stop.',
      createdAt: at('2026-12-19', '19:40'),
    },
    {
      resortId: 'alta',
      tripId: ALTA_TRIP,
      date: '2027-02-14',
      kind: 'group',
      instructor: null,
      focusSkills: ids(['Link turns on a green run', 'Match skis at the end of the turn']),
      bookingRef: null,
      bookingUrl: altaResort?.links.lessons ?? null,
      costMinor: null,
      currency: null,
      costKind: null,
      notes: 'Demo planned lesson (simulated): not booked, price not checked yet.',
      createdAt: altaCreated,
    },
  ])

  // --- Expenses (the season budget reads these; the pass purchase is linked so it counts once) --------------------
  const expense = (date: string, category: string, label: string, amountMinor: number, extra: Partial<typeof expenses.$inferInsert> = {}) => ({
    date,
    category,
    label,
    amountMinor,
    currency: 'USD',
    tripId: null,
    passOwnershipId: null,
    notes: 'Demo expense (simulated).',
    createdAt: date < '2026-12-01' ? p.trackingStartInstant : at(date, '20:00'),
    ...extra,
  })
  await db.insert(expenses).values([
    ...(ownershipId !== null
      ? [expense('2026-09-20', 'pass', 'Indy Base Pass 2026–27', 36900, { passOwnershipId: ownershipId, notes: 'Demo expense (simulated). Linked to the pass record so the purchase is counted once.' })]
      : []),
    expense('2026-12-10', 'gear', 'Helmet and goggles', 14900),
    expense('2026-12-19', 'lessons', 'Greek Peak group lesson', 7900),
    expense('2026-12-19', 'rentals', 'Rental package, Greek Peak', 4500),
    expense('2026-12-19', 'food', 'Lunch, Greek Peak', 1800),
    expense('2026-12-28', 'lift', 'Lift ticket, Labrador', 5900),
    expense('2026-12-28', 'rentals', 'Rental package, Labrador', 3900),
    expense('2026-12-28', 'travel', 'Fuel, Labrador round trip', 1500),
    expense('2027-01-02', 'rentals', 'Rental package, Greek Peak', 4500),
    expense('2027-01-02', 'food', 'Lunch, Greek Peak', 1900),
    expense('2027-01-10', 'lift', 'Lift ticket, Labrador', 5900),
    expense('2027-01-10', 'rentals', 'Rental package, Labrador', 3900),
    expense('2027-01-10', 'food', 'Lunch, Labrador', 1700),
  ])

  // --- My rating (written the evening of my 2 Jan visit, so it only knows what I logged by then) ------------------
  const reviewedVisit = logs.find((l) => l.resortId === 'greek-peak' && l.date === '2027-01-02')
  await db.insert(myRatings).values({
    resortId: 'greek-peak',
    rating: 4,
    review: `Demo review (simulated): close to Ithaca with a gentle learning area${reviewedVisit ? `; ${visitSurface(reviewedVisit.surfaceFeedback)} on my 2 Jan visit` : ''}.`,
    updatedAt: at('2027-01-02', '20:30'),
  })

  // --- FX (demo rates, never used in live mode) ---------------------------------------------------------------------
  const fx = rng('fx')
  let cad = 1.3712
  let eur = 0.9241
  const fxRows: (typeof fxRates.$inferInsert)[] = []
  for (const date of ['2026-12-01', '2026-12-08', '2026-12-15', '2026-12-22', '2026-12-29', '2027-01-05', '2027-01-12', '2027-01-14']) {
    cad += fx.normal(0, 0.004)
    eur += fx.normal(0, 0.003)
    const fetchedAt = `${date}T16:15:00.000Z`
    fxRows.push({ base: 'USD', quote: 'CAD', rate: cad.toFixed(4), rateDate: date, provider: DEMO_PROVIDER, fetchedAt, kind: 'demo' })
    fxRows.push({ base: 'USD', quote: 'EUR', rate: eur.toFixed(4), rateDate: date, provider: DEMO_PROVIDER, fetchedAt, kind: 'demo' })
  }
  await db.insert(fxRates).values(fxRows)

  // --- Alert rules (defaults for favourites + a watch on Song Mountain) and fired alerts ---------------------------
  await ensureDefaultAlertRules(db, p.trackingStartInstant)
  await db.insert(alertRules).values({ type: 'opening-date-change', resortId: NOT_OPEN_RESORT, params: { lookbackDays: 14 }, enabled: true, cooldownHours: 12, createdAt: p.trackingStartInstant })
  await fireDemoAlerts(db, p)

  return { logs }
}

async function fireDemoAlerts(db: Db, p: PersonalInputs): Promise<void> {
  const rules = await db.select().from(alertRules)
  const rule = (type: AlertType, resortId: string | null) => rules.find((r) => r.type === type && r.resortId === resortId) ?? null
  const names = new Map((await db.select({ id: resorts.id, shortName: resorts.shortName }).from(resorts)).map((r) => [r.id, r.shortName]))
  const fire = async (r: ReturnType<typeof rule>, cand: AlertCandidate, firedAt: string, readAt: string | null) => {
    if (!r) return
    const outcome = await fireCandidate(db, r, cand, firedAt)
    if (outcome === 'fired' && readAt) await db.update(alerts).set({ readAt }).where(eq(alerts.dedupeKey, dedupeKeyOf(cand)))
  }
  const plus = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString()

  // Resort opened (Greek Peak) and the announced-opening change at Song Mountain, from the recorded history.
  const history = await db.select().from(openingDateHistory).where(inArray(openingDateHistory.resortId, ['greek-peak', NOT_OPEN_RESORT]))
  const opened = history.find((h) => h.resortId === 'greek-peak' && h.field === 'actualOpening' && h.newValue)
  if (opened) {
    await fire(
      rule('resort-opened', 'greek-peak'),
      {
        type: 'resort-opened',
        subject: 'greek-peak',
        bucket: opened.seasonId,
        resortId: 'greek-peak',
        title: `${names.get('greek-peak') ?? 'Greek Peak'} opened for the ${opened.seasonId} season`,
        body: `Opening confirmed for ${formatLocalDate(opened.newValue!, 'ccc d LLL yyyy')} by ${opened.prov?.provider ?? 'a simulated report'}. Check today's report for open terrain. ${DEMO_SUFFIX}`,
        link: '/resorts/greek-peak',
      },
      plus(opened.changedAt, 10),
      plus(opened.changedAt, 190),
    )
  }
  const moved = history.find((h) => h.resortId === NOT_OPEN_RESORT && h.field === 'announcedOpening' && h.previousValue && h.newValue)
  if (moved) {
    const name = names.get(NOT_OPEN_RESORT) ?? NOT_OPEN_RESORT
    await fire(
      rule('opening-date-change', NOT_OPEN_RESORT),
      {
        type: 'opening-date-change',
        subject: `${NOT_OPEN_RESORT}/${moved.seasonId}/announcedOpening`,
        bucket: moved.newValue!,
        resortId: NOT_OPEN_RESORT,
        title: `${name}: announced opening changed to ${formatLocalDate(moved.newValue!, 'ccc d LLL yyyy')}`,
        body: `Previously ${formatLocalDate(moved.previousValue!, 'ccc d LLL yyyy')}. An announced date is a target and depends on operations and weather. Source: ${moved.prov?.provider ?? 'unknown'}. ${DEMO_SUFFIX}`,
        link: `/resorts/${NOT_OPEN_RESORT}`,
      },
      plus(moved.changedAt, 10),
      plus(moved.changedAt, 300),
    )
  }

  // Snow threshold at Alta, from the forecast fetched on 12 Jan (exactly as the rule sums it: whole hour slots).
  const snowRule = rule('snow-threshold', 'alta')
  if (p.altaForecast && snowRule) {
    const thresholdCm = Number((snowRule.params as { thresholdCm?: unknown }).thresholdCm ?? 15)
    const windowHours = Number((snowRule.params as { windowHours?: unknown }).windowHours ?? 72)
    const fromMs = Math.floor(Date.parse(p.altaForecast.fetchedAt) / 3_600_000) * 3_600_000
    const slots = slotsWithin(prepareSeries(p.altaForecast.hourly, 'preceding-hour'), fromMs, fromMs + windowHours * 3_600_000)
    let total = 0
    let crossedAt: number | null = null
    for (const s of slots) {
      const v = s.point.snowfallCm
      if (typeof v !== 'number') continue
      total += v
      if (crossedAt === null && total >= thresholdCm) crossedAt = s.startMs
    }
    if (crossedAt !== null) {
      const crossDate = localDateOf(new Date(crossedAt).toISOString(), 'America/Denver')
      await fire(
        snowRule,
        {
          type: 'snow-threshold',
          subject: 'alta',
          bucket: `${crossDate}|${thresholdCm}`,
          resortId: 'alta',
          title: `${names.get('alta') ?? 'Alta'}: likely ${formatSnow(Math.round(total * 10) / 10, p.units)} of snow in the next ${windowHours} h`,
          body: `Modeled snowfall (${DEMO_PROVIDER}, ${DEMO_MODEL}) at the ${p.altaForecast.pointKey} point passes your ${formatSnow(thresholdCm, p.units)} threshold around ${formatLocalDate(crossDate)}. A forecast, not an observation — it can change. ${DEMO_SUFFIX}`,
          link: '/resorts/alta',
        },
        plus(p.altaForecast.fetchedAt, 10),
        null,
      )
    }
  }

  // A pass sales deadline — the deadline itself is simulated (no dated deadline exists in the catalog).
  const passProduct = (await db.select().from(passProducts).where(eq(passProducts.id, PASS_DEADLINE_PRODUCT)))[0]
  if (passProduct) {
    const deadline = '2027-01-24'
    await fire(
      rule('pass-deadline', null),
      {
        type: 'pass-deadline',
        subject: passProduct.id,
        bucket: `${deadline}|within-14d|simulated`,
        resortId: passProduct.resortId,
        title: `${passProduct.name}: sales deadline in 12 days (simulated)`,
        body: `Deadline ${formatLocalDate(deadline, 'ccc d LLL yyyy')} — simulated for the demo; the real deadline is on the official pass page. ${DEMO_SUFFIX}`,
        link: '/passes',
      },
      '2027-01-12T14:00:00.000Z',
      null,
    )
  }
}
