/** Official resort report adapters. Add a resort by writing a `LabelReportConfig` (or a bespoke provider). */
import type { ResortReportProvider } from '../types'
import { createAltaReportProvider } from './alta'
import { createGreekPeakReportProvider } from './greek-peak'

export { createLabelReportProvider, extractReport, reportContentHash, type LabelReportConfig } from './provider'
export { GREEK_PEAK_REPORT, createGreekPeakReportProvider } from './greek-peak'
export { ALTA_REPORT, createAltaReportProvider } from './alta'

export const reportProviders: ResortReportProvider[] = [createGreekPeakReportProvider(), createAltaReportProvider()]

export function getReportProvider(resortId: string): ResortReportProvider | null {
  return reportProviders.find((p) => p.resortId === resortId) ?? null
}
