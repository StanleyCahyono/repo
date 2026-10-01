/**
 * Serves MapLibre's web-worker modules from the installed package, same-origin.
 *
 * MapLibre 6 locates its worker next to its own script via import.meta.url. Under Turbopack that URL is not an
 * http(s) address, so MapLibre would fall back to loading the page itself as a worker and never draw tiles.
 * The map component calls setWorkerUrl('/vendor/maplibre/maplibre-gl-worker.mjs'); the worker then imports
 * './maplibre-gl-shared.mjs', which resolves to this route too. Serving from node_modules keeps the worker in
 * lockstep with the installed library version.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const FILES = new Set(['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'])

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params
  if (!FILES.has(file)) return new Response('Not found', { status: 404 })
  try {
    const body = await fs.readFile(path.join(process.cwd(), 'node_modules', 'maplibre-gl', 'dist', file))
    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'public, max-age=86400',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return new Response('MapLibre worker not installed', { status: 404 })
  }
}
