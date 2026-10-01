/**
 * Server-side assembly for Today: one call from the page, everything else is pre-shaped and serializable.
 *
 * - The dashboard itself comes from getTodayView (src/lib/data/today.ts); the weekend finder from getRecommendation
 *   with the "My weights" preset over its window.
 * - Resort cards (the shared Explore card, for "Quick look" and sources) for the recommended options and the
 *   favourites, built with toResortCardData from real summaries — never partial or guessed.
 * - Pass watch: dated pass price/sales deadlines and the research notes on sales, from the Passes read model, with
 *   relevance to your favourites taken from the exact products' access rules (affiliation ≠ ownership).
 * - Onboarding options (exact pass products, current preferences) only while onboarding is not done.
 */
import 'server-only'
import type { Ctx } from '@/lib/context'
import { getFreshness, type FreshnessView } from '@/lib/data/freshness'
import { getPassesView } from '@/lib/data/passes'
import { listResortSummaries, type ResortSummary } from '@/lib/data/resorts'
import { defaultPreset, getRecommendation, getTodayView, type TodayView } from '@/lib/data/today'
import { tripSummaries, type TripSummary } from '@/lib/data/trips'
import { toResortCardData, type ResortCardData } from '@/components/resort/card-data'
import { HOME_ITHACA } from '@/lib/domain/defaults'
import { LONG_HAUL_KM } from '@/lib/domain/geo'
import { formatMoney, money } from '@/lib/domain/money'
import { formatDistance } from '@/lib/domain/units'
import {
  FACTOR_KEYS,
  FACTOR_LABEL,
  PRESET_LABEL,
  PRESET_MODES,
  PRESET_WEIGHTS,
  RECOMMEND_PRESETS,
  type FactorWeights,
  type RankedOption,
  type RecommendPreset,
} from '@/lib/domain/recommend'
import { addDays, daysBetween, nextSaturday } from '@/lib/domain/time'
import { PASS_FAMILIES, SCORING_MODE_LABEL, type AbilityLevel, type PassFamilyId, type Provenance, type ScoringMode, type UnitPrefs } from '@/lib/domain/types'
import type { StripDayData } from './day-strip'
import { finderRange, type FinderWindow, type TodayParams } from './params'
import type { PresetOption } from './preset-chips'
import { rankingView, weightPercents, type RankingView } from './rank-model'

const PRICE_DEADLINE_DAYS = 60

export interface PriceDeadline {
  productId: string
  name: string
  familyId: PassFamilyId | null
  category: string | null
  price: string
  /** Last purchase date at this price (inclusive). */
  until: string
  daysLeft: number
  /** The price after the deadline, when the source lists one. */
  next: string | null
  note: string | null
  favourite: boolean
  owned: boolean
  confirmAtSource: boolean
  prov: Provenance | null
}

export interface SalesNote {
  names: string[]
  familyId: PassFamilyId | null
  text: string
  favourite: boolean
  confirmAtSource: boolean
  prov: Provenance | null
}

export interface PassWatch {
  /** Exact products recorded as yours (holder "me"). */
  mine: { name: string; familyId: PassFamilyId | null }[]
  /** Structured sales deadlines (≤ 45 days) from the dashboard. */
  deadlines: TodayView['passDeadlines']
  prices: PriceDeadline[]
  notes: SalesNote[]
  /** Notes not shown (see Passes & Costs). */
  moreNotes: number
}

export interface OnboardingOptions {
  home: {
    name: string
    lat: number
    lon: number
    timezone: string
    isDefault: boolean
  }
  ability: AbilityLevel
  units: UnitPrefs
  travel: { maxDriveHours: number | null; willingToFly: boolean }
  seasonLabel: string
  products: {
    id: string
    name: string
    familyId: string
    familyName: string
    owned: boolean
  }[]
}

export interface PlanningHint {
  resortId: string
  name: string
  label: 'announced' | 'estimated'
  /** First weekend on/after the (announced or earliest estimated) opening. */
  from: string
  to: string
  href: string
}

