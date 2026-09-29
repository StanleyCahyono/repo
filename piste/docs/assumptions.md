# Assumptions and environment adaptations

Material decisions made while building Piste. Each one can be revisited.

## Build environment
- **Blocked network.** The build environment's egress proxy allowed only package registries and a web-search tool
  capped at 200 searches per session. Resort sites, pass sites, Open-Meteo, api.weather.gov, Wikipedia and map tile
  hosts could not be fetched during development.
- **Research ran out early.** The search cap ran out after the Central and Western New York research batches:
  - **Fully researched:** Greek Peak, Bristol, Holiday Valley and Elk Mountain.
  - **Partly researched:** Labrador and Belleayre.
  - **Reference data only:** the other 27 resorts carry only stable reference facts, labelled
    `verification: "unverified"` and shown as "Reference — confirm". These are coordinates, elevations, official
    homepages, and road and avalanche portals.
  - **Never filled in from memory:** 2026–27 opening dates, prices, hours and pass access for those resorts. They
    show as unknown, with official links and a manual-edit route.
- **How the catalog is labelled.** Researched facts come from web-search summaries and carry
  `verification: "search-summary"` with the source URL of each fact. The UI says "Researched — confirm at source"
  until you confirm them or a live adapter supersedes them. You can confirm them in Settings → corrections or with
  the Passes manual-rule editor.
- **Weather and NWS.** The adapters are built against the documented APIs and tested with fixtures in the
  documented format. They run live on a networked machine. In the build environment every refresh fails, and the UI
  shows that honestly: "not fetched yet" or the failure itself, never demo data dressed up as live.
- **Official report parsers.** The parsers for Greek Peak and Alta could not be developed against the live pages.
  - **How they behave:** they validate what they extract and fail loudly with `schema-changed`, rather than
    returning partial data.
  - **Status:** the coverage matrix (`docs/providers.md`) lists them as unverified. Manual report entry is the
    dependable path until someone checks them against the real pages.
- **Maps.** MapLibre with OpenFreeMap tiles.
  - **Tiles:** could not be loaded in the build environment, so the map falls back to a schematic view that keeps
    every marker usable.
  - **Worker:** MapLibre's web worker is served same-origin from the installed package (`/vendor/maplibre/*`),
    because the bundler hides the library's own script URL.
- **Photographs.** No licensed resort photos could be obtained, so every resort uses the designed topographic
  placeholder, labelled as decorative. The schema supports licensed photos with credit and licence fields.

## Product decisions
- **Demo mode.** Demo mode is a separate SQLite file, not a flag on rows. A demo row cannot leak into live
  recommendations, exports or alerts because it never exists in the live database. Demo data simulates Fri 15 Jan
  2027, and everything simulated carries `kind: "demo"`.
- **Opening dates.** Estimated opening windows are Piste estimates derived from researched past openings. They are
  always labelled "Estimated" and never "Announced". An announced date never turns into "Open" on its own.
- **Conditions model thresholds.** Every threshold in Piste Conditions v1 is an initial engineering assumption, kept
  in versioned configuration (`src/lib/domain/conditions/config.v1.ts`). The model is marked "not yet calibrated" in
  `docs/methodology.md`.
- **Expense bands.** $ below 125, $$ 125–249, $$$ 250–449, $$$$ 450+ (USD, per person, per day). These are UI
  classification thresholds, not price facts. A missing lift or rental price makes the tier "Incomplete estimate".
- **Pass family colours.** These are Piste's own categories, not official brand identities: text label, border and
  monogram, and no logos.
- **Drive times.** Drive times are curated estimates, labelled as such, plus Google Maps directions links.
  openrouteservice routing is reserved (`ORS_API_KEY`) but not implemented.
- **Flights.** Without `DUFFEL_ACCESS_TOKEN`, flights are prefilled search links plus manual itinerary and quote
  entry. Piste never shows fares, schedules or flight numbers it did not receive from a provider.

## Development notes
- **Dev URL.** Open dev servers at `http://localhost:<port>`. Next 16's dev-origin protection blocks the
  hot-reload socket for other hostnames such as `127.0.0.1`, so pages would not hydrate.
  `allowedDevOrigins` in `next.config.ts` can add others.
- **`tsconfig.json` churn.** When several dev servers run with `NEXT_DIST_DIR`, `next dev` adds their type
  directories to `tsconfig.json`. Revert those lines before committing.
