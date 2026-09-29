import { Settings } from 'luxon'
import { describe, expect, it } from 'vitest'
import { toUtcIso } from './result'

describe('toUtcIso', () => {
  it('needs an explicit offset: an offset-less stamp is unknown, never read in the server zone', () => {
    const prev = Settings.defaultZone
    Settings.defaultZone = 'Asia/Tokyo' // a server that is not on UTC
    try {
      expect(toUtcIso('2027-01-15T07:00:00-05:00')).toBe('2027-01-15T12:00:00.000Z')
      expect(toUtcIso('2027-01-10T15:51:01.927Z')).toBe('2027-01-10T15:51:01.927Z')
      expect(toUtcIso('2027-01-15T07:00:00')).toBeNull() // not 2027-01-14T22:00:00.000Z (Tokyo wall time)
      expect(toUtcIso('2027-01-15')).toBeNull()
      expect(toUtcIso(null)).toBeNull()
    } finally {
      Settings.defaultZone = prev
    }
  })
})
