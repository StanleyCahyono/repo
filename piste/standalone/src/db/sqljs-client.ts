/**
 * A libsql `Client` look-alike over sql.js (SQLite compiled to WebAssembly), so Drizzle's libsql driver
 * (`drizzle-orm/libsql/driver-core`) runs unchanged in the browser.
 *
 * - Results match libsql's ResultSet: rows are objects with enumerable column properties plus non-enumerable numeric
 *   indexes and `length` (Drizzle reads them with Array.prototype.slice.call(row)).
 * - Arguments are converted like libsql's: booleans → 0/1, Date → epoch ms, bigint → number when safe,
 *   ArrayBuffer → bytes; undefined becomes NULL.
 * - One connection, one lock: an open transaction holds the lock until commit/rollback, so statements from other async
 *   code (a route loading while an action writes) never run inside it. Statements themselves are synchronous in WASM.
 * - Every statement that can change data reports a write (for the debounced IndexedDB save).
 */
import type { Database, SqlValue } from 'sql.js'

export type InValue = null | string | number | bigint | boolean | Uint8Array | ArrayBuffer | Date | undefined
export type InArgs = InValue[] | Record<string, InValue>
export type InStatement = string | { sql: string; args?: InArgs } | [string, InArgs?]
export type TransactionMode = 'write' | 'read' | 'deferred'

export interface Row {
  [column: string]: unknown
  readonly length: number
  readonly [index: number]: unknown
}

export interface ResultSet {
  columns: string[]
  columnTypes: string[]
  rows: Row[]
  rowsAffected: number
  lastInsertRowid: bigint | undefined
  toJSON(): unknown
}

export class SqlError extends Error {
  code: string
  constructor(
    message: string,
    code = 'SQLITE_ERROR',
    readonly index?: number,
  ) {
    super(message)
    this.name = index === undefined ? 'LibsqlError' : 'LibsqlBatchError'
    this.code = code
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Rows

const VALUES = Symbol('values')

class RowImpl {
  declare [VALUES]: SqlValue[]
}
let indexGetters = 0
function ensureIndexGetters(n: number) {
  for (; indexGetters < n; indexGetters++) {
    const i = indexGetters
    Object.defineProperty(RowImpl.prototype, i, {
      get(this: RowImpl) {
        return this[VALUES][i]
      },
      enumerable: false,
    })
  }
}
Object.defineProperty(RowImpl.prototype, 'length', {
  get(this: RowImpl) {
    return this[VALUES].length
  },
  enumerable: false,
})

function makeRow(values: SqlValue[], columns: string[]): Row {
  const row = new RowImpl() as unknown as Record<string | symbol, unknown>
  Object.defineProperty(row, VALUES, { value: values, enumerable: false })
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i]
    if (!Object.prototype.hasOwnProperty.call(row, c)) row[c] = values[i]
  }
  return row as unknown as Row
}

class ResultSetImpl implements ResultSet {
  constructor(
    public columns: string[],
    public columnTypes: string[],
    public rows: Row[],
    public rowsAffected: number,
    public lastInsertRowid: bigint | undefined,
  ) {}
  toJSON() {
    return {
      columns: this.columns,
      columnTypes: this.columnTypes,
      rows: this.rows.map((r) => Array.prototype.slice.call(r)),
      rowsAffected: this.rowsAffected,
      lastInsertRowid: this.lastInsertRowid === undefined ? null : String(this.lastInsertRowid),
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Arguments

function toSql(v: InValue): SqlValue {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'bigint') return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new RangeError('Only finite numbers (not Infinity or NaN) can be passed as arguments')
    return v
  }
  if (v instanceof Date) return v.valueOf()
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  return v
}

function normalize(stmt: InStatement, args?: InArgs): { sql: string; args?: InArgs } {
  if (typeof stmt === 'string') return { sql: stmt, args }
  if (Array.isArray(stmt)) return { sql: stmt[0], args: stmt[1] }
  return stmt
}

const READ_ONLY = /^(select|explain|values)\b/i
const TX_CONTROL = /^(begin|commit|end|rollback|savepoint|release)\b/i

function stripLeading(sql: string): string {
  return sql.replace(/^(\s+|--[^\n]*\n?|\/\*[\s\S]*?\*\/)+/, '')
}

/** Can this statement change stored data? (Errs on the side of "yes": an extra save is harmless.) */
export function isWriteSql(sql: string): boolean {
  const s = stripLeading(sql)
  if (READ_ONLY.test(s) || TX_CONTROL.test(s)) return false
  if (/^pragma\b/i.test(s)) return false
  if (/^with\b/i.test(s)) return /\b(insert|update|delete|replace)\b/i.test(s)
  return true
}

// ---------------------------------------------------------------------------------------------------------------------
// Lock

class Lock {
  private tail: Promise<void> = Promise.resolve()
  acquire(): Promise<() => void> {
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    const prev = this.tail
    this.tail = prev.then(() => held)
    return prev.then(() => release)
  }
}

const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null
const waiting: (() => void)[] = []
if (channel) channel.port1.onmessage = () => waiting.shift()?.()
/** Give the browser a chance to paint (a macrotask, without setTimeout's 4 ms clamp). */
export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (!channel) return void setTimeout(resolve, 0)
    waiting.push(resolve)
    channel.port2.postMessage(0)
  })
}

