import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fakeHttp, text } from '../test-helpers'
import { ALTA_REPORT, createAltaReportProvider } from './alta'
import { createGreekPeakReportProvider, GREEK_PEAK_REPORT } from './greek-peak'
import { getReportProvider, reportProviders } from './index'
import { extractFromLines, parseReportDate, parseSnowAt } from './labels'
import { extractReport, reportContentHash } from './provider'
import { isAllowed, parseRobots } from './robots'

const fixture = (n: string) => readFileSync(new URL(`./__fixtures__/${n}`, import.meta.url), 'utf8')
const NY = { now: '2027-01-15T14:00:00.000Z', timezone: 'America/New_York' }
const DENVER = { now: '2027-01-15T14:00:00.000Z', timezone: 'America/Denver' }
const lines = (...l: string[]) => extractFromLines(l, { assumedSnowUnit: 'in', timezone: NY.timezone, now: NY.now })

describe('Greek Peak (synthetic fixture)', () => {
  it('extracts counts, snow windows, surface and report time — and ignores the page traps', () => {
    const out = extractReport(fixture('greek-peak-conditions.html'), GREEK_PEAK_REPORT, NY)
    if (!out.ok) throw new Error(out.error)
    const r = out.report
    expect(r).toMatchObject({
      localDate: '2027-01-15',
      reportedAt: '2027-01-15T12:02:00.000Z', // 7:02 AM EST
      status: 'open', // from "Mountain Status: Open", not from the legend or the announced opening day
      openTrails: 32,
      totalTrails: 55, // not the og:description "55 of 55" or the script's 999
      openLifts: 6,
      totalLifts: 8,
      openBeginnerTrails: 9,
      totalBeginnerTrails: 12,
      groomedRuns: 28,
      baseDepthCm: 45.7, // lower bound of 18″–30″; 1,148' (feet, elevation) is never read as snow
      surfaceTags: ['packed-powder'],
      surfaceText: 'Packed Powder, Machine Groomed, some Loose Granular',
    })
    // Column-layout table: each window gets its own value, not the next header's number.
    expect(r.snowfall.map((s) => [s.window, s.amountCm])).toEqual([
      ['24h', 7.6],
      ['48h', 12.7],
      ['7d', 27.9],
      ['season', 162.6],
    ])
    expect(r.notes).toMatch(/range/)
    expect(out.capabilities.missing).toEqual(expect.arrayContaining(['summitDepthCm', 'openAcres']))
  })

  it('reads the print layout (two-cell table, "New Snow", unit words)', () => {
    const out = extractReport(fixture('greek-peak-print.html'), GREEK_PEAK_REPORT, NY)
    if (!out.ok) throw new Error(out.error)
    expect(out.report).toMatchObject({ reportedAt: '2027-01-15T11:45:00.000Z', openTrails: 30, totalTrails: 55, openLifts: 5, totalLifts: 8, surfaceTags: ['firm'], status: null })
    expect(out.report.snowfall).toEqual([expect.objectContaining({ window: 'overnight', amountCm: 5.1 })])
    expect(out.capabilities.missing).toContain('status')
    expect(out.capabilities.limitations.join(' ')).toMatch(/status left unknown/)
  })

  it('a changed layout yields schema-changed through the provider, never a half-empty report', async () => {
    const h = fakeHttp((c) => {
      if (c.url.endsWith('/robots.txt')) return new Response('', { status: 404 })
      return text(fixture('greek-peak-changed.html'))
    })
    const res = await createGreekPeakReportProvider({ http: h.client }).fetchReport(NY)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errorKind).toBe('schema-changed')
    expect(res.retriable).toBe(false)
    expect(res.error).toMatch(/layout not recognised/)
    // Primary and print URL were both tried; both page fetches are recorded as failed parses with a hash.
    const pages = res.fetches.filter((f) => !f.url.endsWith('/robots.txt'))
    expect(pages.map((f) => f.url)).toEqual(GREEK_PEAK_REPORT.urls)
    expect(pages.every((f) => f.ok === false && f.contentHash !== null && f.httpStatus === 200)).toBe(true)
  })

  it('falls back to the print version when the primary page fails', async () => {
    const h = fakeHttp((c) => {
      if (c.url.endsWith('/robots.txt')) return text('User-agent: *\nDisallow: /wp-admin/\n')
      if (c.url === GREEK_PEAK_REPORT.urls[0]) return new Response('', { status: 500 })
      return text(fixture('greek-peak-print.html'))
    })
    const res = await createGreekPeakReportProvider({ http: h.client }).fetchReport(NY)
    if (!res.ok) throw new Error(res.error)
    expect(res.provenance).toMatchObject({
      kind: 'official',
      provider: 'greekpeak.net',
      sourceUrl: 'https://greekpeak.net/conditions-print',
      publishedAt: '2027-01-15T11:45:00.000Z',
      verification: 'unverified',
      staleAfter: '2027-01-16T05:00:00.000Z', // end of the report's resort-local day
    })
    expect(res.fetches.some((f) => f.url === GREEK_PEAK_REPORT.urls[0] && f.ok === false && f.httpStatus === 500)).toBe(true)
  })

  it('respects robots.txt and does not fetch a disallowed page', async () => {
    const h = fakeHttp((c) => (c.url.endsWith('/robots.txt') ? text('User-agent: *\nDisallow: /ski-ride/\n') : text(fixture('greek-peak-conditions.html'))))
    const res = await createGreekPeakReportProvider({ http: h.client }).fetchReport(NY)
    expect(res.ok === false && res.errorKind).toBe('unsupported')
    expect(h.calls.map((c) => c.url)).toEqual(['https://www.greekpeak.net/robots.txt'])
  })

  it('an unreachable page is a network/timeout failure, not a parser failure', async () => {
    const h = fakeHttp((c) => (c.url.endsWith('/robots.txt') ? new Response('', { status: 404 }) : Promise.reject(new TypeError('fetch failed'))))
    const res = await createGreekPeakReportProvider({ http: h.client }).fetchReport(NY)
    expect(res.ok === false && res.errorKind).toBe('network')
    expect(res.ok === false && res.retriable).toBe(true)
  })
})

