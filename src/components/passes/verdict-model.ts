/**
 * The checker's answer reduced to one hero card: the question line, a verdict, one line of detail, where the dates sit
 * against the resort's announced season, and the allowance left. Pure and serializable (the card is a client
 * component). Unknown access is "No access recorded", never a yes; a pass that covers dates outside the announced
 * season says so instead of a plain yes.
 */
import type { CheckerView } from '@/lib/data/passes-screen'
import type { SeasonContext } from '@/lib/data/passes-hud'
import type { AccessVerdict } from '@/lib/domain/passes/types'
import { dayMonth, dayNumber, plural, rangeLabel, shortDate, STATUS_META, weekdayShort, type MarkStatus } from './format'

export type VerdictTone = 'yes' | 'outside' | 'caution' | 'no' | 'unknown' | 'idle'

export interface VerdictModel {
  /** Changes whenever the question changes (drives the entrance animation). */
  key: string
  tone: VerdictTone
  status: MarkStatus | null
  /** Overrides the status chip's label. */
  chip?: string
  /** "IKON PASS · KITZBÜHEL · SAT 12 DEC 2026". */
  query: string
  /** Big line. With `count`, the number is drawn separately (count-up) before `headline`. */
  headline: string
  count: { value: number; of?: number } | null
  detail: string | null
  season: string | null
  meter: { total: number; used: number; label: string } | null
  days: { date: string; wd: string; n: number; status: MarkStatus; label: string; canSki: boolean }[] | null
}

function toneOf(v: AccessVerdict): VerdictTone {
  if (v.status === 'unknown' || v.status === 'season-mismatch') return 'unknown'
  if (v.canSki) return 'yes'
  if (v.status === 'discount-only') return 'caution'
  return 'no'
}

/** "Before the announced opening on 6 Nov." etc. Announced dates are never a live status. */
export function seasonLine(c: SeasonContext | null, resortName: string, single: boolean): string | null {
  if (!c) return null
  const word = (k: 'actual' | 'announced' | null) => (k === 'actual' ? '' : 'announced ')
  const range = c.opening && c.closing ? ` (${dayMonth(c.opening)} – ${dayMonth(c.closing)})` : ''
  switch (c.state) {
    case 'before':
      return `${resortName}: before the ${word(c.openingKind)}opening on ${shortDate(c.opening!)}.`
    case 'after':
      return `${resortName}: after the ${word(c.closingKind)}closing on ${shortDate(c.closing!)}.`
    case 'partly':
      return `${resortName}: only some of these days fall inside the announced season${range}.`
    case 'inside':
      return `${resortName}: ${single ? 'inside' : 'all inside'} the announced season${range || ` (from ${dayMonth(c.opening!)})`}. Announced dates, not a live status.`
    case 'unannounced':
      return c.estimateFrom
        ? `${resortName}: opening not announced. Piste estimates from ${shortDate(c.estimateFrom)} — an estimate.`
        : `${resortName}: season dates not announced.`
  }
}

