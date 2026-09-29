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

## Cost bands and budgets

This section explains how Piste answers "Can I use my exact pass here on this date?" and "What will a day, a
trip or a season cost?". The code lives in `src/lib/domain/passes/` and `src/lib/domain/costs/`. These are pure
functions: they take rows and the app clock as inputs and never read the database, the network or the system
clock.

The rules below follow the data-honesty principles in `AGENTS.md`. Unknown means unknown. It is never read as
permission, never read as $0, and it never produces a tier.

### Pass access

#### What a badge means and what a verdict means

- **Family badges** (Ikon, Epic, Indy, Mountain Collective, Regional) are for **discovery only**. A resort gets a
  family badge when at least one product in that family has a current rule there that is not `not-included`.
  When every such rule is `unknown` or `discount-only`, the badge is flagged `qualifiedOnly`. A badge never
  means you own a pass, and it never means your product covers the resort.
- A **verdict** answers the question for one **exact product**, one resort and one resort-local date. It uses
  that product's current rule (the highest `version`) and your logged usage.

#### Evaluation order (the first match wins)

| # | Status | When |
|---|---|---|
| 1 | `season-mismatch` | The product's season (e.g. `2026-27`, which runs 1 Jul → 30 Jun) does not contain the date. |
| 2 | `unknown` | There is no rule, the rule says `unknown`, a day limit has no day count (or one that is not a whole number of days), or a shared pool is missing its size or its member resorts, or the pool's other rules were not supplied to the evaluator (so days used at the other members could not be counted). The message is *"Access rules not confirmed for this product — check the official page"*. |
| 3 | `not-included` | The rule says the product does not include this resort. |
| 4 | `unknown` / `blackout` | Blackout dates that are not recorded (`null`) or that cannot be read make the date `unknown` — an unreadable blackout is never read as "no blackout". Otherwise, `blackout` when the date falls inside a range. Ranges are **inclusive** resort-local dates (`from` and `to` are both blacked out). Blackouts apply to discount benefits too. |
| 5 | `discount-only` | No included days, only a discount. The discount text is shown and is never applied to prices automatically. |
| 6 | `included` | Unlimited access. |
| 7 | `days-exhausted` / `included-limited` | A limited allotment (a per-resort cap, a shared pool, or both). |

`canSki` is true **only** for `included` / `included-limited`, which means a day is available and the date is
not blacked out. A reservation requirement never blocks a day. It is shown in `reservationRequired`
(true / false / null for "not recorded") and in the reasons. A rule whose provenance is `search-summary`
adds "Researched — confirm at source"; a rule with no provenance, no verification level or `unverified` adds
"Rule source not verified — confirm on the official pass page". When the verdict is included, the product's
own blackout summary (if recorded) is added to the reasons, because it can describe dates the per-resort rule
does not record as ranges.

#### Day limits and shared pools

- A **per-resort cap** is a `limited-days` rule, and its `days` field is the cap.
- A **shared pool** (for example an Alta/Snowbird-style combined allotment) is a set of rules for the same
  product that share a `poolId`. Logging a day at **any** member resort uses up the pool. The pool's total comes
  from the explicit `poolDays` on a member, if there is one. Otherwise it comes from `days` on the
  `shared-pool` members.
- **A cap inside a pool** (both limits at once) is stored as a `limited-days` rule with the `poolId` set. That
  resort then has to satisfy its own cap **and** the pool. The days remaining is the smaller of the two.
- If member rules disagree about the pool size, Piste uses the **smaller** figure and says that the records
  conflict.
- **Counting days:** Piste counts distinct (resort, date) pairs within the product's season. A duplicate log
  entry counts once. Two different member resorts on the same date count as two days, which is the
  conservative choice. If the date being evaluated is already logged, it is not counted twice.
- **Planning** (`planAccess`) walks the planned days in date order. It starts from the logged usage and uses up
  one day for each earlier planned day that can use the pass. So with a two-day cap, the third planned day shows
  `days-exhausted`. Days that are blocked (blackout, not included, unknown) use up nothing.
- `remainingByResort` / `remainingByPool` give the season balance for the "track remaining days" views. They
  ignore dates and blackouts.

### Day basket and expense tiers

#### What goes in the basket

The **per-person day basket** has four lines:

