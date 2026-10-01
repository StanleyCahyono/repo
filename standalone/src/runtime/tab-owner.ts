/**
 * One tab owns the data. Every tab keeps the databases in memory and saves whole files to IndexedDB, so two open tabs
 * would overwrite each other's changes. The newest tab (usually: the file was double-clicked again) takes over: it
 * asks the current owner — over a BroadcastChannel — to save and step back, then holds a Web Lock while it runs. The
 * previous tab shows "Piste is open in another tab" with a button to take it back. An owner that does not answer
 * (frozen or discarded) loses the lock after a few seconds and may no longer write.
 * Without Web Locks (old browsers) there is no protection, as before.
 */

const LOCK = 'piste-standalone-owner'
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('piste-standalone') : null

let release: (() => void) | null = null
let owner = false
let writable = true
let onLost: ((saveFirst: boolean) => Promise<void>) | null = null

/** May this tab still write to IndexedDB? (False once another tab took over.) */
export function canWrite(): boolean {
  return writable
}

/** What to do when another tab takes over: `saveFirst` is false when the lock was taken by force. */
export function setOnLost(fn: (saveFirst: boolean) => Promise<void>) {
  onLost = fn
}

function acquire(options: LockOptions): Promise<boolean> {
  return new Promise((resolve) => {
    navigator.locks
      .request(LOCK, options, (lock) => {
        if (!lock) {
          resolve(false)
          return undefined
        }
        owner = true
        resolve(true)
        return new Promise<void>((r) => (release = r))
      })
      .catch(async (e: unknown) => {
        if (owner && (e as { name?: string })?.name === 'AbortError') {
          // Another tab took the lock by force: stop writing at once.
          await stepBack(false)
        } else resolve(false)
      })
  })
}

async function stepBack(saveFirst: boolean) {
  if (!owner) return
  owner = false
  if (!saveFirst) writable = false
  try {
    await onLost?.(saveFirst)
  } finally {
    writable = false
    release?.()
    release = null
  }
}

channel?.addEventListener('message', (e: MessageEvent<{ type?: string }>) => {
  if (e.data?.type === 'handoff' && owner) void stepBack(true)
})

/** Become the tab that owns the data (taking over from another tab if needed). */
export async function becomeOwner(status: (text: string) => void): Promise<'owner' | 'unprotected'> {
  if (!navigator.locks?.request) return 'unprotected'
  try {
    if (await acquire({ ifAvailable: true })) return 'owner'
    status('Piste is open in another tab — taking over…')
    channel?.postMessage({ type: 'handoff' })
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 6000)
    const got = await acquire({ signal: ac.signal })
    clearTimeout(timer)
    if (got) return 'owner'
    await acquire({ steal: true })
    return 'owner'
  } catch {
    return 'unprotected'
  }
}
