/**
 * Catalog file formats (catalog/*.json). The catalog is curated, human-editable seed data with a source for every
 * non-trivial fact. `scripts/seed.ts` validates these files and loads them into the database without overwriting
 * user corrections (resort_overrides) or personal records.
 *
 * Research provenance: facts gathered by web search carry verification "search-summary" and are shown in the UI as
 * "Researched — confirm at source" until confirmed.
 */
import { z } from 'zod'

const url = z.url()
const optUrl = url.nullable().default(null)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const optDate = date.nullable().default(null)
const optStr = z.string().nullable().default(null)
const optNum = z.number().nullable().default(null)
const optBool = z.boolean().nullable().default(null)
const season = z.string().regex(/^\d{4}-\d{2}$/)

export const Verification = z.enum(['api', 'official-page', 'search-summary', 'user-confirmed', 'unverified'])

/** Where a group of facts came from. */
export const SourceRef = z.object({
  url: optUrl,
  verification: Verification.default('search-summary'),
  checkedOn: date.default('2026-09-28'),
  note: optStr,
})
export type SourceRef = z.infer<typeof SourceRef>

const withSource = <T extends z.ZodRawShape>(shape: T) => z.object({ ...shape, source: SourceRef.nullable().default(null) })

export const LinkSet = z.object({
  official: optUrl,
  trailMap: optUrl,
  interactiveMap: optUrl,
  snowReport: optUrl,
  hours: optUrl,
  tickets: optUrl,
  seasonPass: optUrl,
  lessons: optUrl,
  rentals: optUrl,
  webcams: optUrl,
  parking: optUrl,
  roadInfo: optUrl,
  lodging: optUrl,
  events: optUrl,
  tourism: optUrl,
  avalanche: optUrl,
  openSkiMap: optUrl,
})

export const HistoricalOpening = z.object({
  season,
  opened: optDate,
  closed: optDate,
  source: SourceRef.nullable().default(null),
})

export const CatalogResort = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(2),
  shortName: z.string().min(2),
  country: z.string().length(2),
  region: z.string(),
  stateProvince: optStr,
  locality: optStr,
  timezone: z.string(),
  operator: optStr,
  /** 2 = personal favourite/priority (Greek Peak, Alta), 1 = practical from Ithaca, 0 = destination. */
  priority: z.number().int().min(0).max(2).default(0),
  location: withSource({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }),
  elevation: withSource({ baseM: optNum, summitM: optNum, verticalM: optNum }),
  weatherPoints: z
    .array(
      z.object({
        key: z.enum(['base', 'summit']),
        label: z.string(),
        lat: z.number(),
        lon: z.number(),
        elevationM: optNum,
        approximate: z.boolean().default(true),
      }),
    )
    .min(1),
  terrain: withSource({
    trails: optNum,
    lifts: optNum,
    skiableAcres: optNum,
    beginnerPct: optNum,
    intermediatePct: optNum,
    advancedPct: optNum,
    terrainParks: optNum,
    season: season.nullable().default(null),
  }),
  features: withSource({
    nightSkiing: optBool,
    snowmakingPct: optNum,
    lessons: optBool,
    rentals: optBool,
    onMountainLodging: optBool,
    tubing: optBool,
    childcare: optBool,
    beginnerArea: optStr,
  }),
  character: optStr,
  learning: optStr,
  season: z.object({
    season,
    announcedOpening: withSource({ date: optDate, text: optStr, announcedOn: optDate }),
    announcedClosing: withSource({ date: optDate, text: optStr, announcedOn: optDate }),
    /** Past openings used to derive an *estimated* window (labelled Estimated, never Announced). */
    history: z.array(HistoricalOpening).default([]),
    typicalText: optStr,
    notes: optStr,
  }),
  hours: z
    .array(
      withSource({
        activity: z.enum(['lifts', 'night-skiing', 'ticket-office', 'rentals', 'lessons', 'tubing', 'other']),
        label: z.string(),
        /** ISO weekdays 1=Mon…7=Sun; null when the source doesn't say. */
        days: z.array(z.number().int().min(1).max(7)).nullable().default(null),
        opens: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
        closes: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
        season: season.nullable().default(null),
        note: optStr,
      }),
    )
    .default([]),
  prices: z
    .array(
      withSource({
        subjectType: z.enum(['lift-ticket', 'pass-product', 'rental', 'lesson', 'parking', 'food', 'other']),
        item: z.string(),
        category: optStr,
        amount: z.number().nonnegative(),
        amountMax: optNum,
        currency: z.string().length(3),
        season: season.nullable().default(null),
        dayType: z.enum(['weekday', 'weekend', 'holiday', 'peak', 'any']).nullable().default(null),
        purchaseBy: optDate,
        appliesFrom: optDate,
        appliesTo: optDate,
        includesTax: optBool,
        note: optStr,
      }),
    )
    .default([]),
  links: LinkSet,
  moreLinks: z.array(z.object({ label: z.string(), url })).default([]),
  travel: z.object({
    driveFromIthaca: withSource({ minutes: optNum, km: optNum, basis: optStr }).nullable().default(null),
    airports: z
      .array(
        withSource({
          iata: z.string().length(3),
          role: z.enum(['closest', 'practical', 'both']),
          minutes: optNum,
          km: optNum,
          basis: optStr,
        }),
      )
      .default([]),
    transfers: z
      .array(
        z.object({
          name: z.string(),
          type: z.enum(['bus', 'shuttle', 'rental-car', 'private', 'train', 'other']),
          url: optUrl,
          notes: optStr,
        }),
      )
      .default([]),
  }),
  reportSource: z
    .object({ url: optUrl, format: z.enum(['html', 'json', 'pdf', 'unknown']).default('unknown'), notes: optStr })
    .nullable()
    .default(null),
  photo: z
    .object({ src: z.string(), alt: z.string(), credit: z.string(), license: z.string(), sourceUrl: url })
    .nullable()
    .default(null),
  research: z.object({
    method: z.string().default('web-search'),
    date: date.default('2026-09-28'),
    openQuestions: z.array(z.string()).default([]),
    conflicts: z.array(z.string()).default([]),
    confidenceNotes: optStr,
  }),
})
export type CatalogResort = z.infer<typeof CatalogResort>

