#!/usr/bin/env node
/**
 * Build the single-file Piste: standalone/index.html (npm run standalone).
 *
 * The file is a BUILD TARGET of the Next app's own source — src/app routes, src/components, src/lib — bundled with
 * esbuild for the browser. Next APIs, the database client and Node built-ins are swapped for browser shims
 * (standalone/src/shims, standalone/src/db); a few server-only sentences are rewritten at bundle time so they stay
 * honest in a single file (PATCHES below). CSS (Tailwind, from src/app/globals.css), fonts, the SQLite WebAssembly
 * binary, the catalog and MapLibre's worker are all inlined. Nothing under src/ is modified.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SRC = path.join(ROOT, 'src')
const APP = path.join(SRC, 'app')
const OUT = path.join(HERE, 'index.html')
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'piste-standalone')
const shim = (f) => path.join(HERE, 'src', 'shims', f)
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')
const sha256 = (s) => createHash('sha256').update(s).digest('hex')

const started = Date.now()
const warnings = []
const warn = (m) => {
  warnings.push(m)
  console.warn(`  ! ${m}`)
}
fs.mkdirSync(CACHE, { recursive: true })

/** Environment of the browser build (process.env in the bundle). */
const ENV = {
  NODE_ENV: 'production',
  PISTE_STANDALONE: '1',
  // Browsers cannot read other sites' pages (CORS): official report parsers and the link checker. Duffel needs a secret.
  PISTE_DISABLED_PROVIDERS: 'alta-official,greek-peak-official,link-check,duffel',
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. Fonts: evaluate src/app/fonts.ts with a capturing next/font/local, then emit @font-face rules with base64 woff2.

async function buildFonts() {
  const entry = `export * as fonts from ${JSON.stringify(path.join(APP, 'fonts.ts'))}\nexport { fontNames } from ${JSON.stringify(shim('next-font-local.ts'))}\n`
  const out = path.join(CACHE, 'fonts.mjs')
  await esbuild.build({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: out,
    logLevel: 'silent',
    plugins: [
      {
        name: 'capture-local-font',
        setup(b) {
          b.onResolve({ filter: /^next\/font\/local$/ }, () => ({ path: 'capture', namespace: 'font-capture' }))
          b.onLoad({ filter: /.*/, namespace: 'font-capture' }, () => ({ contents: 'export default (options) => ({ __options: options })', loader: 'js' }))
        },
      },
    ],
  })
  const mod = await import(`${pathToFileURL(out).href}?t=${Date.now()}`)
  const css = []
  const htmlClasses = []
  for (const [name, value] of Object.entries(mod.fonts)) {
    const options = value?.__options
    if (!options) continue
    const n = mod.fontNames(options)
    htmlClasses.push(n.variableClass)
    const srcs = typeof options.src === 'string' ? [{ path: options.src }] : options.src
    for (const s of srcs) {
      const file = path.resolve(APP, s.path)
      const b64 = fs.readFileSync(file).toString('base64')
      css.push(
        `@font-face{font-family:'${n.family}';src:url(data:font/woff2;base64,${b64}) format('woff2');font-weight:${s.weight ?? options.weight ?? 'normal'};font-style:${s.style ?? options.style ?? 'normal'};font-display:${options.display ?? 'swap'}}`,
      )
    }
    css.push(`.${n.variableClass}{${options.variable}:${n.stack}}`, `.${n.familyClass}{font-family:${n.stack}}`)
    console.log(`  font ${name}: ${srcs.length} files → ${options.variable}`)
  }
  return { css: css.join('\n'), htmlClasses }
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Embedded files: the curated catalog (read by the unchanged loadCatalog() through the node:fs shim).

function collectFiles() {
  const files = {}
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.json')) files[rel(p)] = JSON.stringify(JSON.parse(fs.readFileSync(p, 'utf8')))
    }
  }
  walk(path.join(ROOT, 'catalog'))
  const hash = sha256(Object.keys(files).sort().map((k) => `${k}\n${files[k]}`).join('\n')).slice(0, 16)
  return { files, hash }
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Migrations, exactly as drizzle's readMigrationFiles() reads them.

function collectMigrations() {
  const dir = path.join(ROOT, 'drizzle')
  const journal = JSON.parse(fs.readFileSync(path.join(dir, 'meta', '_journal.json'), 'utf8'))
  const migrations = journal.entries.map((e) => {
    const sql = fs.readFileSync(path.join(dir, `${e.tag}.sql`), 'utf8')
    return { tag: e.tag, when: e.when, hash: sha256(sql), statements: sql.split('--> statement-breakpoint') }
  })
  return { migrations, schemaId: sha256(migrations.map((m) => `${m.when}:${m.hash}`).join('|')).slice(0, 12) }
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Route table from src/app (pages, layouts, loading, error, not-found; API route handlers separately).

const ROUTE_FILES = { 'page.tsx': 'page', 'layout.tsx': 'layout', 'loading.tsx': 'loading', 'error.tsx': 'error', 'not-found.tsx': 'notFound' }
const SKIP_DIRS = new Set(['api', 'signin', 'vendor'])

const isClientFile = (file) => /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use client['"]/.test(fs.readFileSync(file, 'utf8'))

function buildRoutes() {
  const imports = []
  let n = 0
  const imp = (file) => {
    const id = `m${n++}`
    imports.push(`import * as ${id} from ${JSON.stringify(file)}`)
    return id
  }
  let pages = 0
  const node = (dir, segment, kind, param) => {
    const parts = [`segment: ${JSON.stringify(segment)}`, `kind: ${JSON.stringify(kind)}`]
    if (param) parts.push(`param: ${JSON.stringify(param)}`)
    const client = {}
    for (const [file, key] of Object.entries(ROUTE_FILES)) {
      const p = path.join(dir, file)
      if (!fs.existsSync(p)) continue
      parts.push(`${key}: ${imp(p)}`)
      if (isClientFile(p)) client[key] = true
      if (key === 'page') pages++
    }
    if (Object.keys(client).length) parts.push(`client: ${JSON.stringify(client)}`)
    const children = []
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('@')) continue
      if (kind === 'root' && SKIP_DIRS.has(e.name)) continue
      const child = path.join(dir, e.name)
      let m
      if ((m = /^\((.+)\)$/.exec(e.name))) children.push(node(child, e.name, 'group'))
      else if ((m = /^\[\.\.\.(.+)\]$/.exec(e.name))) children.push(node(child, e.name, 'catch-all', m[1]))
      else if ((m = /^\[(.+)\]$/.exec(e.name))) children.push(node(child, e.name, 'dynamic', m[1]))
      else children.push(node(child, e.name, 'static'))
    }
    parts.push(`children: [${children.join(', ')}]`)
    return `{ ${parts.join(', ')} }`
  }
  const tree = node(APP, '', 'root')

  const api = []
  const walkApi = (dir, urlPath) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walkApi(p, `${urlPath}/${e.name}`)
      else if (e.name === 'route.ts') api.push(`{ path: ${JSON.stringify(urlPath)}, module: ${imp(p)} }`)
    }
  }
  walkApi(path.join(APP, 'api'), '/api')
  console.log(`  routes: ${pages} pages, ${api.length} API routes`)
  return `${imports.join('\n')}\nexport const tree = ${tree}\nexport const apiRoutes = [${api.join(', ')}]\n`
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. MapLibre's web worker as one self-contained script (it imports a shared chunk; a Blob worker cannot).

