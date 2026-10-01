/** Marker / status-dot tones shared by the Explore map, rows and Compare headers (token classes only). */
export type StageTone = 'open' | 'announced' | 'estimate' | 'closed' | 'unknown'

export const TONE_DOT: Record<StageTone, string> = {
  open: 'bg-teal',
  announced: 'bg-[color-mix(in_srgb,var(--teal)_45%,var(--surface))]',
  estimate: 'bg-copper',
  closed: 'bg-ink-3',
  unknown: 'bg-[color-mix(in_srgb,var(--ink-3)_45%,var(--surface))]',
}
export const TONE_LABEL: Record<StageTone, string> = {
  open: 'Open',
  announced: 'Opening announced',
  estimate: 'Estimated opening',
  closed: 'Closed',
  unknown: 'Status unknown',
}
