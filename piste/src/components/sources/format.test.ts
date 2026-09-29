import { describe, expect, it } from 'vitest'
import { cleanMessage, errorBeyondStatus, errorDigest, groupFailures, httpReason, shortUrl } from './format'

describe('errorDigest', () => {
  it('groups one message per failed item, most frequent first, without item keys or error tags', () => {
    const error = [
      'alta:base:open-meteo: http: Open-Meteo: HTTP 403 Forbidden',
      'alta:base:nws-grid: http: NWS points: HTTP 403 Forbidden',
      'alta:summit:open-meteo: http: Open-Meteo: HTTP 403 Forbidden',
      'greek-peak:nws-alerts: timeout: NWS alerts: timed out after 15000 ms',
    ].join('; ')
    expect(errorDigest(error)).toEqual({
      truncated: false,
      items: [
        { text: 'Open-Meteo: HTTP 403 Forbidden', count: 2 },
        { text: 'NWS points: HTTP 403 Forbidden', count: 1 },
        { text: 'NWS alerts: timed out after 15000 ms', count: 1 },
      ],
    })
  })

  it('drops the cut-off fragment of a length-capped error and flags counts as a sample', () => {
    const d = errorDigest('a:b: http: Open-Meteo: HTTP 403 Forbidden; a:c: http: NWS po…')
    expect(d).toEqual({ truncated: true, items: [{ text: 'Open-Meteo: HTTP 403 Forbidden', count: 1 }] })
    // A single, cut-off message is still shown.
    expect(errorDigest('Something very long…').items).toEqual([{ text: 'Something very long…', count: 1 }])
  })

  it('handles empty input', () => {
    expect(errorDigest(null)).toEqual({ items: [], truncated: false })
    expect(errorDigest('')).toEqual({ items: [], truncated: false })
  })
})

describe('error text beside an HTTP status', () => {
  it('hides text that only repeats the status', () => {
    expect(errorBeyondStatus('HTTP 403 Forbidden', 403)).toBeNull()
    expect(errorBeyondStatus('http: alta.com: HTTP 403 Forbidden', 403)).toBeNull()
    expect(errorBeyondStatus('http: alta.com: HTTP 403 Forbidden', null)).toBe('alta.com: HTTP 403 Forbidden')
    expect(errorBeyondStatus('schema-changed: layout not recognised (no "Base depth" label)', 200)).toBe('layout not recognised (no "Base depth" label)')
    expect(cleanMessage('greek-peak:greek-peak-official: http: greekpeak.net: HTTP 403 Forbidden')).toBe('greekpeak.net: HTTP 403 Forbidden')
  })

  it('explains statuses honestly — a 403 does not prove a page is gone', () => {
    expect(httpReason(403)).toMatch(/does not prove/)
    expect(httpReason(404)).toMatch(/not found/)
    expect(httpReason(200)).toBeNull()
    expect(httpReason(null)).toBeNull()
  })
})

describe('groupFailures and shortUrl', () => {
  it('groups by status (or error) with the largest group first', () => {
    const items = [
      { url: 'a', httpStatus: 404, error: null },
      { url: 'b', httpStatus: 403, error: 'HTTP 403' },
      { url: 'c', httpStatus: 403, error: 'HTTP 403' },
      { url: 'd', httpStatus: null, error: 'getaddrinfo ENOTFOUND example.invalid' },
    ]
    expect(groupFailures(items).map((g) => [g.key, g.items.length])).toEqual([
      ['HTTP 403', 2],
      ['HTTP 404', 1],
      ['getaddrinfo ENOTFOUND example.invalid', 1],
    ])
  })

  it('shortens links for display', () => {
    expect(shortUrl('https://www.alta.com/lift-tickets/')).toBe('alta.com/lift-tickets')
    expect(shortUrl('https://example.org/' + 'x'.repeat(100), 20)).toHaveLength(20)
  })
})
