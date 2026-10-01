/**
 * `process` for the browser bundle (injected by esbuild for every free `process` reference). The environment is fixed
 * at build time (standalone/build.mjs → virtual:piste/env); there is no working directory, so cwd() is '/'.
 */
import { ENV } from 'virtual:piste/env'

export const process = {
  env: { ...ENV } as Record<string, string | undefined>,
  cwd: () => '/',
  platform: 'browser',
  versions: {} as Record<string, string>,
  browser: true,
  nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)),
  on: () => undefined,
  off: () => undefined,
  emitWarning: () => undefined,
}
