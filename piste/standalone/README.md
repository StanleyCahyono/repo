# Piste as a single file

`standalone/index.html` is the whole Piste app in one HTML file. Double-click it (or open it with
File → Open in your browser). You don't need to install anything, and there is no server or Node. It runs the same
screens, components, engines and data model as the Next.js app. It is built from the same source.

```bash
npm run standalone          # rebuild standalone/index.html from the current src/ (about 3 s)
npm run standalone:verify   # re-check it in headless Chromium from its file:// URL (routes, interactions, exports, demo)
```

`verify` accepts `--shots <dir>` for screenshots at 390 and 1440 px, light and dark, `--no-demo`, and
`--chromium <path>`. It also reads `PLAYWRIGHT_CHROMIUM_PATH`.

## Daily use

- **Open the file once a day, or keep it open in a pinned tab.** A couple of seconds after it opens, it fetches what
  is due: the forecast at most twice a day, alerts hourly, exchange rates daily.
- **Check the line under Today's title.** It says when the weather last updated, or that the latest attempt failed
  and which data you are looking at. **Update now** runs it straight away.
- **Nothing is collected while the file is closed or the computer sleeps.**
- **Opening dates, prices, pass rules and snow reports have no data feed.** Enter them in the app as they are
  announced; "Keeping it current" in the main README says where.
- **Keep a copy now and then:** Settings → Export & backup → *Download my data*.

## What works

- **Every screen, in live and demo mode:** Today, Explore (list, map, compare, events), resort pages, Forecast, Trips,
  Passes & Costs (products, matrix, costs, compare, rule editor), My Season, Settings and Sources & Sync. Unknown
  resorts, trips and addresses show the app's own not-found pages.
- **Your data stays in this browser.** Live and demo data are two separate SQLite databases (SQLite compiled to
  WebAssembly). Your changes are saved in IndexedDB within a second, the in-page scheduler's writes at most every
  10 minutes, and everything is saved when the tab is hidden or closed (see "Saved data" below). On first start the curated
  catalog is loaded (`seedCatalog`, the same code as `npm run db:setup`). If a rebuilt file carries a changed catalog,
  it is re-seeded automatically. Your corrections and records are kept.
- **Demo mode:** the first switch builds the demo season in the page, with a progress screen (about 15 s). It is
  saved, so later switches are instant. Returning to live never touches demo data, and demo data never touches live.
- **Exports:** JSON, CSV and trip/event calendar (ICS) downloads come from the app's own export handlers, which run in
  the browser. Settings → Export & backup and My Season → Export also offer:
  - **Download my data (.db):** the whole database as a standard SQLite file, in the same format as the server's
    `data/piste.db`.
  - **Import a .db file:** replaces your live records after checking the file. It must be SQLite, have this version's
    schema, and not be a demo database.
- **Refresh jobs while the page is open:** in live mode and online, the same scheduler as `npm run worker` ticks once a
  minute. It fetches Open-Meteo, NWS forecasts and alerts, and Frankfurter FX, then runs status, assessments, alerts and
  prune, each on its own cadence. OpenStreetMap lifts & runs load weekly for favourites and resorts in upcoming trips,
  and on demand from any resort page (the Overpass API answers browsers, so it works from `file://`). Weather is fetched every 12 h, so every daily visit gets a fresh forecast. The
  server's default is 3 h. A failed refresh never advances "last successful update".
- **Maps:** MapLibre GL runs from an embedded worker. Tiles come from OpenFreeMap, so they need an internet connection.
  Offline, the schematic map says so.
- **Links and history:** URLs look like `index.html?view=map#/explore`: the app's query is the real query, and the
  path sits in the fragment. Links open in new tabs, and back and forward work. Filters survive a reload, and in-page
  section links scroll without changing the page.
- **One tab at a time:** every tab holds the data in memory, so two tabs would overwrite each other's saves. Opening
  the file again takes over: the older tab saves, then shows "Piste is open in another tab" with a button to take it
  back.

Measured in headless Chromium on the build machine:

| | |
|---|---|
| File size | about 6 MB (JS 5.6 MB, CSS with fonts 0.4 MB, SQLite WebAssembly and MapLibre worker inlined) |
| Start, first time (includes loading the catalog) | about 1.0–1.3 s to the first rendered page |
| Start with saved data | about 0.7–0.95 s |
| Demo generation, first switch | about 12–13 s (`npm run demo:seed` takes about 14 s natively on the same machine) |
| Saved data | about 0.75 MB live on first start (about 1.6 MB after the first prune writes 16 KB pages); the demo database is about 51 MB |

### Saved data

The whole live database is held in memory and saved to IndexedDB as one file, so it must stay small with daily use.
A refresh pass writes about 40,000 hourly weather rows and up to 1,683 assessments (about 8 MB). Before this was
limited, a year of once-a-day visits would have reached gigabytes. The single file is built with these settings
(`standalone/build.mjs`; the rules are in `docs/scheduler.md`, "Retention"):

- **Weather every 12 h** (`PISTE_WEATHER_EVERY_MIN=720`). **Only the current pass is kept whole**
  (`PISTE_WEATHER_RETENTION_DAYS=0.25`), because no screen compares a forecast with earlier runs.
