/**
 * Read-only `node:fs` for the browser bundle. It serves the files embedded at build time (the curated catalog/*.json)
 * so src/lib/catalog/seed.ts `loadCatalog()` runs unchanged — same validation, same result as on the server.
 * process.cwd() is '/' in the bundle, so paths look like '/catalog/resorts/alta.json'.
 */
import { files } from 'virtual:piste/files'

const key = (p: string | URL) =>
  String(p)
    .replace(/^file:\/\//, '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')

function isDir(k: string): boolean {
  if (k === '') return true
  const prefix = `${k}/`
  return Object.keys(files).some((f) => f.startsWith(prefix))
}

function notFound(p: string | URL, syscall: string): Error {
  const e = new Error(`ENOENT: no such file or directory, ${syscall} '${String(p)}'`) as Error & { code: string }
  e.code = 'ENOENT'
  return e
}

export function existsSync(p: string | URL): boolean {
  const k = key(p)
  return k in files || isDir(k)
}

export function readdirSync(p: string | URL): string[] {
  const k = key(p)
  if (!isDir(k)) throw notFound(p, 'scandir')
  const prefix = k ? `${k}/` : ''
  const names = new Set<string>()
  for (const f of Object.keys(files)) if (f.startsWith(prefix)) names.add(f.slice(prefix.length).split('/')[0])
  return [...names].sort()
}

export function readFileSync(p: string | URL, options?: string | { encoding?: string | null }): string | Uint8Array {
  const k = key(p)
  if (!(k in files)) throw notFound(p, 'open')
  const enc = typeof options === 'string' ? options : options?.encoding
  return enc ? files[k] : new TextEncoder().encode(files[k])
}

export function statSync(p: string | URL) {
  const k = key(p)
  const file = k in files
  if (!file && !isDir(k)) throw notFound(p, 'stat')
  return { isFile: () => file, isDirectory: () => !file, size: file ? files[k].length : 0, mtimeMs: 0 }
}

function readOnly(name: string): never {
  throw new Error(`fs.${name} is not available in the single-file version (there is no disk to write to)`)
}

export const mkdirSync = () => undefined
export const writeFileSync = () => readOnly('writeFileSync')
export const renameSync = () => readOnly('renameSync')
export const rmSync = () => readOnly('rmSync')
export const unlinkSync = () => readOnly('unlinkSync')
export const copyFileSync = () => readOnly('copyFileSync')

export const promises = {
  readFile: async (p: string | URL, options?: string | { encoding?: string | null }) => readFileSync(p, options),
  readdir: async (p: string | URL) => readdirSync(p),
  stat: async (p: string | URL) => statSync(p),
  access: async (p: string | URL) => {
    if (!existsSync(p)) throw notFound(p, 'access')
  },
  mkdir: async () => undefined,
  writeFile: async () => readOnly('promises.writeFile'),
}

const fs = { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, renameSync, rmSync, unlinkSync, copyFileSync, promises }
export default fs
