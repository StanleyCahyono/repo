# Scheduler, refresh jobs and alerts

Piste collects data with server-side jobs. Nothing is collected by the browser, and **a sleeping or powered-off
machine cannot collect data**: forecasts made while it slept are simply missing from history (the calendar shows
the gap). For continuous collection, run the worker on an always-on host (a small home server, a NAS, a VPS), or
call a single refresh pass from cron on a machine that is awake.

## Ways to run

| Command | What it does |
|---|---|
| `npm run worker` | Long-running worker. Checks every 60 s which jobs are due, runs them one at a time, writes a heartbeat. Stops gracefully on `Ctrl-C` / `SIGTERM` (the item in progress finishes; a second signal exits immediately). |
| `npm run refresh` | One pass of every job, in order, then exit — for cron. `npm run refresh -- --jobs weather,reports` runs a subset. Exit code 1 if any job ended in `error`. |
| `POST /api/refresh` | Manual refresh of one job from the app (see below). |
| `npm run db:migrate` | Apply migrations to the live database (`-- --demo` for the demo database). The app also migrates on first open. |

Only the **live** database is refreshed. The demo database is never filled from live sources, and live refreshes
are refused in demo mode.

### Cron example

```cron
# Every 3 hours at minute 7, plus hourly official reports during the day (Eastern time machine clock).
7 */3 * * *   cd /srv/piste && npm run refresh >> data/refresh.log 2>&1
37 6-18 * * * cd /srv/piste && npm run refresh -- --jobs reports,status,assessments,alerts >> data/refresh.log 2>&1
```

With cron, `/api/health` judges the heartbeat against 240 minutes (`PISTE_HEALTH_MAX_HEARTBEAT_MIN` overrides).

### systemd example (always-on Linux host)

```ini
[Unit]
Description=Piste refresh worker
After=network-online.target

[Service]
WorkingDirectory=/srv/piste
ExecStart=/usr/bin/npm run worker
Restart=on-failure
KillSignal=SIGTERM
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
```

## Jobs and cadences

| Job | Default cadence | Env override (minutes) | Notes |
|---|---|---|---|
| `weather` | 180 min | `PISTE_WEATHER_EVERY_MIN` | Every resort weather point (base/summit) from every supporting provider: Open-Meteo (primary), NWS gridded forecast (US, stored as an alternate model for disagreement checks). 3 past days + 16 forecast days. |
| `nws-alerts` | 60 min | `PISTE_ALERTS_EVERY_MIN` | Official NWS watches/warnings per US resort. Ended or withdrawn alerts are removed. |
| `reports` | 60 min between 06:00–18:00 **resort-local**, 240 min otherwise | `PISTE_REPORTS_EVERY_MIN`, `PISTE_REPORTS_NIGHT_EVERY_MIN` | One task per resort with an official report adapter (Greek Peak, Alta). |
| `status` | 60 min | `PISTE_STATUS_EVERY_MIN` | Status implied by season dates (see "Honesty rules"). Local and cheap, so an announced date passing (or a recorded closing) shows within the hour. |
| `assessments` | every 6 h, and after weather/report/status changes | `PISTE_ASSESSMENTS_EVERY_MIN` | Conditions v1 for every resort, today−1 … forecast horizon (≤ 16 days), all three modes. |
| `alerts` | after every refresh pass | — | Evaluates alert rules → in-app alerts. |
| `fx` | daily | `PISTE_FX_EVERY_MIN` | ECB reference rates for every currency in use. |
| `links` | daily | `PISTE_LINKS_EVERY_MIN` | Re-checks links older than 20 h (≤ 300 per run, 250 ms apart). |
| `prune` | daily | `PISTE_PRUNE_EVERY_MIN` | Retention (below). The single-file build prunes every 6 h and on every visit. |

Other settings: `PISTE_WORKER_TICK_SECONDS` (60), `PISTE_SCHEDULER_JITTER` (0.1 = ±10 % of each cadence, so
requests do not align on the hour; 0 ≤ value < 1), `PISTE_WEATHER_RETENTION_DAYS` (14; retention settings below), `PISTE_DISABLED_PROVIDERS`
(comma-separated ids of providers the jobs must not call: `open-meteo`, `nws-grid`, `nws-alerts`, `frankfurter`,
`link-check`, `alta-official`, `greek-peak-official`). Invalid or non-positive cadence values fall back to the
defaults. All variables are listed in `docs/environment.md`.

