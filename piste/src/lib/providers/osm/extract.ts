/**
 * The stored form of an OpenStreetMap lifts-and-runs extract (source_records.extract of adapter 'osm-overpass'):
 * `{ skiArea: SkiAreaExtract, requests }`. Read back through `readSkiAreaExtract`, which rejects anything that is not
 * the current version — a damaged or older record reads as "not loaded", never as a half-parsed list.
 */
import { z } from 'zod'
import { LIFT_TYPES, PISTE_DIFFICULTIES, SKI_AREA_EXTRACT_VERSION, type SkiAreaExtract } from '@/lib/domain/lifts'

const n = z.number().finite()
const nn = n.nullable()
const Difficulty = z.enum([...PISTE_DIFFICULTIES, 'unknown'])

export const SkiAreaExtractSchema = z.object({
  v: z.literal(SKI_AREA_EXTRACT_VERSION),
  method: z.enum(['area', 'bbox']),
  areas: z.array(z.object({ osm: z.string(), name: z.string().nullable() })),
  bbox: z.tuple([n, n, n, n]).nullable(),
  osmTimestamp: z.string().nullable(),
  lifts: z.array(
    z.object({
      osm: z.string(),
      name: z.string().nullable(),
      ref: z.string().nullable(),
      type: z.enum(LIFT_TYPES),
      lengthM: nn,
      capacityPerHour: nn,
      occupancy: nn,
      durationMin: nn,
    }),
  ),
  runs: z.array(
    z.object({
      osm: z.string(),
      name: z.string().nullable(),
      ref: z.string().nullable(),
      difficulty: Difficulty,
      grooming: z.string().nullable(),
      lengthM: nn,
      segments: z.number().int().min(0),
    }),
  ),
  unnamed: z.array(z.object({ difficulty: Difficulty, segments: z.number().int().min(0), lengthM: n })),
  areaPistes: z.number().int().min(0),
})

export interface StoredSkiArea {
  skiArea: SkiAreaExtract
  /** HTTP requests the load took (sites, area, bounding-box fallback). */
  requests: number
}

/** The ski area in a stored record's `extract`, or null when it is missing, damaged or of another version. */
export function readSkiAreaExtract(extract: unknown): SkiAreaExtract | null {
  const inner = extract && typeof extract === 'object' ? (extract as { skiArea?: unknown }).skiArea : undefined
  const parsed = SkiAreaExtractSchema.safeParse(inner)
  return parsed.success ? (parsed.data as SkiAreaExtract) : null
}
