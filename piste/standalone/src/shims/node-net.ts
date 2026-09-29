/** `node:net` isIP for the browser bundle (the URL guard classifies literal addresses with it). */

const V4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

function isV6(s: string): boolean {
  const addr = s.split('%')[0]
  if (!/^[0-9a-fA-F:.]+$/.test(addr) || !addr.includes(':')) return false
  const dbl = addr.split('::')
  if (dbl.length > 2) return false
  const groups = addr.split(':').filter((g, i, all) => g !== '' || (i > 0 && i < all.length - 1))
  const last = groups[groups.length - 1] ?? ''
  const v4Tail = last.includes('.')
  if (v4Tail && !V4.test(last)) return false
  const count = groups.filter((g) => g !== '').length + (v4Tail ? 1 : 0)
  if (groups.some((g) => g !== '' && !g.includes('.') && !/^[0-9a-fA-F]{1,4}$/.test(g))) return false
  return dbl.length === 2 ? count <= 7 : count === 8
}

export function isIPv4(s: string): boolean {
  return V4.test(s)
}

export function isIPv6(s: string): boolean {
  return isV6(s)
}

export function isIP(s: string): 0 | 4 | 6 {
  return isIPv4(s) ? 4 : isIPv6(s) ? 6 : 0
}

export default { isIP, isIPv4, isIPv6 }
