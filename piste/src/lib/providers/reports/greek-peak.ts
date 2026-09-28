/**
 * Greek Peak Mountain Resort (Virgil/Cortland, NY) — official conditions page.
 *
 * UNVERIFIED: built without access to the live page (the build environment could not load greekpeak.net).
 * The catalog notes that the page lists open/closed trails and lifts, surfaces and grooming, updated daily in
 * season, with a printable version. The adapter therefore requires an operations anchor (trail or lift counts)
 * and treats snow figures as optional. Expect this adapter to report 'schema-changed' until checked against the
 * real markup; the manual report entry flow is the dependable path meanwhile.
 */
import type { HttpClient } from '../http'
import type { ResortReportProvider } from '../types'
import { createLabelReportProvider, type LabelReportConfig } from './provider'

export const GREEK_PEAK_REPORT: LabelReportConfig = {
  id: 'greek-peak-official',
  resortId: 'greek-peak',
  label: 'Greek Peak conditions page',
  maturity: 'unverified',
  urls: ['https://www.greekpeak.net/ski-ride/current-conditions/', 'https://greekpeak.net/conditions-print'],
  publisher: 'greekpeak.net',
  assumedSnowUnit: 'in',
  required: [['trails', 'lifts']],
}

export function createGreekPeakReportProvider(options: { http?: HttpClient } = {}): ResortReportProvider {
  return createLabelReportProvider(GREEK_PEAK_REPORT, options)
}
