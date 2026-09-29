/**
 * GET  /signin — the sign-in page (or "sign-in is off" / the configuration error). Signed-in visitors go straight on.
 * POST /signin — form post: same-origin only, rate-limited in memory, constant-time passcode check; on success a
 *                signed httpOnly session cookie and a 303 to `next` (a same-origin path only).
 *
 * A Route Handler rather than a page on purpose: pages render inside the root layout, which shows personal data in
 * the navigation. See ./render.ts.
 */
import { NextResponse, type NextRequest } from 'next/server'
import {
  authConfig,
  clientAddress,
  isHttps,
  isSameOriginPost,
  MAX_PASSCODE_INPUT,
  passcodeMatches,
  safeNextPath,
  SESSION_COOKIE,
  sessionCookieOptions,
  signInLimiter,
  signSession,
  verifySession,
} from '@/lib/auth'
import { renderSignInPage, SIGNIN_HEADERS, type SignInView } from './render'

const NOTICES = new Set(['invalid', 'locked', 'signed-out', 'origin', 'bad-request'])
/** Slows down guessing a little without making a mistyped passcode painful. */
const FAILURE_DELAY_MS = 400

function page(view: SignInView, status = 200): Response {
  return new Response(renderSignInPage(view), { status, headers: SIGNIN_HEADERS })
}

/** 303 to a same-origin path (relative Location, so it is right behind any reverse proxy). */
function seeOther(location: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location, 'cache-control': 'no-store' } })
}

function backToForm(notice: string, next: string): NextResponse {
  const q = new URLSearchParams({ e: notice })
  if (next !== '/') q.set('next', next)
  return seeOther(`/signin?${q.toString()}`)
}

export async function GET(request: NextRequest) {
  const cfg = authConfig()
  const params = request.nextUrl.searchParams
  const next = safeNextPath(params.get('next'))
  if (cfg.state === 'off') return page({ kind: 'off', next })
  if (cfg.state === 'misconfigured') return page({ kind: 'misconfigured', problem: cfg.problem }, 503)

  const nowSec = Math.floor(Date.now() / 1000)
  if (verifySession(cfg, request.cookies.get(SESSION_COOKIE)?.value, nowSec).ok) return seeOther(next)

  // The lock is re-read from the limiter so a reload shows the real remaining time (or clears it).
  const limit = signInLimiter().check(clientAddress(request.headers), Date.now())
  const asked = params.get('e')
  const notice = !limit.allowed ? 'locked' : asked && NOTICES.has(asked) && asked !== 'locked' ? (asked as Extract<SignInView, { kind: 'form' }>['notice']) : null
  return page({ kind: 'form', next, notice, retryAfterSec: limit.allowed ? null : limit.retryAfterSec }, limit.allowed ? 200 : 429)
}

export async function POST(request: NextRequest) {
  const cfg = authConfig()
  if (cfg.state === 'misconfigured') return page({ kind: 'misconfigured', problem: cfg.problem }, 503)

  let passcode: FormDataEntryValue | null = null
  let next = '/'
  try {
    const form = await request.formData()
    passcode = form.get('passcode')
    next = safeNextPath(typeof form.get('next') === 'string' ? (form.get('next') as string) : null)
  } catch {
    return backToForm('bad-request', '/')
  }
  if (cfg.state === 'off') return seeOther(next)
  if (!isSameOriginPost(request.headers)) return backToForm('origin', next)

  const limiter = signInLimiter()
  const client = clientAddress(request.headers)
  const limit = limiter.check(client, Date.now())
  if (!limit.allowed) return backToForm('locked', next)

  if (typeof passcode !== 'string' || passcode.length > MAX_PASSCODE_INPUT || !passcodeMatches(cfg, passcode)) {
    limiter.fail(client, Date.now())
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS))
    return backToForm('invalid', next)
  }

  limiter.succeed(client)
  const res = seeOther(next)
  res.cookies.set(SESSION_COOKIE, signSession(cfg, Math.floor(Date.now() / 1000)), sessionCookieOptions(isHttps(request.url, request.headers.get('x-forwarded-proto'))))
  return res
}
