/**
 * Report provenance markers shared by jobs, read models and the UI (pure: no database, no network).
 */

/**
 * `prov.note` of a report found by catalog research (a dated `recentReports` entry in catalog/resorts/*.json). It is
 * stored as an official report with the research verification ('search-summary'), its own observation day and its
 * source — shown as "Researched — confirm at source", never as read by Piste or as live.
 */
export const RESEARCHED_REPORT_NOTE = 'catalog-research'

export function isResearchedReport(r: { prov: { note?: string | null } | null | undefined } | null | undefined): boolean {
  return r?.prov?.note === RESEARCHED_REPORT_NOTE
}
