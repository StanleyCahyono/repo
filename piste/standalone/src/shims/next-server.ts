/** next/server for the single-file build: just enough for the API route handlers to run in the browser. */
import { cookieStore } from './next-headers'

export class NextRequest extends Request {
  readonly nextUrl: URL
  readonly cookies = cookieStore
  constructor(input: string | URL | Request, init?: RequestInit) {
    super(input, init)
    this.nextUrl = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
  }
}

export class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit): NextResponse {
    const headers = new Headers(init?.headers)
    if (!headers.has('content-type')) headers.set('content-type', 'application/json')
    return new NextResponse(JSON.stringify(body), { ...init, headers })
  }
  static redirect(url: string | URL, init?: number | ResponseInit): NextResponse {
    const status = typeof init === 'number' ? init : (init?.status ?? 307)
    const headers = new Headers(typeof init === 'object' ? init.headers : undefined)
    headers.set('location', String(url))
    return new NextResponse(null, { status, headers })
  }
  static next(init?: ResponseInit): NextResponse {
    return new NextResponse(null, init)
  }
  static rewrite(_url: string | URL, init?: ResponseInit): NextResponse {
    return new NextResponse(null, init)
  }
}

export function after(fn: () => unknown): void {
  setTimeout(() => void fn(), 0)
}

export function connection(): Promise<void> {
  return Promise.resolve()
}
