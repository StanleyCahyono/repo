# Methodology

How Piste turns reports, weather and operations data into the numbers it shows. Every model here is a transparent
planning heuristic. None of them is a validated meteorological or safety model.

**Calibration status: not yet calibrated.** Every threshold and curve below, except the brief's mode weights and
descriptor bands, is an initial engineering assumption. Piste makes no accuracy claims until it has comparable
observations or personal feedback and enough samples by resort, forecast horizon and metric.

## Conditions model

"Piste Conditions v1" (`modelVersion: piste-conditions/1.0`) is implemented in `src/lib/domain/conditions/`. It is
pure code: the caller passes the app clock (`now`), the report, the weather runs, the operating status and any
official alerts. The engine never reads the system clock, the database or the network, so the same inputs always
give the same assessment. Calculations and grounding need no LLM.

| File | Role |
|---|---|
| `config.v1.ts` | Versioned, data-only configuration: weights, bands, gate, every threshold and curve, each with a calibration note. |
| `aggregate.ts` | Hourly weather → resort-local daily aggregates and rolling windows. |
| `surface.ts` | Surface interpretation with explicit, id-tagged rules. |
| `components.ts` | The S, T, W, V and C components (0–100). |
| `confidence.ts` | The High / Medium / Low evidence label. |
| `score.ts` | `assessDay()`: eligibility, gate, score kind, score, explanation. |

To change the model, edit the config, bump `version` and record the change here. Stored assessments keep the
version they were computed with, so old and new results are never mixed silently.

### Inputs and time handling

- **Weather points.** The model uses up to two points per resort, `base` and `summit`, with the coordinates,
  elevation, model and retrieval time that the provider returned. A modeled grid cell does not resolve individual
  slopes, and an elevation adjustment does not make it a weather station. Weather-model output is labelled
  `modeled`, never "observed".
- **Interval semantics.** Each hourly record describes exactly one hour slot:
  - `preceding-hour` (Open-Meteo accumulations): the value stamped T covers (T−1h, T]. A record stamped 00:00
    local therefore belongs to the **previous** local day.
  - `following-hour`: the value covers [T, T+1h).
  - `instant`: the value is treated as describing [T, T+1h).

  Instantaneous variables such as temperature and wind share the slot of their record. That is accurate to within
  1 h. Time-of-day notes use the record's own timestamp.
- **Counting each hour exactly once.** Records are de-duplicated by slot, and a later record for the same hour
  wins. A record whose hour partly overlaps an earlier kept slot (irregular stamps such as 14:53 then a 15:10
  special) is dropped and counted in `overlapsDropped`; the gap shows as reduced coverage. Every daily or rolling
  aggregate selects whole slots, so adjacent windows partition the hours and overlapping-window double counting
  cannot happen.
- **Resort-local days.** Daily aggregates run from local midnight to local midnight in the resort's IANA zone
  (Luxon). DST days have 23 or 25 real hours, and coverage is measured against that real count. For example,
  America/Denver has 25 hours on 2026-11-01 and 23 hours on 2027-03-14.
- **Coverage.** Each aggregate reports `hoursCovered`, `expectedHours`, `coverage` and `complete`, plus coverage
  for each variable. A partial day is never presented as complete. A variable with no values is `null`
  (unknown), not 0.
- **Quantities are kept apart.** Snowfall (cm of new snow), rain (mm of liquid), precipitation (mm of water
  equivalent) and modeled ground snow depth are separate quantities. Snowfall is never derived from rain or
  precipitation. Modeled snow depth is reported as `modeledSnowDepthCm` and is never added to a reported piste
  base depth.
- **Lift hours.** Components use the published lift hours for the date when they are supplied. Otherwise they
  use a default window of 09:00–16:00 local.
- **Report age.** A report's age is measured from the time the source published it (`reportedAt`), never from
  when Piste fetched it, so refetching an old report does not make it fresh. When the publish time is unknown,
  the age is measured from the start of the report's local date, which is conservative. The age is measured to
  a reference time that depends on the date:
  - today: `now`
  - a future date: that date's lift opening
  - a past date: that date's lift close
- **Later evidence never rewrites an earlier day.** A report dated after the assessed date is not used for its
  surface, terrain or status, and status statements about later dates are ignored when resolving the date's
  status (a later "open" cannot hide a closure confirmed for the date).

### Surface interpretation

The model looks for evidence in this order and uses the first one it finds:

