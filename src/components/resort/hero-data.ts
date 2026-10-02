/**
 * What the resort hero says, built on the server from the summary: the status / opening line (never "Open" from an
 * announced date; unknown status says so), the HUD line (place, coordinates, elevations) and which art to draw.
 */
import { photoSrc } from '@/lib/ui/assets'
import type { ResortSummary } from '@/lib/data/resorts'
import type { UnitPrefs } from '@/lib/domain/types'
import { dayLabel, dayLabelYear, dotJoin, seasonText, units } from './format'
import type { HeroArtSpec, HeroData, HeroTone } from './hero'

/** The Matterhorn's summit, the subject of Zermatt's bundled picture (metres). */
const MATTERHORN_M = 4478

const sentence = (t: string) => (/[.!?”]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`)

function status(r: ResortSummary): HeroData['status'] {
  const o = r.opening
  const st = r.status
  const unknownNote = st.status === 'unknown' ? 'Operating status unknown — never treated as open.' : null
  const season = seasonText(o.seasonId) ?? ''
  const closing = o.closing.label === 'announced' && o.closing.date ? `Season to ${dayLabelYear(o.closing.date)}.` : null
  let tone: HeroTone = 'neutral'
  let text: string
  let sub: string | null = null
  if (r.closure) {
    tone = 'critical'
    text = `Closed · ${r.closure.reason}`
  } else if (st.status === 'open' || st.status === 'partially-open') {
    tone = 'positive'
    text = o.closing.label === 'announced' && o.closing.date ? `${st.label} · until ${dayLabel(o.closing.date)}` : st.label
    sub = st.note
  } else if (o.label === 'announced' && o.date) {
    tone = 'teal'
    text = `Opens ${dayLabelYear(o.date)} · announced`
    sub = o.text ? `“${o.text.replace(/^[“"]|[”"]$/g, '')}” A target, not a promise: never shown as open until it opens.` : 'A target, not a promise: never shown as open until it opens.'
  } else if (o.label === 'estimated') {
    tone = 'copper'
    text = `${season} opening not announced`
    sub = o.date ? `Piste estimate: about ${dayLabel(o.date)}${o.to && o.to !== o.date ? ` – ${dayLabel(o.to)}` : ''}.${o.basis ? ` ${sentence(o.basis)}` : ''}` : (o.basis ?? null)
  } else if (o.label === 'opened') {
    tone = st.status === 'closed-for-season' ? 'neutral' : 'positive'
    text = st.status === 'unknown' ? (o.date ? `Opened ${dayLabelYear(o.date)}` : 'Opened this season') : st.label
    sub = closing
  } else {
    tone = 'copper'
    text = `${season} opening not announced`
    sub = o.typicalText ?? null
  }
  return { tone, text, sub, note: tone !== 'positive' ? unknownNote : null }
}

function coord(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`
}

export function heroData(r: ResortSummary, prefs: UnitPrefs, chapters: number): HeroData {
  const u = units(prefs)
  const base = u.elev(r.baseElevationM)
  const top = u.elev(r.summitElevationM)
  const verticalM = r.verticalM ?? (r.baseElevationM !== null && r.summitElevationM !== null ? r.summitElevationM - r.baseElevationM : null)
  const range = base && top ? `${base.replace(/ (m|ft)$/, '')}–${top}` : (top ?? base)
  const locality = r.locality ? r.locality.split('(')[0].trim() : null
  let art: HeroArtSpec
  // The two hand-made cut-outs (from the design) lead; otherwise the bundled Commons photo; otherwise terrain art.
  if (r.id === 'zermatt') art = { kind: 'matterhorn', peakLabel: `Matterhorn · ${u.elev(MATTERHORN_M)}`, topLabel: top ? `Ski area top · ${top}` : null }
  else if (r.id === 'greek-peak') art = { kind: 'greek-peak', topLabel: top ? `Summit · ${top}` : null, sub: verticalM !== null ? `${u.elev(verticalM)} vertical` : null }
  else if (r.photo) art = { kind: 'photo', ...r.photo, src: photoSrc(r.photo.src) }
  else
    art = {
      kind: 'terrain',
      seed: r.id,
      verticalM,
      summitM: r.summitElevationM,
      topLabel: top ? `Summit · ${top}` : null,
      baseLabel: base ? `Base · ${base}` : null,
      verticalLabel: verticalM !== null ? `${u.elev(verticalM)} vertical` : null,
    }
  return {
    name: r.name,
    shortName: r.shortName,
    place: dotJoin(r.region, r.stateProvince ?? null, r.country !== 'US' ? r.country : null),
    hud: dotJoin(locality && locality.length <= 28 ? locality : null, coord(r.lat, r.lon), range),
    status: status(r),
    art,
    chapters,
    demo: r.demo,
  }
}
