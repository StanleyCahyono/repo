/**
 * Dependency-free HTML → text helpers for official report pages. These never execute page scripts and never
 * keep markup: output is plain text lines used only for label matching (and a short extract for debugging).
 */

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  deg: '°',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  rdquo: '”',
  ldquo: '“',
  rsquo: '’',
  lsquo: '‘',
  Prime: '″',
  prime: '′',
  hellip: '…',
  bull: '•',
  middot: '·',
  times: '×',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    }
    return NAMED[body] ?? NAMED[body.toLowerCase()] ?? m
  })
}

/** Remove non-content elements (scripts, styles, templates, svg, comments). */
export function stripNonContent(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
}

const BLOCK = /<\/?(?:p|div|section|article|header|footer|main|aside|nav|ul|ol|li|h[1-6]|table|thead|tbody|tfoot|tr|dl|dt|dd|br|hr|form|fieldset|figure|figcaption|blockquote|pre)\b[^>]*>/gi
const CELL = /<\/?(?:td|th)\b[^>]*>/gi

function cleanInline(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ' '))
    .replace(/[ \t\r ]+/g, ' ')
    .trim()
}

/** Page text as trimmed, non-empty lines. Block elements break lines; table cells are joined with " | ". */
export function htmlToLines(html: string): string[] {
  const body = stripNonContent(html).replace(CELL, ' | ').replace(BLOCK, '\n')
  return decodeEntities(body.replace(/<[^>]*>/g, ' '))
    .split('\n')
    .map((l) =>
      l
        .replace(/[ \t\r ]+/g, ' ')
        .replace(/(?:\s*\|\s*)+/g, ' | ')
        .replace(/^\s*\|\s*|\s*\|\s*$/g, '')
        .trim(),
    )
    .filter((l) => l.length > 0)
}

/**
 * Label/value pairs from tables and definition lists, rendered as "label: value" lines:
 * - two-cell rows `<tr><th>New Snow</th><td>2"</td></tr>`
 * - a header row followed by a value row with the same number of cells (column layout), but only when those are
 *   the table's only two rows of that width. A list (lifts, trails: `Lift | Status | Hours` then a row per lift)
 *   would otherwise turn its first item's cells into page-level facts such as "Status: Closed". A stacked layout
 *   (several header/value row pairs) is skipped as well: its values end up missing, never wrong.
 * - `<dt>label</dt><dd>value</dd>`
 */
export function htmlPairLines(html: string): string[] {
  const clean = stripNonContent(html)
  const out: string[] = []
  for (const table of clean.match(/<table\b[\s\S]*?<\/table\s*>/gi) ?? []) {
    const rows = (table.match(/<tr\b[\s\S]*?<\/tr\s*>/gi) ?? []).map((tr) =>
      (tr.match(/<(td|th)\b[^>]*>[\s\S]*?<\/\1\s*>/gi) ?? []).map(cleanInline),
    )
    const rowsOfWidth = new Map<number, number>()
    for (const row of rows) rowsOfWidth.set(row.length, (rowsOfWidth.get(row.length) ?? 0) + 1)
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r.length === 2 && r[0] && r[1]) out.push(`${r[0]}: ${r[1]}`)
      const next = rows[i + 1]
      if (
        r.length > 2 &&
        next &&
        next.length === r.length &&
        rowsOfWidth.get(r.length) === 2 &&
        r.every((c) => /[a-z]/i.test(c)) &&
        next.some((c) => /\d/.test(c))
      ) {
        r.forEach((label, j) => {
          if (label && next[j]) out.push(`${label}: ${next[j]}`)
        })
      }
    }
  }
  const dl = /<dt\b[^>]*>([\s\S]*?)<\/dt\s*>\s*<dd\b[^>]*>([\s\S]*?)<\/dd\s*>/gi
  for (const m of clean.matchAll(dl)) {
    const label = cleanInline(m[1])
    const value = cleanInline(m[2])
    if (label && value) out.push(`${label}: ${value}`)
  }
  return out
}
