/**
 * Serves the app's own binary assets (src/assets: the Today hero art and the avatar body), same-origin, so nothing
 * loads from a CDN at runtime. Only plain file names in src/assets are served (ASSET_NAME: no paths). The single-file build inlines the
 * same files as data URLs instead (standalone/src/shims/assets.ts).
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { ASSET_NAME } from '@/lib/ui/assets'

const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', glb: 'model/gltf-binary', svg: 'image/svg+xml' }

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params
  if (!ASSET_NAME.test(file)) return new Response('Not found', { status: 404 })
  try {
    const body = await fs.readFile(path.join(process.cwd(), 'src', 'assets', file))
    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': TYPES[file.split('.').pop() ?? ''] ?? 'application/octet-stream',
        'cache-control': 'public, max-age=604800',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
