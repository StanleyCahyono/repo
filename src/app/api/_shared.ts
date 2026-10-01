/** Helpers shared by the API route handlers (not a route: only route.ts files are routable). */
import 'server-only'

/**
 * Refuse cross-site browser requests to mutating endpoints. Non-browser clients (curl, cron) send no Origin and pass
 * this check. These handlers do no authentication of their own: like every route, they rely on the passcode proxy
 * in src/proxy.ts (enabled when PISTE_PASSCODE is set) for access control.
 */
export function isSameOrigin(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = request.headers.get('origin')
  if (!origin) return true
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error, ...extra }, { status, headers: { 'cache-control': 'no-store' } })
}

export function download(body: string, contentType: string, disposition: string): Response {
  return new Response(body, {
    headers: {
      'content-type': contentType,
      'content-disposition': disposition,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