describe('Alta (synthetic fixture)', () => {
  it('prefers structured data, reads explicit cm and the storm window, and dates in Mountain time', () => {
    const out = extractReport(fixture('alta-conditions.html'), ALTA_REPORT, DENVER)
    if (!out.ok) throw new Error(out.error)
    const byWindow = Object.fromEntries(out.report.snowfall.map((s) => [s.window, s.amountCm]))
    expect(byWindow['24h']).toBe(35.6) // JSON-LD 14 in wins over the page text 13"
    expect(byWindow.storm).toBe(55.9)
    expect(byWindow.season).toBe(538.5)
    expect(out.report.baseDepthCm).toBe(223.5)
    expect(out.report.reportedAt).toBe('2027-01-15T12:30:00.000Z') // 5:30 AM MST
    expect(out.report.surfaceTags).toEqual(['fresh-snow', 'wind-affected'])
    expect(out.report).toMatchObject({ openLifts: 6, totalLifts: 7, openTrails: null, status: null })
    expect(out.extract.source).toBe('structured+page')
  })

  it('a replaced report page is schema-changed', async () => {
    const h = fakeHttp((c) => (c.url.endsWith('/robots.txt') ? new Response('', { status: 404 }) : text(fixture('alta-changed.html'))))
    const res = await createAltaReportProvider({ http: h.client }).fetchReport(DENVER)
    expect(res.ok === false && res.errorKind).toBe('schema-changed')
  })
})

