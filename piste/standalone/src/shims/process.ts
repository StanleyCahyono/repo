/**
 * `process` for the browser bundle (injected by esbuild for every free `process` reference). The environment is fixed
 * at build time (standalone/build.mjs → __PISTE_ENV__); there is no working directory, so cwd() is '/'.
 */
declare const __PISTE_ENV__: Record<string, string>

export const process = {
  env: { ...__PISTE_ENV__ } as Record<string, string | undefined>,
  cwd: () => '/',
  platform: 'browser',
  versions: {} as Record<string, string>,
  browser: true,
  nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)),
  on: () => undefined,
  off: () => undefined,
  emitWarning: () => undefined,
}
