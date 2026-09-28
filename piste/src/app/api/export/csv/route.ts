/**
 * GET /api/export/csv?table=<name> — one personal table as CSV (RFC 4180, UTF-8 with BOM for spreadsheet apps).
 * Tables: see PERSONAL_TABLES in src/lib/export/json.ts. Demo exports carry a `data_label` column = DEMO.
 */
import type { NextRequest } from 'next/server'
import { getCtx } from '@/lib/context'
import { collectTable } from '@/lib/export/collect'
import { recordsToCsv } from '@/lib/export/csv'
import { contentDisposition, exportFileName, isPersonalTable, PERSONAL_TABLES } from '@/lib/export/json'
import { download, jsonError } from '../../_shared'

export async function GET(request: NextRequest) {
  const table = request.nextUrl.searchParams.get('table') ?? ''
  if (!isPersonalTable(table)) return jsonError(400, `Unknown table "${table}"`, { tables: PERSONAL_TABLES })
  const ctx = await getCtx()
  const rows = await collectTable(ctx.db, table, ctx.mode)
  const demo = ctx.mode === 'demo'
  const labelled = demo ? rows.map((r) => ({ data_label: 'DEMO', ...r })) : rows
  const csv = recordsToCsv(labelled, demo ? ['data_label'] : [])
  const name = exportFileName(table, 'csv', { now: ctx.now, mode: ctx.mode })
  return download(`﻿${csv}`, 'text/csv; charset=utf-8', contentDisposition(name))
}
