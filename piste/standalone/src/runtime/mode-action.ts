/**
 * Browser replacement for src/lib/actions/mode.ts (the bundler redirects imports of that file here).
 * Same signature and the same rule — the demo database is generated before demo mode switches on — but generation
 * runs in this page with a progress screen, and the switch navigates instead of throwing redirect().
 */
import { MODE_COOKIE } from '@/lib/context'
import { cookieStore } from '../shims/next-headers'
import { enterDemo } from './demo'
import { go } from './router'
import { onModeChange } from './scheduler'

export async function setMode(mode: 'live' | 'demo', returnTo = '/') {
  if (mode === 'demo') {
    if (!(await enterDemo())) return
    cookieStore.set(MODE_COOKIE, 'demo')
  } else {
    cookieStore.delete(MODE_COOKIE)
  }
  onModeChange(mode)
  await go(typeof returnTo === 'string' && returnTo.startsWith('/') ? returnTo : '/', 'push')
}