// ---------------------------------------------------------------------------

export const CatalogPassFamily = z.object({
  id: z.enum(['ikon', 'epic', 'indy', 'mountain-collective', 'regional']),
  name: z.string(),
  operator: optStr,
  links: z.record(z.string(), url.nullable()),
  source: SourceRef.nullable().default(null),
})

export const CatalogPassPrice = withSource({
  category: z.string(),
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
  window: optStr,
  purchaseBy: optDate,
})

export const CatalogPassProduct = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  family: z.enum(['ikon', 'epic', 'indy', 'mountain-collective', 'regional']),
  /** For resort-specific season passes. */
  resortId: optStr,
  name: z.string(),
  season,
  summary: optStr,
  blackoutsSummary: optStr,
  reservationsSummary: optStr,
  salesDeadline: optDate,
  salesDeadlineText: optStr,
  renewalNotes: optStr,
  prices: z.array(CatalogPassPrice).default([]),
  source: SourceRef.nullable().default(null),
})

export const CatalogAccessRule = withSource({
  productId: z.string(),
  resortId: z.string(),
  access: z.enum(['unlimited', 'limited-days', 'shared-pool', 'discount-only', 'not-included', 'unknown']),
  days: optNum,
  poolId: optStr,
  poolLabel: optStr,
  blackouts: z.array(z.object({ from: date, to: date, label: optStr })).default([]),
  reservationRequired: optBool,
  reservationNotes: optStr,
  discountText: optStr,
  eligibilityNotes: optStr,
  notes: optStr,
})

export const CatalogPasses = z.object({
  families: z.array(CatalogPassFamily),
  products: z.array(CatalogPassProduct),
  access: z.array(CatalogAccessRule),
  research: z.object({ openQuestions: z.array(z.string()).default([]), conflicts: z.array(z.string()).default([]) }).default({ openQuestions: [], conflicts: [] }),
})
export type CatalogPasses = z.infer<typeof CatalogPasses>

// ---------------------------------------------------------------------------

export const CatalogAirport = z.object({
  iata: z.string().length(3),
  name: z.string(),
  city: optStr,
  lat: z.number(),
  lon: z.number(),
  timezone: optStr,
  role: z.enum(['origin', 'destination', 'both']),
  officialUrl: optUrl,
  airlinesUrl: optUrl,
  airlines: z
    .array(z.object({ airline: z.string(), nonstops: z.array(z.string()).default([]), seasonal: optStr, sourceUrl: optUrl }))
    .default([]),
  parking: optStr,
  driveFromHome: withSource({ minutes: optNum, km: optNum, basis: optStr }).nullable().default(null),
  notes: optStr,
  source: SourceRef.nullable().default(null),
})

export const CatalogAirports = z.object({
  airports: z.array(CatalogAirport),
  routeNotes: z.array(z.object({ from: z.string(), to: z.string(), notes: z.string(), source: SourceRef.nullable().default(null) })).default([]),
  skiBaggage: z.array(z.object({ airline: z.string(), policy: z.string(), source: SourceRef.nullable().default(null) })).default([]),
})

export const CatalogHotel = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  resortId: z.string(),
  name: z.string(),
  tier: z.enum(['budget', 'comfortable', 'premium']).nullable().default(null),
  brand: optStr,
  address: optStr,
  lat: optNum,
  lon: optNum,
  officialUrl: optUrl,
  distanceText: optStr,
  skiInOut: z.enum(['verified-yes', 'verified-no', 'unknown']).default('unknown'),
  shuttle: optStr,
  parking: optStr,
  notes: optStr,
  source: SourceRef.nullable().default(null),
})

export const CatalogEvent = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  resortId: optStr,
  title: z.string(),
  category: z.enum(['live-music', 'festival', 'night-ski', 'opening', 'competition', 'food-drink', 'community', 'other']),
  venue: optStr,
  startLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/).nullable().default(null),
  endLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/).nullable().default(null),
  timezone: z.string(),
  status: z.enum(['announced', 'tentative', 'not-announced', 'postponed', 'cancelled']),
  lastEdition: optStr,
  ticketUrl: optUrl,
  price: optNum,
  currency: optStr,
  ageRestriction: optStr,
  bookingRequired: optBool,
  officialUrl: optUrl,
  announcedOn: optDate,
  source: SourceRef.nullable().default(null),
})

export const CatalogHotels = z.object({ hotels: z.array(CatalogHotel) })
export const CatalogEvents = z.object({ events: z.array(CatalogEvent) })
