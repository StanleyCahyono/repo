/** Small helpers for building `ProviderResult`s consistently. */
import { DateTime } from 'luxon'
import type { HttpFailure } from './http'
import type { Capabilities, ProviderErrorKind, ProviderResult, SourceFetch } from './types'

export function fail(
  errorKind: ProviderErrorKind,
  error: string,
  fetches: SourceFetch[] = [],
  retriable = errorKind === 'timeout' || errorKind === 'network' || errorKind === 'rate-limited',
): ProviderResult<never> {
  return { ok: false, error, errorKind, retriable, fetches }
}

/** Convert an HTTP-layer failure into a provider failure, keeping every fetch record. */
export function failFromHttp(r: HttpFailure, fetches: SourceFetch[], context: string): ProviderResult<never> {
  return { ok: false, error: `${context}: ${r.error}`, errorKind: r.errorKind, retriable: r.retriable, fetches }
}

export function caps(supplied: string[], missing: string[], limitations: string[] = []): Capabilities {
  return { supplied: [...new Set(supplied)], missing: [...new Set(missing)], limitations }
}

/** Normalize any ISO-8601 instant (with offset or Z) to a UTC ISO string; null when absent/invalid. */
export function toUtcIso(value: string | null | undefined): string | null {
  if (!value) return null
  const dt = DateTime.fromISO(value, { setZone: true })
  return dt.isValid ? dt.toUTC().toISO() : null
}

export function addHoursIso(instant: string, hours: number): string {
  return DateTime.fromISO(instant, { zone: 'utc' }).plus({ hours }).toUTC().toISO()!
}

/** Zod issue list → short human text (first few issues). */
export function describeIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[], max = 4): string {
  return issues
    .slice(0, max)
    .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join('; ')
}
