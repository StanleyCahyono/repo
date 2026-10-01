/**
 * Pure text helpers for Sources & Sync (no React, no server imports) — unit-tested in format.test.ts.
 */

/** Strip the item key ("alta:base:open-meteo: ") and the error-class tag ("http: ") from one error message. */
export function cleanMessage(raw: string): string {
  return raw
    .trim()
    // Item key: resort[:point][:provider] — lowercase ids joined by ':' and followed by ': '.
    .replace(/^[a-z0-9-]+(?::[a-z0-9-]+)*:\s+/, '')
    // Error class tag written by the provider layer.
    .replace(/^(?:http|timeout|network|parse|schema-changed|unsupported|not-configured|rate-limited):\s+/i, '')
    .trim()
}

/**
 * A run's error text is one message per failed item, joined with "; " and prefixed with the item key
 * ("alta:base:open-meteo: http: Open-Meteo: HTTP 403 Forbidden"). Group identical messages so a run that failed
 * the same way for 60 items reads as one line. Most frequent first, then first seen. The stored text is capped in
 * length, so it can be cut off: then the cut fragment is dropped and `truncated` is set — counts are only a
 * sample and should not be shown as totals.
 */
export function errorDigest(error: string | null | undefined, max = 3): { items: { text: string; count: number }[]; truncated: boolean } {
  if (!error) return { items: [], truncated: false }
  const truncated = error.trimEnd().endsWith('…')
  const parts = error.split(/;\s+/)
  if (truncated && parts.length > 1) parts.pop()
  const counts = new Map<string, number>()
  for (const raw of parts) {
    const text = cleanMessage(raw)
    if (!text) continue
    counts.set(text, (counts.get(text) ?? 0) + 1)
  }
  const items = [...counts.entries()]
    .map(([text, count], i) => ({ text, count, i }))
    .sort((a, b) => b.count - a.count || a.i - b.i)
    .slice(0, max)
    .map(({ text, count }) => ({ text, count }))
  return { items, truncated }
}

/** An error worth showing next to an HTTP status: null when it only repeats the status. */
export function errorBeyondStatus(error: string | null | undefined, status: number | null | undefined): string | null {
  if (!error) return null
  const text = cleanMessage(error)
  if (!text) return null
  if (status && new RegExp(`^(?:[\\w.-]+:\\s+)?HTTP ${status}\\b`).test(text)) return null
  return text
}

/** "HTTP 403" → a plain reason; null when there is nothing specific to say. */
export function httpReason(status: number | null | undefined): string | null {
  if (!status) return null
  if (status === 401 || status === 403) return 'refused by the site or a network proxy — often automated checks are blocked, which does not prove the page is gone'
  if (status === 404 || status === 410) return 'page not found — the link is probably broken or moved'
  if (status === 429) return 'rate-limited — too many requests; it will be retried later'
  if (status >= 500) return 'server error at the source — usually temporary'
  if (status >= 300 && status < 400) return 'redirect not followed'
  return null
}

/** Group failed link checks by their HTTP status or error, largest group first. */
export function groupFailures<T extends { httpStatus: number | null; error: string | null }>(items: readonly T[]): { key: string; label: string; items: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const it of items) {
    const key = it.httpStatus ? `HTTP ${it.httpStatus}` : (it.error?.replace(/\s+/g, ' ').slice(0, 80) ?? 'Unknown error')
    groups.set(key, [...(groups.get(key) ?? []), it])
  }
  const isStatus = (k: string) => /^HTTP \d+$/.test(k)
  // Largest first; on ties HTTP statuses before free-text errors, then alphabetical.
  return [...groups.entries()]
    .map(([key, list]) => ({ key, label: key, items: list }))
    .sort((a, b) => b.items.length - a.items.length || Number(isStatus(b.key)) - Number(isStatus(a.key)) || a.key.localeCompare(b.key))
}

/** "https://www.alta.com/lift-tickets/" → "alta.com/lift-tickets". */
export function shortUrl(url: string, max = 64): string {
  const s = url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}
