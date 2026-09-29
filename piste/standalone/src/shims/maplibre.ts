/**
 * maplibre-gl for the single-file build: the real library, with its web worker (worker + shared chunk bundled into
 * one self-contained script at build time) started from a Blob URL. A page opened from file:// cannot load the worker
 * from a path, so setWorkerUrl() ignores the path the map component passes and uses the Blob instead.
 */
import * as maplibre from 'maplibre-gl/dist/maplibre-gl.mjs'
import workerSource from 'virtual:piste/maplibre-worker'

export * from 'maplibre-gl/dist/maplibre-gl.mjs'

let blobUrl: string | null = null

/**
 * MapLibre starts a MODULE worker unless the URL ends in `.cjs`; Chromium refuses module workers from Blob URLs on a
 * file:// page (opaque origin), while classic workers work. The bundled worker is a plain IIFE, so a `#.cjs` fragment
 * (ignored when the Blob is fetched) selects the classic path.
 */
export function workerBlobUrl(): string {
  blobUrl ??= `${URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))}#.cjs`
  return blobUrl
}

export function setWorkerUrl(_ignored?: string): void {
  maplibre.setWorkerUrl(workerBlobUrl())
}

export default maplibre
