import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end journeys (e2e/). Uses the pre-installed Chromium when PLAYWRIGHT_CHROMIUM_PATH is set,
 * otherwise Playwright's managed browser.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined
const port = Number(process.env.E2E_PORT ?? 3100)

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: `npx next start --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { PISTE_DATA_DIR: process.env.PISTE_DATA_DIR ?? './data/e2e' },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
})
