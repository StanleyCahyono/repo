/**
 * Structured data on report pages: JSON-LD blocks and <meta> tags. There is no schema.org vocabulary for snow
 * reports, so instead of guessing a schema we flatten whatever structured key/value pairs a page publishes into
 * "label: value" lines (camelCase/snake_case keys humanised, schema.org PropertyValue → "name: value unit") and
 * run them through the same label matcher as the page text — with higher priority. Nothing here trusts page
 * modification timestamps (`dateModified`) as a report time.
 */
import { decodeEntities } from './text'

const MAX_LINES = 300
const MAX_DEPTH = 8

export function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .replace(/[_\-.:]+/g, ' ')
    .trim()
}

function scalar(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function walk(node: unknown, out: string[], depth: number) {
  if (out.length >= MAX_LINES || depth > MAX_DEPTH || node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const n of node) walk(n, out, depth + 1)
    return
  }
  const obj = node as Record<string, unknown>
  const type = typeof obj['@type'] === 'string' ? obj['@type'] : null
  if (type === 'PropertyValue') {
    const name = scalar(obj.name)
    const value = scalar(obj.value)
    const unit = scalar(obj.unitText) ?? scalar(obj.unitCode)
    if (name && value !== null) out.push(`${name}: ${value}${unit ? ` ${unitWord(unit)}` : ''}`)
    return
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('@')) {
      if (k === '@graph') walk(v, out, depth + 1)
      continue
    }
    const s = scalar(v)
    if (s !== null) {
      if (s.length <= 200) out.push(`${humanizeKey(k)}: ${s}`)
    } else {
      walk(v, out, depth + 1)
    }
  }
}

/** UN/CEFACT common codes seen in PropertyValue.unitCode → words the label matcher understands. */
function unitWord(u: string): string {
  const map: Record<string, string> = { INH: 'in', CMT: 'cm', MTR: 'm', FOT: 'ft' }
  return map[u.toUpperCase()] ?? u
}

export interface StructuredData {
  lines: string[]
  jsonLdBlocks: number
  metaTags: number
  invalidJsonLd: number
}

export function extractStructured(html: string): StructuredData {
  const lines: string[] = []
  let jsonLdBlocks = 0
  let invalidJsonLd = 0
  const ld = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi
  for (const m of html.matchAll(ld)) {
    jsonLdBlocks++
    try {
      walk(JSON.parse(m[1].trim()), lines, 0)
    } catch {
      invalidJsonLd++
    }
  }
  let metaTags = 0
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0]
    const name = tag.match(/\b(?:name|property|itemprop)\s*=\s*["']([^"']+)["']/i)?.[1]
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1]
    if (!name || content === undefined) continue
    // Social/SEO tags are marketing copy, not report data.
    if (/^(og|twitter|fb|al|article|profile|video|music|book):/i.test(name)) continue
    if (/^(viewport|robots|charset|theme-color|generator|description|keywords|author|title|application-name|referrer|google-site-verification|format-detection|msapplication-.*|apple-.*)$/i.test(name)) continue
    metaTags++
    const value = decodeEntities(content).trim()
    if (value && value.length <= 300 && lines.length < MAX_LINES) lines.push(`${humanizeKey(name)}: ${value}`)
  }
  return { lines, jsonLdBlocks, metaTags, invalidJsonLd }
}