1. **Lift access.** This is the day's own lift-ticket price. If the pass being considered can be used that day,
   this line is **$0 incremental** with the note "Covered by *product*". Days that are discount-only are priced
   at the full ticket price, with the discount noted but not applied.
2. **Rental.** This is the rental option you selected in gear preferences (full package, skis only, boots only).
   With "own gear" it is $0 and is labelled as an assumption. Rental price snapshots are matched by `item` equal
   to the option id (`full-package`, `skis-only`, `boots-only`), plus a few plain aliases.
3. **Lunch.** This is your own lunch estimate from Settings, and it is always labelled "Your estimate".
4. **Parking.** A per-vehicle price is split across the party size with exact allocation. The basket shows the
   largest share, so the figure is never rounded down. Parking that is confirmed free, or not needed (for
   example with a shuttle), is $0. Otherwise the parking cost is unknown.

Every resort uses the same assumptions (rental option, lunch estimate, party size, ticket category, display
currency), so the tiers can be compared. Lessons, lodging and long-distance travel are listed separately in the
trip budget.

Each line records its **kind**: published price, observed quote, your estimate, demo, assumption, or covered by
pass. It also records its source and its original currency. A price whose provenance is `search-summary` or
`unverified` (the catalog's research-grade prices) sets `confirmAtSource` on the line, its source text ends with
"Researched — confirm at source", and the basket adds a caveat naming those lines. A pass-covered lift line
does the same when the access rule is research-grade, and says when the reservation requirement is not
recorded. Confirmed free / not-needed parking is labelled published only when a kind or a source is supplied;
otherwise it is an assumption.

#### Day types and holidays

Prices are looked up by day type: weekday, weekend or holiday. A holiday takes priority over a weekend. The
holiday calendar is configurable (`DayTypeConfig`). It includes US federal holidays, which are computed for each
season so later seasons work without edits, plus observed days. It also includes an optional Christmas–New Year
period (default 25 Dec → 1 Jan inclusive) and any dates or ranges you add. The 2026–27 defaults are:

Independence Day (4 Jul, observed 3 Jul) · Labor Day 7 Sep · Columbus Day 12 Oct · Veterans Day 11 Nov ·
Thanksgiving 26 Nov · Christmas–New Year 25 Dec – 1 Jan · MLK Day 18 Jan · Presidents' Day 15 Feb · Memorial
Day 31 May · Juneteenth 19 Jun (observed 18 Jun).

Resort-specific "peak" calendars belong on the price snapshot's `appliesFrom` / `appliesTo`, not in this list.

#### Choosing a price snapshot

A snapshot is used only if all of these hold:

- the subject and resort match;
- the category matches (a snapshot with no category is accepted as generic);
- the season matches;
- the date is inside `appliesFrom` / `appliesTo`;
- the day type matches, or the snapshot's day type is `any` or unset (a `peak` price needs a dated window);
- it has not expired, and its purchase-by date has not passed.

Among the snapshots that apply, Piste ranks by:

1. **Source quality.** Published prices and observed quotes come first, then your estimates, then demo prices.
   (Research-grade "published" prices keep their rank but are flagged "confirm at source", see above.)
2. **Specificity.** An exact day type ranks higher, then a dated window (a narrower window ranks higher), then a
   named season, then an exact category.
3. **Recency.** The most recently observed snapshot wins.

Piste does **not** fall back from one day type to another. A weekend price is not used for a holiday; the
holiday price counts as missing instead. A snapshot with **no** recorded day type is accepted for any day, and its
basis then says "day type not stated". The chosen line shows why it was picked (for example
"Published price · weekend price · 2026-27").

#### The incomplete-estimate rule

- **Required lines** are lift access and, when you rent, the rental. (Callers can also make parking or lunch
  required.) If any required line is unknown, the basket is `complete: false`. It then has **no total**, and its
  tier is **"Incomplete estimate"**. A tier is never produced from partial data. The known lines are still
  listed so you can see the itemisation, and `knownSubtotal` is never classified.
- **Optional lines** (lunch and parking by default) that are unknown are listed under `missing`, left out of the
  total, and noted as a caveat (for example "Excludes parking (unknown)").
- If a price is known but no stored FX rate can convert it, that line is shown in its original currency, and the
  basket has no display total. If that price can't be converted to USD either, there is no tier.

#### Expense tier bands

These are UI classification thresholds, not price estimates. They are configurable and stored in USD, per
person per day:

| Tier | Range (USD) |
|---|---|
| $ | under $125.00 |
| $$ | $125.00 – $249.99 |
| $$$ | $250.00 – $449.99 |
| $$$$ | $450.00 and up |

The lower bound of each band is inclusive: $124.99 is `$`, $125.00 is `$$`, $449.99 is `$$$` and $450.00 is
`$$$$`. Each basket line is converted **directly** from its original currency to USD and then summed, which
avoids converting twice. The basket is then classified. When lines are estimate ranges, `tier` classifies the low
end; if the high end lands in a higher band it is reported as `tierMax` with the caveat "Estimate range spans
$ to $$", so a range is never shown only at its cheaper tier. The basket is recalculated whenever the dates, owned
pass, gear, party size or exchange rates change, because it is a pure function of those inputs.

### Currency conversion (FX)

- Rates come from stored `fx_rates` records, where "1 `base` = `rate` `quote`" and the rate is a decimal
  string. Piste never fetches or guesses a rate inside a calculation.
- Lookup order is: same currency (identity), then the direct pair, then the inverse pair (by division), then a
  **cross rate through USD** (two legs). By default the latest `rateDate` is used. `asOf` limits the lookup to
  rates dated on or before a given day. When a direct and an inverse rate share a date, the direct rate wins.
- The arithmetic uses decimals (big.js). It rounds **once**, half-up, to the target currency's minor unit (so JPY
  has no decimals).
