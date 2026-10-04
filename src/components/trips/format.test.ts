import { describe, expect, it } from 'vitest'
import { placeLine } from './format'

describe('placeLine', () => {
  it('drops notes in brackets and repeated parts', () => {
    expect(placeLine('Union Dale (Herrick Township, Susquehanna County), PA, PA', 'Northeastern Pennsylvania')).toBe('Union Dale, PA · Northeastern Pennsylvania')
    expect(placeLine('Virgil (Cortland mailing address: 2000 NYS Route 392, Cortland, NY 13045), NY', 'Central New York')).toBe('Virgil, NY · Central New York')
  })
  it('handles a missing town or a region already in the town', () => {
    expect(placeLine(null, 'Utah')).toBe('Utah')
    expect(placeLine('Zermatt, Valais', 'Valais')).toBe('Zermatt, Valais')
  })
})