describe('label matcher guards', () => {
  it('never reads feet, hours or percentages as snow', () => {
    expect(parseSnowAt("1,148'", 'in')).toBeNull()
    expect(parseSnowAt(' 24 Hours: 5"', 'in')).toBeNull()
    expect(parseSnowAt(' 80%', 'in')).toBeNull()
    expect(parseSnowAt(' 350 m', 'in')).toBeNull()
    expect(parseSnowAt(': 12 cm', 'in')).toMatchObject({ cm: 12, unit: 'cm', assumed: false })
    expect(parseSnowAt(': 2½"', null)).toMatchObject({ cm: 6.4, unit: 'in' })
    expect(parseSnowAt(': 4', null)).toBeNull() // unit required when no assumption is allowed
    expect(parseSnowAt(': 4', 'in')).toMatchObject({ cm: 10.2, assumed: true })
  })

  it('takes status only from explicit wording', () => {
    expect(lines('Status: Open / Closed', 'Opening Day: December 4').status).toBeNull()
    expect(lines('Trails Open 32 of 55').status).toBeNull()
    expect(lines('We are closed for the 2026-27 season. Thanks!').status?.value).toBe('closed-for-season')
    expect(lines('Mountain Status: Closed').status?.value).toBe('temporarily-closed')
  })

  it('combines separate open/total lines and rejects impossible counts', () => {
    expect(lines('Trails Open: 32', 'Total Trails: 55').trails).toMatchObject({ open: 32, total: 55 })
    expect(lines('Lifts Open 9 of 8').lifts).toBeNull()
    expect(lines('Night Trails Open 5 of 20', 'Lifts Open 2 of 8').trails).toBeNull()
  })

  it('does not let a later junk "updated" line or a future stamp set the report time', () => {
    const x = lines('Stay updated: 3 ways to follow us', 'Last Updated: Jan 15, 2027 7:02 AM')
    expect(x.reportDate?.instant).toBe('2027-01-15T12:02:00.000Z')
    expect(lines('Updated: Jan 20, 2027 7:00 AM').reportDate).toBeNull()
  })
})

describe('report dates', () => {
  it('handles DST, missing years around New Year and date-only stamps', () => {
    // US DST starts Sun 14 Mar 2027: 7:00 AM EDT = 11:00Z.
    expect(parseReportDate('March 14, 2027 7:00 AM', 'America/New_York', '2027-03-14T15:00:00Z')).toEqual({ localDate: '2027-03-14', instant: '2027-03-14T11:00:00.000Z' })
    expect(parseReportDate('Dec 31 4:00 PM', 'America/New_York', '2027-01-02T15:00:00Z')?.localDate).toBe('2026-12-31')
    expect(parseReportDate('Friday, January 15, 2027', 'America/Denver', DENVER.now)).toEqual({ localDate: '2027-01-15', instant: null })
    expect(parseReportDate('2027-01-15T06:10:00-07:00', 'America/Denver', DENVER.now)?.instant).toBe('2027-01-15T13:10:00.000Z')
  })
})

describe('change detection and registry', () => {
  it('the normalised hash ignores markup-only changes', () => {
    const html = fixture('greek-peak-print.html')
    const a = extractReport(html, GREEK_PEAK_REPORT, NY)
    const b = extractReport(html.replace('<h1>', '<h1 class="x" data-token="abc123">').replace('</body>', '<script>var t=Date.now()</script></body>'), GREEK_PEAK_REPORT, NY)
    if (!a.ok || !b.ok) throw new Error('fixture failed')
    expect(reportContentHash(b.report)).toBe(reportContentHash(a.report))
  })

  it('registers the unverified Greek Peak and Alta adapters', () => {
    expect(reportProviders.map((p) => [p.resortId, p.maturity])).toEqual([
      ['greek-peak', 'unverified'],
      ['alta', 'unverified'],
    ])
    expect(getReportProvider('alta')?.url).toBe('https://www.alta.com/conditions')
    expect(getReportProvider('killington')).toBeNull()
  })

  it('robots rules: longest match wins, Allow wins ties, our own group overrides *', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: piste\nDisallow: /private\nAllow: /private/ok\n')
    expect(isAllowed(rules, '/ski-ride/current-conditions/')).toBe(true)
    expect(isAllowed(rules, '/private/x')).toBe(false)
    expect(isAllowed(rules, '/private/ok/y')).toBe(true)
    expect(isAllowed(parseRobots('User-agent: *\nDisallow: /*.pdf$\n'), '/map.pdf')).toBe(false)
  })
})
