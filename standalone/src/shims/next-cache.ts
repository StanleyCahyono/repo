/**
 * next/cache for the single-file build. There is no server cache: every revalidation simply re-runs the current
 * route's loaders after the current task (many calls collapse into one refresh).
 */
import { scheduleRefresh } from '../runtime/router'

export function revalidatePath(_path: string, _type?: 'page' | 'layout'): void {
  void scheduleRefresh()
}

export function revalidateTag(_tag: string, _profile?: unknown): void {
  void scheduleRefresh()
}

export function updateTag(_tag: string): void {
  void scheduleRefresh()
}

export function refresh(): void {
  void scheduleRefresh()
}

export function unstable_noStore(): void {}

export function unstable_cache<T extends (...args: never[]) => unknown>(fn: T): T {
  return fn
}
