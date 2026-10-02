/** Decode an encoded polyline (Google's format, 5 decimals, lat before lon) into [lon, lat] pairs. */
export function decodePolyline(str: string): [number, number][] {
  const out: [number, number][] = []
  let i = 0
  let lat = 0
  let lon = 0
  const next = () => {
    let shift = 0
    let result = 0
    let b: number
    do {
      b = str.charCodeAt(i++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (i < str.length) {
    lat += next()
    lon += next()
    out.push([lon / 1e5, lat / 1e5])
  }
  return out
}
