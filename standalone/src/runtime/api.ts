/**
 * The app's API routes (src/app/api/**\/route.ts) run in the browser: fetch('/api/…') and export links call the same
 * handlers with a Request built from the call. Downloads become Blob files with the handler's Content-Disposition name.
 */
import { deferSaves, saveSoon } from '../db/client'
import { NextRequest } from '../shims/next-server'
import { findApiRoute } from './routes'
import { notify } from './notices'
import type { AppUrl } from './url'

const ORIGIN = 'http://piste.local'

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response

export async function callApi(url: AppUrl, init: RequestInit = {}): Promise<Response> {
  const route = findApiRoute(url.pathname)
  if (!route) return Response.json({ error: `No such API route in the single-file version: ${url.pathname}` }, { status: 404 })
  const method = (init.method ?? 'GET').toUpperCase()
  const handler = route.module[method] as Handler | undefined
  if (typeof handler !== 'function') return Response.json({ error: `Method ${method} not allowed` }, { status: 405, headers: { allow: Object.keys(route.module).filter((k) => /^[A-Z]+$/.test(k)).join(', ') } })
  const req = new NextRequest(`${ORIGIN}${url.pathname}${url.search}`, { ...init, method })
  // A write through an API route (e.g. a manual refresh, which writes for minutes) saves once it is done.
  const endDeferral = method === 'GET' ? null : deferSaves()
  try {
    return await handler(req, { params: Promise.resolve({}) })
  } catch (e) {
    console.error(e)
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  } finally {
    if (endDeferral) {
      endDeferral()
      saveSoon()
    }
  }
}

/** `attachment; filename="x"; filename*=UTF-8''x` → the file name. */
export function filenameFrom(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/.exec(disposition)
  return (plain?.[1] ?? plain?.[2] ?? fallback).trim()
}

export function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 60_000)
}

/** Run an export route and save its response as a file. HTTP errors are reported, never saved as a file. */
export async function downloadApi(url: AppUrl): Promise<void> {
  const res = await callApi(url)
  if (!res.ok) {
    let message = `Export failed (HTTP ${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      /* not JSON */
    }
    notify({ tone: 'error', text: message })
    return
  }
  const name = filenameFrom(res.headers.get('content-disposition'), url.pathname.split('/').pop() || 'piste-export')
  const type = res.headers.get('content-type') ?? 'application/octet-stream'
  saveBlob(new Blob([await res.arrayBuffer()], { type }), name)
}

/** Does this fetch() target an app API route? Returns its app URL. */
export function apiUrlOf(input: string, docPathname: string): AppUrl | null {
  let u: URL
  try {
    u = new URL(input, 'file:///__piste__/')
  } catch {
    return null
  }
  if (input.startsWith('/api/') || (u.protocol === 'file:' && u.pathname.startsWith('/api/') && u.pathname !== docPathname)) {
    return { pathname: u.pathname, search: u.search, section: '' }
  }
  if (u.origin === ORIGIN && u.pathname.startsWith('/api/')) return { pathname: u.pathname, search: u.search, section: '' }
  return null
}