/** What the weekend finder weighs, in plain words (all from preferences — nothing guessed). */
export interface FinderInputs {
  home: string
  ability: AbilityLevel
  /** Formatted per-person day budget, or null when none is set. */
  dayBudget: string | null
  /** Exact pass products recorded as yours. */
  passes: string[]
  maxDriveHours: number | null
  willingToFly: boolean
  companion: { name: string | null; ability: AbilityLevel } | null
}

export interface TodayData {
  view: TodayView
  /** The hero ranking (slim, client-safe). */
  ranking: RankingView
  finder: {
    window: FinderWindow
    ranking: RankingView
    saved: FactorWeights
    inputs: FinderInputs
  }
  /** Seven-day strip, slim for the client. */
  strip: StripDayData[]
  /** Conditions scoring mode the strip and cards show ("Learning day"). */
  modeLabel: string
  /** Preset chips with the weights each applies. */
  presets: PresetOption[]
  /** The preset used when the URL names none (from your ability). */
  defaultPreset: RecommendPreset
  /** Resort names by id, for events and changes. */
  names: Record<string, string>
  /** Card view models keyed `${resortId}|${date}` (recommended options and favourites). */
  cards: Record<string, ResortCardData>
  passes: PassWatch
  trips: TripSummary[]
  planning: PlanningHint[]
  onboarding: OnboardingOptions | null
  units: UnitPrefs
  /** Every favourite lacks stored weather. */
  weatherMissing: boolean
  /** When the data was last updated (live mode); null in demo mode. */
  freshness: FreshnessView | null
  /** LONG_HAUL_KM in display units: resorts farther from home are planned as trips, not ranked on Today. */
  longHaulLimit: string | null
}

export const cardKey = (resortId: string, date: string) => `${resortId}|${date}`

const isFamily = (id: string): id is PassFamilyId => (PASS_FAMILIES as readonly string[]).includes(id)

function modeFor(view: TodayView, fallback: ScoringMode): ScoringMode {
  return view.preset === 'custom' ? fallback : PRESET_MODES[view.preset][0]
}

async function optionCards(ctx: Ctx, view: TodayView): Promise<Record<string, ResortCardData>> {
  const rec = view.recommendation
  const opts: RankedOption[] = [...(rec.winner ? [rec.winner] : []), ...rec.alternatives, ...rec.statusUnknown.slice(0, 4)]
  const byDate = new Map<string, Set<string>>()
  for (const o of opts) byDate.set(o.date, (byDate.get(o.date) ?? new Set()).add(o.resortId))
  const season = view.season.label
  const units = ctx.prefs.units
  const mode = modeFor(view, ctx.prefs.scoringMode)
  const lists = await Promise.all([...byDate].map(([date, ids]) => listResortSummaries(ctx, { ids: [...ids], date, mode })))
  const cards: Record<string, ResortCardData> = {}
  const add = (s: ResortSummary) => {
    cards[cardKey(s.id, s.date)] = toResortCardData(s, {
      units,
      now: ctx.now,
      seasonLabel: season,
    })
  }
  for (const list of lists) list.forEach(add)
  for (const w of view.watchlist) add(w.summary)
  return cards
}

