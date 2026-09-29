/**
 * `node:dns/promises` for the browser bundle. A web page cannot resolve host names, so the DNS-based SSRF check is not
 * available; the only caller (the link checker) is disabled in the single-file version.
 */

export async function lookup(hostname: string): Promise<never> {
  throw new Error(`DNS lookups are not available in the single-file version (${hostname})`)
}

export default { lookup }
