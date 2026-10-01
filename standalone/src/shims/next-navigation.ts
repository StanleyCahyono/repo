/** next/navigation for the single-file build: hooks read the router's URL context; notFound/redirect throw. */
import { useContext, useMemo } from 'react'
import { ParamsContext, UrlContext } from '../runtime/contexts'
import { NotFoundError, RedirectError, isNotFoundError, isRedirectError } from '../runtime/errors'
import { appRouter, currentAppUrl } from '../runtime/router'

/** URLSearchParams that refuses mutation, like Next's ReadonlyURLSearchParams. */
export class ReadonlyURLSearchParams extends URLSearchParams {
  append(): void {
    throw new Error('Method unavailable on `ReadonlyURLSearchParams`.')
  }
  delete(): void {
    throw new Error('Method unavailable on `ReadonlyURLSearchParams`.')
  }
  set(): void {
    throw new Error('Method unavailable on `ReadonlyURLSearchParams`.')
  }
  sort(): void {
    throw new Error('Method unavailable on `ReadonlyURLSearchParams`.')
  }
}

function useUrl() {
  return useContext(UrlContext) ?? currentAppUrl()
}

export function useRouter() {
  return appRouter
}

export function usePathname(): string {
  return useUrl().pathname
}

export function useSearchParams(): ReadonlyURLSearchParams {
  const search = useUrl().search
  return useMemo(() => new ReadonlyURLSearchParams(search), [search])
}

export function useParams<T extends Record<string, string | string[]> = Record<string, string>>(): T {
  return useContext(ParamsContext) as T
}

export function useSelectedLayoutSegment(): string | null {
  return null
}

export function useSelectedLayoutSegments(): string[] {
  return []
}

export function notFound(): never {
  throw new NotFoundError()
}

export enum RedirectType {
  push = 'push',
  replace = 'replace',
}

export function redirect(url: string, type: RedirectType | 'push' | 'replace' = 'replace'): never {
  throw new RedirectError(url, type === 'push' ? 'push' : 'replace')
}

export function permanentRedirect(url: string, type: RedirectType | 'push' | 'replace' = 'replace'): never {
  throw new RedirectError(url, type === 'push' ? 'push' : 'replace')
}

export function forbidden(): never {
  throw new Error('Forbidden')
}

export function unauthorized(): never {
  throw new Error('Unauthorized')
}

export function unstable_rethrow(error: unknown): void {
  if (isNotFoundError(error) || isRedirectError(error)) throw error
}
