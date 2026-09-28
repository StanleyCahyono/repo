/**
 * SSRF guard for user-supplied URLs (link checker, URL importer, anything a person can type).
 *
 * `assertPublicHttpUrl` accepts only http(s) URLs without embedded credentials, on a standard port, whose host
 * is not a special-use name and whose every DNS answer is a public unicast address. Literal IPs (including the
 * odd IPv4 spellings the WHATWG URL parser normalises, e.g. `http://2130706433/` → 127.0.0.1) and IPv6 forms
 * that embed IPv4 (mapped, compatible, NAT64, 6to4) are classified on the embedded address.
 *
 * Residual risk (documented in docs/providers.md): DNS can change between this check and the connection
 * (rebinding). Callers that follow redirects must re-check every hop — `checkLink` does.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

/** Resolves a hostname to every address the OS resolver would connect to. Injectable for tests. */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>

export const systemResolver: Resolver = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true })
  return answers.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }))
}

export type UnsafeUrlReason = 'invalid' | 'scheme' | 'credentials' | 'port' | 'hostname' | 'private-address' | 'dns'

export class UnsafeUrlError extends Error {
  readonly reason: UnsafeUrlReason
  constructor(reason: UnsafeUrlReason, message: string) {
    super(message)
    this.name = 'UnsafeUrlError'
    this.reason = reason
  }
}

export interface GuardOptions {
  resolver?: Resolver
  /** Allow ports other than the scheme default / 80 / 443. Off by default. */
  allowNonStandardPorts?: boolean
}

export interface GuardedUrl {
  url: URL
  /** Addresses the hostname resolved to (or the literal IP). */
  addresses: string[]
}

// ---------------------------------------------------------------------------
// IP classification

interface V4Range {
  base: number
  bits: number
  label: string
}

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const v = Number(p)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n
}

function cidr4(cidr: string, label: string): V4Range {
  const [ip, bits] = cidr.split('/')
  return { base: v4ToInt(ip)!, bits: Number(bits), label }
}

const BLOCKED_V4: V4Range[] = [
  cidr4('0.0.0.0/8', 'this-network'),
  cidr4('10.0.0.0/8', 'private'),
  cidr4('100.64.0.0/10', 'carrier-grade-nat'),
  cidr4('127.0.0.0/8', 'loopback'),
  cidr4('169.254.0.0/16', 'link-local (incl. cloud metadata)'),
  cidr4('172.16.0.0/12', 'private'),
  cidr4('192.0.0.0/24', 'ietf-protocol'),
  cidr4('192.0.2.0/24', 'documentation'),
  cidr4('192.88.99.0/24', '6to4-relay'),
  cidr4('192.168.0.0/16', 'private'),
  cidr4('198.18.0.0/15', 'benchmarking'),
  cidr4('198.51.100.0/24', 'documentation'),
  cidr4('203.0.113.0/24', 'documentation'),
  cidr4('224.0.0.0/4', 'multicast'),
  cidr4('240.0.0.0/4', 'reserved/broadcast'),
]

function inV4(n: number, r: V4Range): boolean {
  const size = 2 ** (32 - r.bits)
  return Math.floor(n / size) === Math.floor(r.base / size)
}

