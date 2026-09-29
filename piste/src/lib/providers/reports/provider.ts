/**
 * Reusable label-based official-report adapter. A resort adapter is just configuration: page URLs, publisher
 * name, the unit the resort prints snow in, and which anchors must be present for the page to count as a report.
 *
 * Pipeline: per URL (primary, then alternates) robots.txt check → fetch page → structured data (JSON-LD / meta)
 * lines first, then table/definition-list pairs, then page text → label extraction → required-anchor check → zod
 * validation. Missing required anchors or implausible values → errorKind 'schema-changed' (never partial silent
 * data). Optional fields that are absent are listed in `capabilities.missing`.
 */
import { endOfLocalDay, localDateOf, startOfLocalDay } from '@/lib/domain/time'
import { provenance, type SnowfallReading, type SnowWindow } from '@/lib/domain/types'
import { defaultHttp, stableHash, type HttpClient } from '../http'
import { caps, describeIssues, fail, failFromHttp } from '../result'
import type { Capabilities, ParsedReport, ProviderResult, ResortReportProvider, SourceFetch } from '../types'
import { anchorsFound, extractFromLines, type AnchorKey, type Extraction, type SnowUnit } from './labels'
import { checkRobots } from './robots'
import { ParsedReportSchema } from './schema'
import { extractStructured } from './structured'
import { htmlPairLines, htmlToLines } from './text'

export interface LabelReportConfig {
  id: string
  resortId: string
  label: string
  maturity: 'verified' | 'unverified'
  /** Primary page first; alternates (e.g. a print version) are tried when the primary fails. */
  urls: [string, ...string[]]
  /** Publisher shown in provenance, e.g. "greekpeak.net". */
  publisher: string
  /** Unit for unitless snow numbers after snow-quantity labels (US resorts print inches). */
  assumedSnowUnit: SnowUnit
  /** Every group needs at least one anchor. Waived only when the page states closed-for-season / not-yet-open. */
  required: AnchorKey[][]
}

export interface ExtractSuccess {
  ok: true
  report: ParsedReport
  capabilities: Capabilities
  anchors: AnchorKey[]
  /** Short normalised extract (labels + matched text) for debugging and change detection. */
  extract: Record<string, unknown>
}
export interface ExtractFailure {
  ok: false
  error: string
  anchors: AnchorKey[]
}

const WINDOW_ORDER: SnowWindow[] = ['overnight', '24h', '48h', '72h', '7d', 'storm', 'season']

/** Expected report fields — reported as missing when the page does not show them. */
const FIELDS: (keyof ParsedReport)[] = [
  'reportedAt',
  'status',
  'snowfall',
  'baseDepthCm',
  'summitDepthCm',
  'surfaceText',
  'groomingText',
  'groomedRuns',
  'snowmakingText',
  'openTrails',
  'totalTrails',
  'openLifts',
  'totalLifts',
  'openBeginnerTrails',
  'totalBeginnerTrails',
  'openAcres',
]

