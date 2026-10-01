/**
 * Alta Ski Area (UT) — official snow report.
 *
 * UNVERIFIED: the URL https://www.alta.com/conditions is the expected location of Alta's snow report but was NOT
 * confirmed (the catalog has no verified snow-report URL for Alta yet, and alta.com could not be loaded from the
 * build environment). Alta publishes snow figures (24 h / storm / season totals, base depth) prominently, so the
 * adapter requires a snow anchor; lift/trail counts are optional.
 */
import type { HttpClient } from '../http'
import type { ResortReportProvider } from '../types'
import { createLabelReportProvider, type LabelReportConfig } from './provider'

export const ALTA_REPORT: LabelReportConfig = {
  id: 'alta-official',
  resortId: 'alta',
  label: 'Alta snow report',
  maturity: 'unverified',
  urls: ['https://www.alta.com/conditions'],
  publisher: 'alta.com',
  assumedSnowUnit: 'in',
  required: [['baseDepth', 'snowfall']],
}

export function createAltaReportProvider(options: { http?: HttpClient } = {}): ResortReportProvider {
  return createLabelReportProvider(ALTA_REPORT, options)
}