- **Past days:** the forecast-then hours the history calendar reads (about 26 per point and day) are kept for every
  resort for 14 days. After that they are kept only for favourites and resorts in a trip
  (`PISTE_WEATHER_HISTORY_DAYS=14`); for other resorts the calendar says the older forecast-then is not kept. "Piste
  estimated then" is kept for every resort and day. A past day's full assessment breakdown is kept for 14 days
  (`PISTE_ASSESSMENT_DETAIL_DAYS=14`). After that its score, confidence and surface remain.
- **Prune on every visit and every 6 h**, right after the refresh (`PISTE_PRUNE_EVERY_MIN=360`), then `VACUUM` with
  16 KB pages (`PISTE_PRUNE_VACUUM=1`, `PISTE_DB_PAGE_SIZE=16384`), so the saved file shrinks too. The VACUUM took
  about half a second on a 50–70 MB file (sql.js in Node on the build machine).
- **Saving:** a save exports the whole database. Your own actions (forms, buttons, a manual refresh) are saved within
  a second of finishing. The scheduler's writes (a heartbeat every minute, refresh bookkeeping, fetched data) are
  saved at most every 10 minutes. Everything is saved when the tab is hidden or closed, or when another tab takes
  over. Before this, the page saved after nearly every write. In headless Chromium, the first 150 s of a refresh pass
  made 94 whole-database saves; now it makes 1, the initial save of a fresh database.

Measured with once-a-day use (`src/lib/jobs/retention.sim.test.ts`, extrapolated from 2 simulated resorts to all 33,
with the 2 default favourites):

| | Before | Now |
|---|---|---|
| Growth per day | 13.5 MB | about 0.075 MB (each extra favourite adds about 11 KB) |
| After 70 days | about 940 MB | about 35 MB |
| After 200 days (projected) | about 2.7 GB | about 45 MB |

## What does not (and why)

- **Official snow-report parsers (Greek Peak, Alta) and the link checker.** A web page cannot read other sites' pages
  (CORS). They show as "Not available in the single-file version". Manual report entry works as usual.
- **Duffel flight offers.** They need a secret API key, which a file in your browser cannot keep. Search links and
  manual quotes work.
- **Nothing is collected while the page is closed or the computer sleeps.** Sources & Sync says this. For continuous
  collection, run the server version with its worker.
- **Sign-in** is not applicable. Nothing is served to a network; Settings says so.
- **`npm run backup` / `restore`** do not exist here. Use Download / Import instead.
- **Storage belongs to the browser.** Another browser, another computer or clearing site data starts empty. Chrome
  keeps one storage area for all files opened from disk. If a browser refuses storage for local files, the page still
  works but warns that changes will not be kept, and points you to Download.
- **Untested here:** the live weather, FX, OpenStreetMap (Overpass) and tile APIs. The build environment has no internet access. They are public
  APIs that send CORS headers, and failures show as failures. Only Chromium was tested.

## How it is built

`build.mjs` bundles `src/main.tsx` with esbuild. The result is a build target of the existing source, not a rewrite:

- **Next APIs → `src/shims/`:**
  - `next/link` renders real `<a>` elements and navigates on click.
  - `next/navigation` provides the router hooks plus `notFound`/`redirect`.
  - `next/headers` keeps cookies in localStorage.
  - `next/cache` makes `revalidatePath` re-run the current route's loaders.
  - `next/server`, `next/dynamic` and `next/font/local`; `server-only` becomes empty.
  - Node built-ins (`fs` serves the embedded catalog, `crypto` provides synchronous SHA-256/HMAC).
- **`src/lib/db/client.ts` → `src/db/`:** sql.js behind a libsql-compatible client, so Drizzle's libsql driver runs
  unchanged. The client handles one lock per database, row objects shaped like libsql's, and migrations with drizzle's
  bookkeeping. `src/lib/actions/mode.ts` → `src/runtime/mode-action.ts` generates the demo in the page.
- **Server actions** (`'use server'` modules) are wrapped: they run in order, and `revalidatePath` refreshes the page
  before the action resolves.
- **One inline ES module**, not an IIFE: V8 compiles lazily-called code inside one huge function much more slowly
  (React DOM initialised about 5 times faster this way).
- **Routes** are generated from `src/app` at build time. `src/runtime/loader.tsx` runs the async server components
  (layouts and page) in the browser, with the App Router's `error.tsx`, `not-found.tsx` and `loading.tsx` rules. The
  real root layout (`src/app/layout.tsx`) is called too, and its `<body>` content is rendered, so the shell stays in
  sync with the Next app. The root is `src/runtime/app.tsx`, which provides transitions, scroll handling and the route
  announcer.
- **`src/runtime/interceptors.ts`** translates `history.pushState`/`replaceState` calls and plain links. It also runs
  `fetch('/api/…')` against the app's route handlers.
- **Bundle-time text patches** (`PATCHES` in `build.mjs`) change only sentences that would be untrue in a single file
  (server, worker, npm scripts) and two browser incompatibilities: `http.ts` refuses to load in a browser and sends a
  User-Agent, and the map's worker URL uses `location.origin`. A patch that stops applying is reported. The two
  required ones fail the build.
- **CSS** is Tailwind v4 over `src/app/globals.css`, the same input as the Next build, plus MapLibre's stylesheet.
  Fonts, the SQLite WebAssembly binary, the catalog and MapLibre's worker are inlined.

The only change under `src/` is one line in `src/app/globals.css`: `@source not '../../standalone';`. It keeps this
directory, and especially the generated index.html, out of the Next build's Tailwind class scan.
