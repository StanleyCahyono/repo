/**
 * Shared test fixture for the journeys.
 *
 * - `mode`: 'live' (default) or 'demo'. Demo sets the `piste-mode=demo` cookie on the context before any navigation
 *   (demo "now" is Fri 15 Jan 2027, 09:00 in Ithaca).
 * - The browser can reach only the app (playwright.config.ts routes every other host to a closed proxy port): map
 *   tiles and live providers are unreachable in the sandbox anyway; this makes it deterministic everywhere and
 *   guarantees tests never touch the internet.
 * - An automatic guard fails the test on page errors (uncaught exceptions), hydration errors and any other app
 *   console error. Failed loads of non-app resources are ignored, and a test can allow a known message with
 *   `consoleErrors.allow(/pattern/)` (the 404 checks allow the document's own "404 (Not Found)").
 */
import { test as base, expect, type ConsoleMessage, type Page } from '@playwright/test'

export type Mode = 'live' | 'demo'

export interface ConsoleGuard {
  /** Tolerate console errors matching this pattern for the rest of the test. */
  allow: (pattern: RegExp) => void
  /** Unexpected errors so far. */
  readonly errors: string[]
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function isAppUrl(raw: string): boolean {
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('about:')) return true
  try {
    return LOCAL_HOSTS.has(new URL(raw).hostname)
  } catch {
    return true
  }
}

function describe(msg: ConsoleMessage): string {
  const where = msg.location()?.url
  return `${msg.text()}${where ? ` (at ${where})` : ''}`
}

export const test = base.extend<{ mode: Mode; consoleErrors: ConsoleGuard }>({
  mode: ['live', { option: true }],

  // Fixture callbacks name their second argument `provide`, not `use`, so React's hooks lint rule leaves them alone.
  context: async ({ context, mode, baseURL }, provide) => {
    if (mode === 'demo') await context.addCookies([{ name: 'piste-mode', value: 'demo', url: baseURL! }])
    await provide(context)
  },

  consoleErrors: [
    async ({ page }, provide) => {
      const allowed: RegExp[] = []
      const errors: string[] = []
      const record = (text: string) => {
        if (!allowed.some((re) => re.test(text))) errors.push(text)
      }
      page.on('pageerror', (err) => record(`Uncaught: ${err.message}`))
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return
        // A resource on another host that could not load (map tiles, styles): expected without network.
        const where = msg.location()?.url ?? ''
        if (!isAppUrl(where) && /Failed to load resource|net::ERR_/.test(msg.text())) return
        record(describe(msg))
      })
      await provide({
        allow: (pattern) => {
          allowed.push(pattern)
          // Drop anything already recorded that the new pattern covers.
          for (let i = errors.length - 1; i >= 0; i--) if (pattern.test(errors[i])) errors.splice(i, 1)
        },
        get errors() {
          return errors
        },
      })
      expect(errors, 'unexpected console errors or page errors').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

/** Switch an existing page's context to demo or live data (cookie only; navigate afterwards). */
export async function setMode(page: Page, mode: Mode, baseURL: string) {
  const ctx = page.context()
  await ctx.clearCookies({ name: 'piste-mode' })
  if (mode === 'demo') await ctx.addCookies([{ name: 'piste-mode', value: 'demo', url: baseURL }])
}