export function verdictModel(view: CheckerView, season: SeasonContext | null): VerdictModel {
  const { selection } = view
  const opt = view.passes.find((p) => p.key === selection.key) ?? null
  const resort = view.resorts.find((r) => r.id === selection.resortId) ?? null
  const when = rangeLabel(selection.from, selection.to)
  const query = [opt?.name ?? 'Any pass', resort?.shortName ?? 'Any resort', when].join(' · ').toUpperCase()
  const key = `${selection.key ?? '-'}|${selection.resortId ?? '-'}|${selection.from}|${selection.to}`
  const base = { key, query, count: null, detail: null, season: null, meter: null, days: null }

  if (view.mode === 'both' && view.result) {
    const r = view.result
    const single = r.days.length === 1
    const sLine = seasonLine(season, r.resort.shortName, single)
    if (single) {
      const v = r.days[0].verdict
      let tone = toneOf(v)
      const outside = tone === 'yes' && !!season?.outside
      if (outside) tone = 'outside'
      const reasons = v.reasons
      const allowance = v.pool?.total ?? v.resortCap?.total ?? null
      const head = v.status === 'unknown' ? 'No access recorded' : outside ? 'Pass yes, resort shut' : v.headline || STATUS_META[v.status].label
      // The first reason usually restates the headline; lead with the next one when it does.
      const lead = head.split(' — ')[0]
      const detail = reasons.find((x) => !x.startsWith(lead)) ?? reasons[0] ?? null
      return {
        ...base,
        tone,
        status: v.status,
        headline: head,
        detail: v.status === 'unknown' ? (reasons[0] ?? 'No access rule is recorded here.') : detail,
        season: sLine,
        meter:
          allowance != null && (v.status === 'included-limited' || v.status === 'days-exhausted')
            ? { total: allowance, used: allowance - (v.remainingDays ?? 0), label: v.pool ? (v.pool.label ?? 'Shared pool') : `Days at ${r.resort.shortName}` }
            : null,
      }
    }
    const n = r.days.length
    const allUnknown = r.days.every((d) => d.verdict.status === 'unknown')
    const tone: VerdictTone = allUnknown ? 'unknown' : r.covered === n ? (season?.outside ? 'outside' : 'yes') : r.covered > 0 ? 'caution' : 'no'
    return {
      ...base,
      tone,
      status: allUnknown ? 'unknown' : r.covered === n ? 'included' : r.covered > 0 ? 'included-limited' : (r.days[0]?.verdict.status ?? 'unknown'),
      chip: allUnknown ? 'No access recorded' : r.covered === n ? `All ${n} days` : r.covered > 0 ? `${r.covered} of ${n} days` : 'No days covered',
      headline: 'days covered',
      count: { value: allUnknown ? 0 : r.covered, of: n },
      detail: allUnknown ? 'No access rule is recorded for these days, so none is counted as covered.' : 'Assumes you ski every day in the range: each covered day uses one pass day before the next is checked.',
      season: sLine,
      days: r.days.map((d) => ({ date: d.date, wd: weekdayShort(d.date), n: dayNumber(d.date), status: d.verdict.status, label: STATUS_META[d.verdict.status].label, canSki: d.verdict.canSki })),
    }
  }

  if (view.mode === 'pass' && view.byResort && opt) {
    const all = view.byResort
    const can = all.filter((a) => a.days.length && a.covered === a.days.length).length
    // Only what is known is counted: answers with unknown access are left out (never counted as covered).
    const known = all.filter((a) => a.covered > 0 || !a.days.some((d) => d.verdict.status === 'unknown')).length
    return {
      ...base,
      tone: can ? 'yes' : known ? 'no' : 'idle',
      status: can ? 'included' : known ? 'not-included' : null,
      count: { value: can },
      headline: can === 1 ? 'resort covers it' : 'resorts cover it',
      detail: known
        ? `${can === known ? `${known === 1 ? 'The one resort' : `All ${known} resorts`} on file for this pass ${known === 1 ? 'is' : 'are'} open to you then.` : `${can} of the ${plural(known, 'resort')} on file for this pass ${can === 1 ? 'is' : 'are'} open to you then.`} Pick a resort for the day-by-day answer.`
        : `No resort access is recorded for ${opt.name} yet.`,
    }
  }

  if (view.mode === 'resort' && view.byProduct && resort) {
    const all = view.byProduct
    const can = all.filter((a) => a.days.length && a.covered === a.days.length).length
    const known = all.filter((a) => a.covered > 0 || !a.days.some((d) => d.verdict.status === 'unknown')).length
    return {
      ...base,
      tone: can ? 'yes' : known ? 'no' : 'idle',
      status: can ? 'included' : known ? 'not-included' : null,
      count: { value: can },
      headline: can === 1 ? 'pass works here' : 'passes work here',
      detail: known
        ? `${can === known ? `${known === 1 ? 'The one pass' : `All ${known} passes`} on file for ${resort.shortName} ${known === 1 ? 'works' : 'work'} then.` : `${can} of the ${plural(known, 'pass', 'passes')} on file for ${resort.shortName} ${can === 1 ? 'works' : 'work'} then.`} Pick one for the day-by-day answer.`
        : `No pass product is recorded for ${resort.shortName} — lift tickets are the only known option.`,
      season: seasonLine(season, resort.shortName, selection.from === selection.to),
    }
  }

  return {
    ...base,
    tone: 'idle',
    status: null,
    query: `NO QUESTION YET · ${when.toUpperCase()}`,
    headline: 'Pick a pass and a resort',
    detail: 'Or only a resort, to see every product recorded there — or only a pass, to see where it works.',
  }
}