Due times are computed from `refresh_runs`, so restarting the worker does not re-run everything, and a job + target
that is already running is never started twice (a `running` row older than 90 min is marked abandoned). After a
failed run the job is retried after min(cadence, 30 min). A job body that throws is retried once with backoff;
provider-level retries/timeouts live in `src/lib/providers/http.ts`.

## Run records and "last successful update"

Every run is a `refresh_runs` row: `running` → `ok` / `partial` / `error` / `skipped`, with attempts, items written,
the error text and per-source outcomes in `details.items` (`{ key, target, ok, skipped, written, error }`).

- **Per-source isolation:** each resort/point/provider is its own item. One failing never aborts the others; the
  run is `partial` when some items failed.
- **Last success** (`lastSuccess(db, job, target?)`, rule in `src/lib/jobs/success.ts`) only considers `ok`/`partial`
  runs; for a resort, a global run counts only if that resort's own item succeeded. A failed run never advances it.
  Jobs that call external sources (`weather`, `nws-alerts`, `reports`, `links`, `fx`) count only when at least one
  real fetch succeeded: a run that fetched nothing — no provider configured or disabled, every source unsupported,
  every item skipped — is recorded `ok` but does not advance "last successful update", so a disconnected provider
  never looks fresh. Local jobs (`status`, `assessments`, `alerts`, `prune`) count whenever they complete. The whole
  run history is searched, so a source failing for months still shows its real last success.
- **Failed weather fetches** add a `weather_runs` row with `status = 'error'` (shown on Sources) and never delete or
  modify earlier good runs. A response the adapter accepted but that holds no usable hour (an empty time axis, or
  renamed variables that all parse as null) is treated the same way, as a `schema-changed` failure: an error run, a
  `source_records` row with `ok = false` and the parser error, and the last good run stays the latest.
