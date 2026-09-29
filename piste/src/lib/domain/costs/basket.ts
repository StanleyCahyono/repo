/**
 * Per-person day basket: lift access + selected rental option + lunch + allocated parking. The same assumptions
 * (rental option, lunch estimate, party size, ticket category, currency) are applied to every resort so tiers are
 * comparable. Lessons, lodging and long-distance travel are itemised elsewhere (trip budget).
 *
 * Honesty rules
 * - A missing lift price, or a missing rental price when a rental is needed, makes the basket incomplete: no
 *   total and tier 'incomplete' ("Incomplete estimate"). A tier is never produced from partial data.
 * - Lunch and parking, when unknown, are listed as missing and excluded from the total (stated in `excluded`).
 * - A pass that can be used that day makes lift access 0 incremental, with a "Covered by …" note.
 * - Every line says what kind of number it is (published / observed quote / your estimate / assumption / pass).
 * - Research-grade (search-summary / unverified) prices and pass rules set `confirmAtSource` and add a caveat.
 * - Estimate ranges are classified at both ends (`tier` low end, `tierMax` when the high end is in a higher band).
 */
import { allocate, formatMoney, money, sum, type Money } from '../money'
import { formatLocalDate } from '../time'
import { ACCESS_STATUS_LABEL, type AccessStatus, type AccessVerdict } from '../passes/types'
import { DEFAULT_DAY_TYPE_CONFIG, dayTypeFor, type DayType, type DayTypeConfig } from './day-type'
import { convertMoney, convertWith, type FxRateRecord, type FxRateUsed } from './fx'
import { selectPrice, type PriceSelection, type PriceSnapshotInput, type QuoteKind } from './prices'
import {
  classifyTier,
  DEFAULT_TIER_BANDS,
  INCOMPLETE_ESTIMATE,
  incompleteTier,
  tierFor,
  type TierBands,
  type TierResult,
} from './tiers'
import type { ExpenseTier } from '../types'

export type RentalOption = 'full-package' | 'skis-only' | 'boots-only' | 'none'
export type LineKind = QuoteKind | 'assumption' | 'pass-covered'
export type BasketLineKey = 'lift' | 'rental' | 'lunch' | 'parking'

export const LINE_KIND_LABEL: Record<LineKind, string> = {
  published: 'Published price',
  'observed-quote': 'Observed quote',
  'user-estimate': 'Your estimate',
  demo: 'Demo price',
  assumption: 'Assumption',
  'pass-covered': 'Covered by pass',
}

export const RENTAL_LABEL: Record<RentalOption, string> = {
  'full-package': 'Rental package (skis, boots, poles)',
  'skis-only': 'Ski rental',
  'boots-only': 'Boot rental',
  none: 'Own gear',
}

const RENTAL_ALIASES: Record<Exclude<RentalOption, 'none'>, string[]> = {
  'full-package': ['full-package', 'package', 'ski-package', 'full-rental', 'full', 'ski-boot-pole-package'],
  'skis-only': ['skis-only', 'skis', 'ski-only'],
  'boots-only': ['boots-only', 'boots', 'boot-only'],
}

/** Rental snapshots are matched by `item` = the option id (a few plain aliases accepted). */
export function rentalItemMatches(item: string, option: Exclude<RentalOption, 'none'>): boolean {
  const norm = item.trim().toLowerCase().replace(/[\s_]+/g, '-')
  return RENTAL_ALIASES[option].includes(norm)
}

export interface BasketLine {
  key: BasketLineKey
  label: string
  /** Per person, in the price's original currency. null = unknown. */
  amount: Money | null
  /** Upper bound when the source is a range. */
  amountMax: Money | null
  /** In the basket currency; null when unknown or when no stored FX rate exists (show `amount` instead). */
  display: Money | null
  displayMax: Money | null
  fx: FxRateUsed | null
  kind: LineKind | null
  source: string | null
  snapshotId: number | null
  note: string | null
  /** Required lines make the basket incomplete when unknown. */
  required: boolean
  /** Research-grade/unverified price or pass rule behind this line — show "Researched — confirm at source". */
  confirmAtSource: boolean
}

export interface BasketAssumptions {
  /** Display currency for totals. */
  currency: string
  rentalOption: RentalOption
  /** Your lunch estimate per person (Settings). null = not set. */
  lunch: Money | null
  /** People sharing one vehicle's parking. */
  partySize: number
  /** Ticket category; default 'adult'. */
  category?: string | null
  /**
   * Lines whose absence makes the basket incomplete. Default ['lift', 'rental'] (rental only counts when a
   * rental is selected). Add 'parking' / 'lunch' for a stricter basket.
   */
  required?: readonly BasketLineKey[]
  dayTypeConfig?: DayTypeConfig
  bands?: TierBands
}