1. **A fresh official or manual report** (a report for the assessed date, age ≤ 24 h) with a classifiable
   surface. This gives basis `reported`, and the source wording is kept verbatim. An earlier day's report is at
   most carried forward as "Likely still …", however few hours old it is. The report is **superseded** when at least 5 cm of snow
   or at least 2 mm of rain is modeled between the report and the end of lift hours.
2. **My own feedback** from the last 30 h. This gives basis `personal`.
3. **Weather inference.** This gives basis `inferred`, and the text always starts with "Likely …". An older
   report (24–96 h) is **downgraded**. A rule that fires can override it, and the inference text cites it
   ("Based on the last report Wed 07:10, 50 h old: Packed powder"). When no rule fires, the older report is
   carried forward as "Likely still …", with two exceptions:
   - If significant weather has been modeled since the report, the surface becomes "Likely mixed".
   - Reported fresh snow is never carried forward as fresh.

   Reports older than 96 h are ignored.
4. **Nothing usable.** This gives basis `none`, tag `unknown`, and S is not scored.

For a **future date**, even a fresh report can only be carried forward as an inference, and personal feedback is
not used.

Weather-inference rules. Each rule has an id, and its thresholds are editable in `config.v1.ts`:

| Rule id | Hypothesis | v1 thresholds (initial engineering assumptions) |
|---|---|---|
| `surface/warm-wet` | Sustained warmth or rain wets the surface → `wet-slushy` | ≥ 2 mm rain, or ≥ 4 h at ≥ +3 °C, during lift hours |
| `surface/fresh-snow-cold` | Recent cold snowfall with little later rain → `fresh-snow` (grooming and coverage unknown) | ≥ 5 cm in the 48 h to lift close; after the last snow hour ≤ 1 mm rain and ≤ 3 h above +1 °C; "deep" at ≥ 20 cm. Unknown is not "dry and cold": where rain is missing, total precipitation bounds it; an hour after the snow with neither, or unknown temperatures that could exceed the warm-hour allowance, block the rule with a note |
| `surface/thaw-refreeze` | A thaw or rain followed by a sustained freeze → `firm`, or `icy-refrozen` for strong wetting. **Only where snow is known to exist.** | In the 72 h before lift opening: ≥ 3 h at ≥ +1 °C or ≥ 1 mm rain, then ≥ 6 consecutive h at ≤ −2 °C. Icy when ≥ 3 mm rain or ≥ 8 thaw hours |
| `surface/wind-affected` | Wind exposure can move snow → adds `wind-affected` ("Possibly …" beside another surface) | Sustained ≥ 35 km/h or gusts ≥ 60 km/h in the last 24 h, where snow is known to exist or ≥ 2 cm fell recently |
| `surface/late-day-warming` | A frozen morning that warms later shifts the preferred time window (a note, not a tag) | First 2 lift hours ≤ 0 °C, then a later hour ≥ +1 °C |
| `surface/report-stale` | An older report carried forward as "Likely still …" | 24–96 h old with no major modeled change |
| `surface/report-superseded` | Weather after the report changes it | ≥ 5 cm snow or ≥ 2 mm rain since the report |

When several rules fire, the primary surface follows the order wet > fresh snow > thaw-refreeze >
carried-forward report. Wind-affected is added as a secondary tag.

**Snow known to exist** means one of the following in the last 7 days: a report with a base depth, a surface, an
open status or open trails, or my own surface feedback. Modeled snow depth never counts.

**Grooming and snowmaking are not surface tags.** Grooming is a management action and machine-made snow is an
origin. Both are returned separately (`management`) and shown as separate explanation lines. A report that
mentions grooming but gives no surface is not surface evidence. Model inference never claims "powder" or
"corn".

### Components (0–100)

