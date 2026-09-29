/**
 * next/link for the single-file build. Renders a real <a> whose href works when opened in a new tab
 * (`index.html?query#/path`), and turns plain left clicks into client navigations like Next's Link.
 */
import { useContext, type AnchorHTMLAttributes, type MouseEvent, type ReactNode, type Ref } from 'react'
import { UrlContext } from '../runtime/contexts'
import { currentAppUrl, go } from '../runtime/router'
import { isApiPath, resolveAppUrl, toRealHref } from '../runtime/url'

interface UrlObject {
  pathname?: string | null
  query?: Record<string, string | number | boolean | readonly (string | number | boolean)[] | null | undefined> | string | null
  search?: string | null
  hash?: string | null
  href?: string | null
}

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string | UrlObject
  replace?: boolean
  scroll?: boolean
  prefetch?: boolean | null | 'auto'
  shallow?: boolean
  passHref?: boolean
  legacyBehavior?: boolean
  locale?: string | false
  onNavigate?: (e: { preventDefault: () => void }) => void
  ref?: Ref<HTMLAnchorElement>
  children?: ReactNode
}

export function formatHref(href: string | UrlObject): string {
  if (typeof href === 'string') return href
  if (href.href) return href.href
  let search = href.search ?? ''
  if (!search && href.query) {
    if (typeof href.query === 'string') search = href.query
    else {
      const p = new URLSearchParams()
      for (const [k, v] of Object.entries(href.query)) {
        if (v === null || v === undefined) continue
        if (Array.isArray(v)) for (const x of v) p.append(k, String(x))
        else p.append(k, String(v))
      }
      search = p.toString()
    }
  }
  if (search && !search.startsWith('?')) search = `?${search}`
  const hash = href.hash ? (href.hash.startsWith('#') ? href.hash : `#${href.hash}`) : ''
  return `${href.pathname ?? ''}${search}${hash}`
}

const modified = (e: MouseEvent) => e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

export default function Link({ href, replace, scroll, prefetch: _prefetch, shallow: _shallow, passHref: _passHref, legacyBehavior: _legacy, locale: _locale, onNavigate, onClick, ref, children, ...rest }: LinkProps) {
  const current = useContext(UrlContext) ?? currentAppUrl()
  const raw = formatHref(href)
  const resolved = resolveAppUrl(raw, current, window.location)
  const internal = resolved.kind === 'app' && !isApiPath(resolved.url.pathname)
  const realHref = resolved.kind === 'app' ? (internal ? toRealHref(resolved.url, window.location) : raw) : resolved.href

  return (
    <a
      {...rest}
      ref={ref}
      href={realHref}
      data-app-href={internal ? raw : undefined}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || !internal) return
        if (modified(e) || (rest.target && rest.target !== '_self') || rest.download !== undefined) return
        let prevented = false
        onNavigate?.({ preventDefault: () => (prevented = true) })
        e.preventDefault()
        if (prevented) return
        void go(raw, replace ? 'replace' : 'push', scroll !== false)
      }}
    >
      {children}
    </a>
  )
}
