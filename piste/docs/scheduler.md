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
| `prune` | daily | `PISTE_PRUNE_EVERY_MIN` | Retention (below). |

Other settings: `PISTE_WORKER_TICK_SECONDS` (60), `PISTE_SCHEDULER_JITTER` (0.1 = ±10 % of each cadence, so
requests do not align on the hour; 0 ≤ value < 1), `PISTE_WEATHER_RETENTION_DAYS` (14), `PISTE_DISABLED_PROVIDERS`
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
- Retention (`prune`): every run from the last 14 days is kept. Older runs: the **first successful run per resort /
  point / provider / resort-local day** is kept — a forecast made before its valid time stays available to compare
  with what was later reported — and the rest are deleted. Stored runs are never rewritten with newer data.
- `source_records` older than 30 days are pruned except the newest per adapter/resort/URL; `refresh_runs` older than
  60 days (skipped rows after 7 days), except the run "last success" points at for each job and for each resort —
  including a resort's success recorded inside a global run — which is kept whatever its age.

## Assessments history

`assessments` recomputes Piste Conditions v1 from the database: the latest status statement known for the date,
the latest operations report on or before the date (personal feedback is passed as feedback, never as an
operations report), the latest successful primary weather run per point, an alternate model's daily snowfall when
one is stored (NWS), published lift hours and official alerts. A new `conditions_assessments` row is written only
when the material result changes (score, components, surface, confidence, eligibility, and the report/status rows
used). Earlier rows are never updated, so the history calendar can show what the app estimated at the time. Without
any stored forecast only yesterday and today are assessed. Rows computed in the demo database are kind `demo`.

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
