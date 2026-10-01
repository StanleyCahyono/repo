import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Separate build dirs let several dev servers run side by side (NEXT_DIST_DIR=.next-a npx next dev -p 3101).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // libsql ships a native binding; keep it out of the server bundle.
  serverExternalPackages: ['@libsql/client', 'libsql'],
  poweredByHeader: false,
  // No floating Next.js badge over the bottom-left of the app (it sat on top of the mobile navigation in dev).
  devIndicators: false,
  images: {
    // Photos are served from /public with recorded licences; no remote hotlinking.
    remotePatterns: [],
  },
}

export default nextConfig
