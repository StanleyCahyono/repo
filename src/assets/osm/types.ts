/** A bundled OpenStreetMap snapshot of one resort's lifts and downhill pistes (scripts/build-osm-snapshots.mjs). */
export interface OsmSnapshotElement {
  id?: string
  tags?: Record<string, string>
  /** Encoded polyline (precision 5, lat/lon order) — current format. */
  p?: string
  /** Older compact line: [lon, lat] pairs. */
  c?: [number, number][]
  /** Older format: {lat, lon} points. */
  geometry?: { lat: number; lon: number }[]
}

/** A named place near the ski area (map label). k: settlement kind, peak or lift station. */
export interface OsmPlace {
  n: string
  /** English name when OpenStreetMap records one that differs (e.g. Japanese resorts). */
  en?: string
  k: 'city' | 'town' | 'village' | 'hamlet' | 'peak' | 'station'
  /** [lon, lat] */
  ll: [number, number]
  /** Elevation in metres (peaks, stations) when recorded. */
  e?: number
}

export interface OsmSnapshot {
  fetched: string
  source: string
  osmTimestamp?: string | null
  area?: string
  elements: OsmSnapshotElement[]
  places?: OsmPlace[]
}
