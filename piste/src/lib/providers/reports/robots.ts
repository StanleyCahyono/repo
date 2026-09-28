/**
 * Minimal robots.txt support for official report pages. Public visibility does not by itself permit automated
 * fetching, so report adapters check the site's robots rules for our product token ("piste") and "*".
 * Longest matching rule wins; Allow beats Disallow on ties; `*` and `$` wildcards are supported.
 */
import type { HttpClient } from '../http'
import type { ProviderErrorKind, SourceFetch } from '../types'

interface Rule {
  allow: boolean
  pattern: string
}

export function parseRobots(text: string, agent = 'piste'): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = []
  let current: { agents: string[]; rules: Rule[] } | null = null
  let lastWasAgent = false
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current) continue
    if (key === 'allow' || key === 'disallow') {
      if (key === 'disallow' && value === '') continue // empty Disallow = allow all
      current.rules.push({ allow: key === 'allow', pattern: value })
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a === agent.toLowerCase()))
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'))
  return chosen.flatMap((g) => g.rules)
}

function ruleMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const body = (anchored ? pattern.slice(0, -1) : pattern).split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path)
}

export function isAllowed(rules: Rule[], pathWithQuery: string): boolean {
  let best: Rule | null = null
  for (const r of rules) {
    if (!ruleMatches(r.pattern, pathWithQuery)) continue
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r
  }
  return best ? best.allow : true
}

export type RobotsVerdict =
  | { ok: true; allowed: boolean; fetch: SourceFetch }
  | { ok: false; error: string; errorKind: ProviderErrorKind; retriable: boolean; fetch: SourceFetch }

/** Fetch (cached 24 h) and evaluate robots.txt for `url`. 4xx = no rules (allowed). 5xx/timeout = cannot tell. */
export async function checkRobots(http: HttpClient, url: string): Promise<RobotsVerdict> {
  const u = new URL(url)
  const robotsUrl = `${u.origin}/robots.txt`
  const res = await http.request(robotsUrl, {
    expect: 'text',
    timeoutMs: 10_000,
    retries: 1,
    cacheTtlMs: 24 * 3_600_000,
    acceptStatus: [400, 401, 403, 404, 410],
    maxBytes: 512 * 1024,
  })
  if (!res.ok) return { ok: false, error: `robots.txt: ${res.error}`, errorKind: res.errorKind, retriable: res.retriable, fetch: res.fetch }
  if (res.status >= 400) return { ok: true, allowed: true, fetch: res.fetch }
  const rules = parseRobots(res.text)
  return { ok: true, allowed: isAllowed(rules, `${u.pathname}${u.search}`), fetch: res.fetch }
}