- **Report fetches** are always logged in `source_records` (adapter, URL, HTTP status, content hash, extract, error,
  parser errors). An unchanged report (same content hash, ignoring the page's "updated" time and the date) creates
  no new revision and does not touch the stored report's `reportedAt`, so its observation age keeps growing. A
  changed report becomes revision n+1 for that resort and local date.

## Manual refresh (`POST /api/refresh`)

```http
POST /api/refresh
Content-Type: application/json

{ "job": "weather", "target": "alta" }
```

- Jobs: `weather`, `nws-alerts`, `reports`, `status`, `assessments` (target optional), `alerts`, `links`, `fx`
  (global only).
- **Cooldown:** 10 minutes per job + target since the last run that actually ran. Within it the answer is `429`
  with `nextAllowedAt` and `Retry-After`. Skipped attempts do not extend the cooldown.
- After new weather/report/status data, assessments for the target and alerts are recomputed immediately.
- `409` in demo mode for jobs that call live sources, or while the same job is already running. Cross-site browser
  requests are refused.

## Health (`GET /api/health`)

Returns the scheduler heartbeat (`app_meta['scheduler.heartbeat']`), its age, whether it is stale (worker: > 5 min;
cron: > 240 min; `PISTE_HEALTH_MAX_HEARTBEAT_MIN` overrides both), last success per job (reports per resort; see
"last successful update" above), and the latest run of each job. `?strict=1` answers `503` when stale, for an
external uptime monitor.

## Weather history and retention

- `weather_points.validTime` is the provider's UTC stamp. `localDate` is the resort-local day of the hour the value
  describes, using the provider's interval semantics (stored per run in `weather_runs.interval_semantics`). For
  Open-Meteo (`preceding-hour`) a value stamped 00:00 local covers 23:00–24:00 of the **previous** day, and DST days
  have 23 or 25 hours.
- Grid coordinates/elevation, units and model run time are stored as returned; a missing model run time stays null.
- Stored runs are never rewritten with newer data. Retention is below.

## Retention (`prune`)

Only what a screen, the history calendar or an alert still reads is kept. The rules live in
`src/lib/jobs/retention.ts`, and the history calendar (`src/lib/data/forecast.ts`) selects with the same helpers, so
the two cannot drift apart. `src/lib/jobs/retention.test.ts` checks that every reader (history calendars, latest
runs and their hours, newest assessments, trip-alert inputs) returns exactly the same data after a prune, and that a
second prune changes nothing.

**Who reads old rows:**

- Forecast, resort pages, Today, assessments and alerts read only the **latest successful run per resort / point /
  provider** (all its hours). Nothing compares a run with earlier runs. "Model disagreement" uses the latest NWS
  run, and the snow alert uses the latest run (fetched within 12 h).
- History calendar, **forecast then**: for each past resort-local day and point (base, summit), the primary run
  fetched most recently before the day started (Open-Meteo is preferred to NWS even when older, within a look-back
  of 17 days before the month), and only its hours from the day's start to its end + 1 h. With one visit a day, that
  is yesterday's first run and about 26 of its 456 hours.
- History calendar, **Piste estimated then**: for each past day and mode, the newest assessment computed before the
  day started. Only headline fields are read: score, kind, descriptor, confidence, surface, lead time and model.
- Every screen that shows a date, including a resort page for a past date (up to 400 days back) and trip days up to
  7 days back, shows the **newest assessment** per resort, date and mode, with its breakdown.
- **Outlook fell** alerts compare every assessment computed since the trip was created for trip days that are today
  or later. They read score and kind.
- **Tracking start** (when not recorded) is the earliest successful run and the earliest assessment per resort.
- No screen dereferences an assessment's `inputs.weatherRunIds`, so deleting runs cannot break a view. The report
  and status ids it holds point at rows that are never pruned.

**Weather runs:** every run fetched in the last `PISTE_WEATHER_RETENTION_DAYS` days (default 14) is kept whole, and
so is any run stamped in the future. Older runs:

- the latest successful run per resort / point / provider stays whole, however old (the app was not opened for
  weeks);
- a run that is a past day's forecast-then keeps only the hours that day reads. One run can serve several days when
  the app was not opened in between;
- the earliest successful run per resort keeps its row (tracking start);
- everything else is deleted: superseded runs, NWS runs no past day used (NWS is only picked when Open-Meteo has
  nothing for that point), other points, and old error rows.

**Assessments** (no window): per resort, date and mode the newest row is kept whole. The "estimated then" row, the
trip rows and the earliest row per resort are kept for their headline facts only: their components, explanation and
confidence reasons are emptied, and the explanation says the breakdown is not kept. A row that is not the newest can
never become the newest again. Rows stamped in the future are left alone. Everything else is deleted.

**Size limits (off by default; the single-file build turns them on):**

- `PISTE_WEATHER_HISTORY_DAYS=N`: past days keep forecast-then for every resort for N days, then only for
  favourites and resorts in a trip (not cancelled). For the others the prune records the first day still kept in
  `app_meta['history.forecastKeptFrom.<resort>']`. The history calendar then shows no forecast-then for earlier days
  and says why. It does not count them as gaps, and it still shows what was reported and what Piste estimated then.
- `PISTE_ASSESSMENT_DETAIL_DAYS=N`: a past day older than N days keeps only its "estimated then" row, or its newest
  row when nothing was estimated before it, as headline facts. A resort page for such a date shows that score,
  confidence and surface, with "Older assessment: its breakdown and reasons are not kept."
- `PISTE_PRUNE_VACUUM=1` runs `VACUUM` after a prune that deleted rows, and `PISTE_DB_PAGE_SIZE=16384` sets the page
  size it writes. Assessment rows of 1–3 KB waste much of a 4 KB page.

Other tables: `source_records` older than 30 days are pruned except the newest per adapter/resort/URL;
`refresh_runs` older than 60 days (skipped rows after 7 days) are pruned, except the run "last success" points at for
each job and for each resort, including a resort's success recorded inside a global run, which is kept whatever its
age. Reports, status events, opening-date history and personal records are never pruned.

**Measured** (`src/lib/jobs/retention.sim.test.ts`: the real Open-Meteo and NWS adapters fed full-size synthetic
responses, once-a-day passes of weather, status, assessments, alerts and prune; 2 simulated US resorts extrapolated
linearly to the 33 in the catalog; size = `page_count × page_size` after `VACUUM`):

| Settings | Growth | Day 70 | Day 200 (projected) |
|---|---|---|---|
| Before this change (every day's first run kept with all 456 hours, assessments never pruned), 1 visit a day | 13.5 MB/day | ≈ 940 MB (607 MB measured at day 45) | ≈ 2.7 GB |
| Exact rules only, `PISTE_WEATHER_RETENTION_DAYS=0.25`, 16 KB pages (no visible loss) | 0.67 MB/day | 69 MB | ≈ 157 MB |
| Single-file settings (above plus both size limits at 14 days), 2 favourites | 0.075 MB/day | ≈ 35 MB | ≈ 45 MB |
| Next app defaults (14-day window, weather every 3 h), after this change | ≈ 0.85 MB/day beyond the window | ≈ 0.9 GB | ≈ 1.0 GB |

In the single-file row, each extra favourite or trip resort adds about 11 KB a day, about 2 MB over 200 days. In the
Next app the 14-day full-retention window is most of the size: about 770 MB of whole runs at 8 passes a day. No
screen reads it, so `PISTE_WEATHER_RETENTION_DAYS=2` brings 200 days down to about 320 MB and `0.25` to about 210 MB.
The projections scale `refresh_runs` and `source_records` with the resort count too, so they err on the high side.
Run `PISTE_SIM_REPORT=1 PISTE_SIM_DAYS=70 [PISTE_SIM_SINGLE_FILE=1] npx vitest run src/lib/jobs/retention.sim.test.ts`
to measure again.

## Assessments history

`assessments` recomputes Piste Conditions v1 from the database: the latest status statement known for the date,
the latest operations report on or before the date (personal feedback is passed as feedback, never as an
operations report), the latest successful primary weather run per point, an alternate model's daily snowfall when
one is stored (NWS), published lift hours and official alerts. A new `conditions_assessments` row is written only
when the material result changes (score, components, surface, confidence, eligibility, and the report/status rows
used). A score is never rewritten, so the history calendar can show what the app estimated at the time. The prune
deletes superseded rows no screen reads and empties the unread breakdown of rows kept for their headline (see
Retention). Without any stored forecast only yesterday and today are assessed. Rows computed in the demo database are
kind `demo`.

## Honesty rules enforced by jobs

- Status events are appended only on change and never reordered (an older statement is not appended).
- A statement cannot postdate its retrieval: an official report stamped after it was fetched (a typo, or a local
  "updated 06:00" parsed as UTC) enters the status history at the fetch time — the stored report keeps the source's
  own `reportedAt`. A manual report whose reported time is more than 5 minutes in the future is rejected; within
  that clock-skew allowance its status takes effect at entry time.
- An announced opening date never produces `open`. Before it, the derived status is `not-yet-open`; once it passes
  without an official confirmation the derived status becomes `unknown` ("Status unavailable"). Derived statuses
  never override a newer official statement of the same season; a statement from an earlier season (last April's
  "closed for the season") does not block the new season's derived status.
- A derived status describes the whole resort-local day, so it is stamped at local midnight: an official statement
  made later that day wins even if it is fetched after the status job ran. (When it supersedes a statement about an
  earlier date that was first recorded later today, it takes that statement's time instead.)
- An official `open`/`partially-open` report confirms the actual opening; `closed-for-season` after an opening
  confirms the actual closing. Every change of announced/actual opening/closing is logged to
  `opening_date_history`.
- Manual reports: kind `manual` (typed from an official source, source URL required), kind `official` entered by me
  (`verification: user-confirmed`, `note: entered-by-user`), personal feedback (kind `manual`, provider `You`,
  `note: personal`). Personal feedback never sets status, season dates or terrain. Use `reportOrigin(row)` to label
  them.

## Alerts

In-app only (`alerts` table); no browser push. Default rules are created once per favorite (opening-date change,
resort opened, snow ≥ 15 cm in 72 h) and once globally (pass sales deadline ≤ 14 days, forecast deterioration ≥ 15
points for saved-trip days, new/updated events at favorite or trip resorts, verified price changes). Rules you delete
are not recreated.

- **Dedupe:** each alert has a unique key `type:subject:bucket` (e.g. snow threshold: resort + the local day the
  threshold is crossed; price change: the new snapshot). Repeated refreshes of the same forecast never repeat it.
- **Snow threshold** alerts use only a forecast fetched within the last 12 hours
  (`CONDITIONS_CONFIG_V1.confidence.weatherStaleHours`); after fetches have failed for longer, the last good run is not
  presented as current news. Summit first, Open-Meteo preferred.
- **Opening-date changes** researched by web search (catalog reseeds, verification `search-summary`) say
  "Researched — confirm at source"; unverified ones say "Unverified — confirm at the official source".
- **Cooldown:** per rule and subject (default 12 h). A new bucket inside the cooldown is held back and fires later if
  the condition still holds.
- Price changes use verified snapshots only (`published`/`observed-quote` with verification `api`, `official-page`
  or `user-confirmed`), compared within the same subject, item, category, day type, season, currency, validity dates
  (`appliesFrom`/`appliesTo`, i.e. date-specific tickets), purchase-by tier and tax treatment. Two prices observed at
  the same instant are conflicting statements, not a change. Researched (search-summary) prices never trigger
  alerts.
- Event alerts start from what exists when a resort is first watched (no burst of alerts for the existing catalog).
