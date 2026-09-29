import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, forecastHref, forecastQuery, parseForecastParams, parseResortList, patchQuery, validDate, validMonth } from './params'

describe('parseForecastParams', () => {
  it('uses favourites when r is absent, and an explicit empty selection when r is empty', () => {
    expect(parseForecastParams({}).resorts).toBeNull()
    expect(parseForecastParams({ r: '' }).resorts).toEqual([])
    expect(parseForecastParams(new URLSearchParams('r=')).resorts).toEqual([])
  })

  it('keeps well-formed, de-duplicated resort ids, at most four', () => {
    expect(parseResortList('alta, Greek-Peak,alta,../etc,stowe,vail,jay-peak')).toEqual(['alta', 'greek-peak', 'stowe', 'vail'])
  })

  it('parses every field and falls back leniently', () => {
    const p = parseForecastParams({ r: 'alta,stowe', focus: 'stowe', pt: 'summit', date: '2027-01-16', month: '2027-01', mode: 'powder', metric: 'wind' })
    expect(p).toEqual({ resorts: ['alta', 'stowe'], focus: 'stowe', point: 'summit', date: '2027-01-16', month: '2027-01', mode: 'powder', metric: 'wind' })
    expect(parseForecastParams({ pt: 'peak', date: '2027-02-30', month: '2027-13', mode: 'yolo', metric: 'rain', focus: 'Bad Id!' })).toEqual({
      ...DEFAULT_PARAMS,
    })
  })

  it('reads the first value of repeated keys', () => {
    expect(parseForecastParams({ pt: ['summit', 'base'] }).point).toBe('summit')
  })
})

describe('validDate / validMonth', () => {
  it('accepts real calendar dates only', () => {
    expect(validDate('2028-02-29')).toBe('2028-02-29')
    expect(validDate('2027-02-29')).toBeNull()
    expect(validDate('2027-1-5')).toBeNull()
    expect(validMonth('2027-12')).toBe('2027-12')
    expect(validMonth('2027-00')).toBeNull()
  })
})

describe('forecastQuery / forecastHref / patchQuery', () => {
  it('omits defaults and keeps commas readable', () => {
    expect(forecastQuery({ point: 'base', metric: 'snow' })).toBe('')
    expect(forecastQuery({ resorts: ['alta', 'stowe'], point: 'summit', date: '2027-01-16' })).toBe('?r=alta,stowe&pt=summit&date=2027-01-16')
    expect(forecastHref({ resorts: ['alta'], date: '2027-01-10' }, 'history')).toBe('/forecast?r=alta&date=2027-01-10#history')
  })

  it('patches: null removes, empty string keeps an explicit empty value, undefined leaves alone', () => {
    const q = patchQuery('?r=alta,stowe&focus=alta&metric=temp', { focus: null, r: '', date: undefined, pt: 'summit' })
    const sp = new URLSearchParams(q.slice(1))
    expect(sp.get('focus')).toBeNull()
    expect(sp.get('r')).toBe('')
    expect(sp.get('metric')).toBe('temp')
    expect(sp.get('pt')).toBe('summit')
    expect(parseForecastParams(sp).resorts).toEqual([])
  })

  it('round-trips through parse', () => {
    const q = forecastQuery({
      resorts: ['alta', 'greek-peak'],
      focus: 'greek-peak',
      point: 'summit',
      date: '2027-03-13',
      mode: 'learning',
      metric: 'potential',
    })
    expect(parseForecastParams(new URLSearchParams(q.slice(1)))).toEqual({
      resorts: ['alta', 'greek-peak'],
      focus: 'greek-peak',
      point: 'summit',
      date: '2027-03-13',
      month: null,
      mode: 'learning',
      metric: 'potential',
    })
  })
})
