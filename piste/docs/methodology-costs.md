# Methodology — pass access and costs

This section explains how Piste answers "Can I use my exact pass here on this date?" and "What will a day, a
trip or a season cost?". The code lives in `src/lib/domain/passes/` and `src/lib/domain/costs/`. These are pure
functions: they take rows and the app clock as inputs and never read the database, the network or the system
clock.

The rules below follow the data-honesty principles in `AGENTS.md`. Unknown means unknown. It is never read as
permission, never read as $0, and it never produces a tier.

---

## 1. Pass access

### What a badge means and what a verdict means

- **Family badges** (Ikon, Epic, Indy, Mountain Collective, Regional) are for **discovery only**. A resort gets a
  family badge when at least one product in that family has a current rule there that is not `not-included`.
  When every such rule is `unknown` or `discount-only`, the badge is flagged `qualifiedOnly`. A badge never
  means you own a pass, and it never means your product covers the resort.
- A **verdict** answers the question for one **exact product**, one resort and one resort-local date. It uses
  that product's current rule (the highest `version`) and your logged usage.

### Evaluation order (the first match wins)

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

### Day limits and shared pools

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

---

## 2. Day basket and expense tiers

### What goes in the basket

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

### Day types and holidays

Prices are looked up by day type: weekday, weekend or holiday. A holiday takes priority over a weekend. The
holiday calendar is configurable (`DayTypeConfig`). It includes US federal holidays, which are computed for each
season so later seasons work without edits, plus observed days. It also includes an optional Christmas–New Year
period (default 25 Dec → 1 Jan inclusive) and any dates or ranges you add. The 2026–27 defaults are:

Independence Day (4 Jul, observed 3 Jul) · Labor Day 7 Sep · Columbus Day 12 Oct · Veterans Day 11 Nov ·
Thanksgiving 26 Nov · Christmas–New Year 25 Dec – 1 Jan · MLK Day 18 Jan · Presidents' Day 15 Feb · Memorial
Day 31 May · Juneteenth 19 Jun (observed 18 Jun).

Resort-specific "peak" calendars belong on the price snapshot's `appliesFrom` / `appliesTo`, not in this list.

### Choosing a price snapshot

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

### The incomplete-estimate rule

- **Required lines** are lift access and, when you rent, the rental. (Callers can also make parking or lunch
  required.) If any required line is unknown, the basket is `complete: false`. It then has **no total**, and its
  tier is **"Incomplete estimate"**. A tier is never produced from partial data. The known lines are still
  listed so you can see the itemisation, and `knownSubtotal` is never classified.
- **Optional lines** (lunch and parking by default) that are unknown are listed under `missing`, left out of the
  total, and noted as a caveat (for example "Excludes parking (unknown)").
- If a price is known but no stored FX rate can convert it, that line is shown in its original currency, and the
  basket has no display total. If that price can't be converted to USD either, there is no tier.

### Expense tier bands

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

---

## 3. Currency conversion (FX)

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

---

## 4. Trip budget

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

---

## 5. Pass comparison calculator

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

---

## 6. Season budget

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

---

## 7. Data conventions and known limits

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