- Every conversion returns the **original amount unchanged**, the converted amount, the effective rate, the rate
  date (for a cross rate, the older of the two legs), the provider and the records used. The UI shows the
  original currency with "≈ converted (rate, date)".
- If no usable rate exists, the conversion returns `null`. The caller then shows the original currency and
  leaves that amount out of any display-currency total, marking the total incomplete.

### Trip budget

- Each item has a type, a cost range (a minimum, plus an optional maximum), a currency, a cost kind (quote,
  estimate or actual), a basis (per person or shared) and an optional quote expiry.
- **Per-person** items are paid by each person, so the group pays the amount × party size. **Shared** items are
  converted first and then split with `money.allocate`, so the shares add up **exactly** to the item total (for
  example $100 across 3 people is $33.34, $33.33 and $33.33). Leftover cents rotate across people from item to
  item. Each person's total adds up exactly to the group total. The headline "per person" figure is the largest
  share.
- Ranges are added up as a separate minimum and maximum. Estimates stay editable ranges and are never presented
  as live quotes.
- **Expired quotes** (a quote whose `quoteExpiresAt` has passed and which is not booked and not an actual cost)
  stay in the totals, because they are the best number on file, but they are flagged "re-check the price". An
  expiry given as a date only is valid through that day.
- **Missing items** (no cost, or no currency) are listed. Items that can't be converted are listed in their
  original currency and left out of the totals, so the budget is incomplete.
- `total` and `perPersonTotal` are **null unless the budget is complete**. `group` / `perPerson` /
  `perPersonMax` are the sums of the priced lines only (a trip whose only item has no cost has `group` = $0 but
  `total` = null); show them only as a known subtotal beside the missing list, never as the trip total.
- **Locked per-item rates:** a rate saved on the item wins over the stored rate table, but only when the item
  also names the currency the rate converts into (`fxQuote`). Otherwise the stored rates are used.

### Pass comparison calculator

- **Baseline (tickets only)** is the sum of **each planned day's own ticket price** for that resort and date,
  priced by day type. It never multiplies one resort's most expensive walk-up ticket by the number of days. If
  any planned day has no known price, the baseline total is unknown, and the known part and the missing days are
  listed.
- **For each candidate product,** Piste runs `planAccess` over the planned days. The season total is the pass
  price plus the ticket cost of every planned day the pass cannot cover. That includes days that are blacked out,
  days after the allotment runs out, days not included, discount-only days (at full price), days with unknown
  access (which are **never** assumed covered) and days in the wrong season.
- **Products you already own:** the price paid is shown as **already paid** (a sunk cost). **Incremental** is
  the ticket cost of the days the pass doesn't cover, with logged usage counted against the allotments.
  **Season total** is already paid plus incremental. Two savings figures are shown: baseline minus incremental,
  and baseline minus season total.
