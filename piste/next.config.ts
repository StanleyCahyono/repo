import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // libsql ships a native binding; keep it out of the server bundle.
  serverExternalPackages: ['@libsql/client', 'libsql'],
  poweredByHeader: false,
  images: {
    // Photos are served from /public with recorded licences; no remote hotlinking.
    remotePatterns: [],
  },
}

export default nextConfig