export interface ClientHooks {
  onWrite?: () => void
  onStatement?: (sql: string, argCount: number) => void
}

// ---------------------------------------------------------------------------------------------------------------------

export class SqlJsClient {
  closed = false
  readonly protocol = 'file'
  private lock = new Lock()
  private yieldEveryMs = 0
  private lastYield = 0

  constructor(
    private db: Database,
    public hooks: ClientHooks = {},
  ) {}

  /** The underlying sql.js database (for export). */
  get raw(): Database {
    return this.db
  }

  /** While > 0, long runs of statements yield to the browser every `ms` so progress can paint. */
  setYieldEvery(ms: number) {
    this.yieldEveryMs = ms
    this.lastYield = performance.now()
  }

  private async maybeYield() {
    if (!this.yieldEveryMs) return
    const now = performance.now()
    if (now - this.lastYield < this.yieldEveryMs) return
    await yieldToBrowser()
    this.lastYield = performance.now()
  }

  private check() {
    if (this.closed) throw new SqlError('The client is closed', 'CLIENT_CLOSED')
  }

  /** Run one statement now (caller holds the lock or is inside the transaction). */
  runNow(stmt: InStatement, args?: InArgs): ResultSet {
    const { sql, args: a } = normalize(stmt, args)
    let prepared
    try {
      prepared = this.db.prepare(sql)
    } catch (e) {
      throw asSqlError(e)
    }
    try {
      let count = 0
      if (a !== undefined) {
        if (Array.isArray(a)) {
          count = a.length
          if (count) prepared.bind(a.map(toSql))
        } else {
          const named: Record<string, SqlValue> = {}
          for (const [k, v] of Object.entries(a)) {
            const name = /^[:@$]/.test(k) ? k : `:${k}`
            named[name] = toSql(v)
          }
          count = Object.keys(named).length
          prepared.bind(named)
        }
      }
      this.hooks.onStatement?.(sql, count)
      const columns = prepared.getColumnNames()
      const rows: Row[] = []
      if (columns.length) ensureIndexGetters(columns.length)
      while (prepared.step()) rows.push(makeRow(prepared.get(), columns))
      const write = isWriteSql(sql)
      const rowsAffected = write ? this.db.getRowsModified() : 0
      if (write) this.hooks.onWrite?.()
      return new ResultSetImpl(columns, columns.map(() => ''), rows, rowsAffected, undefined)
    } catch (e) {
      throw asSqlError(e)
    } finally {
      prepared.free()
    }
  }

  async execute(stmt: InStatement, args?: InArgs): Promise<ResultSet> {
    this.check()
    const release = await this.lock.acquire()
    try {
      return this.runNow(stmt, args)
    } finally {
      release()
      await this.maybeYield()
    }
  }

  async batch(stmts: InStatement[], mode: TransactionMode = 'deferred'): Promise<ResultSet[]> {
    this.check()
    const release = await this.lock.acquire()
    try {
      this.db.run(beginFor(mode))
      const out: ResultSet[] = []
      try {
        for (let i = 0; i < stmts.length; i++) {
          try {
            out.push(this.runNow(stmts[i]))
          } catch (e) {
            throw new SqlError((e as Error).message, (e as SqlError).code ?? 'SQLITE_ERROR', i)
          }
        }
        this.db.run('COMMIT')
      } catch (e) {
        safeRollback(this.db)
        throw e
      }
      return out
    } finally {
      release()
      await this.maybeYield()
    }
  }

