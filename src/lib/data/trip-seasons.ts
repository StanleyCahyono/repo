/**
 * Season windows for the trip calendars (pure, client-safe): which days of a resort's season are known to be in it.
 *
 * - opened:    an actual opening is on record — from that day to the actual or announced closing.
 * - announced: an announced opening date — from it to the announced closing (when there is one).
 * - estimate:  only a Piste estimate of the opening — from the start of the estimate window onwards.
 *
 * An announced date never becomes "opened". A window with no closing on record is open-ended: it is drawn only up to
 * the end of that hemisphere's usual season (north 30 Apr, south 31 Oct) and labelled "closing not announced", so the
 * calendar never implies a closing date nobody published.
 */
import { formatLocalDate, hemisphereOf } from '@/lib/domain/time'

export type SeasonWindowKind = 'opened' | 'announced' | 'estimate'

export interface SeasonWindow {
  kind: SeasonWindowKind
  from: string
  /** Last day drawn (the closing, or the display cap when open-ended). */
  to: string
  /** No closing on record. */
  openEnded: boolean
  /** Legend text, e.g. "After est. opening (28 Nov – 5 Dec, Piste estimate)". */
  label: string
}

export interface SeasonTrack {
  resortId: string
  name: string
  windows: SeasonWindow[]
}

export interface SeasonRowLike {
  seasonId: string
  announcedOpening: string | null
  estimatedOpenFrom: string | null
  estimatedOpenTo: string | null
  actualOpening: string | null
  announcedClosing: string | null
  actualClosing: string | null
}

const short = (d: string) => formatLocalDate(d, 'd LLL')

/** Season windows of one resort from its season rows, dropping any that ended before `today`. */
export function seasonWindows(rows: readonly SeasonRowLike[], lat: number | null, today: string): SeasonWindow[] {
  const south = hemisphereOf(lat) === 'south'
  const out: SeasonWindow[] = []
  for (const r of rows) {
    const y = Number(r.seasonId.slice(0, 4))
    if (!Number.isFinite(y)) continue
    const cap = south ? `${y + 1}-10-31` : `${y + 1}-04-30`
    const closing = r.actualClosing ?? r.announcedClosing
    const closingText = closing ? `to ${short(closing)}` : 'closing not announced'
    let w: SeasonWindow | null = null
    if (r.actualOpening) {
      w = { kind: 'opened', from: r.actualOpening, to: closing ?? cap, openEnded: !closing, label: `Season opened ${short(r.actualOpening)}, ${closingText}` }
    } else if (r.announcedOpening) {
      w = { kind: 'announced', from: r.announcedOpening, to: closing ?? cap, openEnded: !closing, label: `Announced season, ${short(r.announcedOpening)} ${closingText}` }
    } else if (r.estimatedOpenFrom) {
      const range = r.estimatedOpenTo && r.estimatedOpenTo !== r.estimatedOpenFrom ? `${short(r.estimatedOpenFrom)} – ${short(r.estimatedOpenTo)}` : short(r.estimatedOpenFrom)
      w = { kind: 'estimate', from: r.estimatedOpenFrom, to: closing ?? cap, openEnded: !closing, label: `After est. opening (${range}, Piste estimate)` }
    }
    if (w && w.to >= today && w.to >= w.from) out.push(w)
  }
  return out.sort((a, b) => a.from.localeCompare(b.from))
}

const RANK: Record<SeasonWindowKind, number> = { opened: 3, announced: 2, estimate: 1 }

/** The strongest window covering a date across the given tracks (opened > announced > estimate). */
export function markOn(tracks: readonly SeasonTrack[], date: string): { kind: SeasonWindowKind; window: SeasonWindow; track: SeasonTrack } | null {
  let best: { kind: SeasonWindowKind; window: SeasonWindow; track: SeasonTrack } | null = null
  for (const track of tracks) {
    for (const w of track.windows) {
      if (date < w.from || date > w.to) continue
      if (!best || RANK[w.kind] > RANK[best.kind]) best = { kind: w.kind, window: w, track }
    }
  }
  return best
}
