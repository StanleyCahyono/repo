/**
 * URL state for the Passes & Costs routes. Everything a visitor sets lives in the query string, so a reload, a shared
 * link or "back" restores the same view. Parsing is lenient: invalid values fall back to defaults (the loaders clamp
 * dates to the season). Client-safe (no Luxon).
 *
 *   /passes            ?own=3 | ?pass=<productId|none>  &resort=alta  &from=2027-02-14  &to=2027-02-16
 *   /passes/costs      ?date=2027-01-16  &show=all|favorites|complete  &cur=CAD
 *   /passes/compare    ?days=alta.2027-02-14,snowbird.2027-02-15  &trips=0  &cur=CAD
 */

export type RawParams = Record<string, string | string[] | undefined> | URLSearchParams

const ID_RE = /^[a-z0-9-]{1,100}$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function first(sp: RawParams, key: string): string | undefined {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? undefined
  const v = sp[key]
  return Array.isArray(v) ? v[0] : v
}

/** A real calendar date 'YYYY-MM-DD' (rejects 2027-02-30). */
export function validDate(v: string | null | undefined): string | null {
  if (!v) return null
  const m = DATE_RE.exec(v)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? v : null
}

export function validId(v: string | null | undefined): string | null {
  return v && ID_RE.test(v) ? v : null
}

/** Calendar arithmetic on 'YYYY-MM-DD' (timezone-free, UTC based). */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** ISO weekday 1 = Mon … 7 = Sun. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return w === 0 ? 7 : w
}

/** Next Saturday on or after `date`. */
export function saturdayFrom(date: string): string {
  return shiftDate(date, (6 - weekdayOf(date) + 7) % 7)
}

// ---------------------------------------------------------------------------
// Checker (/passes)

export interface CheckerQuery {
  own: number | null
  /** Product id, or 'none' for "no pass — show every product at the resort". */
  pass: string | null
  resort: string | null
  from: string | null
  to: string | null
}

export function parseChecker(sp: RawParams): CheckerQuery {
  // `pick` is the no-JavaScript form field: 'own:3' | 'product:<id>' | 'none'.
  const pick = first(sp, 'pick')
  const ownRaw = pick?.startsWith('own:') ? pick.slice(4) : first(sp, 'own')
  const own = ownRaw && /^\d{1,9}$/.test(ownRaw) ? Number(ownRaw) : null
  const passRaw = pick ? (pick.startsWith('product:') ? pick.slice(8) : pick === 'none' ? 'none' : undefined) : first(sp, 'pass')
  return {
    own,
    pass: passRaw === 'none' ? 'none' : validId(passRaw),
    resort: validId(first(sp, 'resort')),
    from: validDate(first(sp, 'from')),
    to: validDate(first(sp, 'to')),
  }
}

/** Link into the checker. `pass` may be an option key ('own:3' / 'product:x'), a product id, or 'none'. */
export function checkerHref(q: { pass?: string | null; own?: number | null; resort?: string | null; from?: string | null; to?: string | null }): string {
  const p = new URLSearchParams()
  if (q.own != null) p.set('own', String(q.own))
  else if (q.pass?.startsWith('own:')) p.set('own', q.pass.slice(4))
  else if (q.pass?.startsWith('product:')) p.set('pass', q.pass.slice(8))
  else if (q.pass) p.set('pass', q.pass)
  if (q.resort) p.set('resort', q.resort)
  if (q.from) p.set('from', q.from)
  if (q.to && q.to !== q.from) p.set('to', q.to)
  const s = p.toString()
  return s ? `/passes?${s}` : '/passes'
}

// ---------------------------------------------------------------------------
// Day costs

export type CostsShow = 'all' | 'favorites' | 'complete'

export interface CostsQuery {
  date: string | null
  show: CostsShow
  cur: string | null
}

const CUR_RE = /^[A-Za-z]{3}$/

export function parseCosts(sp: RawParams): CostsQuery {
  const show = first(sp, 'show')
  const cur = first(sp, 'cur')
  return {
    date: validDate(first(sp, 'date')),
    show: show === 'favorites' || show === 'complete' ? show : 'all',
    cur: cur && CUR_RE.test(cur) ? cur.toUpperCase() : null,
  }
}

// ---------------------------------------------------------------------------
// Pass vs tickets

export interface ScenarioDayParam {
  resortId: string
  date: string
}

export interface CompareQuery {
  days: ScenarioDayParam[]
  trips: boolean
  cur: string | null
}

/** 'alta.2027-02-14,snowbird.2027-02-15' → rows; invalid or duplicate entries are skipped. */
export function parseDays(v: string | null | undefined, max = 60): ScenarioDayParam[] {
  if (!v) return []
  const out: ScenarioDayParam[] = []
  const seen = new Set<string>()
  for (const part of v.split(',')) {
    const i = part.lastIndexOf('.')
    if (i <= 0) continue
    const resortId = validId(part.slice(0, i))
    const date = validDate(part.slice(i + 1))
    if (!resortId || !date) continue
    const k = `${resortId}.${date}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ resortId, date })
    if (out.length >= max) break
  }
  return out
}

export function serializeDays(days: readonly ScenarioDayParam[]): string {
  return [...days]
    .sort((a, b) => a.date.localeCompare(b.date) || a.resortId.localeCompare(b.resortId))
    .map((d) => `${d.resortId}.${d.date}`)
    .join(',')
}

export function parseCompare(sp: RawParams): CompareQuery {
  const cur = first(sp, 'cur')
  return {
    days: parseDays(first(sp, 'days')),
    trips: first(sp, 'trips') !== '0',
    cur: cur && CUR_RE.test(cur) ? cur.toUpperCase() : null,
  }
}

// ---------------------------------------------------------------------------

/** Apply a patch to a query string (null/'' removes a key). Keeps commas readable. Returns '' or '?…'. */
export function patchQuery(search: string, patch: Record<string, string | null | undefined>): string {
  const p = new URLSearchParams(search.replace(/^\?/, ''))
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (v === null || v === '') p.delete(k)
    else p.set(k, v)
  }
  const s = p.toString().replace(/%2C/gi, ',')
  return s ? `?${s}` : ''
}
