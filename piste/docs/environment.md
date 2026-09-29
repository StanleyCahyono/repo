# Environment variables

Piste runs with **no** environment variables on a local machine. Everything below is optional. Put values in
`.env.local` (never commit it). Secrets are only read on the server; nothing here is exposed to the browser except
variables prefixed `NEXT_PUBLIC_`.

| Variable | Default | Purpose |
|---|---|---|
| `PISTE_DATA_DIR` | `./data` | Directory holding `piste.db` (live) and `piste-demo.db` (demo). Must be persistent storage — do not point it at ephemeral hosting disks. |
| `PISTE_DB_FILE` | — | Explicit path for the live database file (overrides `PISTE_DATA_DIR` for live data). |
| `PISTE_PASSCODE` | — | Enables sign-in. Set this before exposing Piste beyond `localhost`. |
| `PISTE_SESSION_SECRET` | — | 32+ random characters used to sign the session cookie. Required with `PISTE_PASSCODE`. |
| `PISTE_CONTACT` | — | Contact (email or URL) added to the User-Agent. api.weather.gov asks every client to identify itself. |
| `OPEN_METEO_API_KEY` | — | Only for Open-Meteo's commercial API. Personal, non-commercial use needs no key. |
| `DUFFEL_ACCESS_TOKEN` | — | Enables live flight offers through Duffel. Test tokens (`duffel_test_…`) return test data, labelled as such. Without it, Piste offers flight-search links and manual itinerary/quote entry. |
| `ORS_API_KEY` | — | **Not implemented yet (reserved).** Nothing reads it today; drive times are curated estimates plus map direction links. |
| `PISTE_DISABLED_PROVIDERS` | — | Comma-separated provider ids to switch off. Refresh jobs never call a disabled provider, and its runs never count as "last successful update": `open-meteo`, `nws-grid`, `nws-alerts`, `frankfurter`, `link-check`, `alta-official`, `greek-peak-official`. `duffel` is also accepted and shown as disabled on Sources. Example: `nws-grid,link-check`. |
| `NEXT_PUBLIC_MAP_STYLE_URL` | OpenFreeMap Positron | MapLibre style URL. Must allow your traffic volume and show its attribution. |
| `NEXT_DIST_DIR` | `.next` | Build directory (lets several dev servers run side by side). |
| `NODE_USE_ENV_PROXY` | — | Set to `1` if you are behind an HTTPS proxy: Node's built-in fetch only honours `HTTPS_PROXY` with this flag (Node ≥ 22.21). |
| `PISTE_FIXED_NOW` | — | Test/debug only: pin the app clock to an ISO instant. |

## Scheduler, retention and health

Cadences (`*_EVERY_MIN`, in minutes) and the tick/jitter settings apply to the long-running worker
(`npm run worker`); `npm run refresh` (cron) runs every job once and ignores them. Retention applies whenever the
`prune` job runs; the heartbeat threshold applies to `/api/health`. Invalid values (for cadences, days and minutes:
anything but a positive number) fall back to the default. See `docs/scheduler.md`.

| Variable | Default | Purpose |
|---|---|---|
| `PISTE_WEATHER_EVERY_MIN` | `180` | Weather forecasts for every resort point. |
| `PISTE_REPORTS_EVERY_MIN` | `60` | Official resort reports between 06:00 and 18:00 resort-local time. |
| `PISTE_REPORTS_NIGHT_EVERY_MIN` | `240` | Official resort reports outside those hours. |
| `PISTE_ALERTS_EVERY_MIN` | `60` | Official NWS weather alerts (watches/warnings). Piste's own in-app alerts are evaluated after every refresh pass. |
| `PISTE_STATUS_EVERY_MIN` | `60` | Operating status derived from season dates (announced opening reached, season closed). |
| `PISTE_ASSESSMENTS_EVERY_MIN` | `360` | Conditions assessments; also recomputed right after new weather, report or status data. |
| `PISTE_LINKS_EVERY_MIN` | `1440` | Link checks. |
| `PISTE_FX_EVERY_MIN` | `1440` | Currency reference rates. |
| `PISTE_PRUNE_EVERY_MIN` | `1440` | Retention pruning. |
| `PISTE_WORKER_TICK_SECONDS` | `60` | How often the worker checks for due jobs (seconds). |
| `PISTE_SCHEDULER_JITTER` | `0.1` | Random jitter per due time as a fraction of the cadence (0 ≤ value < 1; `0.1` = ±10 %), so requests do not align on the hour. |
| `PISTE_WEATHER_RETENTION_DAYS` | `14` | Every weather run from the last N days is kept; older runs keep the first successful run per resort, point, provider and resort-local day. |
| `PISTE_HEALTH_MAX_HEARTBEAT_MIN` | `5` (worker) / `240` (cron) | Minutes without a scheduler heartbeat after which `/api/health` reports the scheduler as stale (`?strict=1` answers 503). |

## Backups (`npm run backup` / `npm run restore`)

| Variable | Default | Purpose |
|---|---|---|
| `PISTE_BACKUP_KEEP` | `14` | Number of backups kept (positive integer; `--keep` overrides). |
| `PISTE_BACKUP_DIR` | `./data/backups` | Backup directory (`--dir` overrides). Demo backups (`--demo`) go to its `demo/` subdirectory — by default `./data/backups-demo` — so live and demo backups never share a directory. See `docs/backup.md`. |
