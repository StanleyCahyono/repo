/**
 * CSV (RFC 4180) builder. Pure.
 *
 * - Fields containing a comma, double quote, CR or LF — or leading/trailing spaces — are quoted; quotes doubled.
 * - Records end with CRLF.
 * - null/undefined → empty cell (unknown stays blank, never 0). Booleans → true/false. Objects/arrays → JSON.
 * - Spreadsheet formula injection: a TEXT value starting with = + - @ TAB or CR is prefixed with an apostrophe so
 *   spreadsheet apps show it as text instead of evaluating it. Numbers are never altered. The JSON export is the
 *   lossless format.
 */

export interface CsvColumn<Row> {
  header: string
  value: (row: Row) => unknown
}

const FORMULA_START = /^[=+\-@\t\r]/

export function csvField(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s: string
  if (typeof v === 'string') s = FORMULA_START.test(v) ? `'${v}` : v
  else if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : ''
  else if (typeof v === 'boolean') s = v ? 'true' : 'false'
  else if (typeof v === 'bigint') s = v.toString()
  else if (v instanceof Date) s = v.toISOString()
  else s = JSON.stringify(v)
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv<Row>(columns: readonly CsvColumn<Row>[], rows: readonly Row[]): string {
  const lines = [columns.map((c) => csvField(c.header)).join(',')]
  for (const r of rows) lines.push(columns.map((c) => csvField(c.value(r))).join(','))
  return lines.join('\r\n') + '\r\n'
}

/** Columns for every key of the given records (first-seen order), for straightforward table dumps. */
export function columnsFromRows(rows: readonly Record<string, unknown>[], preferred: readonly string[] = []): CsvColumn<Record<string, unknown>>[] {
  const keys: string[] = [...preferred]
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k)
  return keys.map((k) => ({ header: k, value: (r) => r[k] }))
}

/** Convenience: CSV of plain records with a column per key. */
export function recordsToCsv(rows: readonly Record<string, unknown>[], preferred: readonly string[] = []): string {
  return toCsv(columnsFromRows(rows, preferred), rows)
}
