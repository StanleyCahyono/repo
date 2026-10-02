import { describe, expect, it } from 'vitest'
import { decodePolyline } from './decode'

describe('decodePolyline', () => {
  it('decodes the reference polyline into [lon, lat] pairs', () => {
    // Google's documented example: (38.5, -120.2), (40.7, -120.95), (43.252, -126.453).
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ])
  })

  it('returns no points for an empty string', () => {
    expect(decodePolyline('')).toEqual([])
  })
})
