# Environment variables

Piste runs with **no** environment variables on a local machine. Everything below is optional. Put values in
`.env.local` (never commit it). Secrets are only read on the server; nothing here is exposed to the browser except
variables prefixed `NEXT_PUBLIC_`.

| Variable | Default | Purpose |
|---|---|---|
| `PISTE_DATA_DIR` | `./data` | Directory holding `piste.db` (live) and `piste-demo.db` (demo). Must be persistent storage — do not point it at ephemeral hosting disks. |
| `PISTE_DB_FILE` | — | Explicit path for the live database file (overrides `PISTE_DATA_DIR` for live data). |
| `PISTE_PASSCODE` | — | Enables sign-in (see [Sign-in](#sign-in-optional) below). Set it before exposing Piste beyond `localhost`. Leading/trailing spaces are ignored. |
| `PISTE_SESSION_SECRET` | — | 32+ random characters (e.g. `openssl rand -base64 32`) used to sign the session cookie. Required with `PISTE_PASSCODE`: if it is missing or shorter, Piste refuses to run unprotected — every page shows a configuration error (HTTP 503) and every API answers 503. |
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
| `PISTE_OSM_EVERY_MIN` | `10080` | OpenStreetMap lifts & runs for favourites and resorts in upcoming trips (per resort; others load on demand). |
| `PISTE_WORKER_TICK_SECONDS` | `60` | How often the worker checks for due jobs (seconds). |
| `PISTE_SCHEDULER_JITTER` | `0.1` | Random jitter per due time as a fraction of the cadence (0 ≤ value < 1; `0.1` = ±10 %), so requests do not align on the hour. |
| `PISTE_WEATHER_RETENTION_DAYS` | `14` | Every weather run from the last N days (fractions allowed: `0.25` = 6 h) is kept whole. Older runs keep only what a screen reads: the latest run per resort, point and provider, and the hours each past day's "forecast then" uses (see `docs/scheduler.md`, retention). |
| `PISTE_WEATHER_HISTORY_DAYS` | unset (every day) | Size limit: past days' "forecast then" is kept for every resort for N days, then only for favourites and resorts in a trip. The history calendar says so for the others. The single-file build uses `14`. |
| `PISTE_ASSESSMENT_DETAIL_DAYS` | unset (every day) | Size limit: past days keep their newest assessment with its breakdown for N days, then only what Piste estimated before the day (score, confidence, coverage, surface). The single-file build uses `14`. |
| `PISTE_PRUNE_VACUUM` | unset | `1` runs `VACUUM` after a prune that deleted rows, so the database file shrinks (the single-file build saves the whole file). |
| `PISTE_DB_PAGE_SIZE` | unset | Page size (bytes: 4096–65536) applied by that `VACUUM`; ignored in WAL mode. The single-file build uses `16384`. |
| `PISTE_HEALTH_MAX_HEARTBEAT_MIN` | `5` (worker) / `240` (cron) | Minutes without a scheduler heartbeat after which `/api/health` reports the scheduler as stale (`?strict=1` answers 503). |

## Backups (`npm run backup` / `npm run restore`)

| Variable | Default | Purpose |
|---|---|---|
| `PISTE_BACKUP_KEEP` | `14` | Number of backups kept (positive integer; `--keep` overrides). |
| `PISTE_BACKUP_DIR` | `./data/backups` | Backup directory (`--dir` overrides). Demo backups (`--demo`) go to its `demo/` subdirectory — by default `./data/backups-demo` — so live and demo backups never share a directory. See `docs/backup.md`. |

## Sign-in (optional)

With `PISTE_PASSCODE` unset (the default, fine on your own computer) there is no sign-in at all. With it set,
`src/proxy.ts` checks every request before any route runs:

- **Pages** without a valid session redirect (307) to `/signin?next=<the page>`; after signing in you return
  there (same-origin paths only).
- **APIs** (`/api/*`) answer `401` with `{"error":"Sign-in required","signIn":"/signin"}`; Server Function calls
  and other non-GET requests without a session answer `401` too. Cron jobs (`npm run refresh`, `npm run worker`)
  run in their own process and are not affected.
- **Public without a session:** `/signin` (form, sign-out and its self-hosted fonts), Next's static build files
  (`/_next/static/…`), `/icon.svg` and the MapLibre worker files under `/vendor/maplibre/`. Everything else is
  protected, including `/_next/image` and unknown paths.
- **Session:** an HMAC-SHA256-signed cookie `piste-session` (httpOnly, SameSite=Lax, `Secure` when the request
  arrived over https directly or via `X-Forwarded-Proto`), valid for 30 days. The signing key is derived from
  `PISTE_SESSION_SECRET` and the passcode, so changing either signs every browser out. Sign out (Settings → Sign-in)
  clears the cookie on that browser.
- **Passcode check:** constant-time comparison. Failed attempts are rate-limited in memory: 5 per client address
  per 15 minutes, 30 across all addresses (so rotating addresses does not help). The limiter resets when the server
  restarts and is not shared between several server processes. The client address comes from `X-Forwarded-For` /
  `X-Real-IP`, so run Piste behind a reverse proxy that sets them (and strips client-supplied values); the global
  cap applies either way.
- Sign-in form posts are accepted from the same origin only. Serve Piste over https when it is reachable from other
  devices: the passcode travels in the form post.
