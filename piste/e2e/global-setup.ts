/**
 * Fresh, deterministic data for every e2e run (see playwright.config.ts):
 *   1. delete and recreate PISTE_DATA_DIR (default ./data/e2e — only a directory inside ./data is ever removed),
 *   2. live database: migrations + catalog seed (`npm run db:setup` semantics),
 *   3. demo database: the isolated demo generator (`npm run demo:seed`, simulated Fri 15 Jan 2027).
 *
 * Playwright starts the web server before this runs; its readiness probe never opens a database, so the first page
 * request opens these new files. With E2E_REUSE_SERVER=1 (a server you started yourself) the data is left as it is,
 * because deleting SQLite files under a running server would leave it reading the old ones.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function run(script: string, env: NodeJS.ProcessEnv) {
  execFileSync(path.join(root, 'node_modules', '.bin', 'tsx'), [script], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] })
}

export default async function globalSetup() {
  const dir = path.resolve(process.env.PISTE_DATA_DIR ?? path.join(root, 'data', 'e2e'))
  if (process.env.E2E_REUSE_SERVER === '1') {
    console.log(`[e2e] Reusing the running server and its data in ${dir}`)
    return
  }
  const dataRoot = path.join(root, 'data')
  if (path.dirname(dir) !== dataRoot || ['review', 'backups', 'backups-demo'].includes(path.basename(dir))) {
    throw new Error(`[e2e] Refusing to reset ${dir}: use a dedicated directory directly inside ${dataRoot} (default data/e2e)`)
  }
  const started = Date.now()
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  // Blank anything that could point the scripts at another database.
  const env: NodeJS.ProcessEnv = { ...process.env, PISTE_DATA_DIR: dir, PISTE_DB_FILE: '' }
  run('scripts/migrate.ts', env)
  run('scripts/seed.ts', env)
  run('scripts/seed-demo.ts', env)
  for (const file of ['piste.db', 'piste-demo.db']) {
    if (!fs.existsSync(path.join(dir, file))) throw new Error(`[e2e] ${file} was not created in ${dir}`)
  }
  console.log(`[e2e] Fresh live + demo data in ${path.relative(root, dir)} (${((Date.now() - started) / 1000).toFixed(1)} s)`)
}
