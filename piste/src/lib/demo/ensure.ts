import type { Db } from '@/lib/db/client'

/**
 * Seed the demo database on first use. Implemented by the demo generator (src/lib/demo/generate.ts);
 * this indirection keeps the mode switch independent of generator internals.
 */
export async function ensureDemoSeeded(db: Db): Promise<void> {
  const mod = await import('./generate').catch(() => null)
  if (mod && typeof mod.ensureDemoData === 'function') await mod.ensureDemoData(db)
}