/** Pure: page HTML → validated report or a schema-changed failure. Exported for fixture tests. */
export function extractReport(html: string, cfg: LabelReportConfig, ctx: { now: string; timezone: string }): ExtractSuccess | ExtractFailure {
  const structured = extractStructured(html)
  const lines = [...structured.lines, ...htmlPairLines(html), ...htmlToLines(html)]
  const x: Extraction = extractFromLines(lines, { assumedSnowUnit: cfg.assumedSnowUnit, timezone: ctx.timezone, now: ctx.now })
  const anchors = anchorsFound(x)

  const seasonal = x.status && (x.status.value === 'closed-for-season' || x.status.value === 'not-yet-open')
  const unmet = cfg.required.filter((group) => !group.some((a) => anchors.includes(a)))
  if (unmet.length && !seasonal) {
    return {
      ok: false,
      anchors,
      error: `Page layout not recognised: missing ${unmet.map((g) => g.join(' or ')).join('; ')} (found: ${anchors.join(', ') || 'nothing'})`,
    }
  }

  const limitations: string[] = []
  const notes: string[] = []
  const snowfall: SnowfallReading[] = WINDOW_ORDER.filter((w) => x.snowfall[w]).map((w) => ({
    window: w,
    amountCm: x.snowfall[w]!.cm,
    startAt: null,
    endAt: null,
    sourceText: x.snowfall[w]!.text.slice(0, 200),
  }))
  if (x.snowfall.overnight && /new\s+snow/i.test(x.snowfall.overnight.text)) {
    limitations.push('"New snow" has no stated window; stored as overnight/since-last-report.')
  }
  const assumed = [...Object.values(x.snowfall), x.baseDepth, x.summitDepth].some((v) => v?.assumed)
  if (assumed) limitations.push(`Some snow values had no printed unit and were read as ${cfg.assumedSnowUnit === 'in' ? 'inches' : 'centimetres'}.`)
  if (x.baseDepth?.rangeCm) notes.push(`Base depth reported as a range (${x.baseDepth.text}); the lower bound is stored.`)
  for (const w of WINDOW_ORDER) {
    const s = x.snowfall[w]
    if (s?.rangeCm) notes.push(`Snowfall reported as a range (${s.text}); the lower bound is stored.`)
  }
  const noteText = notes.join(' ')

  let localDate: string
  let reportedAt: string | null = null
  if (x.reportDate) {
    localDate = x.reportDate.localDate
    reportedAt = x.reportDate.instant
    if (!reportedAt) limitations.push('Page shows a report date without a time.')
  } else {
    localDate = localDateOf(ctx.now, ctx.timezone)
    limitations.push('Page shows no report date; dated by the day it was retrieved.')
  }

  const report: ParsedReport = {
    localDate,
    reportedAt,
    status: x.status?.value ?? null,
    snowfall,
    baseDepthCm: x.baseDepth?.cm ?? null,
    baseDepthLocation: x.baseDepth?.location ?? null,
    summitDepthCm: x.summitDepth?.cm ?? null,
    surfaceTags: x.surface?.tags ?? [],
    surfaceText: x.surface?.text ?? null,
    groomingText: x.grooming?.text ?? null,
    groomedRuns: x.groomedRuns?.value ?? null,
    snowmakingText: x.snowmaking?.text ?? null,
    openTrails: x.trails?.open ?? null,
    totalTrails: x.trails?.total ?? null,
    openLifts: x.lifts?.open ?? null,
    totalLifts: x.lifts?.total ?? null,
    openBeginnerTrails: x.beginnerTrails?.open ?? null,
    totalBeginnerTrails: x.beginnerTrails?.total ?? null,
    openAcres: x.openAcres?.value ?? null,
    // Bounded to the schema's 500 characters so several range notes can never fail validation.
    notes: noteText ? (noteText.length > 500 ? `${noteText.slice(0, 499)}…` : noteText) : null,
  }

  const valid = ParsedReportSchema.safeParse(report)
  if (!valid.success) {
    return { ok: false, anchors, error: `Extracted values failed validation (${describeIssues(valid.error.issues)})` }
  }

  const supplied = FIELDS.filter((f) => (f === 'snowfall' ? snowfall.length > 0 : report[f] !== null))
  const missing = FIELDS.filter((f) => !supplied.includes(f))
  if (cfg.maturity === 'unverified') limitations.push('Parser built without access to the live page (unverified); confirm at source.')
  if (!x.status) limitations.push('No explicit operating status on the page; status left unknown.')

  const extract: Record<string, unknown> = {
    source: structured.lines.length ? 'structured+page' : 'page',
    matched: {
      snowfall: snowfall.map((s) => s.sourceText),
      baseDepth: x.baseDepth?.text ?? null,
      summitDepth: x.summitDepth?.text ?? null,
      trails: x.trails?.text ?? null,
      lifts: x.lifts?.text ?? null,
      status: x.status?.text ?? null,
      reportDate: x.reportDate?.text ?? null,
    },
    normalizedHash: reportContentHash(report),
  }
  return { ok: true, report, capabilities: caps(supplied, missing, limitations), anchors, extract }
}