export type ParkingFact = { status: 'free' | 'not-needed'; source?: string | null; kind?: LineKind | null }

/** The verdict fields the basket needs. When `resortId`/`date` are present they must match the basket day. */
export type BasketPass = Pick<AccessVerdict, 'canSki' | 'status' | 'productName' | 'reservationRequired' | 'discountText'> &
  Partial<Pick<AccessVerdict, 'resortId' | 'date' | 'confirmAtSource'>>

export interface BasketDayInput {
  resortId: string
  date: string
  /** Price snapshots for this resort (lift-ticket, rental, parking…). */
  prices: readonly PriceSnapshotInput[]
  /** Confirmed parking facts; otherwise parking snapshots are used; otherwise unknown. */
  parking?: ParkingFact | null
  /** Access verdict for the pass under consideration (owned or candidate) on this date. */
  pass?: BasketPass | null
}

export interface BasketContext {
  /** ISO instant — quote expiry. */
  now: string
  /** Home-local date — FX as-of and date-only expiry. */
  today?: string | null
  rates: readonly FxRateRecord[]
}

export interface BasketMissing {
  key: BasketLineKey | 'fx'
  required: boolean
  message: string
}

export interface DayBasket {
  resortId: string
  date: string
  dayType: DayType
  holidayName: string | null
  currency: string
  lines: BasketLine[]
  /** All required prices known. */
  complete: boolean
  missing: BasketMissing[]
  /** Optional lines left out of the total because they are unknown. */
  excluded: BasketLineKey[]
  /** Plain-language qualifiers for the total/tier, e.g. "Excludes parking (unknown)". */
  caveats: string[]
  /** Per person, basket currency. null when incomplete or a line could not be converted. */
  total: Money | null
  /** Upper bound when any line is a range; else null. */
  totalMax: Money | null
  /** Sum of the known, converted lines — for itemised display only; never classify it. */
  knownSubtotal: Money
  /** Tier of the basket's low end (any range lines at their minimum). */
  tier: TierResult
  /** Tier of the high end when estimate ranges push it into a higher band than `tier`; else null. */
  tierMax: ExpenseTier | null
  /** Tier symbol or "Incomplete estimate". */
  label: string
  assumptions: Omit<BasketAssumptions, 'dayTypeConfig' | 'bands' | 'required'> & { required: BasketLineKey[] }
}

export const DEFAULT_REQUIRED_LINES: readonly BasketLineKey[] = ['lift', 'rental']

interface LineDraft extends Omit<BasketLine, 'display' | 'displayMax' | 'fx'> {
  missingMessage?: string
}

function fromSelection(
  key: BasketLineKey,
  label: string,
  sel: PriceSelection,
  required: boolean,
  missingMessage: string,
): LineDraft {
  const s = sel.snapshot
  if (!s) {
    const expiredNote = sel.expired ? ` (${sel.expired} expired quote${sel.expired === 1 ? '' : 's'} ignored)` : ''
    // Keep the note inside the sentence: "No rental price (1 expired quote ignored)."
    const message = expiredNote ? `${missingMessage.replace(/\.+$/, '')}${expiredNote}.` : missingMessage
    return {
      key,
      label,
      amount: null,
      amountMax: null,
      kind: null,
      source: null,
      snapshotId: null,
      note: null,
      required,
      confirmAtSource: false,
      missingMessage: message,
    }
  }
  return {
    key,
    label,
    amount: money(s.amountMinor, s.currency),
    amountMax: s.amountMaxMinor != null && s.amountMaxMinor > s.amountMinor ? money(s.amountMaxMinor, s.currency) : null,
    kind: s.quoteKind,
    source: sel.basis,
    snapshotId: s.id ?? null,
    note: s.feesText ?? (s.includesTax === false ? 'Before tax' : null),
    required,
    confirmAtSource: sel.confirmAtSource,
  }
}

function notCoveredNote(pass: BasketPass): string {
  const status = ACCESS_STATUS_LABEL[pass.status as AccessStatus] ?? pass.status
  if (pass.status === 'discount-only') {
    return `${pass.productName}: discount only${pass.discountText ? ` (${pass.discountText})` : ''} — not applied; full ticket price shown.`
  }
  return `Not covered by ${pass.productName}: ${status}.`
}

