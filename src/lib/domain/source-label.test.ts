import { describe, expect, it } from 'vitest'
import { cleanCatalogText, cleanNote, providerLabel, shownNote } from './source-label'

describe('source labels', () => {
  it('names the catalog plainly', () => {
    expect(providerLabel('Piste catalog (web research)')).toBe('Piste catalog')
    expect(providerLabel('Open-Meteo')).toBe('Open-Meteo')
  })

  it('hides internal markers, caveats and catalog research notes', () => {
    expect(cleanNote('catalog-research')).toBeNull()
    expect(cleanNote('Piste reference data — confirm at source')).toBeNull()
    expect(cleanNote('Purchases Apr 1 - Sep 30, 2026')).toBe('Purchases Apr 1 - Sep 30, 2026')
    expect(shownNote({ provider: 'Piste catalog (web research)', note: 'Season 2026-27' })).toBeNull()
    expect(shownNote({ provider: 'You', note: 'Checked at the ticket window' })).toBe('Checked at the ticket window')
  })

  it('drops research caveats from catalog prose clause by clause', () => {
    expect(cleanCatalogText('SATA group — reference, confirm')).toBe('SATA group')
    expect(cleanCatalogText("Alpe d'Huez opens 5 Dec 2026 (France Montagnes opening list, per search summary).")).toBe("Alpe d'Huez opens 5 Dec 2026.")
    expect(cleanCatalogText('Albion base (Albion Basin) — Sunnyside and Albion lifts; confirm current lift names')).toBe('Albion base (Albion Basin) — Sunnyside and Albion lifts')
    expect(cleanCatalogText('Unlimited season pass for guests aged 25 or younger. Price not confirmed.')).toBe('Unlimited season pass for guests aged 25 or younger.')
    expect(cleanCatalogText('Reports say the pass sold out in Sept 2026 (unconfirmed).')).toBe('Reports say the pass sold out in Sept 2026.')
    expect(cleanCatalogText('Usually early December to late April (reference; confirm).')).toBe('Usually early December to late April.')
    expect(cleanCatalogText('Childcare not confirmed.')).toBeNull()
    expect(cleanCatalogText('Free shuttle from the village every 20 min.')).toBe('Free shuttle from the village every 20 min.')
  })
})

describe('research wording in notes', () => {
  it('drops sentences that only describe the research', () => {
    expect(cleanCatalogText('Every Tuesday, online purchase. Age category not stated in the research summary.')).toBe('Every Tuesday, online purchase.')
    expect(cleanCatalogText('No reservation required (research). For 2025-26 all lift tickets were sold online only.')).toBe('No reservation required. For 2025-26 all lift tickets were sold online only.')
    expect(cleanCatalogText('None recorded in research (listed as unlimited).')).toBeNull()
  })
})
