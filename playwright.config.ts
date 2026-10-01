import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end journeys (e2e/) against a production build.
 *
 *   NEXT_DIST_DIR=.next npx next build
 *   PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e
 *
 * - The web server is `next start` on E2E_PORT (3100) serving the build in E2E_DIST_DIR (.next — the same directory
 *   `NEXT_DIST_DIR=.next npx next build` writes; next.config.ts reads NEXT_DIST_DIR).
 * - Data lives in PISTE_DATA_DIR (./data/e2e). e2e/global-setup.ts recreates it before every run: migrations and the
 *   catalog seed for live mode, and the demo generator for demo mode (simulated Fri 15 Jan 2027).
 * - Playwright starts the web server BEFORE global setup, so the readiness probe uses /icon.svg (a static file that
 *   never opens the database); the first page request opens the freshly seeded files. For the same reason a server
 *   is never reused unless E2E_REUSE_SERVER=1 (then global setup keeps the existing data as well).
 * - Optional API keys are blanked (journey 7), and the server's outbound HTTP goes through a closed local proxy
 *   port, so every live provider fails fast and deterministically (journey 8), with or without network access.
 * - Projects: every journey runs on desktop (1440×900); tests tagged @mobile also run on a phone (390×844, touch),
 *   and @phone-only tests (the 390 px sweep of every screen) run only there.
 * - Uses the pre-installed Chromium when PLAYWRIGHT_CHROMIUM_PATH is set, otherwise Playwright's managed browser.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined
const port = Number(process.env.E2E_PORT ?? 3100)
const distDir = process.env.E2E_DIST_DIR ?? '.next'
const reuse = process.env.E2E_REUSE_SERVER === '1'
const root = path.dirname(fileURLToPath(import.meta.url))
// Shared with e2e/global-setup.ts (same process) and the web server.
process.env.PISTE_DATA_DIR = path.resolve(root, process.env.PISTE_DATA_DIR ?? 'data/e2e')
const deadProxy = 'http://127.0.0.1:9'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    // Screenshots and dates in the browser follow the app, not the machine running the tests.
    locale: 'en-US',
    timezoneId: 'America/New_York',
    launchOptions: executablePath ? { executablePath } : {},
    // The browser reaches only the app: every other host (map tiles, styles) goes to a closed proxy port and fails
    // at once. Map tiles and live providers are blocked in the sandbox anyway; this makes it deterministic.
    proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1,localhost' },
  },
  webServer: {
    command: `npx next start --port ${port} --hostname 127.0.0.1`,
    cwd: root,
    url: `http://127.0.0.1:${port}/icon.svg`,
    reuseExistingServer: reuse,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      PISTE_DATA_DIR: process.env.PISTE_DATA_DIR,
      PISTE_DB_FILE: '',
      NEXT_DIST_DIR: distDir,
      NEXT_TELEMETRY_DISABLED: '1',
      // Quiet Node's "EnvHttpProxyAgent is experimental" warning (see the proxy settings below).
      NODE_NO_WARNINGS: '1',
      // Journey 7: no optional credentials, no sign-in, the real clock in live mode.
      DUFFEL_ACCESS_TOKEN: '',
      ORS_API_KEY: '',
      OPEN_METEO_API_KEY: '',
      PISTE_PASSCODE: '',
      PISTE_SESSION_SECRET: '',
      PISTE_FIXED_NOW: '',
      PISTE_DISABLED_PROVIDERS: '',
      // Journey 8: every upstream is unreachable (connection refused at a closed local port).
      NODE_USE_ENV_PROXY: '1',
      HTTPS_PROXY: deadProxy,
      HTTP_PROXY: deadProxy,
      https_proxy: deadProxy,
      http_proxy: deadProxy,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    },
  },
  projects: [
    { name: 'desktop', grepInvert: /@phone-only/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', grep: /@mobile|@phone-only/, use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
})
