/**
 * Runtime validation of a normalised report before it leaves an adapter. Anything implausible means the
 * extractor misread the page, which is reported as 'schema-changed' rather than stored.
 */
import { z } from 'zod'
import { OPERATING_STATUSES, SNOW_WINDOWS, SURFACE_TAGS } from '@/lib/domain/types'

const count = (max: number) => z.number().int().min(0).max(max).nullable()
const cm = (max: number) => z.number().min(0).max(max).nullable()

export const ParsedReportSchema = z
  .object({
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reportedAt: z.iso.datetime({ offset: true }).nullable(),
    status: z.enum(OPERATING_STATUSES).nullable(),
    snowfall: z.array(
      z.object({
        window: z.enum(SNOW_WINDOWS),
        amountCm: cm(3000),
        startAt: z.string().nullable().optional(),
        endAt: z.string().nullable().optional(),
        sourceText: z.string().max(200).nullable().optional(),
      }),
    ),
    baseDepthCm: cm(1500),
    baseDepthLocation: z.string().max(80).nullable(),
    summitDepthCm: cm(1500),
    surfaceTags: z.array(z.enum(SURFACE_TAGS)),
    surfaceText: z.string().max(200).nullable(),
    groomingText: z.string().max(240).nullable(),
    groomedRuns: count(400),
    snowmakingText: z.string().max(240).nullable(),
    openTrails: count(400),
    totalTrails: count(400),
    openLifts: count(60),
    totalLifts: count(60),
    openBeginnerTrails: count(400),
    totalBeginnerTrails: count(400),
    openAcres: z.number().min(0).max(20_000).nullable(),
    notes: z.string().max(500).nullable(),
  })
  .superRefine((r, ctx) => {
    const pairs: [number | null, number | null, string][] = [
      [r.openTrails, r.totalTrails, 'openTrails'],
      [r.openLifts, r.totalLifts, 'openLifts'],
      [r.openBeginnerTrails, r.totalBeginnerTrails, 'openBeginnerTrails'],
    ]
    for (const [open, total, path] of pairs) {
      if (open !== null && total !== null && open > total) ctx.addIssue({ code: 'custom', path: [path], message: 'open exceeds total' })
    }
    const windows = r.snowfall.map((s) => s.window)
    if (new Set(windows).size !== windows.length) ctx.addIssue({ code: 'custom', path: ['snowfall'], message: 'duplicate window' })
    const by = Object.fromEntries(r.snowfall.map((s) => [s.window, s.amountCm]))
    // Longer windows cannot hold less snow than the shorter windows they contain.
    const nested: [string, string][] = [
      ['24h', '48h'],
      ['48h', '72h'],
      ['72h', '7d'],
      ['7d', 'season'],
      ['24h', 'season'],
    ]
    for (const [short, long] of nested) {
      if (by[short] != null && by[long] != null && by[short]! > by[long]! + 0.5) {
        ctx.addIssue({ code: 'custom', path: ['snowfall'], message: `${short} exceeds ${long}` })
      }
    }
  })
