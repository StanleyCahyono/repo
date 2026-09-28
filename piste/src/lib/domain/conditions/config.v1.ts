/**
 * Piste Conditions v1 — versioned configuration (data only).
 *
 * Every number below except the brief's mode weights and descriptor bands is an INITIAL ENGINEERING ASSUMPTION,
 * not a calibrated value. Each carries a note on how it could be calibrated once comparable data exist
 * (official reports, personal feedback, station observations). Changing any value changes the model's output,
 * so edit `version` too and record the change in docs/methodology.md.
 *
 * Units: cm (snow), mm (rain/precipitation), °C, km/h, metres (visibility), hours.
 */
import type { ConditionsConfig } from './types'

export const CONDITIONS_CONFIG_V1: ConditionsConfig = {
  version: 'piste-conditions/1.0',

  // Brief §5 table — fixed by the product brief, not an assumption.
  weights: {
    learning: { S: 25, T: 30, W: 20, V: 15, C: 10 },
    'all-mountain': { S: 35, T: 25, W: 20, V: 10, C: 10 },
    powder: { S: 45, T: 20, W: 20, V: 10, C: 5 },
  },

  // Brief §5 descriptor bands (suitability, not safety).
  descriptors: [
    { min: 85, label: 'Excellent' },
    { min: 70, label: 'Good' },
    { min: 55, label: 'Mixed' },
    { min: 0, label: 'Challenging' },
  ],

  // Brief §5: surface evidence + terrain status + wind + ≥ 80% weighted coverage.
  gate: {
    // Model inference is not surface evidence; only a fresh report or my own feedback is.
    surfaceEvidenceBases: ['reported', 'personal'],
    requireTerrain: true,
    requireWind: true,
    minCoverage: 0.8,
  },

  limited: {
    // Initial engineering assumption: an overall estimate from < 50% of the weighted inputs says more about
    // the missing data than the day. Calibrate by checking how often limited estimates flip descriptor band
    // once the full inputs arrive.
    minCoverageForEstimate: 0.5,
  },

  weightFactors: {
    // Initial engineering assumption: an inferred surface counts half. Calibrate against personal feedback —
    // raise if "Likely …" surfaces match what I found on the hill, lower if they often miss.
    inferredSurface: 0.5,
    // Initial engineering assumption: a labelled proxy (cloud cover for visibility, whole-mountain trails for
    // beginner terrain) counts three quarters. Calibrate by comparing proxy and direct values where both exist.
    proxy: 0.75,
  },

  // Initial engineering assumption: typical day-lift hours. Published hours for the date replace it.
  operatingWindow: { opens: '09:00', closes: '16:00' },

  // Initial engineering assumption: Open-Meteo's 16-day forecast. A run's own horizonDays takes precedence.
  horizon: { defaultDays: 16 },

  points: {
    // Initial engineering assumption: beginner terrain is usually near the base, so learning mode reads the
    // base point first; other modes read the upper mountain. Calibrate per resort from trail-map elevations.
    surface: { learning: ['base', 'summit'], 'all-mountain': ['summit', 'base'], powder: ['summit', 'base'] },
    // Brief/task: wind at the upper-mountain point, falling back to base with a note.
    wind: ['summit', 'base'],
    comfort: { learning: ['base', 'summit'], 'all-mountain': ['summit', 'base'], powder: ['summit', 'base'] },
    visibility: ['summit', 'base'],
  },

  surface: {
    // Official, hand-typed-from-official and demo (demo DB only) reports can support precise wording.
    reportKinds: ['official', 'manual', 'demo'],
    // Initial engineering assumption: a daily report describes that day. Calibrate from report cadence.
    reportFreshMaxAgeHours: 24,
    // Initial engineering assumption: beyond 4 days surface evolves too much to carry forward even as "Likely".
    reportStaleMaxAgeHours: 96,
    // Initial engineering assumption: my own feedback describes the day I skied plus the next morning.
    personalMaxAgeHours: 30,
    // Initial engineering assumption: a base depth / open terrain report within 7 days proves snow cover.
    snowKnownMaxAgeDays: 7,
    // Initial engineering assumption: sub-millimetre model noise is not snowfall/rain.
    traceSnowCm: 0.1,
    traceRainMm: 0.2,

    reportSuperseded: {
      id: 'surface/report-superseded',
      // Initial engineering assumption: ≥ 5 cm new snow or ≥ 2 mm rain after the report changes the surface.
      // Calibrate against intra-day report revisions.
      snowCm: 5,
      rainMm: 2,
    },
    freshSnow: {
      id: 'surface/fresh-snow-cold',
      // Initial engineering assumption: snow from the last 48 h still reads as "fresh". Calibrate from reports
      // that tag fresh/new snow vs modeled accumulation.
      lookbackHours: 48,
      minSnowCm: 5,
      // Initial engineering assumption: ≥ 20 cm ungroomed snow is "deep" for a beginner.
      deepSnowCm: 20,
      maxRainAfterMm: 1,
      // Initial engineering assumption: more than 3 h above +1 °C after the snow wets it.
      warmAfterC: 1,
      maxWarmHoursAfter: 3,
    },
    thawRefreeze: {
      id: 'surface/thaw-refreeze',
      // Initial engineering assumption: a thaw or rain in the last 72 h followed by ≥ 6 consecutive hours at or
      // below −2 °C refreezes the surface. Calibrate against "firm"/"icy" report tags.
      lookbackHours: 72,
      thawTempC: 1,
      minThawHours: 3,
      minRainMm: 1,
      freezeTempC: -2,
      minFreezeHours: 6,
      // Initial engineering assumption: ≥ 3 mm rain or ≥ 8 thaw hours is enough to leave ice, not just firm snow.
      icyRainMm: 3,
      icyThawHours: 8,
    },
    warmWet: {
      id: 'surface/warm-wet',
      // Initial engineering assumption: ≥ 2 mm rain or ≥ 4 h at ≥ +3 °C in lift hours softens/wets the surface.
      minRainMm: 2,
      warmTempC: 3,
      minWarmHours: 4,
    },
    lateDayWarming: {
      id: 'surface/late-day-warming',
      // Initial engineering assumption: a frozen morning (first 2 h ≤ 0 °C) that later reaches ≥ +1 °C shifts
      // the preferred time window. Calibrate from personal "preferred time" notes.
      morningHours: 2,
      morningMaxC: 0,
      afternoonMinC: 1,
    },
    windAffected: {
      id: 'surface/wind-affected',
      // Initial engineering assumption: sustained ≥ 35 km/h or gusts ≥ 60 km/h in the last 24 h can move snow.
      // Calibrate against "wind-affected"/"wind-buff" wording in reports.
      lookbackHours: 24,
      sustainedKmh: 35,
      gustKmh: 60,
      recentSnowCm: 2,
    },
    staleReport: { id: 'surface/report-stale' },
    freshReport: { id: 'surface/report-fresh' },
    personal: { id: 'surface/personal-feedback' },
  },

  components: {
    S: {
      // Initial engineering assumption: suitability of each surface per mode (0–100). Learning prefers packed,
      // groomed-friendly surfaces and ranks fresh snow below packed powder; every mode penalises ice.
      // Calibrate with personal ratings by surface tag once enough ski days are logged.
      base: {
        learning: {
          'fresh-snow': 70,
          'packed-powder': 90,
          firm: 60,
          'icy-refrozen': 20,
          'wet-slushy': 45,
          'spring-snow': 65,
          'wind-affected': 45,
          mixed: 60,
        },
        'all-mountain': {
          'fresh-snow': 80,
          'packed-powder': 85,
          firm: 60,
          'icy-refrozen': 25,
          'wet-slushy': 45,
          'spring-snow': 70,
          'wind-affected': 55,
          mixed: 60,
        },
        powder: {
          'fresh-snow': 85,
          'packed-powder': 65,
          firm: 45,
          'icy-refrozen': 15,
          'wet-slushy': 35,
          'spring-snow': 50,
          'wind-affected': 50,
          mixed: 55,
        },
      },
      // Initial engineering assumption: fresh-snow amount (cm) → adjustment. Learning never goes positive and
      // falls with depth (deep/ungroomed snow is harder for beginners); powder rewards depth.
      freshSnowAdjustment: {
        learning: [
          [0, 0],
          [10, 0],
          [20, -10],
          [30, -20],
          [50, -30],
        ],
        'all-mountain': [
          [0, 0],
          [5, 0],
          [15, 5],
          [30, 10],
        ],
        powder: [
          [0, -10],
          [5, -5],
          [15, 5],
          [30, 15],
        ],
      },
      // Initial engineering assumption: reported grooming halves the beginner deep-snow penalty.
      learningGroomedMitigation: 0.5,
      // Initial engineering assumption: wind-affected alongside another surface costs 10 points.
      secondaryAdjustment: { 'wind-affected': -10 },
      // Initial engineering assumption: a model-only surface can never read better than "Good".
      inferredCap: 80,
    },
    T: {
      // Initial engineering assumption: open fraction → score; half open is still a usable day.
      // Calibrate with personal ratings vs open fraction.
      ratioCurve: [
        [0, 0],
        [0.1, 15],
        [0.25, 40],
        [0.5, 70],
        [0.75, 90],
        [1, 100],
      ],
      // Initial engineering assumption: a few open beginner runs already make a learning day workable.
      beginnerCountCurve: [
        [0, 0],
        [1, 40],
        [3, 70],
        [6, 90],
        [10, 100],
      ],
      // Initial engineering assumption: terrain counts are same-day facts; older reports are not used.
      reportMaxAgeHours: 24,
    },
    W: {
      // Initial engineering assumption: gusts matter at ~70% of their speed relative to sustained wind.
      gustWeight: 0.7,
      // Initial engineering assumption: effective wind (km/h) → comfort. Calibrate against lift-hold reports
      // and personal comfort notes. It does not predict whether a particular lift will close.
      curve: [
        [0, 100],
        [15, 100],
        [25, 90],
        [35, 75],
        [45, 55],
        [60, 30],
        [75, 10],
        [90, 0],
      ],
    },
    V: {
      // Initial engineering assumption: visibility (m) → score; flat light below ~1 km is hard for learners.
      // Calibrate against station visibility and personal notes.
      curve: [
        [0, 0],
        [200, 10],
        [500, 30],
        [1000, 55],
        [2000, 75],
        [5000, 90],
        [10000, 100],
      ],
      proxy: {
        // Initial engineering assumption: overcast alone rarely stops skiing; heavy precipitation does.
        cloudCurve: [
          [0, 95],
          [50, 85],
          [80, 70],
          [100, 55],
        ],
        precipMmPerHour: 1,
        precipPenalty: 25,
      },
    },
    C: {
      // Initial engineering assumption: apparent temperature (°C) → comfort, best just around freezing.
      // Editable; calibrate from personal comfort ratings.
      curve: [
        [-35, 0],
        [-25, 15],
        [-18, 40],
        [-12, 65],
        [-6, 85],
        [-2, 95],
        [3, 100],
        [8, 90],
        [13, 70],
        [20, 45],
      ],
      // Environment Canada / NWS wind-chill formula validity range.
      windChill: { maxTempC: 10, minWindKmh: 4.8 },
    },
  },

  confidence: {
    // Initial engineering assumption: weather older than 12 h misses at least two model updates.
    weatherStaleHours: 12,
    // Initial engineering assumption: forecasts ≥ 2 days out are less certain, ≥ 4 days much less.
    // Calibrate with stored forecast-vs-report error by horizon once samples exist.
    leadDays: { medium: 2, low: 4 },
    coverage: { high: 0.9, medium: 0.8 },
    // Initial engineering assumption: models "disagree" when daily snowfall differs by ≥ 5 cm and ≥ 50%.
    disagreement: { minAbsCm: 5, minRelative: 0.5 },
    lowFactorPenalty: 2,
    lowTotal: 3,
  },
}