/** Expand an IPv6 literal to eight 16-bit groups. Handles `::`, zone ids and a trailing dotted IPv4. */
function v6Groups(ip: string): number[] | null {
  let s = ip.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase()
  const dotted = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (dotted) {
    const n = v4ToInt(dotted[1])
    if (n === null) return null
    s = s.slice(0, -dotted[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const parse = (part: string) => (part === '' ? [] : part.split(':').map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)))
  const head = parse(halves[0])
  const tail = halves.length === 2 ? parse(halves[1]) : []
  if ([...head, ...tail].some((g) => Number.isNaN(g))) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const fill = 8 - head.length - tail.length
  if (fill < 1) return null
  return [...head, ...Array(fill).fill(0), ...tail]
}

function groupsToV4(hi: number, lo: number): string {
  return `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`
}

export interface IpClassification {
  public: boolean
  /** Why the address is not public (null when public). */
  range: string | null
}

export function classifyIp(ip: string): IpClassification {
  const kind = isIP(ip.replace(/^\[|\]$/g, '').split('%')[0])
  if (kind === 4) {
    const n = v4ToInt(ip)
    if (n === null) return { public: false, range: 'unparseable' }
    const hit = BLOCKED_V4.find((r) => inV4(n, r))
    return hit ? { public: false, range: hit.label } : { public: true, range: null }
  }
  if (kind === 6) {
    const g = v6Groups(ip)
    if (!g) return { public: false, range: 'unparseable' }
    const allZeroPrefix = (k: number) => g.slice(0, k).every((x) => x === 0)
    if (g.every((x) => x === 0)) return { public: false, range: 'unspecified' }
    if (allZeroPrefix(7) && g[7] === 1) return { public: false, range: 'loopback' }
    // IPv4-mapped ::ffff:a.b.c.d and deprecated IPv4-compatible ::a.b.c.d → classify the embedded IPv4.
    if (allZeroPrefix(5) && g[5] === 0xffff) return embedded(groupsToV4(g[6], g[7]), 'ipv4-mapped')
    if (allZeroPrefix(6)) return embedded(groupsToV4(g[6], g[7]), 'ipv4-compatible')
    // NAT64 well-known prefix 64:ff9b::/96 embeds IPv4; 64:ff9b:1::/48 is local-use.
    if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
      return embedded(groupsToV4(g[6], g[7]), 'nat64')
    }
    if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return { public: false, range: 'nat64-local-use' }
    if (g[0] === 0x2002) return embedded(groupsToV4(g[1], g[2]), '6to4')
    if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return { public: false, range: 'discard' }
    if (g[0] === 0x2001 && g[1] === 0x0db8) return { public: false, range: 'documentation' }
    if (g[0] === 0x2001 && g[1] === 0) return { public: false, range: 'teredo' }
    if ((g[0] & 0xfe00) === 0xfc00) return { public: false, range: 'unique-local (fc00::/7)' }
    if ((g[0] & 0xffc0) === 0xfe80) return { public: false, range: 'link-local (fe80::/10)' }
    if ((g[0] & 0xffc0) === 0xfec0) return { public: false, range: 'site-local (fec0::/10)' }
    if ((g[0] & 0xff00) === 0xff00) return { public: false, range: 'multicast' }
    return { public: true, range: null }
  }
  return { public: false, range: 'not-an-ip' }
}

function embedded(v4: string, via: string): IpClassification {
  const c = classifyIp(v4)
  return c.public ? c : { public: false, range: `${via} ${c.range}` }
}

export function isPublicIp(ip: string): boolean {
  return classifyIp(ip).public
}

// ---------------------------------------------------------------------------
// Hostnames

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home.arpa', '.corp', '.localdomain']
const BLOCKED_NAMES = new Set(['localhost', 'localhost.localdomain', 'metadata', 'metadata.google.internal', 'instance-data'])

function hostnameProblem(host: string): string | null {
  if (!host) return 'empty hostname'
  if (BLOCKED_NAMES.has(host)) return `special-use hostname "${host}"`
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return `special-use hostname "${host}"`
  // Single-label names resolve through search domains to internal hosts.
  if (!host.includes('.')) return `single-label hostname "${host}"`
  return null
}

// ---------------------------------------------------------------------------

export async function assertPublicHttpUrl(input: string | URL, opts: GuardOptions = {}): Promise<GuardedUrl> {
  let url: URL
  try {
    url = new URL(String(input))
  } catch {
    throw new UnsafeUrlError('invalid', 'Not a valid absolute URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('scheme', `Only http and https URLs are allowed (got ${url.protocol})`)
  }
  if (url.username || url.password) throw new UnsafeUrlError('credentials', 'URLs with embedded credentials are not allowed')
  if (url.port && !opts.allowNonStandardPorts && url.port !== '80' && url.port !== '443') {
    throw new UnsafeUrlError('port', `Port ${url.port} is not allowed`)
  }

  const host = url.hostname.replace(/\.$/, '').toLowerCase()
  const literal = host.replace(/^\[|\]$/g, '')
  if (isIP(literal)) {
    const c = classifyIp(literal)
    if (!c.public) throw new UnsafeUrlError('private-address', `Address ${literal} is not public (${c.range})`)
    return { url, addresses: [literal] }
  }

  const problem = hostnameProblem(host)
  if (problem) throw new UnsafeUrlError('hostname', `Hostname not allowed: ${problem}`)

  let answers: ResolvedAddress[]
  try {
    answers = await (opts.resolver ?? systemResolver)(host)
  } catch (e) {
    throw new UnsafeUrlError('dns', `Could not resolve ${host}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (answers.length === 0) throw new UnsafeUrlError('dns', `${host} did not resolve to any address`)
  for (const a of answers) {
    const c = classifyIp(a.address)
    if (!c.public) throw new UnsafeUrlError('private-address', `${host} resolves to non-public address ${a.address} (${c.range})`)
  }
  return { url, addresses: answers.map((a) => a.address) }
}
