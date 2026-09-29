/** @libsql/client is never used in the browser build (the database is sql.js); anything reaching for it fails loudly. */
export function createClient(): never {
  throw new Error('@libsql/client is not available in the single-file version')
}

export class LibsqlError extends Error {}
