/**
 * GET /api/export/json — every personal table as one JSON document (see src/lib/export/json.ts).
 * In demo mode the export comes from the demo database and is labelled DEMO in the payload and filename.
 */
import { getCtx } from '@/lib/context'
import { collectPersonalData } from '@/lib/export/collect'
import { buildJsonExport, contentDisposition, exportFileName } from '@/lib/export/json'
import { download } from '../../_shared'

export async function GET() {
  const ctx = await getCtx()
  const payload = buildJsonExport(await collectPersonalData(ctx.db, ctx.mode), { now: ctx.now, mode: ctx.mode })
  const name = exportFileName('export', 'json', { now: ctx.now, mode: ctx.mode })
  return download(JSON.stringify(payload, null, 2), 'application/json; charset=utf-8', contentDisposition(name))
}
