/**
 * Persistence of the two SQLite databases (live, demo) in IndexedDB: one record per mode holding the sql.js export.
 * When IndexedDB is unavailable (some browsers restrict it for file:// pages, private windows), everything still works
 * in memory and the page says so honestly.
 */
import type { AppMode } from '@/lib/domain/types'

const DB_NAME = 'piste-standalone'
const STORE = 'databases'

export interface StoredDatabase {
  bytes: Uint8Array
  /** Migration id of the schema the bytes were written with. */
  schemaId: string
  savedAt: string
  /** Bytes as written (for the storage summary). */
  size: number
}

let opening: Promise<IDBDatabase | null> | null = null
let unavailableReason: string | null = null

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening
  opening = new Promise((resolve) => {
    let idb: IDBFactory
    try {
      idb = window.indexedDB
      if (!idb) throw new Error('IndexedDB is not available in this browser')
    } catch (e) {
      unavailableReason = e instanceof Error ? e.message : String(e)
      return resolve(null)
    }
    let req: IDBOpenDBRequest
    try {
      req = idb.open(DB_NAME, 1)
    } catch (e) {
      unavailableReason = e instanceof Error ? e.message : String(e)
      return resolve(null)
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      unavailableReason = req.error?.message ?? 'IndexedDB could not be opened'
      resolve(null)
    }
    req.onblocked = () => {
      unavailableReason = 'IndexedDB is blocked by another open copy of this page'
      resolve(null)
    }
  })
  return opening
}

export async function storageAvailable(): Promise<boolean> {
  return (await open()) !== null
}

export function storageProblem(): string | null {
  return unavailableReason
}

function request<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        if (!db) return reject(new Error(unavailableReason ?? 'IndexedDB unavailable'))
        const tx = db.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        tx.oncomplete = () => resolve(req.result)
        tx.onerror = () => reject(tx.error ?? req.error)
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
        // Commit now rather than when the event loop is idle: a save issued as the page is hidden should land.
        if (mode === 'readwrite') tx.commit?.()
      }),
  )
}

export async function loadDatabase(mode: AppMode): Promise<StoredDatabase | null> {
  if (!(await storageAvailable())) return null
  try {
    const v = await request<StoredDatabase | undefined>('readonly', (s) => s.get(mode) as IDBRequest<StoredDatabase | undefined>)
    return v && v.bytes instanceof Uint8Array ? v : null
  } catch {
    return null
  }
}

/** Is a record stored for this mode? (Counts the key; does not read the bytes.) */
export async function databaseExists(mode: AppMode): Promise<boolean> {
  if (!(await storageAvailable())) return false
  try {
    return (await request<number>('readonly', (s) => s.count(mode))) > 0
  } catch {
    return false
  }
}

export async function saveDatabase(mode: AppMode, record: StoredDatabase): Promise<void> {
  await request('readwrite', (s) => s.put(record, mode))
}

export async function deleteDatabase(mode: AppMode): Promise<void> {
  if (!(await storageAvailable())) return
  await request('readwrite', (s) => s.delete(mode))
}

/**
 * Ask the browser not to evict the data under storage pressure (best effort). Only where the answer is silent
 * (Chromium decides by heuristics); Firefox would show a permission prompt at start-up.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!('userAgentData' in navigator)) return false
    if (await navigator.storage?.persisted?.()) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
