/**
 * How a fact's source is named on screen (pure; shared by the source drawer, alerts and read models).
 *
 * Researched catalog facts are shown like any other fact, so the catalog's internal provider name
 * ("Piste catalog (web research)") is shown as plain "Piste catalog", and its research notes (researcher commentary,
 * not part of the fact) and internal note markers are not shown.
 */
import type { Provenance } from './types'

/** The catalog provider's stored name starts with this (see src/lib/catalog/seed.ts CATALOG_PROVIDER). */
const CATALOG_PREFIX = 'Piste catalog'

export const isCatalogProvider = (provider: string | null | undefined): boolean => !!provider && provider.startsWith(CATALOG_PREFIX)

/** Display name of a provider: "Piste catalog (web research)" → "Piste catalog"; others unchanged. */
export function providerLabel(provider: string | null | undefined): string | null {
  if (!provider) return null
  return isCatalogProvider(provider) ? CATALOG_PREFIX : provider
}

/** Machine markers stored in `prov.note` (e.g. 'catalog-research', 'entered-by-user', 'personal'). */
const MARKER = /^[a-z]+(?:-[a-z]+)*$/
/** Research caveat wording that is no longer shown anywhere. */
const CAVEAT = /confirm at (?:the )?(?:official )?source|unverified|not web-verified|reference data|\b(?:search|research) summar(?:y|ies)\b|\bresearched\b/i

/** A stored note as display text, or null for an internal marker or research caveat wording. */
export function cleanNote(note: string | null | undefined): string | null {
  const t = note?.trim()
  return !t || MARKER.test(t) || CAVEAT.test(t) ? null : t
}

/** The provenance note worth showing beside a fact, or null (catalog research notes, markers, caveats). */
export function shownNote(p: Pick<Provenance, 'provider' | 'note'> | null | undefined): string | null {
  return isCatalogProvider(p?.provider) ? null : cleanNote(p?.note)
}

/** Research caveat wording inside catalog prose (a clause or sentence that only says "check this"). */
const PROSE_CAVEAT =
  /\bconfirm\b|\bunconfirmed\b|\bnot confirmed\b|\bunverified\b|\bnot (?:been )?verified\b|\breference (?:data|note|link)\b|\bpiste reference\b|\b(?:search|research)[- ]summar(?:y|ies)\b|\bresearched\b|\bin research\b|catalog\/|passes\.json|web-verified|unattributed/i
/** A parenthetical made only of a research caveat: "(reference — confirm)", "(per search summary)", "(unconfirmed)". */
const CAVEAT_PAREN = /\s*\([^()]*(?:confirm|unverified|reference|search[- ]summar|research summar|researched|\bresearch\b|not (?:been )?verified|web-verified)[^()]*\)/gi
/** A trailing dash clause that is only a caveat: "SATA group — reference, confirm". */
const CAVEAT_TAIL = /\s+[—–]\s+[^—–]*\b(?:confirm|unconfirmed|unverified|reference)\b[^—–]*$/i

/**
 * Catalog prose without its research caveats. The catalog's researchers wrote notes such as "(per search summary)",
 * "— reference, confirm" or "Childcare not confirmed." into displayed text; under the display policy researched facts
 * read normally, so those fragments are dropped (clause by clause) and the rest is kept as written. Returns null when
 * nothing but caveats remains. Never used on text you entered yourself.
 */
export function cleanCatalogText(text: string | null | undefined): string | null {
  if (text == null) return null
  const sentences = text
    .replace(CAVEAT_PAREN, '')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => {
      const end = /[.!?]$/.test(sentence) ? sentence.slice(-1) : ''
      const body = end ? sentence.slice(0, -1) : sentence
      const clauses = body.split(/;\s+/).map((clause) => clause.replace(CAVEAT_TAIL, '').trim())
      const kept = clauses.filter((clause) => clause && !PROSE_CAVEAT.test(clause)).join('; ')
      return kept ? `${kept}${end}` : ''
    })
    .filter((x) => x && !PROSE_CAVEAT.test(x))
  const t = sentences.join(' ').replace(/\s+([,.;:])/g, '$1').replace(/\s{2,}/g, ' ').trim()
  if (!t || /^[\s.,;:—–-]*$/.test(t)) return null
  return t[0].toUpperCase() + t.slice(1)
}
