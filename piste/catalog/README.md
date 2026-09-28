# Piste catalog

Curated seed data for Piste, the personal ski planner. Season: **2026-27**. Home: **Ithaca, NY**. Research date:
**2026-09-28**.

The catalog is a starting point. It is not a live feed. Each non-trivial fact carries a `source` (a `SourceRef`) that
says where it came from and how far to trust it. Anything the research could not establish is left `null` or empty.
The app then shows an honest **Unknown** or **Not announced** state with a link to the official page.

## Files

| File | Schema (`src/lib/catalog/schema.ts`) | Contents |
|---|---|---|
| `resorts/<id>.json` | `CatalogResort` | 33 resorts: identity, location, elevation, terrain, features, 2026-27 season fields, hours, prices, links, travel from Ithaca, report source, open questions |
| `passes.json` | `CatalogPasses` | Pass families, exact 2026-27 products (with any sourced prices), per-resort access rules, open questions and conflicts |
| `airports.json` | `CatalogAirports` | Origin airports (ITH, SYR, ELM, ROC, BUF) and destination airports (SLC, DEN, EGE, HDN, JAC, IDA, BZN, YVR, BTV, ALB, INN, ZRH, MUC) |
| `hotels.json` | `CatalogHotels` | A small, curated lodging list for priority resorts (no prices) |
| `events.json` | `CatalogEvents` | Events found in research only |

## Evidence levels

Each `source.verification` value tells the app how to label a fact:

| `verification` | Meaning | What the app shows |
|---|---|---|
| `search-summary` | **Researched.** The fact came from a web-search result summary on 2026-09-28, and the source URL is recorded. Page fetches were blocked in the build environment, so the pages themselves were not read. | "Researched — confirm at source" (source drawer: "Researched via web search — confirm at the source") |
| `unverified` | **Piste reference data.** Stable facts supplied without a web check: coordinates, base/summit elevation and vertical, timezone, region, operator (as of 2025), official homepages, airport names and locations, pass-site homepages, reference-only transfer options, and prior-season pass affiliations. Deep links (sub-pages) are recorded only when research cited them; otherwise the homepage is given. Notes read "Piste reference data (not web-verified in this build) — confirm at source". | "Not verified", plus the note; pass rules add "Rule source not verified — confirm on the official pass page." |
| `official-page` / `api` / `user-confirmed` | Not used by the build. Upgrade a fact to one of these after you check it against the official page, or after a live adapter or your own correction replaces it. | "Read from the official page" / "Retrieved from a documented API" / "Confirmed by you" |

**Never supplied from memory**, so these fields stay unknown unless research found them: 2026-27 opening and closing
dates, all prices, operating hours, 2026-27 pass access specifics (days, blackouts, reservations), event dates, hotel
rates, airline service and routes, ski-baggage rules and snow statistics.

## What the research covered

The research used web search only, and the session's search budget ran out partway through.

- **Researched (search summaries):** Greek Peak, Bristol Mountain, Holiday Valley, Elk Mountain and Belleayre in
  depth. Labrador Mountain, Song Mountain (SkiCNY), Swain and Toggenburg (closed since 2021) only partly, because the
  budget ran out mid-resort. Toggenburg is kept as a record but has `priority: 0` and no official link while it is
  closed.
- **Carried over from sibling research:** Gore and Whiteface have only the ORDA facts found while researching
  Belleayre: the SKI3 pass, the Frequent Skier Card, Snow Pass partner listings, and Whiteface joining the Mountain
  Collective from 2025-26.
- **Reference data only (no research ran):** Hunter, Windham, Killington, Okemo, Mount Snow, Sugarbush, Stowe, Jay
  Peak, and every western and international destination (Alta, Snowbird, Brighton, Solitude, Deer Valley, Park City,
  Jackson Hole, Big Sky, Vail, Breckenridge, Copper Mountain, Steamboat, Whistler Blackcomb, Ski Arlberg).
- **Multi-resort passes:** the Ikon Pass and Mountain Collective research topic had no budget left, so nothing about
  Ikon, Epic or Mountain Collective 2026-27 was researched. Indy facts come from the Greek Peak and Swain Indy pages
  and from the OnTheSnow 2026/27 Indy buyer's guide.

## How passes are modelled

- **Products** are exact and season-specific (for example `ikon-pass-2026-27` or `greek-peak-unlimited-2026-27`).
  Ikon Pass, Ikon Base Pass, Ikon Session Pass, Epic Pass, Epic Local Pass, Epic Day Pass and Mountain Collective Pass
  are placeholders. Their names are carried over from earlier seasons, with no prices or terms. Indy Base Pass and
  Indy+ Pass are catalogued because research names them for 2026-27.
