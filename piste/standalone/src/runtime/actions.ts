/**
 * Server actions become plain async functions in the browser. The bundler wraps every export of a 'use server'
 * module with `wrapAction` so they behave like Next's:
 * - one action at a time, in call order (Next queues Server Function calls the same way);
 * - revalidatePath() inside the action refreshes the current route, and the action resolves only after the fresh
 *   data is rendered (so `startTransition(async () => { await action() })` stays pending until then);
 * - redirect() inside the action navigates instead of surfacing as an error.
 */
import { isRedirectError } from './errors'
import { go, pendingRefresh } from './router'

let queue: Promise<unknown> = Promise.resolve()

export function wrapAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, name: string): (...args: A) => Promise<R> {
  const wrapped = (...args: A): Promise<R> => {
    const run = async (): Promise<R> => {
      try {
        const result = await fn(...args)
        const refreshing = pendingRefresh()
        if (refreshing) await refreshing
        return result
      } catch (e) {
        if (isRedirectError(e)) {
          await go(e.url, e.type)
          return undefined as R
        }
        throw e
      }
    }
    const p = queue.then(run, run)
    queue = p.catch(() => undefined)
    return p
  }
  Object.defineProperty(wrapped, 'name', { value: name })
  return wrapped
}
