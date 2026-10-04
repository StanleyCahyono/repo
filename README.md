# Piste

A personal ski planning and tracking app for the 2026–27 season, built around a home base in Ithaca, NY.
It answers: where to ski this weekend, what is opening (announced vs estimated), what the snow is like and will be,
what your exact pass covers on your dates, what a day or trip really costs, and how to get there.

> Piste never invents opening dates, prices, events, flight details or ratings. Unknown is shown as unknown,
> estimates are labelled, weather-model output is never called "observed", and demo data is isolated. What is live
> and what is not is listed under [Data coverage](#data-coverage).

## Two ways to use it

- **One file, no install:** open [`standalone/index.html`](standalone/index.html) in a desktop browser (download it
  and double-click). It is the same app, built from the same source into one 6 MB file, and your data stays in that
  browser (with Download/Import for backups). A few things need a server and are left out: the automatic Greek Peak
  and Alta report readers, link checks, live flight offers, and refreshing while the page is closed. Details are in
  [`standalone/README.md`](standalone/README.md). Rebuild it with `npm run standalone`.
- **Full app (Node.js):** the quick start below. It adds a database file on disk, the background worker, scripted
  backups and optional sign-in for use from other devices.

## Keeping it current

**Weather, alerts and exchange rates update themselves.**

- **Single file:** it updates whenever it is open and online, and nothing is collected while it is closed.
  - **Open it once a day.** A couple of seconds after it opens it fetches what is due: the forecast at most twice a
    day, alerts hourly, exchange rates daily.
  - **Check the line under Today's title.** It says when the weather last updated, or that the latest attempt
    failed and which data you are looking at. **Update now** runs it on demand.
  - **Or keep it open in a pinned tab.** It then refreshes on its own while the computer is awake.
- **Full app:** `npm run worker`, or `npm run refresh` from cron, on a computer that stays on (see
  [`docs/scheduler.md`](docs/scheduler.md)).

**Opening dates, prices, pass rules and reports have no data feed.** They change a few times a season; when one is
announced, enter it where you see it. Each entry is labelled as yours, with its source:

- **Opening date, hours, terrain or links of a resort:** Settings → Catalog corrections → *Correct a catalog fact*.
- **Pass access rules and blackout dates:** Passes & Costs → check the pass, resort and date → *Enter the rule*, or
  *Enter a new version*. The new version is added and the old one is kept.
- **A price you were quoted:** Passes & Costs → Products & prices → *Add estimate*. It is shown as your estimate,
  never as a published price.
- **An official snow report:** the resort's page → Conditions → *Save report*, with the report's link.
- **Events** come from the catalog and cannot be added in the app yet. Save one to a trip, or add it to the trip as
  your own item.

## Screens

| Route | What it is for |
|---|---|
| `/` Today | The decision dashboard. Before the season: opening outlook (announced vs estimated), pass deadlines and sales, favourites and the new-snow watch. In season: a ranked answer for a day or weekend with presets, the ranking explanation (benefits, trade-offs, evidence), a 7-day strip, the weekend finder, alerts, recent changes and "Save trip". |
| `/explore` | Filterable resort list and map (list alternative always present), side-by-side compare of up to four resorts on the same scenario (`/explore/compare`), and resort events (`/explore/events`). |
| `/resorts/[id]` | One resort, in sections: overview (status, opening, sourced facts with source drawers), conditions (reports, manual report entry, the Conditions v1 assessment), plan a visit (hours, exact pass access for the date, prices and the day basket), getting there from Ithaca, stay and après (lodging, events), and maps and links. |
| `/forecast` | Modeled weather for the resorts you follow: next 48 hours, 16 days ahead, and a history calendar of what was forecast then, what was reported and what Piste estimated. |
| `/trips` | Trips from dates and a resort: drive vs fly (ITH plus SYR, ELM, ROC, BUF), lodging, lessons, events, an itemised budget with shared costs, a checklist, and calendar (ICS) export. Nothing is booked from here. |
| `/passes` | Your passes and their usage, a pass/date/resort access checker (a rule that isn't on file never counts as access), products and prices, rule detail with a manual rule editor, day costs with expense tiers, and pass vs lift tickets over your planned days. |
| `/season` | My Season: ski-day journal, pass days, destinations, spending against plan, learning checklist, lessons, and export (ICS, CSV, JSON) and backup. |
| `/settings` | Home and season, ability, units and currency (display only; stored values never change), travel, budget defaults, recommendation weights, alert rules, catalog corrections, theme, data mode and sign-in. |
| `/sources` | Sources & Sync: scheduler health, connectors, refresh jobs with manual refresh, per-resort coverage, failures, link checks and corrections. A disconnected source never looks live. |

## Quick start

Requires Node.js 22.12 or newer.

```bash
cd piste                # your clone of this repository, or the folder unzipped from piste-source.zip
npm install
npm run db:setup        # create data/piste.db and load the curated catalog
npm run dev             # http://localhost:3000
```

For a production server: `npm run build && npm run start` (also port 3000).

Keep data fresh from a second terminal, or from cron on an always-on machine (a sleeping laptop collects nothing):

```bash
npm run worker          # long-running scheduler: weather, reports, alerts, links, FX, assessments
# or, from cron:  npm run refresh
```

Cadences, cron and systemd examples, manual refresh and `/api/health` are in [`docs/scheduler.md`](docs/scheduler.md).

### Demo mode

Click **Explore demo mode** in the sidebar (or the More sheet on mobile) to see in-season features before the season
starts. Demo mode is a separate database (`data/piste-demo.db`, created with `npm run demo:seed`) simulating
Fri 15 Jan 2027. It is labelled everywhere and never feeds your records, recommendations, exports or alerts.

### Running beyond localhost

Nothing is required on your own computer. Before Piste is reachable from other devices:

- Set `PISTE_PASSCODE` and `PISTE_SESSION_SECRET` (32+ random characters). Every page then requires sign-in and every
  API answers 401 without a session.
- Serve it over https (the passcode travels in the sign-in form post).
- Keep `PISTE_DATA_DIR` on persistent storage and schedule `npm run backup` ([`docs/backup.md`](docs/backup.md)).

All variables are in [`docs/environment.md`](docs/environment.md); copy `.env.example` to `.env.local`.

## Data coverage

What works live, what needs credentials, and what is links or manual entry. The full matrix, with per-provider
notes, is in [`docs/providers.md`](docs/providers.md).

| Status | Integrations |
|---|---|
| **Live, no setup** | Open-Meteo modeled weather (worldwide); NWS gridpoint forecast and active alerts (US); Frankfurter ECB reference FX rates; the link checker; OpenFreeMap map tiles (in the browser). |
| **Unverified parsers** | Official snow reports for Greek Peak and Alta. Written without access to the live pages; they fail loudly (`schema-changed`) instead of returning partial data. Manual report entry is the dependable path until they are checked. |
| **Needs credentials** | Duffel flight offers (`DUFFEL_ACCESS_TOKEN`). Without it, flights are prefilled Google Flights / KAYAK search links plus manual itinerary and quote entry. |
| **Links and manual records** | Every other resort's reports (manual entry with a source URL plus official links); pass products, access rules and prices, lift prices, lodging and events (curated catalog records with per-fact sources, correctable in the app); driving directions (Google Maps links; drive times are curated estimates). |
| **Not implemented** | openrouteservice routing (`ORS_API_KEY` is reserved and read by nothing). |

The "live" adapters were built against the providers' documented APIs and tested with fixtures in the documented
format. The build environment could not reach any external host, so none has run against the real service yet; the
first successful refresh on a networked machine confirms them, and Sources & Sync shows exactly what succeeded when.
Until then, live mode shows honest "not fetched yet" or failure states, never demo data.

**Catalog** (`catalog/`, validated with `npx tsx scripts/validate-catalog.ts`): 108 resorts (North America, Japan,
Australia and New Zealand, Austria, Switzerland, France, Italy, Germany, Andorra, Spain and Sweden), 23 pass products,
130 pass access rules, 43 airports, 13 hotels and 2 events. Lift and run lists come from OpenStreetMap on each resort
page (loaded automatically for favourites).

- Fully researched: Greek Peak, Bristol, Holiday Valley and Elk Mountain. Partly researched: Labrador and Belleayre.
  Researched facts are shown as "Researched — confirm at source" with their source links.
- The other 27 resorts carry stable reference facts only (location, elevation, official links, road and avalanche
  portals), shown as "Reference — confirm". Their 2026–27 opening dates, prices, hours and pass access are unknown
  and shown as unknown, with official links and a manual-edit route.
- How the research ran out, and how to fill the gaps (Settings → corrections, the Passes rule editor, or re-running
  the research), is in [`docs/assumptions.md`](docs/assumptions.md) and [`catalog/README.md`](catalog/README.md).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js development server / production build / production server |
| `npm run db:setup` | Migrate and seed the live database |
| `npm run db:seed` | Reload `catalog/` (idempotent; keeps your corrections and personal records) |
| `npm run demo:seed` | Regenerate the isolated demo database |
| `npm run worker` | Scheduler loop (see `docs/scheduler.md`) |
| `npm run refresh` | One refresh pass (for cron); `-- --jobs weather,reports` for a subset |
| `npm run backup` / `restore` | SQLite backup / validated restore (see `docs/backup.md`) |
| `npm run typecheck` / `lint` / `test` | TypeScript, ESLint, Vitest unit tests |
| `npm run e2e` | Playwright journeys against a production build (see below) |
| `npm run standalone` / `standalone:verify` | Build the single-file `standalone/index.html` / check it in headless Chromium from its file URL |

## Tests

- **Unit** (`npm test`, Vitest, beside the code as `*.test.ts`): unit conversion, accumulation windows,
  midnight/DST, missing data, closures, beginner vs powder scoring, pass blackouts and day pools, quote expiry,
  shared trip costs, parser schema changes, refresh-failure behaviour, sign-in, and the read models and actions.
- **End to end** (`e2e/`, Playwright): the brief's nine journeys plus a route smoke test, on a desktop (1440 px) and
  a mobile (390 px) project. Run `npm run build` first, then `npm run e2e`. Set
  `PLAYWRIGHT_CHROMIUM_PATH` to use an installed Chromium.
- **Screenshots**: `node scripts/shots.mjs <base-url> <out-dir> <routes…>` captures 390 / 768 / 1440 px in light and
  dark (`SHOT_DEMO=1` for demo mode). `node scripts/contrast.mjs` checks the colour tokens against WCAG AA.

## Project layout

```
catalog/            curated seed data (JSON) with per-fact sources
docs/               brief, methodology, providers, scheduler, backup, environment, design, assumptions
drizzle/            the SQL migration
e2e/                Playwright journeys
scripts/            CLI entry points: migrate, seed, demo, worker, refresh, backup, restore, checks
standalone/         the single-file build: index.html (generated), its build and verify scripts, browser shims
src/app/            routes (App Router); src/proxy.ts is the optional sign-in gate
src/components/     ui/ design-system primitives, one folder per screen
src/lib/domain/     pure logic: units, time, money, Conditions v1, pass rules, costs, recommendation
src/lib/providers/  external data adapters (all network access goes through http.ts)
src/lib/jobs/       idempotent refresh jobs, scheduler, alerts
src/lib/data/       server-side read models;  src/lib/actions/  validated server actions
```

Conventions for contributors (and coding agents) are in [`AGENTS.md`](AGENTS.md).

## Documentation

- [`docs/brief.md`](docs/brief.md): the product brief (acceptance criteria)
- [`docs/methodology.md`](docs/methodology.md): Piste Conditions v1 scoring, cost bands and trip costs
- [`docs/providers.md`](docs/providers.md): source and provider coverage matrix, API notes
- [`docs/scheduler.md`](docs/scheduler.md): refresh cadences, running the worker, health
- [`docs/backup.md`](docs/backup.md): backup and restore
- [`docs/environment.md`](docs/environment.md): environment variables and sign-in
- [`docs/design.md`](docs/design.md): design system
- [`docs/assumptions.md`](docs/assumptions.md): decisions and build-environment adaptations
- [`catalog/README.md`](catalog/README.md): how the catalog was researched and how to correct it

Piste does not purchase services, book trips or publish anything. Links open the official sites, where you decide.
