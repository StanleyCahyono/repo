/**
 * next/headers for the single-file build: cookies live in localStorage (key prefix `piste:cookie:`), falling back to
 * memory when storage is unavailable. headers() is empty — there is no request.
 */

const PREFIX = 'piste:cookie:'
const memory = new Map<string, string>()

function storage(): Storage | null {
  try {
    const s = window.localStorage
    const probe = `${PREFIX}__probe`
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

export interface Cookie {
  name: string
  value: string
}

function read(name: string): string | undefined {
  const s = storage()
  if (s) {
    const v = s.getItem(PREFIX + name)
    return v === null ? undefined : v
  }
  return memory.get(name)
}

function write(name: string, value: string | null) {
  const s = storage()
  if (s) {
    if (value === null) s.removeItem(PREFIX + name)
    else s.setItem(PREFIX + name, value)
  } else if (value === null) memory.delete(name)
  else memory.set(name, value)
}

function all(): Cookie[] {
  const s = storage()
  if (!s) return [...memory].map(([name, value]) => ({ name, value }))
  const out: Cookie[] = []
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i)
    if (k && k.startsWith(PREFIX) && !k.endsWith('__probe')) out.push({ name: k.slice(PREFIX.length), value: s.getItem(k) ?? '' })
  }
  return out
}

export const cookieStore = {
  get(name: string | { name: string }): Cookie | undefined {
    const n = typeof name === 'string' ? name : name.name
    const value = read(n)
    return value === undefined ? undefined : { name: n, value }
  },
  getAll(name?: string): Cookie[] {
    const list = all()
    return name ? list.filter((c) => c.name === name) : list
  },
  has(name: string): boolean {
    return read(name) !== undefined
  },
  set(nameOrCookie: string | (Cookie & Record<string, unknown>), value?: string, _options?: Record<string, unknown>) {
    if (typeof nameOrCookie === 'string') write(nameOrCookie, value ?? '')
    else write(nameOrCookie.name, nameOrCookie.value)
    return cookieStore
  },
  delete(name: string | { name: string }) {
    write(typeof name === 'string' ? name : name.name, null)
    return cookieStore
  },
  get size() {
    return all().length
  },
  toString() {
    return all()
      .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
      .join('; ')
  },
}

export async function cookies() {
  return cookieStore
}

export async function headers() {
  return new Headers()
}

export async function draftMode() {
  return { isEnabled: false, enable() {}, disable() {} }
}