- **Break-even** is shown only when the assumptions fit. That means the product is not owned yet, its price is
  known, every planned day has a known ticket price, and the product covers every planned day. It is then the
  planned day, in date order, on which the running total of each day's own ticket price reaches the pass price.
  If the planned days never reach the price, the shortfall is shown. In every other case the reason is shown
  instead, for example: "The pass does not cover every planned day (1 blacked out, 2 no days left), so a
  day-count break-even does not fit — compare the totals instead."
- Lodging, travel, rentals and lessons cost the same with or without a pass, so the comparison leaves them out.

### Season budget

- The budget shows **actual vs planned by category** (pass, lift, lodging, travel, food, lessons, rentals, gear,
  other), with the variance. Trip item types map to these categories: lift-ticket → lift, rental → rentals,
  flight/drive/transfer/parking → travel.
- **A pass purchase is counted once.**
  - Expenses linked by `passOwnershipId` *are* the purchase. Their category is forced to `pass`, and
    instalments are added together. Expenses linked to a pass supplied for this season count toward it
    **whatever their date**: season passes are bought in the spring sale, which by date falls in the previous
    season. (Expenses linked to passes not supplied still follow the date filter.)
  - If no expense is linked, the ownership record's price paid is used.
  - An unlinked expense of exactly that amount is treated as the same purchase, with a prompt to link it: a
    `pass` expense first, otherwise a `lift` expense (a pass purchase logged as "lift" would otherwise be counted
    twice).
  - On the planned side, an unlinked planned `pass` line priced exactly like an owned pass is that pass and is
    planned once.
- **Days covered by a pass add $0 of lift cash.** A planned lift line marked as pass-covered, or linked to the
  pass, adds nothing, and the pass price is never spread into daily costs. A logged `lift` expense on a pass day
  is real cash (for example a friend's ticket), so it stays, with a warning to check it isn't the pass itself.
- An owned pass counts toward the planned `pass` category exactly once.
- **Cost per ski day** is actual spending divided by distinct ski days, where ski days are the dates from the ski
  day log together with the dates of logged pass usage. The **on-snow** cost per day uses only pass, lift,
  rentals and lessons.
- **Pass usage value** is the sum of each used day's own ticket price, compared with the pass cost, along with
  the cost per day used. It is **not cash saved** unless you would have skied those days anyway, and it is never
  added to spending. If any used day has no ticket price, the value is unknown and the number of unknown days is
  shown.
- Actual spending is converted at the rate on or before the expense date if one is stored, otherwise at the
  latest stored rate. Amounts that can't be converted are listed, and the budget is marked incomplete.

How the My Season page feeds this budget (`src/lib/data/season.ts`):

- **Planned** is *my share* of the priced items in non-cancelled trips: per-person items as entered, shared items
  split across the trip's party with exact allocation. Trip items marked `idea` are not plans and are left out
  (the page says how many). Unpriced items are counted and reported, so a partial plan never reads as complete.
- A priced lift ticket planned on a day an owned pass covers is **flagged, not dropped** — only an explicit pass
  link (or `passCovered`) removes it, because you may really be buying a ticket that day.
- Spend noted on a ski-day log is shown on that day but not added to the budget; expenses are the record of
  actual spending, so nothing is counted twice.
- Pass usage value uses each used day's own lift ticket (`liftTicketFor`) for that resort and date.

### Data conventions and known limits

- `pass_access_rules` has no pool-total column. The pool total comes from `days` on the `shared-pool` members. A
  pool where **every** member also has its own cap needs the domain-only `poolDays` field until a column is added.
- `trip_items.fx_rate` does not record which currency it converts into. A saved rate is used only when the data
  layer supplies `fxQuote`.
- Rental price snapshots should use `item` = `full-package` | `skis-only` | `boots-only`.
- Lift-ticket snapshots are matched by subject, resort, category, season, window and day type only; `item` is free
  text and is not interpreted. A twilight ticket, a multi-day pack or a single-weekday promotion stored as a plain
  `lift-ticket` with a generic category / day type can therefore be picked as the day's price. Catalog prices
  must keep such products out of the generic slots (give them their own category, or a dated window).
- Categories are compared as exact (case-insensitive) strings: `adult` does not match `Adult (13-69)`. Catalog
  categories need a normalised id for the basket's default `adult` to find them.
- The holiday calendar is one user-level configuration (US federal by default); it is not per resort, so
  Canadian or European resorts get US holiday day types.
