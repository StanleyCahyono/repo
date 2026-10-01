/**
 * POST /signin/signout — clears the session cookie on this browser and returns to /signin.
 * Same-origin form posts only (a cross-site page cannot sign you out). GET changes nothing and just redirects.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { authConfig, isHttps, isSameOriginPost, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth'

function seeOther(location: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location, 'cache-control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  if (!isSameOriginPost(request.headers)) return seeOther('/signin?e=origin')
  const res = seeOther(authConfig().state === 'on' ? '/signin?e=signed-out' : '/')
  // Expire the cookie with the same attributes it was set with.
  res.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(isHttps(request.url, request.headers.get('x-forwarded-proto')), 0))
  return res
}

export async function GET() {
  return seeOther('/signin')
}
