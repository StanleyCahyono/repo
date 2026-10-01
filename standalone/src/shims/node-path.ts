/** Minimal POSIX `node:path` for the browser bundle (the catalog loader joins paths; nothing touches a real disk). */

export const sep = '/'
export const delimiter = ':'

export function normalize(p: string): string {
  const abs = p.startsWith('/')
  const out: string[] = []
  for (const part of p.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (!abs) out.push('..')
    } else out.push(part)
  }
  const joined = out.join('/')
  return abs ? `/${joined}` : joined || '.'
}

export function join(...parts: string[]): string {
  return normalize(parts.filter((x) => x !== '').join('/'))
}

export function isAbsolute(p: string): boolean {
  return p.startsWith('/')
}

export function resolve(...parts: string[]): string {
  let acc = ''
  for (let i = parts.length - 1; i >= 0 && !acc.startsWith('/'); i--) acc = parts[i] + (acc ? `/${acc}` : '')
  if (!acc.startsWith('/')) acc = `/${acc}`
  return normalize(acc)
}

export function dirname(p: string): string {
  const n = normalize(p)
  const i = n.lastIndexOf('/')
  if (i < 0) return '.'
  if (i === 0) return '/'
  return n.slice(0, i)
}

export function basename(p: string, ext?: string): string {
  const b = normalize(p).split('/').pop() ?? ''
  return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b
}

export function extname(p: string): string {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i) : ''
}

export function relative(from: string, to: string): string {
  const a = resolve(from).split('/').filter(Boolean)
  const b = resolve(to).split('/').filter(Boolean)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/')
}

const path = { sep, delimiter, normalize, join, isAbsolute, resolve, dirname, basename, extname, relative, posix: undefined as unknown }
path.posix = path
export const posix = path
export default path
