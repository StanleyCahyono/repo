/**
 * Load `.env.local` then `.env` for CLI scripts (Next.js does this for the app; tsx scripts do not).
 * Existing environment variables always win. Import this first in every script.
 */
import fs from 'node:fs'
import path from 'node:path'

for (const name of ['.env.local', '.env']) {
  const file = path.join(process.cwd(), name)
  if (!fs.existsSync(file)) continue
  try {
    process.loadEnvFile(file)
  } catch (e) {
    console.warn(`Could not read ${name}: ${e instanceof Error ? e.message : String(e)}`)
  }
}