async function buildMaplibreWorker() {
  const r = await esbuild.build({
    entryPoints: [path.join(ROOT, 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl-worker.mjs')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    minify: true,
    write: false,
    legalComments: 'none',
    logLevel: 'silent',
    target: 'es2022',
  })
  return r.outputFiles[0].text
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. Bundle-time source patches. Only text that is untrue in a single file (server, worker, npm scripts) and two
//    browser incompatibilities are touched; everything else is the app's own code. `required` patches fail the build
//    when they no longer apply; the others warn (the build then shows the server wording).

const words = (s) => new RegExp(s.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'))
const DATA_PANEL = path.join(HERE, 'src', 'runtime', 'data-panel.tsx')

const PATCHES = {
  'src/lib/providers/http.ts': {
    required: true,
    edits: [
      // The file refuses to load in a browser; in this build it is the browser's network layer.
      { find: /if \(typeof window !== 'undefined'\) \{\s*throw new Error\([^)]*\)\s*\}/, replace: '/* standalone: runs in the browser */' },
      // User-Agent triggers CORS preflights the public APIs do not all allow; the browser sends its own.
      { find: "const h: Record<string, string> = { 'User-Agent': userAgent(env.env()) }", replace: 'const h: Record<string, string> = {}' },
      { find: 'decoder.decode(Buffer.concat(chunks))', replace: 'decoder.decode(new Uint8Array(await new Blob(chunks as BlobPart[]).arrayBuffer()))' },
    ],
  },
  'src/components/map/resort-map.tsx': {
    required: true,
    edits: [
      // file:// has origin "null"; the maplibre shim ignores the path and starts its worker from a Blob.
      { find: 'setWorkerUrl(new URL(MAPLIBRE_WORKER_PATH, window.location.origin).href)', replace: 'setWorkerUrl(MAPLIBRE_WORKER_PATH)' },
    ],
  },
  'src/components/ui/offline-banner.tsx': {
    edits: [{ find: 'setLocal(isLocalHost(window.location.hostname))', replace: 'setLocal(true)' }],
  },
  'src/lib/data/sources.ts': {
    edits: [
      { find: 'Turned off (PISTE_DISABLED_PROVIDERS) — nothing is fetched', replace: 'Not available in the single-file version — nothing is fetched' },
      {
        find: "'The scheduler has never run. Start `npm run worker`, or call `npm run refresh` from cron.'",
        replace: "'The scheduler has never run. In the single-file version it runs in this browser tab while Piste is open, online and in live mode.'",
      },
      {
        find: /`No scheduler heartbeat for \$\{ageMinutes\} min\. A sleeping machine cannot collect data — run \\`npm run worker\\` on an always-on host or \\`npm run refresh\\` from cron\.`/,
        replace: '`No scheduler heartbeat for ${ageMinutes} min. The single-file version collects data only while this page is open and online.`',
      },
    ],
  },
  'src/components/sources/state.tsx': {
    edits: [
      {
        find: "disabled: { label: 'Disabled', tone: 'neutral', Icon: CircleSlash, hint: 'Turned off with PISTE_DISABLED_PROVIDERS; refresh jobs never call it.' }",
        replace:
          "disabled: { label: 'Not in this version', tone: 'neutral', Icon: CircleSlash, hint: 'Not available in the single-file version: a web page cannot read other sites’ pages (official reports, link checks) or keep an API secret (Duffel). Refresh jobs never call it.' }",
      },
    ],
  },
  'src/components/sources/status-board.tsx': {
    edits: [
      { find: "'No worker or cron pass has run yet.'", replace: "'Nothing has run in this browser yet.'" },
      { find: '`Worker heartbeat ${ago}.`', replace: '`Heartbeat ${ago} — collecting while this page is open.`' },
      { find: '`Last heartbeat ${ago}; the worker has stopped.`', replace: '`Last heartbeat ${ago}; nothing is collected while the page is closed.`' },
    ],
  },
  'src/components/sources/scheduler-panel.tsx': {
    edits: [
      { find: "'Long-running worker (npm run worker)'", replace: "'This browser tab, while Piste is open'" },
      { find: 'A sleeping machine cannot collect data', replace: 'A closed page cannot collect data' },
      {
        find: words(
          'Piste collects forecasts and reports with server-side jobs, never from your browser. While the computer running Piste sleeps or is off, nothing is fetched: forecasts published in that time are simply missing from history, and alerts wait until the next pass. For continuous collection, run the worker on an always-on machine.',
        ),
        replace:
          'In the single-file version Piste collects forecasts in this browser tab, only while the page is open, online and in live mode. While it is closed or the computer sleeps, nothing is fetched: forecasts published in that time are simply missing from history, and alerts wait until the next pass. For continuous collection, run the server version and its worker on an always-on machine.',
      },
      {
        element: { anchor: 'Always-on host', tag: 'div' },
        replace:
          '<div className="rounded-[12px] border border-divider bg-surface px-4 py-4 md:px-5"><p className="text-[14.5px] font-semibold text-ink">In this browser</p><p className="mt-1 text-[13px] text-ink-2">Every minute while this page is open, Piste checks which jobs are due and writes a heartbeat. The single-file version has no worker, cron or server.</p></div>',
      },
      { element: { anchor: '>Health check<', tag: 'dt' }, replace: '' },
      { element: { anchor: 'GET /api/health?strict=1', tag: 'dd' }, replace: '' },
    ],
  },
  'src/app/sources/page.tsx': {
    edits: [
      { find: 'meta="Refreshes run on the server, on a schedule — never in your browser."', replace: 'meta="In the single-file version, refreshes run in this browser tab on a schedule, while it is open."' },
    ],
  },
  'src/components/trips/flight-offers.tsx': {
    edits: [
      { find: "title: 'Flight offers connector is disabled'", replace: "title: 'Flight offers are not available in the single-file version'" },
      {
        find: "body: 'It is switched off on this server (PISTE_DISABLED_PROVIDERS). Use the search links and manual quotes.'",
        replace: "body: 'Live flight offers need a secret API key, which a file in your browser cannot keep. Use the search links and manual quotes.'",
      },
    ],
  },
  'src/components/settings/info-panels.tsx': {
    edits: [
      { element: { anchor: 'label="Backup & restore"', tag: 'SettingRow' }, replace: '<StandaloneBackupRow demo={demo} />', import: `import { StandaloneBackupRow } from ${JSON.stringify(DATA_PANEL)}` },
      {
        element: { anchor: 'Sign-in is off', tag: 'div' },
        replace:
          '<div className="px-4 py-4 md:px-5"><p className="flex items-center gap-2 text-[14.5px] font-semibold text-ink"><LockOpen aria-hidden className="size-4 text-ink-2" /> Not needed for this file</p><p className="mt-1 max-w-[68ch] text-[13.5px] text-ink-2">The single-file version runs only inside your browser: nothing is served to a network, so there is nothing to sign in to. Anyone who can use this browser profile can open your data.</p></div>',
      },
    ],
  },
  'src/app/settings/page.tsx': {
    edits: [{ find: 'meta="Optional passcode protection for a Piste reachable from other devices."', replace: 'meta="Passcode protection is for the server version; this file runs only in your browser."' }],
  },
  'src/components/season/export-panel.tsx': {
    edits: [
      { element: { anchor: 'aria-labelledby="backup-title"', tag: 'section' }, replace: '<StandaloneBackupSection demo={demo} />', import: `import { StandaloneBackupSection } from ${JSON.stringify(DATA_PANEL)}` },
    ],
  },
}

/** Index of the `>` that closes the opening tag starting at `start` (skips {…} expressions and quoted strings). */
function tagEnd(src, start) {
  let depth = 0
  let quote = null
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return i
  }
  return -1
}

/** Replace the innermost <tag>…</tag> element that contains `anchor`. */
function replaceElement(src, { anchor, tag }, replacement) {
  const at = src.indexOf(anchor)
  if (at < 0) return null
  const re = new RegExp(`<${tag}(?=[\\s>/])|</${tag}\\s*>`, 'g')
  const stack = []
  const pairs = []
  let m
  while ((m = re.exec(src))) {
    if (m[0].startsWith('</')) {
      const open = stack.pop()
      if (open !== undefined) pairs.push([open, m.index + m[0].length])
      continue
    }
    const end = tagEnd(src, m.index)
    if (end < 0) break
    if (src[end - 1] === '/') pairs.push([m.index, end + 1])
    else stack.push(m.index)
    re.lastIndex = end + 1
  }
  let best = null
  for (const [s, e] of pairs) if (s <= at && at < e && (!best || e - s < best[1] - best[0])) best = [s, e]
  if (!best) return null
  return src.slice(0, best[0]) + replacement + src.slice(best[1])
}

const applied = new Set()
function patchSource(file, src) {
  const spec = PATCHES[rel(file)]
  if (!spec) return src
  let out = src
  const imports = []
  spec.edits.forEach((e, i) => {
    let next = null
    if (e.element) next = replaceElement(out, e.element, e.replace)
    else if (typeof e.find === 'string') next = out.includes(e.find) ? out.replace(e.find, () => e.replace) : null
    else next = e.find.test(out) ? out.replace(e.find, () => e.replace) : null
    const label = `${rel(file)} patch ${i + 1}${e.element ? ` (<${e.element.tag}> with "${e.element.anchor}")` : ''}`
    if (next === null) {
      if (spec.required) throw new Error(`Required bundle patch no longer applies: ${label}. Update standalone/build.mjs.`)
      warn(`patch not applied (source changed?): ${label}`)
      return
    }
    out = next
    applied.add(label)
    if (e.import) imports.push(e.import)
  })
  return imports.length ? `${out}\n${imports.join('\n')}\n` : out
}

// ---------------------------------------------------------------------------------------------------------------------
// 7. Server actions: wrap every export of a 'use server' module (queueing, refresh-after-revalidate, redirect).

const USE_SERVER = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use server['"]/

function actionWrapper(file, src) {
  const names = [...src.matchAll(/^export\s+async\s+function\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1])
  const impl = JSON.stringify(`${file}?action-impl`)
  const runtime = JSON.stringify(path.join(HERE, 'src', 'runtime', 'actions.ts'))
  return [
    `import * as impl from ${impl}`,
    `import { wrapAction } from ${runtime}`,
    ...names.map((n) => `export const ${n} = wrapAction(impl.${n}, ${JSON.stringify(`${path.basename(file, '.ts')}.${n}`)})`),
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------------------------------------------------
// 8. The esbuild plugin that ties it together.

function pistePlugin({ routes, files, migrations, buildInfo, worker }) {
  const ALIASES = {
    'next/link': shim('next-link.tsx'),
    'next/navigation': shim('next-navigation.ts'),
    'next/headers': shim('next-headers.ts'),
    'next/cache': shim('next-cache.ts'),
    'next/server': shim('next-server.ts'),
    'next/dynamic': shim('next-dynamic.tsx'),
    'next/font/local': shim('next-font-local.ts'),
    next: shim('empty.ts'),
    'server-only': shim('empty.ts'),
    'client-only': shim('empty.ts'),
    '@libsql/client': shim('libsql-client.ts'),
    'node:fs': shim('node-fs.ts'),
    fs: shim('node-fs.ts'),
    'node:fs/promises': shim('node-fs-promises.ts'),
    'fs/promises': shim('node-fs-promises.ts'),
    'node:path': shim('node-path.ts'),
    path: shim('node-path.ts'),
    'node:crypto': shim('node-crypto.ts'),
    crypto: shim('node-crypto.ts'),
    'node:dns/promises': shim('node-dns.ts'),
    'dns/promises': shim('node-dns.ts'),
    'node:net': shim('node-net.ts'),
    net: shim('node-net.ts'),
    'maplibre-gl': shim('maplibre.ts'),
  }
  /** Whole-module replacements, matched on the resolved file. */
  const REDIRECTS = {
    [path.join(SRC, 'lib', 'db', 'client.ts')]: path.join(HERE, 'src', 'db', 'client.ts'),
    [path.join(SRC, 'lib', 'actions', 'mode.ts')]: path.join(HERE, 'src', 'runtime', 'mode-action.ts'),
  }
  const VIRTUAL = {
    'virtual:piste/routes': () => routes,
    'virtual:piste/files': () => `export const files = ${JSON.stringify(files)}`,
    'virtual:piste/migrations': () => `export const migrations = ${JSON.stringify(migrations)}`,
    'virtual:piste/build-info': () => `export const BUILD_INFO = ${JSON.stringify(buildInfo)}`,
    'virtual:piste/maplibre-worker': () => `export default ${JSON.stringify(worker)}`,
  }
  return {
    name: 'piste',
    setup(b) {
      b.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData?.pisteSkip) return undefined
        if (VIRTUAL[args.path]) return { path: args.path, namespace: 'piste-virtual' }
        if (ALIASES[args.path]) return { path: ALIASES[args.path] }
        if (args.path.endsWith('.css')) return { path: args.path, namespace: 'piste-empty' }
        if (args.path.endsWith('?action-impl')) return { path: args.path.slice(0, -'?action-impl'.length), namespace: 'piste-action-impl' }
        const alias = args.path.startsWith('@/')
        if (!alias && !args.path.startsWith('.') && !path.isAbsolute(args.path)) return undefined
        const r = await b.resolve(alias ? `./${args.path.slice(2)}` : args.path, {
          resolveDir: alias ? SRC : args.resolveDir,
          kind: args.kind,
          importer: args.importer,
          pluginData: { pisteSkip: true },
        })
        if (r.errors.length) return { errors: r.errors }
        if (REDIRECTS[r.path]) return { path: REDIRECTS[r.path] }
        return { path: r.path, namespace: r.namespace, sideEffects: r.sideEffects }
      })
      b.onLoad({ filter: /.*/, namespace: 'piste-virtual' }, (args) => ({ contents: VIRTUAL[args.path](), loader: 'js', resolveDir: ROOT }))
      b.onLoad({ filter: /.*/, namespace: 'piste-empty' }, () => ({ contents: '', loader: 'js' }))
      b.onLoad({ filter: /.*/, namespace: 'piste-action-impl' }, (args) => ({
        contents: patchSource(args.path, fs.readFileSync(args.path, 'utf8')),
        loader: 'ts',
        resolveDir: path.dirname(args.path),
      }))
      b.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
        if (!args.path.startsWith(SRC + path.sep)) return undefined
        const src = fs.readFileSync(args.path, 'utf8')
        const loader = args.path.endsWith('.tsx') ? 'tsx' : 'ts'
        if (args.path.startsWith(path.join(SRC, 'lib', 'actions') + path.sep) && USE_SERVER.test(src)) {
          return { contents: actionWrapper(args.path, src), loader: 'ts', resolveDir: path.dirname(args.path) }
        }
        return { contents: patchSource(args.path, src), loader }
      })
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// 9. CSS: Tailwind v4 over src/app/globals.css (the same input as the Next build), MapLibre's stylesheet, fonts.

async function buildCss(fontCss) {
  const input = fs.readFileSync(path.join(APP, 'globals.css'), 'utf8')
  // The generated page itself is not a source of class names.
  const sourceNot = `@source not ${JSON.stringify(path.relative(APP, OUT).split(path.sep).join('/'))};\n`
  const withNot = input.replace(/(@import\s+['"]tailwindcss['"];?\s*\n)/, `$1${sourceNot}`)
  const result = await postcss([tailwind({ base: ROOT, optimize: { minify: true } })]).process(withNot, { from: path.join(APP, 'globals.css') })
  const maplibreCss = fs.readFileSync(path.join(ROOT, 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl.css'), 'utf8')
  return `${fontCss}\n${result.css}\n${maplibreCss}`
}

// ---------------------------------------------------------------------------------------------------------------------

function bootHtml() {
  // Static start-up screen (React replaces it with the same markup once the app code runs).
  return `<div class="flex min-h-dvh items-center justify-center bg-canvas px-4" aria-busy="true"><div class="flex items-center gap-3 text-ink-2"><svg viewBox="0 0 32 32" aria-hidden="true" class="size-10 shrink-0"><rect width="32" height="32" rx="8" fill="var(--teal)"></rect><path d="M4 23.5 12.2 12l4.6 6 3.4-4.2L28 23.5" fill="none" stroke="var(--on-teal)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path></svg><div><p class="font-display text-[26px] leading-none text-ink">Piste</p><p role="status" class="mt-1 text-[13.5px]">Opening your data…</p></div></div></div>`
}

const escapeScript = (js) => js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')

async function main() {
  console.log("Building standalone/index.html")
  const lap = (s) => console.log(`  [${((Date.now() - started) / 1000).toFixed(1)}s] ${s}`)
  const [fonts, worker] = await Promise.all([buildFonts(), buildMaplibreWorker()])
  lap('fonts + worker')
  const { files, hash: catalogHash } = collectFiles()
  const { migrations, schemaId } = collectMigrations()
  const routes = buildRoutes()
  const buildInfo = { builtAt: new Date().toISOString(), schemaId, catalogHash }
  console.log(`  catalog: ${Object.keys(files).length} files (${catalogHash}); schema ${schemaId}; maplibre worker ${(worker.length / 1024).toFixed(0)} kB`)

  lap('routes')
  const js = await esbuild.build({
    entryPoints: [path.join(HERE, 'src', 'main.tsx')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: ['es2022', 'chrome111', 'firefox115', 'safari16.4'],
    minify: true,
    jsx: 'automatic',
    write: false,
    metafile: true,
    legalComments: 'none',
    charset: 'utf8',
    tsconfig: path.join(ROOT, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"', __PISTE_ENV__: JSON.stringify(ENV), global: 'globalThis' },
    inject: [shim('process.ts')],
    loader: { '.wasm': 'binary', '.sql': 'text' },
    logLevel: 'warning',
    plugins: [pistePlugin({ routes, files, migrations, buildInfo, worker })],
  })
  for (const w of js.warnings) warn(`esbuild: ${w.text}`)
  const code = js.outputFiles[0].text
  fs.writeFileSync(path.join(CACHE, 'meta.json'), JSON.stringify(js.metafile))

  lap('bundle')
  const css = await buildCss(fonts.css)
  lap('css')
  const icon = fs.readFileSync(path.join(APP, 'icon.svg'))
  const themeScript = `(function(){try{var t=localStorage.getItem('piste:standalone:theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}})()`

  const html = `<!doctype html>
<html lang="en" class="${fonts.htmlClasses.join(' ')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f5f1">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0c1a24">
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="Personal ski planning and tracking for the 2026–27 season.">
<meta name="generator" content="Piste single-file build ${buildInfo.builtAt} (schema ${schemaId})">
<title>Piste</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${icon.toString('base64')}">
<!-- Piste, single-file version. Bundles React, React DOM, Motion, Radix UI, lucide, Drizzle ORM, zod, Luxon, d3,
     sql.js (SQLite, public domain), MapLibre GL JS (BSD-3-Clause) and the IBM Plex and Barlow Condensed fonts (SIL OFL 1.1).
     Their licences are in node_modules and src/fonts of the Piste source. -->
<script>${themeScript}</script>
<style>${css}</style>
</head>
<body>
<div id="piste-root">${bootHtml()}</div>
<noscript><p style="padding:24px;font-family:system-ui,sans-serif">Piste needs JavaScript to run.</p></noscript>
<script>${escapeScript(code)}</script>
</body>
</html>
`
  fs.writeFileSync(OUT, html)

  // Wording from the server version that should not survive in the single file (a patch no longer applies).
  for (const phrase of ['npm run worker', 'server-side jobs, never from your browser', 'PISTE_DISABLED_PROVIDERS)']) {
    const count = code.split(phrase).length - 1
    if (count) warn(`bundle still contains "${phrase}" (${count}×)`)
  }
  const size = fs.statSync(OUT).size
  const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`
  console.log(`  js ${mb(code.length)}, css ${mb(css.length)}; ${applied.size} source patches applied`)
  console.log(`Wrote ${rel(OUT)} — ${mb(size)} in ${((Date.now() - started) / 1000).toFixed(1)} s${warnings.length ? ` with ${warnings.length} warning(s)` : ''}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
