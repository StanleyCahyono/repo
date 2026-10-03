/**
 * Pass-family badges for discovery (Explore cards, filters). A badge says "this family has some product with
 * some relationship to this resort" — it is NOT an answer to "can I ski here with my pass". Resort affiliation
 * never implies ownership; exact access comes from evaluateAccess on the owned product.
 */
import { PASS_FAMILIES, type PassAccessType } from '../types'
import type { PassProductInput, PassRuleInput } from './types'

export interface FamilyBadge {
  familyId: string
  /** Products in this family with a rule at the resort that grants something (not 'not-included' or 'unknown'). */
  productIds: string[]
  accessTypes: PassAccessType[]
  /** Every qualifying rule is 'discount-only' — show the badge in a muted/qualified style. */
  qualifiedOnly: boolean
  discoveryOnly: true
}

/**
 * Distinct families with at least one rule at the resort that grants access or a discount ('unknown' rules are not
 * shown, 'not-included' grants nothing). Pass all rules for one resort; only the current version per product counts.
 * Optionally restrict to one season.
 */
export function familyBadges(
  rulesForResort: readonly PassRuleInput[],
  products: readonly PassProductInput[],
  opts: { seasonId?: string | null } = {},
): FamilyBadge[] {
  const productById = new Map(products.map((p) => [p.id, p]))
  const current = new Map<string, PassRuleInput>()
  for (const r of rulesForResort) {
    const key = `${r.productId}|${r.resortId}`
    const prev = current.get(key)
    if (!prev || (r.version ?? 1) > (prev.version ?? 1)) current.set(key, r)
  }

  const byFamily = new Map<string, { productIds: Set<string>; access: Set<PassAccessType> }>()
  for (const r of current.values()) {
    if (r.access === 'not-included' || r.access === 'unknown') continue
    const product = productById.get(r.productId)
    if (!product) continue
    if (opts.seasonId && product.seasonId !== opts.seasonId) continue
    const entry = byFamily.get(product.familyId) ?? { productIds: new Set<string>(), access: new Set<PassAccessType>() }
    entry.productIds.add(product.id)
    entry.access.add(r.access)
    byFamily.set(product.familyId, entry)
  }

  const order = (id: string) => {
    const i = (PASS_FAMILIES as readonly string[]).indexOf(id)
    return i === -1 ? PASS_FAMILIES.length : i
  }
  return [...byFamily.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([familyId, e]) => {
      const accessTypes = [...e.access].sort()
      return {
        familyId,
        productIds: [...e.productIds].sort(),
        accessTypes,
        qualifiedOnly: accessTypes.every((a) => a === 'discount-only'),
        discoveryOnly: true as const,
      }
    })
}