  /** drizzle's migrator path: foreign keys off, one transaction, foreign keys back on. */
  async migrate(stmts: InStatement[]): Promise<ResultSet[]> {
    this.check()
    const release = await this.lock.acquire()
    try {
      this.db.run('PRAGMA foreign_keys = OFF')
      this.db.run('BEGIN DEFERRED')
      const out: ResultSet[] = []
      try {
        for (let i = 0; i < stmts.length; i++) out.push(this.runNow(stmts[i]))
        this.db.run('COMMIT')
      } catch (e) {
        safeRollback(this.db)
        throw e
      }
      return out
    } finally {
      this.db.run('PRAGMA foreign_keys = ON')
      release()
    }
  }

  async transaction(mode: TransactionMode = 'write'): Promise<SqlJsTransaction> {
    this.check()
    const release = await this.lock.acquire()
    try {
      this.db.run(beginFor(mode))
    } catch (e) {
      release()
      throw asSqlError(e)
    }
    return new SqlJsTransaction(this, release)
  }

  async executeMultiple(sql: string): Promise<void> {
    this.check()
    const release = await this.lock.acquire()
    try {
      this.db.exec(sql)
      if (isWriteSql(sql)) this.hooks.onWrite?.()
    } catch (e) {
      throw asSqlError(e)
    } finally {
      release()
    }
  }

  /** Run `fn` with the lock held (no transaction open while it runs). */
  async exclusive<T>(fn: (db: Database) => T): Promise<T> {
    const release = await this.lock.acquire()
    try {
      return fn(this.db)
    } finally {
      release()
    }
  }

  async sync() {
    return { frames_synced: 0, frame_no: 0 }
  }

  async reconnect() {}

  close() {
    if (this.closed) return
    this.closed = true
    try {
      this.db.close()
    } catch {
      /* already closed */
    }
  }
}

export class SqlJsTransaction {
  private done = false
  constructor(
    private client: SqlJsClient,
    private release: () => void,
  ) {}

  get closed() {
    return this.done
  }

  private check() {
    if (this.done) throw new SqlError('The transaction is closed', 'TRANSACTION_CLOSED')
  }

  async execute(stmt: InStatement, args?: InArgs): Promise<ResultSet> {
    this.check()
    return this.client.runNow(stmt, args)
  }

  async batch(stmts: InStatement[]): Promise<ResultSet[]> {
    this.check()
    return stmts.map((s, i) => {
      try {
        return this.client.runNow(s)
      } catch (e) {
        throw new SqlError((e as Error).message, (e as SqlError).code ?? 'SQLITE_ERROR', i)
      }
    })
  }

  async executeMultiple(sql: string): Promise<void> {
    this.check()
    this.client.raw.exec(sql)
    if (isWriteSql(sql)) this.client.hooks.onWrite?.()
  }

  async commit(): Promise<void> {
    if (this.done) return
    try {
      this.client.raw.run('COMMIT')
    } finally {
      this.settle()
    }
  }

  async rollback(): Promise<void> {
    if (this.done) return
    try {
      safeRollback(this.client.raw)
    } finally {
      this.settle()
    }
  }

  close() {
    if (this.done) return
    safeRollback(this.client.raw)
    this.settle()
  }

  private settle() {
    if (this.done) return
    this.done = true
    this.release()
  }
}

function beginFor(mode: TransactionMode): string {
  return mode === 'write' ? 'BEGIN IMMEDIATE' : 'BEGIN DEFERRED'
}

function safeRollback(db: Database) {
  try {
    db.run('ROLLBACK')
  } catch {
    /* no transaction open (SQLite already rolled back) */
  }
}

function asSqlError(e: unknown): Error {
  if (e instanceof SqlError) return e
  const message = e instanceof Error ? e.message : String(e)
  const code = /constraint/i.test(message) ? 'SQLITE_CONSTRAINT' : /no such table|syntax error|no such column/i.test(message) ? 'SQLITE_ERROR' : 'SQLITE_ERROR'
  return new SqlError(message, code)
}
