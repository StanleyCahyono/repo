/** Helpers shared by the API route handlers (not a route: only route.ts files are routable). */
import 'server-only'

/**
 * Refuse cross-site browser requests to mutating endpoints. Non-browser clients (curl, cron) send no Origin and
 * are still subject to the app's sign-in when a passcode is configured.
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