- **Researched access rules** keep the research wording in `notes`. When research gave only a restriction without
  exact dates, `blackouts` stays empty and the restriction is described in `notes`. This applies to Indy Base
  blackouts at Greek Peak and Swain, which were due in fall 2026 and are not yet recorded.
- **Prior-season affiliations** are recorded as `access: "unknown"` rules. Each carries the note "Listed with <Family>
  in 2025–26 (Piste reference data, unverified). 2026–27 access not confirmed — check the official pass page."
  Unknown never counts as included.
- **Nothing is marked `not-included` from memory.** Every `not-included` rule cites research: Elk Mountain on
  Ikon/Epic/Indy, Bristol, Holiday Valley and Belleayre on Indy, and Belleayre on Mountain Collective.
- **No shared day pools** are modelled. The Alta + Snowbird Ikon pool, for example, appears only as a note on the
  unknown rules until it is confirmed for 2026-27.
- ORDA's **SKI3** is left `unknown` at Belleayre, Gore and Whiteface. The reason is that a blackout-date list (Dec 25,
  2026–Jan 1, 2027; Jan 16–18; Feb 13–21, 2027) could not be tied to the pass itself; see `passes.json`
  `research.conflicts`.
- Partner passes seen only for 2025-26 have no 2026-27 product. These are SANY Gold, NSAA Gold and SKI/NY Passport at
  Greek Peak, plus the Greek Peak Indy Add-On. They are listed in `passes.json` `research.openQuestions`.

## Airports, hotels and events

- **Airports:** names, coordinates and timezones are reference data. `airlines` is empty everywhere, because current
  service could not be verified. `routeNotes` and `skiBaggage` are empty. Drive times from downtown Ithaca to the
  origin airports are labelled *"Estimate (typical routing), not a routing-service result"*.
- **Hotels:** Hope Lake Lodge at Greek Peak is researched. The Alta lodges and the one or two properties each for
  Holiday Valley, Killington, Stowe and Whiteface (Lake Placid) are reference data. Tiers are positioning judgements,
  not prices. `skiInOut` is `unknown` for every property, and no rates are stored, so the app shows "Check rates".
  Official URLs are given only where the domain is well established; the app's link checker still has to confirm them.
- **Events:** only two events, both from research:
  - Greek Peak's pond skim. It is a past edition (Apr 4, 2026) with status `not-announced`, because the 2026-27 date
    is not announced.
  - Elk Mountain's Fall Festival (Oct 10–11, 2026), marked `tentative` because the research note did not record the
    exact page.

  No previous-season event is rolled forward.

## Still unknown (as of 2026-09-28)

- Every official 2026-27 opening and closing date. None had been announced for the researched resorts. OnTheSnow
  projections are noted as third-party estimates, never as announcements.
- Ikon, Epic and Mountain Collective 2026-27 lineups, prices, deadlines, day counts, blackouts, reservation rules and
  destination lists.
- Indy 2026-27 prices, full partner list and Indy Base blackout dates.
- Most 2026-27 lift-ticket and season-pass prices. Exceptions: Greek Peak Unlimited ($799 to Sep 30, 2026; $999 from
  Oct 1), Bristol Executive family-member tiers, and Holiday Valley Ultimate White/Flex.
- Hours, prices, terrain and links for every reference-only resort.
- Airline routes and schedules, ski-baggage policies, hotel details and rates, and 2026-27 events.
- Snow statistics. These come from live adapters and your own reports, never from the catalog.

Each resort's `research.openQuestions` and `research.conflicts`, and the same fields in `passes.json`, list the
specific gaps.

## Correcting or extending the data

**In the app (preferred for personal fixes):** use the manual correction flows (Settings → corrections, or a resort's
edit and report entry). Corrections are stored as your own records (resort overrides and user-origin rows). They
survive re-seeding, and the catalog never overwrites them.

**In these files (to fix the shared seed):**

1. Edit the JSON. Keep units metric (m, km, cm), dates as `YYYY-MM-DD`, prices in major units in their sourced
   currency, and only `http(s)` URLs. Unknown values stay `null`.
2. Give every changed fact a `source`. After checking the official page yourself, set `url` to that page,
   `verification` to `official-page` (or `user-confirmed`), `checkedOn` to the date you checked, and a short `note`.
3. Validate with `npx tsx scripts/validate-catalog.ts`. It parses every file through the zod schema, checks that
   pass rules, hotels and events point at real resorts and products, and prints `Catalog valid.`.
4. Load with `npm run db:seed`. Seeding is idempotent:
   - Catalog rows are refreshed, and your corrections and personal records are untouched.
   - Price snapshots are appended only when new.
   - A changed access rule becomes a new rule version.
   - Opening-date changes are logged.