async function passWatch(ctx: Ctx, view: TodayView): Promise<{ watch: PassWatch; products: OnboardingOptions['products'] }> {
  const pv = await getPassesView(ctx)
  const favIds = new Set(view.watchlist.map((w) => w.summary.id))
  const favRelevant = new Set<string>()
  for (const row of pv.matrix.rows) {
    if (row.cells.some((c) => favIds.has(c.resortId) && c.hasRule && c.status !== 'not-included')) favRelevant.add(row.productId)
  }
  for (const p of pv.products) if (p.resortId && favIds.has(p.resortId)) favRelevant.add(p.id)

  const today = ctx.today
  const horizon = addDays(today, PRICE_DEADLINE_DAYS)
  const prices: PriceDeadline[] = []
  for (const p of pv.products) {
    for (const pr of p.prices) {
      const by = pr.purchaseBy?.slice(0, 10) ?? null
      if (!by || by < today || by > horizon || pr.purchaseClosed) continue
      const next = p.prices
        .filter((x) => x !== pr && (x.category ?? '') === (pr.category ?? '') && (!x.purchaseBy || x.purchaseBy.slice(0, 10) > by))
        .sort((a, b) => (a.purchaseBy ?? '9999').localeCompare(b.purchaseBy ?? '9999'))[0]
      prices.push({
        productId: p.id,
        name: p.name,
        familyId: isFamily(p.familyId) ? p.familyId : null,
        category: pr.category,
        price: formatMoney(pr.amount) ?? '',
        until: by,
        daysLeft: daysBetween(today, by),
        next: next ? formatMoney(next.amount) : null,
        note: p.salesDeadline?.text ?? null,
        favourite: favRelevant.has(p.id),
        owned: p.ownedByMe,
        confirmAtSource: pr.confirmAtSource,
        prov: pr.prov,
      })
    }
  }
  prices.sort((a, b) => a.until.localeCompare(b.until) || Number(b.favourite) - Number(a.favourite) || a.name.localeCompare(b.name))

  // Research notes on sales (undated or already dated elsewhere), grouped by identical wording.
  const withPrice = new Set(prices.map((x) => x.productId))
  const dated = new Set(view.passDeadlines.map((d) => d.productId))
  const groups = new Map<string, SalesNote>()
  for (const p of pv.products) {
    const text = p.salesDeadline?.text?.trim()
    if (!text || withPrice.has(p.id) || dated.has(p.id)) continue
    // A note beside dated price tiers is about those dates: once every tier's purchase date has passed, it is history.
    const tiers = p.prices.map((x) => x.purchaseBy?.slice(0, 10)).filter((x): x is string => !!x)
    if (tiers.length && tiers.every((by) => by < today)) continue
    const fam = isFamily(p.familyId) ? p.familyId : null
    const g = groups.get(text)
    const favourite = favRelevant.has(p.id) || p.ownedByMe
    if (g) {
      g.names.push(p.name)
      g.favourite ||= favourite
      g.confirmAtSource ||= p.confirmAtSource
    } else
      groups.set(text, {
        names: [p.name],
        familyId: fam,
        text,
        favourite,
        confirmAtSource: p.confirmAtSource,
        prov: p.prov,
      })
  }
  const allNotes = [...groups.values()].sort((a, b) => Number(b.favourite) - Number(a.favourite) || a.names[0].localeCompare(b.names[0]))
  const notes = allNotes.filter((n) => n.favourite).slice(0, 3)

  return {
    watch: {
      mine: pv.owned
        .filter((o) => o.holder === 'me')
        .map((o) => ({
          name: o.productName,
          familyId: isFamily(o.familyId) ? o.familyId : null,
        })),
      deadlines: view.passDeadlines,
      prices: prices.slice(0, 4),
      notes,
      moreNotes: allNotes.length - notes.length,
    },
    products: pv.products.map((p) => ({
      id: p.id,
      name: p.name,
      familyId: p.familyId,
      familyName: p.familyName,
      owned: p.ownedByMe,
    })),
  }
}

/** First weekend on/after an opening date or the start of an estimated window, for favourites not yet open. */
function planningHints(view: TodayView): PlanningHint[] {
  return view.openingTimeline
    .filter((o) => o.isFavorite && (o.label === 'announced' || o.label === 'estimated') && o.date && o.date >= view.today)
    .map((o) => {
      const sat = nextSaturday(o.date!)
      const from = sat
      const to = addDays(sat, 1)
      return {
        resortId: o.resortId,
        name: o.name,
        label: o.label as 'announced' | 'estimated',
        from,
        to,
        href: `/trips?new=1&resort=${encodeURIComponent(o.resortId)}&start=${from}&end=${to}`,
      }
    })
    .slice(0, 3)
}