| Component | Input | Curve / rule (v1) |
|---|---|---|
| **S** Surface suitability | Surface tags, basis and fresh-snow amount | Base value for each mode and tag, plus a fresh-snow adjustment by amount, plus secondary-tag adjustments (see below). |
| **T** Terrain availability | Same-day report (≤ 24 h), open/total counts | Open share → 0 %: 0, 10 %: 15, 25 %: 40, 50 %: 70, 75 %: 90, 100 %: 100 (see below). |
| **W** Wind comfort | Upper-mountain point in lift hours, base as a noted fallback | Effective wind per hour = max(sustained, 0.7 × gust). The window's peak is mapped ≤ 15 km/h: 100, 25: 90, 35: 75, 45: 55, 60: 30, 75: 10, ≥ 90: 0. |
| **V** Visibility | Hourly visibility (m) in lift hours | Per hour 0 m: 0, 200: 10, 500: 30, 1 km: 55, 2 km: 75, 5 km: 90, ≥ 10 km: 100, then averaged. See below for the proxy. |
| **C** Temperature comfort | Apparent temperature in lift hours | Per hour −35 °C: 0, −25: 15, −18: 40, −12: 65, −6: 85, −2: 95, +3: 100, +8: 90, +13: 70, +20: 45, then averaged (see below). |

**S (surface suitability).** Base values:

| Mode | Fresh snow | Packed powder | Firm | Icy/refrozen | Wet/slushy | Spring | Wind-affected | Mixed |
|---|---|---|---|---|---|---|---|---|
| Learning | 70 | 90 | 60 | 20 | 45 | 65 | 45 | 60 |
| All-mountain | 80 | 85 | 60 | 25 | 45 | 70 | 55 | 60 |
| Powder | 85 | 65 | 45 | 15 | 35 | 50 | 50 | 55 |

- Fresh-snow adjustment by amount:
  - Learning: 0 up to 10 cm, −10 at 20 cm, −20 at 30 cm, −30 at 50 cm, and never positive. Reported grooming
    halves this penalty.
  - All-mountain: up to +10 at 30 cm.
  - Powder: −10 at 0 cm, +5 at 15 cm, +15 at 30 cm.
- Wind-affected beside another surface: −10.
- Icy or refrozen is the lowest value in every mode.
- An inferred surface is capped at 80 and counts at **half weight**.

**T (terrain availability).**

- Learning mode uses open **beginner** trails. When only the beginner open count is known, it uses a count curve
  (0: 0, 1: 40, 3: 70, 6: 90, 10: 100).
- When beginner counts are missing, the whole-mountain open-trail share (or the open-lift share) is used as a
  **labelled proxy** at 0.75 weight.
- With no same-day report, or with no counts, T is `null`: unknown, never assumed open.
- Future dates always have T = `null`.

**V (visibility) proxy.** When visibility data are missing, V uses cloud cover: 0 %: 95, 50 %: 85, 80 %: 70,
100 %: 55, minus 25 for each hour with ≥ 1 mm of precipitation. This is a **labelled proxy** at 0.75 weight.
With neither visibility nor cloud data, V is `null`.

**C (temperature comfort).** When apparent temperature is missing, the Environment Canada/NWS wind-chill formula
is applied to temperature and wind (valid at ≤ 10 °C and ≥ 4.8 km/h). Plain air temperature is used only as a
labelled proxy.

The weather point read for each purpose (all initial engineering assumptions):

- Surface inference and C read the base first in learning mode, because beginner terrain is usually low. They
  read the summit first in the other modes.
- W and V read the summit first.
- The first point in that order with **values for the purpose's variables** in the window wins, so a preferred
  point whose run lacks a variable falls back to the other point, and the component note says so ("base (no
  summit data)"). V uses direct visibility at either point before falling back to the cloud-cover proxy.

### Score, gate and score kinds

| Mode | S | T | W | V | C |
|---|---|---|---|---|---|
| Learning day | 25% | 30% | 20% | 15% | 10% |
| All-mountain day | 35% | 25% | 20% | 10% | 10% |
| Powder preference | 45% | 20% | 20% | 10% | 5% |

`score = round(Σ weight × component / Σ available weight)`

- Components are rounded to integers first, so the breakdown reproduces the score.
- A missing component is excluded and the remaining weights are renormalised. It is never replaced by a neutral
  or zero value.
- **Coverage** is the sum of the effective weights actually used, divided by 100. Inferred-surface and proxy
  factors reduce coverage too.

**Gate for a full `conditions` score:** surface evidence (basis `reported` or `personal`, not an inference),
terrain status (T), wind (W) and coverage ≥ 0.8. When the gate fails, the score kind is `limited` and the
descriptor reads "Limited data". The gate reasons and excluded components are listed. Component estimates are
still shown. An overall estimate is shown only when coverage is ≥ 0.5.

The score kinds are:

