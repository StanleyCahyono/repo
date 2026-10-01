/**
 * The self-hosted fonts (OFL, licences in src/fonts/) for the sign-in page, which is served without the app's
 * build assets. Only the files the page declares are served.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { SIGNIN_FONT_FILES } from '../../render'

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params
  if (!SIGNIN_FONT_FILES.includes(file)) return new Response('Not found', { status: 404 })
  try {
    const body = await fs.readFile(path.join(process.cwd(), 'src', 'fonts', file))
    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': 'font/woff2',
        'cache-control': 'public, max-age=604800',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
