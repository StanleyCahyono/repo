/**
 * Route matching over the tree generated from src/app at build time. Same rules as the App Router for the features
 * Piste uses: route groups `(x)` add no segment, `[x]` matches one segment, static segments win over dynamic ones.
 */
import { tree, apiRoutes, type RouteNodeDef } from 'virtual:piste/routes'

export interface RouteMatch {
  /** Nodes from the root to the node holding the page. */
  chain: RouteNodeDef[]
  params: Record<string, string>
  /** URL segments consumed by each chain node ('' for the root and route groups). */
  segments: string[]
}

function segmentsOf(pathname: string): string[] {
  return pathname.split('/').filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  })
}

function walk(node: RouteNodeDef, rest: string[], chain: RouteNodeDef[], segs: string[], params: Record<string, string>): RouteMatch | null {
  if (rest.length === 0 && node.page) return { chain, params, segments: segs }
  // Static and group children first, dynamic after (App Router precedence).
  const order = [...node.children].sort((a, b) => rank(a) - rank(b))
  for (const child of order) {
    if (child.kind === 'group') {
      const m = walk(child, rest, [...chain, child], [...segs, ''], params)
      if (m) return m
    } else if (child.kind === 'static') {
      if (rest[0] === child.segment) {
        const m = walk(child, rest.slice(1), [...chain, child], [...segs, rest[0]], params)
        if (m) return m
      }
    } else if (child.kind === 'dynamic' && rest.length > 0 && child.param) {
      const m = walk(child, rest.slice(1), [...chain, child], [...segs, rest[0]], { ...params, [child.param]: rest[0] })
      if (m) return m
    } else if (child.kind === 'catch-all' && rest.length > 0 && child.param) {
      const m = walk(child, [], [...chain, child], [...segs, rest.join('/')], { ...params, [child.param]: rest.join('/') })
      if (m) return m
    }
  }
  return null
}

const rank = (n: RouteNodeDef) => (n.kind === 'static' ? 0 : n.kind === 'group' ? 1 : n.kind === 'dynamic' ? 2 : 3)

export function matchRoute(pathname: string): RouteMatch | null {
  return walk(tree, segmentsOf(pathname), [tree], [''], {})
}

export const rootNode = tree

/**
 * The chain of nodes a URL would use even when no page matches (for the nearest loading.tsx during navigation):
 * follows static/dynamic children as far as the URL goes.
 */
export function partialChain(pathname: string): RouteNodeDef[] {
  const m = matchRoute(pathname)
  if (m) return m.chain
  return [tree]
}

export function findApiRoute(pathname: string) {
  return apiRoutes.find((r) => r.path === pathname) ?? null
}
