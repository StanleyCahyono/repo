/**
 * Piste chart primitives — small SVG/HTML charts on d3-scale/d3-shape, design tokens only, light/dark automatic.
 *
 * Building blocks
 * - ChartFrame     title + evidence tag (+ `demo`) + legend + "Show as table" toggle around any chart (required twin).
 * - ChartTable     the accessible table twin ("Not provided" for unknown cells — never blank or 0).
 * - Legend/Swatch  swatches mirror the mark; optional KindTag per series (Model / Reported / Piste estimate).
 * - TimeChart      synchronised stack of TimePanels on one UTC x-scale with ONE scrubber (ARIA slider: pointer,
 *                  touch drag, ←/→, PageUp/PageDown, Home/End); crosshair glides 200 ms, axes stay put. Pass
 *                  `tickFor={(w) => hourTicks(stamps, tickStep(w, hours))}` so ticks fit the measured width.
 *   TimePanel      one unit per panel: line / area / band / bars series, reference lines, night & trend shading,
 *                  `empty` (nothing known) and `note` ("None modeled" when every known value is zero).
 *   TimeAxis       resort-local hour ticks + day labels (labels come from the server, never browser local time);
 *                  labels never collide (`placeTickLabels` / `placeDayLabels`).
 * - SnowfallBars   hourly snowfall bars preset (interval-exact via `hourInterval`; "None modeled" when all zero).
 * - WindBand       sustained wind line with a band up to the gusts.
 * - DailyBars      categorical day bars (HTML) with trend hatching, partial-day "≥", radio-group selection glide.
 * - Sparkline      word-sized line/area/bars, server-renderable.
 * Place time charts on a surface panel: night shading uses the canvas tone.
 *
 * Helpers: `chartUnits(prefs.units)` converts canonical metric to the user's display units (via domain/units.ts);
 * `hourTicks`, `dayMarks`, `tickStep`, `hourInterval`, `valueDomain`, `runsOf`, `sumKnown`, `placeTickLabels` in ./scale.
 *
 * Evidence styling: model output = solid marks; reported/manual = points only; Piste-derived = dashed + copper
 * (`styleForKind`). Status colours are never used for series.
 */
export { ChartFrame, type ChartFrameProps, type ChartView } from './chart-frame'
export { ChartTable, type ChartTableColumn, type ChartTableProps, type ChartTableRow } from './chart-table'
export { Legend, Swatch, type LegendItem, type SwatchShape } from './legend'
export {
  TimeAxis,
  TimeChart,
  TimePanel,
  useTimeChart,
  type AreaSeries,
  type BandSeries,
  type BarSeries,
  type LineSeries,
  type RefLine,
  type TimeBar,
  type TimeChartProps,
  type TimePanelProps,
  type TimePoint,
  type TimeSeries,
  type TimeShade,
  type YOptions,
} from './time-chart'
export { SnowfallBars, WindBand, type SnowfallBarsProps, type WindBandProps } from './presets'
export { DailyBars, type DailyBarDatum, type DailyBarsProps } from './daily-bars'
export { Sparkline, type SparklineProps } from './sparkline'
export { chartUnits, minus, type Quantity, type QuantityKey } from './units'
export { DASH, TONES, styleForKind, type LineStyle, type Tone } from './tones'
export * from './scale'