/**
 * Hash of the normalised report CONTENT — use for "is this a new report?" decisions. Two fetches of an unchanged
 * page hash identically even if its markup (tokens, ads, timestamps in scripts) changed. `localDate` and
 * `reportedAt` are excluded (as in the jobs' hash): an undated page is dated by the retrieval day, and a page may
 * re-render its timestamp, so neither may make an unchanged report look new and reset its observation age.
 */
export function reportContentHash(report: ParsedReport): string {
  const { localDate: _localDate, reportedAt: _reportedAt, ...content } = report
  return stableHash(content)
}

export function createLabelReportProvider(cfg: LabelReportConfig, options: { http?: HttpClient } = {}): ResortReportProvider {
  return {
    id: cfg.id,
    resortId: cfg.resortId,
    label: cfg.label,
    maturity: cfg.maturity,
    url: cfg.urls[0],
    async fetchReport(ctx): Promise<ProviderResult<ParsedReport>> {
      const http = options.http ?? defaultHttp
      const fetches: SourceFetch[] = []

      let lastHttpFailure: ProviderResult<never> | null = null
      let robotsFailure: ProviderResult<never> | null = null
      let schemaError: string | null = null
      let disallowed = 0
      for (const url of cfg.urls) {
        // robots.txt is checked for EVERY URL: an alternate may sit on another origin (greekpeak.net vs www.) or on
        // a path the rules exclude. Same-origin checks are served from the 24 h robots cache.
        const robots = await checkRobots(http, url)
        fetches.push(robots.fetch)
        if (!robots.ok) {
          robotsFailure = fail(robots.errorKind, `${cfg.publisher} ${robots.error}`, fetches, robots.retriable)
          continue
        }
        if (!robots.allowed) {
          disallowed++
          continue
        }
        const res = await http.request(url, {
          expect: 'text',
          headers: { Accept: 'text/html,application/xhtml+xml' },
          timeoutMs: 20_000,
          retries: 1,
          cacheTtlMs: 5 * 60_000,
          maxBytes: 3 * 1024 * 1024,
        })
        if (!res.ok) {
          fetches.push(res.fetch)
          lastHttpFailure = failFromHttp(res, fetches, cfg.publisher)
          continue
        }
        const out = extractReport(res.text, cfg, ctx)
        if (!out.ok) {
          fetches.push({ ...res.fetch, ok: false, error: out.error, extract: { anchors: out.anchors } })
          schemaError = `${cfg.publisher} (${url}): ${out.error}`
          continue
        }
        fetches.push({ ...res.fetch, extract: out.extract })
        const r = out.report
        return {
          ok: true,
          data: r,
          capabilities: out.capabilities,
          fetches,
          provenance: provenance({
            kind: 'official',
            provider: cfg.publisher,
            sourceUrl: url,
            publishedAt: r.reportedAt,
            fetchedAt: res.fetch.fetchedAt,
            validFrom: startOfLocalDay(r.localDate, ctx.timezone),
            validTo: endOfLocalDay(r.localDate, ctx.timezone),
            // A daily report goes stale when its resort-local day ends — measured from the REPORT, not the fetch.
            staleAfter: endOfLocalDay(r.localDate, ctx.timezone),
            verification: cfg.maturity === 'verified' ? 'official-page' : 'unverified',
            originalUnit: cfg.assumedSnowUnit,
            note: cfg.maturity === 'unverified' ? 'Parsed by an unverified adapter; confirm at source.' : null,
          }),
        }
      }
      // Most informative failure first: a page that no longer parses, then a page that could not be fetched, then a
      // robots.txt that could not be read. Only when robots.txt disallowed every URL is the source unsupported.
      if (schemaError) return fail('schema-changed', schemaError, fetches, false)
      if (lastHttpFailure) return lastHttpFailure
      if (robotsFailure) return robotsFailure
      if (disallowed) {
        return fail('unsupported', `${cfg.publisher} robots.txt disallows automated fetching of ${cfg.urls.length > 1 ? 'every report page' : 'this page'}`, fetches, false)
      }
      return fail('network', `${cfg.publisher}: no page could be fetched`, fetches)
    },
  }
}
