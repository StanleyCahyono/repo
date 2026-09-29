/**
 * Ranking explanations for "Where to ski" and the weekend finder — pure, client-safe.
 *
 * The recommendation engine (src/lib/domain/recommend.ts) scores each eligible resort-day as
 *   total = Σ weight_k × used_k      (weights normalised to 1; unknown factors count at 40, below neutral)
 * These helpers turn that into plain language: what each factor contributed, and why an option sits above or
 * below its neighbour ("Ahead of Bristol by 4.2 — mostly fit for me (+3.1)"). They never invent a factor value:
 * an unknown factor is named as unknown and counted exactly as the engine counted it.
 */
import {
  FACTOR_KEYS,
  UNKNOWN_FACTOR_VALUE,
  type FactorKey,
  type FactorWeights,
  type OptionEligibility,
  type Recommendation,
  type RankedOption,
} from '@/lib/domain/recommend'

export interface FactorView {
  key: FactorKey
  label: string
  /** Normalised weight 0–1. */
  weight: number
  /** 0–100, or null when unknown. */
  value: number | null
  /** Value used in the total (the unknown fallback when unknown). */
  used: number
  known: boolean
  note: string
  /** weight × used — points this factor added to the total. */
  points: number
}

export interface DayCell {
  date: string
  total: number | null
  eligibility: OptionEligibility | 'excluded'
  note: string
  best: boolean
}

export interface OptionView {
  resortId: string
  name: string
  rank: number
  /** Best date for this resort in the window. */
  date: string
  total: number
  eligibility: OptionEligibility
  statusNote: string
  assumption: string | null
  factors: FactorView[]
  benefits: string[]
  tradeoffs: string[]
  limitations: string[]
  warnings: string[]
  /** Every date in the window, in order (the best date included). */
  days: DayCell[]
}

export interface RankingView {
  dates: string[]
  presetLabel: string
  weights: FactorWeights
  weightsNote: string | null
  preseason: boolean
  noWinnerReason: string | null
  /** Eligible options in rank order. The first is the pick unless `preseason`. */
  options: OptionView[]
  /** Status unknown — ranked for planning, never the pick. */
  unknown: OptionView[]
  excluded: {
    resortId: string
    name: string
    reason: string
    kind: 'closed' | 'preseason' | 'travel'
  }[]
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function factorViews(o: Pick<RankedOption, 'factors'>): FactorView[] {
  return o.factors.map((f) => ({ ...f, points: round1(f.weight * f.used) }))
}

export function optionView(o: RankedOption, dates: readonly string[]): OptionView {
  const other = new Map(o.otherDates.map((d) => [d.date, d]))
  const days: DayCell[] = dates.map((date) => {
    if (date === o.date)
      return {
        date,
        total: o.total,
        eligibility: o.eligibility,
        note: o.statusNote,
        best: true,
      }
    const d = other.get(date)
    return d
      ? {
          date,
          total: d.total,
          eligibility: d.eligibility,
          note: d.note,
          best: false,
        }
      : {
          date,
          total: null,
          eligibility: 'excluded',
          note: 'Not ranked',
          best: false,
        }
  })
  return {
    resortId: o.resortId,
    name: o.name,
    rank: o.rank,
    date: o.date,
    total: o.total,
    eligibility: o.eligibility,
    statusNote: o.statusNote,
    assumption: o.assumption,
    factors: factorViews(o),
    benefits: o.benefits,
    tradeoffs: o.tradeoffs,
    limitations: o.limitations,
    warnings: o.warnings,
    days,
  }
}

/** Slim, serializable ranking for client components. */
export function rankingView(rec: Recommendation): RankingView {
  return {
    dates: rec.dates,
    presetLabel: rec.presetLabel,
    weights: rec.weights,
    weightsNote: rec.weightsNote,
    preseason: rec.preseason,
    noWinnerReason: rec.noWinnerReason,
    options: rec.ranked.map((o) => optionView(o, rec.dates)),
    unknown: rec.statusUnknown.map((o) => optionView(o, rec.dates)),
    excluded: rec.excluded.map((e) => ({
      resortId: e.resortId,
      name: e.name,
      reason: e.reason,
      kind: e.kind,
    })),
  }
}

/** Weights as whole percentages that add up to 100 (largest-remainder rounding). */
export function weightPercents(w: FactorWeights): Record<FactorKey, number> {
  const total = FACTOR_KEYS.reduce((a, k) => a + Math.max(0, w[k]), 0)
  const out = Object.fromEntries(FACTOR_KEYS.map((k) => [k, 0])) as Record<FactorKey, number>
  if (total <= 0) return out
  const raw = FACTOR_KEYS.map((k) => ({
    k,
    v: (Math.max(0, w[k]) / total) * 100,
  }))
  let left = 100
  for (const r of raw) {
    out[r.k] = Math.floor(r.v)
    left -= out[r.k]
  }
  for (const r of [...raw].sort((a, b) => b.v - Math.floor(b.v) - (a.v - Math.floor(a.v)) || FACTOR_KEYS.indexOf(a.k) - FACTOR_KEYS.indexOf(b.k))) {
    if (left <= 0) break
    out[r.k] += 1
    left -= 1
  }
  return out
}

export const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th')
  return `${n}${s}`
}

