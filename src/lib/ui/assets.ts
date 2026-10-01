/**
 * URLs of the app's bundled binary assets (files in src/assets, served by src/app/assets/[file]/route.ts).
 * The single-file build swaps this module for data URLs (standalone/src/shims/assets.ts) — keep the names in sync.
 */
export const ASSET_FILES = ['greek-peak-hero.webp', 'skier-body.glb'] as const
export type AssetFile = (typeof ASSET_FILES)[number]

export function assetUrl(file: AssetFile): string {
  return `/assets/${file}`
}
