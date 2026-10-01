/**
 * Extra read model for Sources & Sync: the catalog's research notes per resort (how each record was researched,
 * open questions, conflicts). The catalog research ran on web search only and its budget ran out partway, so many
 * resorts carry reference data only — this lists them so nothing reference-grade passes for verified.
 */
import 'server-only'
import * as s from '@/lib/db/schema'
import type { DataCtx } from './core'

export interface ResearchNoteView {
  resortId: string
  name: string
  region: string
  favorite: boolean
  /** 'web-search' (researched, search summaries) or 'reference-only' (no research ran); other values as stored. */
  method: string
  date: string | null
  openQuestions: string[]
  conflicts: string[]
  confidenceNotes: string | null
}

export interface ResearchNotes {
  referenceOnly: ResearchNoteView[]
  researched: ResearchNoteView[]
  /** Resorts without any research record (e.g. added by you). */
  unrecorded: ResearchNoteView[]
}

export async function loadResearchNotes(ctx: Pick<DataCtx, 'db'>): Promise<ResearchNotes> {
  const [rows, favs] = await Promise.all([
    ctx.db.select({ id: s.resorts.id, name: s.resorts.name, region: s.resorts.region, research: s.resorts.research, origin: s.resorts.origin, priority: s.resorts.priority }).from(s.resorts),
    ctx.db.select({ id: s.favorites.resortId }).from(s.favorites),
  ])
  const fav = new Set(favs.map((f) => f.id))
  const priority = new Map(rows.map((r) => [r.id, r.priority]))
  const views: ResearchNoteView[] = rows
    .map((r) => ({
      resortId: r.id,
      name: r.name,
      region: r.region,
      favorite: fav.has(r.id),
      method: r.research?.method ?? (r.origin === 'user' ? 'added-by-you' : 'unrecorded'),
      date: r.research?.date ?? null,
      openQuestions: r.research?.openQuestions ?? [],
      conflicts: r.research?.conflicts ?? [],
      confidenceNotes: r.research?.confidenceNotes ?? null,
    }))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || (priority.get(b.resortId) ?? 0) - (priority.get(a.resortId) ?? 0) || a.name.localeCompare(b.name))
  return {
    referenceOnly: views.filter((v) => v.method === 'reference-only'),
    researched: views.filter((v) => v.method === 'web-search'),
    unrecorded: views.filter((v) => v.method !== 'reference-only' && v.method !== 'web-search'),
  }
}