export function computeDayBasket(day: BasketDayInput, a: BasketAssumptions, ctx: BasketContext): DayBasket {
  const currency = a.currency.toUpperCase()
  if (!Number.isInteger(a.partySize) || a.partySize < 1) throw new Error('Basket party size must be a positive integer')
  if ((day.pass?.resortId && day.pass.resortId !== day.resortId) || (day.pass?.date && day.pass.date !== day.date)) {
    throw new Error(`Basket for ${day.resortId} ${day.date} was given a pass verdict for ${day.pass.resortId} ${day.pass.date}`)
  }
  const requiredKeys = new Set(a.required ?? DEFAULT_REQUIRED_LINES)
  const { dayType, holidayName } = dayTypeFor(day.date, a.dayTypeConfig ?? DEFAULT_DAY_TYPE_CONFIG)
  const category = a.category ?? 'adult'
  const q = { resortId: day.resortId, date: day.date, dayType, now: ctx.now, today: ctx.today ?? null }
  const drafts: LineDraft[] = []

  // Lift access
  if (day.pass?.canSki) {
    const rr = day.pass.reservationRequired
    const research = !!day.pass.confirmAtSource
    drafts.push({
      key: 'lift',
      label: 'Lift access',
      amount: money(0, currency),
      amountMax: null,
      kind: 'pass-covered',
      source: day.pass.productName,
      snapshotId: null,
      note:
        `Covered by ${day.pass.productName}` +
        (rr === true ? ' — reservation required' : rr == null ? ' — reservation requirement not recorded' : '') +
        (research ? ' — access rule not verified, confirm at source' : ''),
      required: requiredKeys.has('lift'),
      confirmAtSource: research,
    })
  } else {
    const sel = selectPrice(day.prices, { ...q, subjectType: 'lift-ticket', category })
    const line = fromSelection('lift', 'Lift ticket', sel, requiredKeys.has('lift'), `No ${dayType} lift ticket price for ${formatLocalDate(day.date)}.`)
    if (day.pass) line.note = [notCoveredNote(day.pass), line.note].filter(Boolean).join(' ')
    drafts.push(line)
  }

  // Rental
  if (a.rentalOption === 'none') {
    drafts.push({
      key: 'rental',
      label: RENTAL_LABEL.none,
      amount: money(0, currency),
      amountMax: null,
      kind: 'assumption',
      source: 'Gear preferences',
      snapshotId: null,
      note: 'Own gear — no rental',
      required: false,
      confirmAtSource: false,
    })
  } else {
    const option = a.rentalOption
    const sel = selectPrice(day.prices, { ...q, subjectType: 'rental', category, item: (i) => rentalItemMatches(i, option) })
    drafts.push(
      fromSelection('rental', RENTAL_LABEL[option], sel, requiredKeys.has('rental'), `No price for ${RENTAL_LABEL[option].toLowerCase()}.`),
    )
  }

  // Lunch — always the user's own estimate, labelled as such.
  drafts.push(
    a.lunch
      ? {
          key: 'lunch',
          label: 'Lunch',
          amount: a.lunch,
          amountMax: null,
          kind: 'user-estimate',
          source: 'Your lunch estimate (Settings)',
          snapshotId: null,
          note: null,
          required: requiredKeys.has('lunch'),
          confirmAtSource: false,
        }
      : {
          key: 'lunch',
          label: 'Lunch',
          amount: null,
          amountMax: null,
          kind: null,
          source: null,
          snapshotId: null,
          note: null,
          required: requiredKeys.has('lunch'),
          confirmAtSource: false,
          missingMessage: 'No lunch estimate set.',
        },
  )

  // Parking, allocated per person
  if (day.parking) {
    const free = day.parking.status === 'free'
    drafts.push({
      key: 'parking',
      label: 'Parking',
      amount: money(0, currency),
      amountMax: null,
      // Only call it published when the caller says so or names a source; an unsourced fact is an assumption.
      kind: day.parking.kind ?? (free && day.parking.source ? 'published' : 'assumption'),
      source: day.parking.source ?? null,
      snapshotId: null,
      note: free ? 'Free parking' : 'No parking needed',
      required: requiredKeys.has('parking'),
      confirmAtSource: false,
    })
  } else {
    const sel = selectPrice(day.prices, { ...q, subjectType: 'parking', category: null })
    const line = fromSelection('parking', 'Parking (your share)', sel, requiredKeys.has('parking'), 'Parking cost unknown.')
    if (line.amount) {
      const perVehicle = line.amount
      line.amount = allocate(perVehicle, a.partySize)[0]
      if (line.amountMax) line.amountMax = allocate(line.amountMax, a.partySize)[0]
      const split = a.partySize > 1 ? ` ÷ ${a.partySize} people` : ''
      line.note = `${formatMoney(perVehicle)} per vehicle${split}` + (line.note ? `. ${line.note}` : '')
    }
    drafts.push(line)
  }

  // Convert to the basket currency
  const missing: BasketMissing[] = []
  const lines: BasketLine[] = drafts.map(({ missingMessage, ...d }) => {
    if (!d.amount) {
      missing.push({ key: d.key, required: d.required, message: missingMessage ?? `${d.label}: unknown.` })
      return { ...d, display: null, displayMax: null, fx: null }
    }
    const conv = convertMoney(d.amount, currency, ctx.rates, { asOf: ctx.today })
    if (!conv) {
      missing.push({
        key: 'fx',
        required: false,
        message: `No stored ${d.amount.currency}→${currency} rate — ${d.label.toLowerCase()} shown in ${d.amount.currency}.`,
      })
      return { ...d, display: null, displayMax: null, fx: null }
    }
    return {
      ...d,
      display: conv.converted,
      displayMax: d.amountMax ? convertWith(d.amountMax, conv.fx).converted : null,
      fx: conv.fx.path === 'identity' ? null : conv.fx,
    }
  })

  const complete = lines.every((l) => !l.required || l.amount !== null)
  const excluded = lines.filter((l) => !l.required && l.amount === null).map((l) => l.key)
  const caveats = excluded.map((k) => `Excludes ${k} (unknown)`)
  const toCheck = lines.filter((l) => l.confirmAtSource && l.amount).map((l) => l.label.toLowerCase())
  if (toCheck.length) caveats.push(`Researched — confirm at source: ${toCheck.join(', ')}`)
  const known = lines.filter((l) => l.display)
  const knownSubtotal = sum(known.map((l) => l.display!), currency)
  const allConverted = lines.every((l) => l.amount === null || l.display !== null)
  const total = complete && allConverted ? knownSubtotal : null
  const hasRange = known.some((l) => l.displayMax)
  const totalMax = total && hasRange ? sum(known.map((l) => l.displayMax ?? l.display!), currency) : null

  // Tier: convert each priced line straight to the band currency (no double conversion), then classify.
  // Ranges are classified at both ends so a range that crosses a band is not shown only at its cheaper tier.
  let tier: TierResult
  let tierMax: ExpenseTier | null = null
  if (!complete) {
    tier = incompleteTier(missing.filter((m) => m.required).map((m) => m.message).join(' '))
  } else {
    const bands = a.bands ?? DEFAULT_TIER_BANDS
    const bandCur = bands.currency.toUpperCase()
    const inBand: Money[] = []
    const inBandMax: Money[] = []
    let fxGap: string | null = null
    for (const l of lines) {
      if (!l.amount) continue
      if (l.amount.amountMinor === 0 && !l.amountMax) continue
      const c = convertMoney(l.amount, bandCur, ctx.rates, { asOf: ctx.today })
      if (!c) {
        fxGap = `No stored ${l.amount.currency}→${bandCur} rate to classify this basket.`
        break
      }
      inBand.push(c.converted)
      inBandMax.push(l.amountMax ? convertWith(l.amountMax, c.fx).converted : c.converted)
    }
    tier = fxGap ? incompleteTier(fxGap) : tierFor(sum(inBand, bandCur), { bands })
    if (tier.tier !== 'incomplete') {
      const high = classifyTier(sum(inBandMax, bandCur), bands)
      if (high !== tier.tier) {
        tierMax = high
        caveats.push(`Estimate range spans ${tier.tier} to ${high}`)
      }
    }
  }

  return {
    resortId: day.resortId,
    date: day.date,
    dayType,
    holidayName,
    currency,
    lines,
    complete,
    missing,
    excluded,
    caveats,
    total,
    totalMax,
    knownSubtotal,
    tier,
    tierMax,
    label: tier.tier === 'incomplete' ? INCOMPLETE_ESTIMATE : tier.tier,
    assumptions: {
      currency,
      rentalOption: a.rentalOption,
      lunch: a.lunch,
      partySize: a.partySize,
      category,
      required: [...requiredKeys],
    },
  }
}

/** One day's own lift-ticket price (used by the pass calculator's baseline). */
export function liftTicketFor(
  prices: readonly PriceSnapshotInput[],
  resortId: string,
  date: string,
  ctx: { now: string; today?: string | null; category?: string | null; dayTypeConfig?: DayTypeConfig },
): {
  price: Money | null
  kind: QuoteKind | null
  basis: string | null
  snapshotId: number | null
  dayType: DayType
  confirmAtSource: boolean
} {
  const { dayType } = dayTypeFor(date, ctx.dayTypeConfig ?? DEFAULT_DAY_TYPE_CONFIG)
  const sel = selectPrice(prices, {
    subjectType: 'lift-ticket',
    resortId,
    date,
    dayType,
    category: ctx.category ?? 'adult',
    now: ctx.now,
    today: ctx.today ?? null,
  })
  const s = sel.snapshot
  return {
    price: s ? money(s.amountMinor, s.currency) : null,
    kind: s?.quoteKind ?? null,
    basis: sel.basis,
    snapshotId: s?.id ?? null,
    dayType,
    confirmAtSource: sel.confirmAtSource,
  }
}
