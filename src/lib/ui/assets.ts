/**
 * URLs of the app's bundled binary assets (files in src/assets, served by src/app/assets/[file]/route.ts).
 * The single-file build swaps this module for data URLs (standalone/src/shims/assets.ts) — keep both in sync.
 * Resort photos (scripts/build-resort-photos.mjs) are stored in the catalog as "asset:photo-<id>.webp".
 */
export const ASSET_FILES = ['greek-peak-hero.webp', 'greek-peak-duo.webp', 'greek-peak-ridge.svg', 'matterhorn-cut.webp', 'matterhorn-duo.webp', 'matterhorn-ridge.svg', 'skier-body.glb'] as const
export type AssetFile = (typeof ASSET_FILES)[number]

/** Names the asset route will serve: plain file names in src/assets (no paths). */
export const ASSET_NAME = /^[a-z0-9][a-z0-9-]*\.(webp|png|svg|glb)$/

export function assetUrl(file: AssetFile | `photo-${string}.webp`): string {
  return `/assets/${file}`
}

/** A catalog photo `src`: "asset:<file>" → the bundled file's URL; anything else unchanged. */
export function photoSrc(src: string): string {
  return src.startsWith('asset:') ? assetUrl(src.slice(6) as `photo-${string}.webp`) : src
}