/** "Conditions 25% · Fit for me 45% · …" (whole percentages that add to 100; zero weights left out). */
export function weightsText(w: FactorWeights): string {
  const pct = weightPercents(w)
  return FACTOR_KEYS.filter((k) => pct[k] > 0)
    .map((k) => `${FACTOR_LABEL[k]} ${pct[k]}%`)
    .join(' · ')
}

function presetOptions(saved: FactorWeights): PresetOption[] {
  return RECOMMEND_PRESETS.map((id) => ({
    id,
    label: PRESET_LABEL[id],
    weights: weightsText(id === 'custom' ? saved : PRESET_WEIGHTS[id]),
  }))
}

/** The strip for the client: only what the cells draw (a confirmed closure keeps just its reason). */
function slimStrip(view: TodayView): StripDayData[] {
  return view.strip.map((d) => ({
    date: d.date,
    isWeekend: d.isWeekend,
    cells: d.cells.map((c) => ({
      resortId: c.resortId,
      name: c.name,
      snowfallCm: c.snowfallCm,
      partial: c.partial,
      tempMinC: c.tempMinC,
      tempMaxC: c.tempMaxC,
      score: c.score,
      scoreKind: c.scoreKind,
      closed: c.closed ? { reason: c.closed.reason } : null,
    })),
  }))
}

function finderInputs(ctx: Ctx, mine: PassWatch['mine']): FinderInputs {
  const p = ctx.prefs
  const budget = p.budget.dayBudgetMinor != null ? formatMoney(money(p.budget.dayBudgetMinor, p.budget.currency)) : null
  return {
    home: p.homeName,
    ability: p.ability,
    dayBudget: budget,
    passes: mine.map((m) => m.name),
    maxDriveHours: p.travel.maxDriveHours,
    willingToFly: p.travel.willingToFly,
    companion: p.companionAbility ? { name: p.companionName, ability: p.companionAbility } : null,
  }
}

export async function loadToday(ctx: Ctx, p: TodayParams): Promise<TodayData> {
  const finderDates = finderRange(p.finder, ctx.today)
  const [view, finderRec, trips, freshness] = await Promise.all([
    getTodayView(ctx, { date: p.date, range: p.range, preset: p.preset }),
    getRecommendation(ctx, { range: finderDates, preset: 'custom' }),
    tripSummaries(ctx),
    getFreshness(ctx),
  ])
  const [cards, pw] = await Promise.all([optionCards(ctx, view), passWatch(ctx, view)])
  const prefs = ctx.prefs
  const onboarding: OnboardingOptions | null = prefs.onboardingDone
    ? null
    : {
        home: {
          name: prefs.homeName,
          lat: prefs.homeLat,
          lon: prefs.homeLon,
          timezone: prefs.homeTimezone,
          isDefault: prefs.homeName === HOME_ITHACA.homeName && prefs.homeLat === HOME_ITHACA.homeLat && prefs.homeLon === HOME_ITHACA.homeLon,
        },
        ability: prefs.ability,
        units: prefs.units,
        travel: {
          maxDriveHours: prefs.travel.maxDriveHours,
          willingToFly: prefs.travel.willingToFly,
        },
        seasonLabel: view.season.label,
        products: pw.products,
      }
  const saved = prefs.weights as FactorWeights
  return {
    view,
    ranking: rankingView(view.recommendation),
    finder: {
      window: p.finder,
      ranking: rankingView(finderRec),
      saved,
      inputs: finderInputs(ctx, pw.watch.mine),
    },
    strip: slimStrip(view),
    modeLabel: SCORING_MODE_LABEL[modeFor(view, prefs.scoringMode)],
    presets: presetOptions(saved),
    defaultPreset: defaultPreset(prefs.ability),
    names: view.resortNames,
    cards,
    passes: pw.watch,
    trips: trips.filter((t) => t.phase === 'upcoming' || t.phase === 'in-progress'),
    planning: planningHints(view),
    onboarding,
    units: prefs.units,
    weatherMissing: view.watchlist.length > 0 && view.watchlist.every((w) => !w.summary.freshness.weatherFetchedAt),
    freshness,
    longHaulLimit: formatDistance(LONG_HAUL_KM, prefs.units),
  }
}
