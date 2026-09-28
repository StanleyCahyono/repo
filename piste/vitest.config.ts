import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    // Domain logic relies on explicit IANA zones; pin the process zone to catch accidental local-time use.
    env: { TZ: 'UTC' },
  },
})
