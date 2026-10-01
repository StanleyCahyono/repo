/**
 * Control-flow errors thrown by the next/navigation shim, matching Next's digests so any code that inspects them
 * (e.g. `unstable_rethrow` patterns) behaves the same.
 */

export class NotFoundError extends Error {
  readonly digest = 'NEXT_HTTP_ERROR_FALLBACK;404'
  constructor() {
    super('NEXT_HTTP_ERROR_FALLBACK;404')
    this.name = 'NotFoundError'
  }
}

export class RedirectError extends Error {
  readonly digest: string
  constructor(
    readonly url: string,
    readonly type: 'push' | 'replace',
  ) {
    super('NEXT_REDIRECT')
    this.name = 'RedirectError'
    this.digest = `NEXT_REDIRECT;${type};${url};307;`
  }
}

export const isNotFoundError = (e: unknown): e is NotFoundError => e instanceof NotFoundError || (e as { digest?: string } | null)?.digest === 'NEXT_HTTP_ERROR_FALLBACK;404'
export const isRedirectError = (e: unknown): e is RedirectError => e instanceof RedirectError