const fmtPts = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(round1(n)).toFixed(1)}`

/** Factor-by-factor point differences a − b (only factors both options were scored on). */
export function factorDeltas(a: Pick<OptionView, 'factors'>, b: Pick<OptionView, 'factors'>): { key: FactorKey; label: string; delta: number }[] {
  const bBy = new Map(b.factors.map((f) => [f.key, f]))
  return a.factors
    .filter((f) => bBy.has(f.key))
    .map((f) => ({
      key: f.key,
      label: f.label,
      delta: round1(f.weight * f.used - bBy.get(f.key)!.weight * bBy.get(f.key)!.used),
    }))
    .filter((d) => d.delta !== 0)
}

function lead(deltas: { label: string; delta: number }[], sign: 1 | -1, max = 2): string[] {
  return deltas
    .filter((d) => d.delta * sign > 0)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.label.localeCompare(y.label))
    .slice(0, max)
    .map((d) => `${d.label.toLowerCase()} (${fmtPts(d.delta)})`)
}

/**
 * One or two sentences on why `list[i]` sits where it does: the gap to the option above (if any) and to the option
 * below (if any), each attributed to the factors that moved it most.
 */
export function explainPosition(list: readonly OptionView[], i: number): string[] {
  const me = list[i]
  if (!me) return []
  const out: string[] = []
  const above = list[i - 1]
  const below = list[i + 1]
  if (above) {
    const gap = round1(above.total - me.total)
    const d = factorDeltas(me, above)
    const behind = lead(d, -1)
    const ahead = lead(d, 1, 1)
    out.push(
      gap === 0
        ? `Level with ${above.name} (${above.total}); the tie-break (known factors, conditions, travel time) put ${above.name} first.`
        : `${gap.toFixed(1)} behind ${above.name}${behind.length ? ` — mostly ${behind.join(' and ')}` : ''}${ahead.length ? `; better on ${ahead[0]}` : ''}.`,
    )
  }
  if (below) {
    const gap = round1(me.total - below.total)
    const d = factorDeltas(me, below)
    const ahead = lead(d, 1)
    if (gap > 0) out.push(`${gap.toFixed(1)} ahead of ${below.name}${ahead.length ? ` — mostly ${ahead.join(' and ')}` : ''}.`)
  }
  const unknown = me.factors.filter((f) => !f.known)
  if (unknown.length) {
    out.push(
      `${unknown.map((f) => f.label).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} unknown and counted at ${UNKNOWN_FACTOR_VALUE} (below neutral), so ${unknown.length === 1 ? 'the gap' : 'these gaps'} cannot help it rank higher.`,
    )
  }
  return out
}

/** The biggest point contributions, e.g. "Fit for me 39.2 · Conditions 22.0 · Travel time 14.4". */
export function topContributions(o: Pick<OptionView, 'factors'>, max = 3): FactorView[] {
  return [...o.factors].sort((a, b) => b.points - a.points || a.key.localeCompare(b.key)).slice(0, max)
}
