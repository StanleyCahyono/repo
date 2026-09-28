import { describe, expect, it } from 'vitest'
import { csvField, recordsToCsv, toCsv } from './csv'

describe('CSV escaping', () => {
  it('quotes fields with commas, quotes, CR/LF or edge spaces and doubles embedded quotes', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('Alta, UT')).toBe('"Alta, UT"')
    expect(csvField('the "Baldy" chutes')).toBe('"the ""Baldy"" chutes"')
    expect(csvField('line 1\nline 2')).toBe('"line 1\nline 2"')
    expect(csvField('a\r\nb')).toBe('"a\r\nb"')
    expect(csvField(' padded ')).toBe('" padded "')
  })

  it('keeps unknown blank (never 0) and serialises other types explicitly', () => {
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
    expect(csvField(0)).toBe('0')
    expect(csvField(false)).toBe('false')
    expect(csvField(Number.NaN)).toBe('')
    expect(csvField({ a: 1, b: 'x,y' })).toBe('"{""a"":1,""b"":""x,y""}"')
  })

  it('neutralises spreadsheet formulas in text but never alters numbers', () => {
    expect(csvField('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`)
    expect(csvField('+1 555')).toBe("'+1 555")
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvField(-12.5)).toBe('-12.5')
  })

  it('builds CRLF-terminated records with a header row', () => {
    const csv = toCsv(
      [
        { header: 'date', value: (r: { d: string; n: string | null }) => r.d },
        { header: 'notes', value: (r) => r.n },
      ],
      [
        { d: '2027-01-15', n: 'Groomers, then "the Cirque"' },
        { d: '2027-01-16', n: null },
      ],
    )
    expect(csv).toBe('date,notes\r\n2027-01-15,"Groomers, then ""the Cirque"""\r\n2027-01-16,\r\n')
    expect(recordsToCsv([{ a: 1 }, { b: 2 }])).toBe('a,b\r\n1,\r\n,2\r\n')
  })
})
