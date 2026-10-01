/**
 * Optional passcode protection (brief §11), enforced before any route renders.
 *
 * - PISTE_PASSCODE unset (local use): a no-op.
 * - Set: every page, API route and Server Function needs a valid signed session cookie (src/lib/auth.ts). Pages
 *   redirect to /signin?next=…, APIs answer 401 JSON, Server Function calls and other non-GET requests answer 401.
 *   Only /signin (and its sign-out and font routes), Next's static assets, /icon.svg and the MapLibre worker files
 *   are public.
 * - Set without a usable PISTE_SESSION_SECRET: fail closed — pages show the configuration error from /signin (503),
 *   APIs answer 503 JSON. Piste never silently runs unprotected.
 *
 * The decision itself is the pure `decideProxy` (unit-tested in src/lib/auth.test.ts); this file only maps it to
 * responses. Next 16 runs proxy on the Node.js runtime, which the HMAC helpers rely on.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { authConfig, decideProxy, SESSION_COOKIE } from '@/lib/auth'

const NO_STORE = { 'cache-control': 'no-store' }

export function proxy(request: NextRequest) {
  const cfg = authConfig()
  if (cfg.state === 'off') return NextResponse.next()

  const { pathname, search } = request.nextUrl
  const decision = decideProxy(
    {
      pathname,
      search,
      method: request.method,
      isServerAction: request.headers.has('next-action'),
      sessionToken: request.cookies.get(SESSION_COOKIE)?.value,
    },
    cfg,
    Math.floor(Date.now() / 1000),
  )

  switch (decision.action) {
    case 'next':
      return NextResponse.next()
    case 'signin': {
      // Proxy responses need an absolute Location (Next parses it); derive it from the request's own URL so host,
      // port and base path are the ones the browser used.
      const url = request.nextUrl.clone()
      url.pathname = '/signin'
      url.search = decision.next === '/' ? '' : `?next=${encodeURIComponent(decision.next)}`
      return NextResponse.redirect(url, { status: 307, headers: NO_STORE })
    }
    case 'unauthorized-api':
      return NextResponse.json(
        { error: 'Sign-in required', signIn: '/signin' },
        { status: 401, headers: { ...NO_STORE, 'www-authenticate': 'Cookie realm="Piste"' } },
      )
    case 'unauthorized':
      return new NextResponse('Sign-in required. Open /signin in the browser, then try again.', {
        status: 401,
        headers: { 'content-type': 'text/plain; charset=utf-8', ...NO_STORE },
      })
    case 'misconfigured-api':
      return NextResponse.json(
        { error: 'Sign-in is misconfigured: PISTE_PASSCODE is set but PISTE_SESSION_SECRET is missing or too short. Piste refuses to run unprotected.' },
        { status: 503, headers: NO_STORE },
      )
    case 'misconfigured-page':
      // The sign-in route renders the configuration error (with a 503) for whatever URL was asked for.
      return NextResponse.rewrite(new URL('/signin', request.url))
  }
}

export const config = {
  // Everything except Next's static build output (public anyway). `_next/image`, APIs and unknown paths are included.
  matcher: ['/((?!_next/static/).*)'],
}