| Score kind | When |
|---|---|
| `conditions` | Today or a past date, and the gate passed. |
| `limited` | Today or a past date, and the gate failed. |
| `weather-potential` | A future date inside the forecast horizon. It uses only weather-derived components (W, V, C and an inferred S). The explanation states that the resort is assumed to operate and that open terrain and operating status are unknown. Future open-terrain counts are never projected. |
| `closed` | Confirmed closure. There is no score and the descriptor reads "Closed". |
| `none` | Preseason, beyond the forecast horizon, or a future date with no weather. |

Descriptors: 85–100 Excellent, 70–84 Good, 55–69 Mixed, below 55 Challenging. They describe suitability, not
safety. The model never advises backcountry travel or declares terrain safe.

### Eligibility and hard rules

Eligibility is decided in this order:

1. **Closed.** Any one of these confirms a closure, and it overrides every score:
   - the date is after the actual closing;
   - the date is before the actual opening;
   - a `temporarily-closed` status for that date;
   - a `closed-for-season` status on or before the date.

   On the same date, the newer status statement wins. When a time is unknown, a closure wins.
2. **Preseason.** There is no actual opening yet, and one of these holds:
   - the date is before the announced opening;
   - with no announcement, the date is before Piste's estimated opening window (labelled as an estimate);
   - the status for that date is `not-yet-open`.

   An announced date never turns into "Open" by itself.
3. **Out of horizon.** The date is after the last forecast day (the run's `horizonDays`, or 16 by default).
   There is no score.
4. **Eligible.** Only when an `open` or `partially-open` status is stated **for that date**.
5. **Status unknown.** Everything else. The unknown status is shown, and the resort is never treated as open,
   even when the data gate passes.

Official alerts that overlap the date are passed through as `warnings`. They never change the score and are
never offset by good component values. An alert whose onset or end is missing or unreadable is treated as
unbounded on that side, so it is shown rather than hidden. Demo-kind reports and weather are ignored unless the assessment runs in
demo mode.

### Confidence

A qualitative evidence label, not a probability. Each factor adds a penalty:

- **Source quality:**
  - official report 0
  - my feedback 1
  - modeled inference or none 2
- **Weather freshness:** retrieval time unknown or older than 12 h: 1.
- **Coverage:**
  - below 0.9: 1
  - below 0.8: 2
- **Lead time:**
  - 2–3 days: 1
  - 4 or more days: 2
- **Model disagreement:** 1, only when an alternate model's daily snowfall is genuinely supplied, the primary
  model covers the whole local day with snowfall values (a partial-day sum is not comparable), and they differ
  by ≥ 5 cm and ≥ 50 %.

The label is **Low** when any factor reaches 2 or the total reaches 3, **Medium** when the total is 1–2, and
**High** otherwise. The reasons are stored with the assessment.

### Output and storage

`assessDay()` returns fields that map 1:1 onto the `conditions_assessments` columns: `scoreKind`, `score`,
`descriptor`, `coverage`, `components`, `surface`, `confidence`, `confidenceReasons`, `eligibility`, `leadDays`,
`explanation`, `modelVersion`, `kind`, `mode`, `localDate`, `computedAt` and `inputs`. It also returns
`warnings`, `hardRuleNotes` and `gate`.

- Each component carries its raw metric inputs (`inputs`), its effective weight, whether it was included, a
  plain-language note and a `proxy` label.
- Explanation strings are formatted in the display units passed at compute time. The UI should use
  `components[].inputs` for anything unit-sensitive.
- Assessments are appended, not overwritten. A forecast assessment made before a date is never rewritten with
  later weather.

### Calibration paths

Once data exist, the model can be calibrated in these ways:

- **Surface rules:** compare inferred tags with the next official report and with my feedback, by rule id.
- **S values:** compare with my post-visit ratings by surface tag and mode.
- **T curve:** compare with my ratings against the open share.
- **W, V and C curves:** compare with station observations where available and with my comfort notes.
- **Confidence thresholds:** review stored forecast-versus-report error by resort, horizon and metric.

No calibration result will be reported without comparable data and enough samples.

### Known limitations

- A grid-cell model cannot see individual slopes, grooming, traffic, snowmaking coverage or untouched powder.
- Terrain for future dates is unknown by design, so a future day is only ever a weather potential.
- Report parsers for some resorts are unverified (see `docs/assumptions.md`). When a parser fails, the day falls
  back to "Limited data" rather than to guessed values.

## Cost bands

TODO: cost-band methodology to be appended by the costs engineer (see `docs/methodology-costs.md` for the draft).
