import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChartTable } from './chart-table'
import { Sparkline } from './sparkline'

describe('Sparkline (server-rendered)', () => {
  it('labels itself and leaves gaps for unknown values instead of drawing zeros', () => {
    const html = renderToStaticMarkup(createElement(Sparkline, { values: [1, null, 3, 2], label: 'Snowfall next 48 h, 0 to 3 in' }))
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Snowfall next 48 h, 0 to 3 in"')
    // d3's line generator starts a new sub-path (M) after an undefined point: two segments, not one through zero.
    const d = /<path d="([^"]+)" fill="none"/.exec(html)?.[1] ?? ''
    expect(d.match(/M/g)?.length).toBe(2)
  })

  it('draws only a dashed baseline when nothing is known', () => {
    const html = renderToStaticMarkup(createElement(Sparkline, { values: [null, null], label: 'No data' }))
    expect(html).toContain('stroke-dasharray="2 3"')
    expect(html).not.toContain('<path')
  })
})

describe('ChartTable (server-rendered)', () => {
  it('renders every cell, with "Not provided" for unknown values — never blank, never 0', () => {
    const html = renderToStaticMarkup(
      createElement(ChartTable, {
        caption: 'Hourly forecast',
        rowHeader: 'Time',
        columns: [
          { key: 'snow', label: 'Snowfall', unit: 'in' },
          { key: 'vis', label: 'Visibility', unit: 'mi' },
        ],
        rows: [{ key: 'a', header: '09:00', cells: { snow: '0', vis: null } }],
      }),
    )
    expect(html).toContain('<caption class="sr-only">Hourly forecast</caption>')
    expect(html).toContain('scope="row"')
    expect(html).toContain('>0<')
    expect(html).toContain('Not provided')
  })
})
