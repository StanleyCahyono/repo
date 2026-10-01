/** A bundled OpenStreetMap snapshot of one resort's lifts and downhill pistes (scripts/build-osm-snapshots.mjs). */
export interface OsmSnapshotElement {
  id?: string
  tags?: Record<string, string>
  /** Compact line: [lon, lat] pairs (current format). */
  c?: [number, number][]
  /** Older format: {lat, lon} points. */
  geometry?: { lat: number; lon: number }[]
}

export interface OsmSnapshot {
  fetched: string
  source: string
  osmTimestamp?: string | null
  elements: OsmSnapshotElement[]
}
