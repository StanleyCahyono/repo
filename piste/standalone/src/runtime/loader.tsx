/**
 * Route loader: runs a URL's async server components (layouts outer → inner and the page, concurrently like the RSC
 * renderer) in the browser and turns the results into a `Resolved` tree for <Outlet>. notFound() and thrown errors
 * are routed to the nearest not-found.tsx / error.tsx with the App Router's rules: a layout's own failure is caught
 * by its PARENT's boundary, a page's by its own segment's boundary.
 */
import { Children, createElement, isValidElement, type ComponentType, type ReactElement, type ReactNode } from 'react'
import type { RouteModule, RouteNodeDef } from 'virtual:piste/routes'
import { isNotFoundError, isRedirectError } from './errors'
import { Outlet, type Resolved } from './outlet'
import type { ErrorComponent } from './route-types'
import { refresh } from './router'
import { matchRoute, rootNode } from './routes'
import { searchRecord, type AppUrl } from './url'

let seq = 0

type Kind = 'layout' | 'page'

async function render(node: RouteNodeDef, kind: Kind, props: Record<string, unknown>): Promise<ReactNode> {
  const mod = node[kind] as RouteModule
  const C = mod.default as ((p: Record<string, unknown>) => ReactNode | Promise<ReactNode>) | undefined
  if (typeof C !== 'function') return null
  if (node.client?.[kind]) return createElement(C as ComponentType<Record<string, unknown>>, props)
  return await C(props)
}

type Settled = { ok: true; value: ReactNode } | { ok: false; error: unknown }
const settle = (p: Promise<ReactNode>): Promise<Settled> => p.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))

function titleFrom(t: unknown, template: { default: string; template: string }): string | null {
  if (typeof t === 'string') return template.template.replace('%s', t)
  if (t && typeof t === 'object') {
    const o = t as { absolute?: string; default?: string }
    if (o.absolute) return o.absolute
    if (o.default) return o.default
  }
  return null
}

function rootTemplate(): { default: string; template: string } {
  const t = rootNode.layout?.metadata?.title as { default?: string; template?: string } | string | undefined
  if (t && typeof t === 'object') return { default: t.default ?? 'Piste', template: t.template ?? '%s' }
  return { default: typeof t === 'string' ? t : 'Piste', template: '%s' }
}

function unwrapHtml(el: ReactNode): { html: Resolved['html']; body: ReactNode } {
  if (isValidElement(el) && el.type === 'html') {
    const props = (el as ReactElement<Record<string, unknown>>).props
    const kids = Children.toArray(props.children as ReactNode)
    const bodyEl = kids.find((k) => isValidElement(k) && k.type === 'body') as ReactElement<{ children?: ReactNode }> | undefined
    return {
      html: { lang: props.lang as string | undefined, theme: props['data-theme'] as string | undefined, className: props.className as string | undefined },
      body: bodyEl ? bodyEl.props.children : (props.children as ReactNode),
    }
  }
  return { html: {}, body: el }
}

function errorElement(node: RouteNodeDef, error: unknown): ReactNode {
  const E = node.error!.default as ErrorComponent
  const err = error instanceof Error ? error : new Error(String(error))
  const again = () => void refresh()
  return createElement(E, { error: err, reset: again, retry: again })
}

export class FatalRouteError extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'FatalRouteError'
  }
}

export async function loadRoute(url: AppUrl): Promise<Resolved> {
  const id = ++seq
  const match = matchRoute(url.pathname)
  const chain = match?.chain ?? [rootNode]
  const segments = match?.segments ?? ['']
  const params = match?.params ?? {}
  const sp = searchRecord(url.search)
  const paramsUpTo = (i: number) => {
    const out: Record<string, string> = {}
    for (let j = 1; j <= i; j++) {
      const n = chain[j]
      if (n.param && n.param in params) out[n.param] = params[n.param]
    }
    return out
  }

  const layoutTasks = chain.map((node, i) => (node.layout ? settle(render(node, 'layout', { children: <Outlet level={i} />, params: Promise.resolve(paramsUpTo(i)) })) : Promise.resolve<Settled>({ ok: true, value: undefined })))
  const leaf = chain[chain.length - 1]
  const pageTask: Promise<Settled> = match
    ? settle(render(leaf, 'page', { params: Promise.resolve(params), searchParams: Promise.resolve(sp) }))
    : Promise.resolve({ ok: false, error: new NotFoundMarker() })
  const metaTask = (async () => {
    if (!match) return null
    const mod = leaf.page as RouteModule
    try {
      if (typeof mod.generateMetadata === 'function') return (await mod.generateMetadata({ params: Promise.resolve(params), searchParams: Promise.resolve(sp) }))?.title ?? null
      return mod.metadata?.title ?? null
    } catch {
      return null
    }
  })()

  const [layouts, page, pageTitle] = await Promise.all([Promise.all(layoutTasks), pageTask, metaTask])

  // Redirects anywhere win.
  for (const r of [...layouts, page]) {
    if (!r.ok && isRedirectError(r.error)) {
      return { ...empty(id, url, chain, segments, params), redirect: { url: r.error.url, type: r.error.type } }
    }
  }

  const root = layouts[0]
  if (!root.ok) throw new FatalRouteError(root.error)
  const { html, body } = unwrapHtml(root.value)

  let cut: Resolved['cut'] = null
  let status = 200
  let notFoundNode: RouteNodeDef | null = null
  const catchAt = (from: number, error: unknown) => {
    const nf = isNotFoundError(error) || error instanceof NotFoundMarker
    for (let j = from; j >= 0; j--) {
      const n = chain[j]
      if (nf && n.notFound?.default) {
        notFoundNode = n
        status = 404
        return { level: j, element: createElement(n.notFound.default as ComponentType) }
      }
      if (!nf && n.error?.default) {
        status = 500
        return { level: j, element: errorElement(n, error) }
      }
    }
    throw new FatalRouteError(error)
  }
  for (let i = 1; i < layouts.length && !cut; i++) {
    const r = layouts[i]
    if (!r.ok) cut = catchAt(i - 1, r.error)
  }
  if (!cut && !page.ok) cut = catchAt(chain.length - 1, page.error)
  if (!cut && !page.ok) throw new FatalRouteError(page.error)

  const template = rootTemplate()
  let title: string | null = null
  if (status === 404) {
    const nfNode = notFoundNode as RouteNodeDef | null
    title = titleFrom(nfNode?.notFound?.metadata?.title, template) ?? titleFrom(pageTitle, template) ?? titleFrom(rootNode.notFound?.metadata?.title, template)
  } else if (status === 200) title = titleFrom(pageTitle, template)

  return {
    id,
    url,
    chain,
    segments,
    params,
    layouts: layouts.map((r) => (r.ok ? r.value : undefined)),
    page: page.ok ? page.value : null,
    cut,
    body,
    html,
    title: title ?? template.default,
    status,
    redirect: null,
  }
}

class NotFoundMarker extends Error {}

function empty(id: number, url: AppUrl, chain: RouteNodeDef[], segments: string[], params: Record<string, string>): Resolved {
  return { id, url, chain, segments, params, layouts: [], page: null, cut: null, body: null, html: {}, title: '', status: 307, redirect: null }
}

/** The nearest loading.tsx for a URL (deepest on its chain), for navigations that take a while. */
export function loadingElementFor(url: AppUrl): ReactNode | null {
  const m = matchRoute(url.pathname)
  if (!m) return null
  for (let i = m.chain.length - 1; i >= 0; i--) {
    const l = m.chain[i].loading?.default
    if (typeof l === 'function') return createElement(l as ComponentType)
  }
  return null
}
