# Providers and data sources

Everything Piste fetches goes through adapters in `src/lib/providers/`, and all network access goes through
`src/lib/providers/http.ts`. Each adapter returns a `ProviderResult` (`src/lib/providers/types.ts`). On success it
carries the values, a `Provenance`, `capabilities` (fields `supplied` and `missing`, plus `limitations`) and the
`fetches` made. On failure it carries a typed `errorKind`, a `retriable` flag and the same `fetches`. Adapters never
write to the database. Jobs persist what they return.

## Coverage matrix

What each status means:

- **Live**: implemented against the provider's documented API and called at runtime with no extra setup.
  Important: the build environment could not reach any external host, so these adapters have only been tested
  against fixtures written in the documented response format. They have never run against the real service. The
  first successful refresh on a real machine confirms them, and Sources & Sync shows the last success.
- **Needs credentials**: an optional connector. It stays idle, and makes no network calls, until you set its
  credential.
- **Unverified parser**: written without access to the live source. Expect `schema-changed` until someone checks
  it against the real page.
- **Manual**: there is no automated feed. Data comes from curated or user-entered records with source links, or the
  item is only a link.

| Provider | Supplies | Auth | Status | Code |
|---|---|---|---|---|
| Open-Meteo forecast | Hourly modeled weather worldwide for base and summit points: temperature, apparent temperature, precipitation, rain, snowfall, modeled snow depth, WMO weather code, cloud cover, visibility, wind, gusts, humidity, freezing level, day/night. 16 days ahead plus up to 92 past days. | None. `OPEN_METEO_API_KEY` is optional and only for the commercial endpoint | Live | `weather/open-meteo.ts` |
| NWS gridpoint forecast | A second model for disagreement checks (US only): temperature, apparent temperature, snowfall amount, precipitation, wind, gust, humidity, sky cover, visibility. About 7 days. | None. Identified by User-Agent (`PISTE_CONTACT`) | Live (US only) | `weather/nws.ts` |
| NWS active alerts | Official watches, warnings and advisories for a point | None. Identified by User-Agent | Live (US only) | `weather/nws.ts` |
| Greek Peak conditions page | Trail, lift and beginner-trail counts, snowfall windows, base depth, surface, grooming, snowmaking, status, report time | None | **Unverified parser** | `reports/greek-peak.ts` |
| Alta snow report | Snowfall windows (24 h, storm, season), base depth, lift counts, surface, report time | None | **Unverified parser, unverified URL** | `reports/alta.ts` |
| Other resorts' official reports | — | — | Manual: report entry plus official links | — |
| OpenStreetMap lifts & runs (Overpass API) | Community-mapped lift and run lists: lift names, types, mapped lengths, capacity, seats, ride time; run names, difficulty, grooming, mapped lengths. Never live open/closed status | None. Identified by User-Agent (`PISTE_CONTACT`) | Live (weekly for favourites and upcoming trips, on demand for any resort) | `osm/overpass.ts` |
| Live lift status pages | The resort's own live lift/run status, **as a link only** (`links.liftStatus`). No public source a browser can read publishes it, so Piste never shows per-lift open/closed | — | Manual (link) | — |
| Frankfurter (ECB reference rates) | Daily FX reference rates as decimal strings | None | Live | `fx/frankfurter.ts` |
| Duffel | On-demand flight offers (amount, currency, expiry, segments, marketing carrier and flight number) | `DUFFEL_ACCESS_TOKEN` | Needs credentials | `flights/duffel.ts` |
| Google Flights, KAYAK | Prefilled **search links** only. Piste reads no fares or schedules from them | None | Manual (links) | `links/builders.ts` |
| Google Maps | Prefilled **directions links**. The travel time shown is Google's, not Piste's | None | Manual (links) | `links/builders.ts` |
| OpenSkiMap, NWS forecast page | Map and forecast **links** | None | Manual (links) | `links/builders.ts` |
| Link checker | HTTP status, final URL after redirects, whether the page can be framed | None | Live | `links/check.ts` |
| OpenFreeMap (map style and tiles) | Vector basemap for the Explore and resort maps, loaded by the browser. Attribution is shown on the map. Piste reads no data from it | None. `NEXT_PUBLIC_MAP_STYLE_URL` swaps in another MapLibre style | Live (browser). Never loaded in the build environment, where the maps showed their schematic fallback: markers plotted by coordinates, with the same selection and interactions | `components/map/resort-map.tsx` |
| Pass products and rules, lift prices, lodging, events | Curated records with per-fact sources (`catalog/`) | — | Manual | — |
| Driving routes (openrouteservice) | — | `ORS_API_KEY` | **Not implemented.** The variable is listed in `.env.example`, but no adapter exists yet. Drive times are curated estimates plus directions links | — |

`providerStatus()` in `registry.ts` returns this table at runtime for the Sources & Sync page. It reports
`live`, `needs-credentials`, `unverified` or `disabled`, plus `credentialSet` and `testMode` flags. It never
includes credential values.

## HTTP policy (`http.ts`)

`fetchWithPolicy(url, policy)` and `createHttpClient(env)` are the only way adapters reach the network.

- **Timeouts.** An `AbortController` limits each attempt, and the limit covers both headers and body (default
  15 s). A body that stalls after the headers arrive also times out.
- **Retries.** Retries are bounded (default 2 for GET, 0 for POST). The delay grows exponentially with "equal
  jitter": half fixed, half random, capped at 8 s.
  - Retried: timeouts, network errors, 408, 425, 429 and 5xx (except 501 and 505).
  - Not retried: other 4xx errors and parse errors.
- **Retry-After.** On 429 or 503, the `Retry-After` header is honoured, in either seconds or HTTP-date form. If the
  server asks for more than `maxRetryAfterMs` (default 30 s), the call returns `rate-limited` (for a 503 too) with
  `retryAfterMs` and the requested wait in the error text, without retrying. The scheduler retries later, and no
  job blocks for minutes. The weather job stops calling a provider that answered `rate-limited` for the rest of
  its pass (see `docs/scheduler.md`).
- **Identification.** Every request sends
  `User-Agent: Piste/0.1 (+personal ski planner; contact: $PISTE_CONTACT)`. The contact is sanitised, and reads
  `unset` when the variable is empty. api.weather.gov requires clients to identify themselves.
- **Per-host pacing.** There is a minimum gap between request starts to the same host:

  | Host | Minimum gap |
  |---|---|
  | api.weather.gov | 1 s |
  | api.open-meteo.com | 200 ms |
  | api.frankfurter.app, api.duffel.com | 500 ms |
  | overpass-api.de | 2 s |
  | resort sites | 3 s |
- **Cache.** A small in-memory TTL cache holds successful GETs only. A cache hit keeps the **original**
  `fetchedAt` and is marked `fromCache`. Serving from cache therefore never counts as a new observation, and
  failures are never cached.
- **Size limit.** Responses are capped at 5 MB by default. A larger response fails with `parse`.
- **Error kinds** match `ProviderErrorKind`: `timeout`, `network`, `http`, `rate-limited`, `parse`,
  `schema-changed`, `unsupported`, `not-configured`.
- **Fetch records.** Every call produces a `SourceFetch` with the URL, `fetchedAt`, HTTP status, a SHA-256 of the
  body, `ok`, `error`, `attempts` and `fromCache`. Before a URL is recorded, credentials in it are redacted:
  `apikey`, `token`, `key` and similar query parameters, plus any userinfo.
- **Hashing.** `sha256Hex()`, `stableStringify()` and `stableHash()` are provided. They produce hashes of
  normalised values that do not depend on key order.
- **Proxy.** Node's built-in `fetch` honours `HTTPS_PROXY`/`HTTP_PROXY` **only when `NODE_USE_ENV_PROXY=1`** is
  set (Node ≥ 22.21). Without that flag, a machine behind a proxy fails with `network` errors.
- **Server only.** `http.ts` throws if it is ever bundled for the browser. Credentials are read from
  `process.env` at call time.

## SSRF guard (`assertPublicHttpUrl`)

Use this guard for any URL a person can type, such as the link checker or a URL importer. It accepts a URL only
when all of the following hold:

- The scheme is `http` or `https`.
- The URL contains no username or password.
- The port is the default, 80 or 443. Other ports require an explicit option.
- The hostname is not special-use: `localhost` (and anything under it), `*.local`, `*.internal`, `*.lan`,
  `*.home.arpa`, `metadata.google.internal`, or any single-label name.
- **Every** DNS answer is a public unicast address. Resolution uses `dns.lookup(all)`, the same resolver `fetch`
  uses, and can be replaced for tests.

The following ranges are rejected:

- 0/8, 10/8, 100.64/10 (CGNAT), 127/8, 169.254/16 (link-local and cloud metadata), 172.16/12, 192.168/16
- Documentation, benchmarking, multicast and reserved ranges
- IPv6 `::`, `::1`, fc00::/7, fe80::/10, fec0::/10, ff00::/8 and 2001:db8::/32
- IPv6 forms that embed IPv4: mapped, compatible, NAT64 (64:ff9b::/96) and 6to4. These are classified by the
  IPv4 address they embed.

Odd IPv4 spellings such as `http://2130706433/` or `0x7f.1` are normalised by the URL parser first, so they are
caught too.

`checkLink` follows redirects **manually** (at most 5) and re-runs the guard on every hop. A public URL cannot
bounce the checker into a private network.

Remaining risk: DNS rebinding. An answer can change between the check and the connection. Pinning the resolved
IP would need a custom undici dispatcher, which is not a project dependency. For a single-user local app this risk
is accepted and documented here.

## Open-Meteo (`weather/open-meteo.ts`)

**Request.** The adapter calls `GET https://api.open-meteo.com/v1/forecast` with these parameters:

- `latitude` and `longitude`, rounded to 4 decimal places.
- `elevation=<m>` when the point elevation is known.
- `hourly=temperature_2m,apparent_temperature,precipitation,rain,snowfall,snow_depth,weather_code,cloud_cover,visibility,wind_speed_10m,wind_gusts_10m,relative_humidity_2m,freezing_level_height,is_day`
- `timezone=GMT` and `timeformat=unixtime`.
- `wind_speed_unit=kmh`.
- `forecast_days` (default 16, maximum 16) and `past_days` (default 2, maximum 92).

When `OPEN_METEO_API_KEY` is set, the same query goes to `https://customer-api.open-meteo.com/v1/forecast` with
`apikey=`. The key is redacted from every recorded URL.

**Time zone choice.** Unix times in GMT are unambiguous instants. Resort-local days are computed later from the
resort's IANA zone (`src/lib/domain/time.ts`), never by the API.

**Elevation.** Passing `elevation` makes Open-Meteo apply statistical downscaling: it adjusts the model grid
values to that height with a lapse rate. This is **not** a new station, and it does not resolve individual slopes.
Without the parameter, Open-Meteo uses its 90 m terrain model for the grid cell. The adapter keeps the returned
grid `latitude`, `longitude` and `elevation` separately from the requested point, and states the limitation in
`capabilities.limitations`.

**Units.** The returned `hourly_units` are stored as-is in `WeatherSeries.units`. Each variable is converted
explicitly to the canonical unit:

| Variable | Canonical unit |
|---|---|
| snowfall | cm |
| precipitation, rain | mm |
| snow_depth | m (modeled ground depth, never a piste base) |
| visibility, freezing level | m |
| wind, gusts | km/h |
| temperature | °C |

Imperial units (`inch`, `ft`, `°F`, `mp/h`, `kn`) are converted too. If a unit is not recognised, that variable
is treated as **missing**. Piste never guesses a unit.

**Missing data.** A requested variable that is absent, or null for every hour, is listed in
`capabilities.missing` and its values stay `null`. Arrays whose lengths do not match the timestamps are rejected
with `parse`, so values never shift onto the wrong hours.

**Interval semantics: `preceding-hour`.** Open-Meteo's documentation says `precipitation`, `rain` and `snowfall`
are sums over the preceding hour, and `wind_gusts_10m` is the maximum over the preceding hour. The other variables
are instantaneous. A record stamped T therefore covers (T−1 h, T]. The conditions engine
(`domain/conditions/aggregate.ts`) uses this to bucket hours into resort days.

**Model run time.** `modelRunAt` is always `null`. `generationtime_ms` is how long the API took to build the
response, not a model run or issue time.

**Provenance.** Kind `modeled`, provider `Open-Meteo`, verification `api`, `staleAfter` set to the fetch time plus
6 h. The note reads **"Weather data by Open-Meteo.com (CC BY 4.0)"**, and this attribution must be displayed.

**Terms.** The free API is for non-commercial use, and Open-Meteo publishes daily, hourly and per-minute call
limits. Check the current terms at https://open-meteo.com/en/terms. Repeated manual refreshes within 10 minutes
are served from the in-memory cache.

## NWS / api.weather.gov (`weather/nws.ts`)

All NWS requests send `Accept: application/geo+json` and the identifying User-Agent. Coordinates use at most 4
decimal places, because the API redirects otherwise. `supports()` is true only for `country: 'US'`. Other points
return `unsupported` without any network call.

### Alerts

- **Request:** `GET https://api.weather.gov/alerts/active?point=lat,lon`, cached for 5 minutes.
- **Output:** each feature becomes an `OfficialAlert` with `id`, `event`, `headline`, `severity`, `onset`, `ends`,
  `expires`, `areaDesc` and `url` (the alert's API URL).
- **Timestamps:** converted to UTC ISO. A timestamp must state its offset (`Z` or `±hh:mm`). One without an offset is
  ambiguous and becomes null; it is never read in the server's own zone. When `ends` is null it stays null, and the
  domain treats it as unbounded.
- **Filtering:** only `status: "Actual"` messages are kept. Test, exercise and cancel messages are dropped and
  counted in `limitations`.
- **Provenance:** kind `official`, stale after 1 h.
- **Empty result:** an empty list is a real answer meaning "no active alerts".

### Gridpoint forecast (second model)

1. `GET /points/{lat},{lon}` returns `properties.forecastGridData`. This lookup is cached for 24 h. A 404 means
   `unsupported`.
2. The adapter checks that the grid URL starts with `https://api.weather.gov/gridpoints/` and refuses anything
   else. A URL supplied by the API is never followed off-host.
3. `GET` the grid URL. Grid data is cached for 10 minutes.

The grid layers are mapped to canonical fields as follows:

| NWS layer | Unit (uom) | Field | How hours are filled |
|---|---|---|---|
| temperature, apparentTemperature | `wmoUnit:degC` (degF converted) | temperatureC, apparentTemperatureC | Repeated |
| windSpeed, windGust | `wmoUnit:km_h-1` (m_s-1, kt converted) | windKmh, gustKmh | Repeated |
| relativeHumidity, skyCover | `wmoUnit:percent` | humidityPct, cloudCoverPct | Repeated |
| visibility | `wmoUnit:m` | visibilityM | Repeated |
| snowfallAmount | `wmoUnit:mm` (new-snow depth) ÷ 10 | snowfallCm | **Distributed** |
| quantitativePrecipitation | `wmoUnit:mm` | precipitationMm | **Distributed** |

NWS supplies no rain-only amount, freezing level, snow depth, WMO code or day flag, so those fields stay null and
are listed as missing. `snowLevel` is deliberately **not** used as the freezing level.

**How intervals are spread over hours** (`weather/nws-intervals.ts`):

- Each `validTime` is an ISO-8601 interval, `start/duration` or `start/end`, for example
  `2027-01-15T06:00:00+00:00/PT6H`. The start and an absolute end must state their offset. An interval without one
  is skipped, never read in the server's zone.
- Instantaneous values are copied to every hour the interval covers.
- Accumulations are **spread proportionally**: each UTC hour gets `total × overlap ÷ interval length`. For example,
  6 mm over PT6H gives 1 mm per hour, and the total is conserved.
- An hour only partly covered by the layer, such as an edge hour when an interval starts at :30, is left **null**
  rather than reported as a smaller amount.
- An hour covered by more than one accumulation interval (a duplicate or overlapping interval) is also left
  **null**. Its amount is ambiguous, and it is never double counted.
- Records are stamped at the hour start and describe [T, T+1 h). The series therefore uses intervalSemantics
  `following-hour`.
- Proportional spreading is a documented approximation. NWS does not say how snow falls within its 6-hour
  blocks.

**Other series fields.**

- `modelRunAt` is the grid's `updateTime`, the forecast office's issue time as the API supplies it (null when the
  stamp has no offset).
- `grid.lat` and `grid.lon` are the centroid of the grid-cell polygon.
- `grid.elevationM` comes from `properties.elevation`. NWS does not adjust values to the requested point's
  elevation, and a limitation says so.

## Official resort reports (`reports/`)

### How a report is fetched and parsed

`createLabelReportProvider(config)` is a reusable adapter. A resort adapter is only configuration: the URLs, the
publisher, the unit the resort prints snow in, and the required anchors. For each fetch it runs these steps:

1. **robots.txt, for every URL.** Before each page, the primary and every alternate, it checks that origin's rules
   for the product token `piste` and for `*`, and caches them for 24 h. An alternate on another origin (Greek Peak:
   `greekpeak.net` next to `www.greekpeak.net`) is checked against its own robots.txt.
   - Disallowed: that page is not fetched, and the adapter moves on to the next URL.
   - 4xx response: no rules apply.
   - 5xx or timeout: that page is skipped, because the adapter cannot tell whether fetching is allowed.
2. **Fetch.** It fetches the primary URL, then tries alternates if that fails (Greek Peak: the print version). When
   no URL yields a report, the most informative failure is returned: `schema-changed` (a page no longer parses),
   then the HTTP or network failure, then the robots.txt error. Only when robots.txt disallows every URL is the
   result `unsupported`.
3. **Build text lines,** in priority order:
   1. **Structured data:** JSON-LD blocks, flattened. A schema.org `PropertyValue` becomes `name: value unit`, and
      camelCase or snake_case keys are turned into words. Custom `<meta>` tags are included. Social/SEO tags
      (`og:`, `twitter:`, description) are skipped because they are marketing copy.
   2. **Table and definition-list pairs:** two-cell rows, `dt`/`dd`, and a header row followed by a value row
      (column layout). The column layout is used only when those two rows are the table's only rows of that width,
      that is, a table with a single data row. A list, such as lifts or trails with a `Lift | Status | Hours` header
      and one row per lift, is never paired, so its first row cannot become page-level facts like `Status: Closed`.
      A stacked layout with several header and value rows is skipped too: those values end up missing, never wrong.
   3. **Page text:** scripts, styles, SVG and iframes are stripped. Block elements become lines and table cells
      are joined with ` | `.
4. **Match labels.** For each field, the first plausible match wins. See the rules below.
5. **Check required anchors.** Each adapter declares groups of anchors, and every group needs at least one. If a
   group is missing, the result is **`schema-changed`** (not retriable) and nothing is returned. A partial report
   is never passed off silently. The only exception is a page that explicitly says the resort is closed for the
   season or not yet open.
6. **Validate with zod** (`reports/schema.ts`):
   - Counts must be within limits, and `open ≤ total`.
   - Snow amounts must be within plausible limits.
   - A longer window cannot hold less snow than a shorter window it contains.

   A failure here also means `schema-changed`.

Optional fields that the page does not show are listed in `capabilities.missing`.

### Label-matching rules

- **Snow amounts.** A number is taken only when it directly follows a known label. It is rejected when followed by
  hours, days, %, °, `'`/′ (feet), m, ft, a time, `of N`, or another label.
  - `″ " ” ''`, `in` and `inches` mean inches. `cm` means centimetres.
  - For labels that name a snow quantity, unitless values are read in the adapter's declared unit (inches for
    Greek Peak and Alta), and a limitation says so.
  - A bare "Base" or "Summit" needs an explicit unit.
  - A range such as `18″–30″`, for base depth or any snowfall window, is stored as its lower bound, with a note.
- **Snowfall windows.**
  - 24, 48 and 72 hour labels map to those windows.
  - "7 day" and "past week" map to 7 days.
  - "Storm total" maps to storm.
  - "Season total", "year to date" and "total snowfall" map to season.
  - "New snow", "overnight" and "fresh snow" map to **overnight**. "New snow" has no stated window, which is
    recorded as a limitation.
- **Counts.**
  - Recognised forms: `Trails Open 32 of 55`, `Open Lifts: 5 / 8`, `32/55 trails`, `Trails Open: 32` with a
    separate `Total Trails: 55`.
  - Beginner, night, groomed and Nordic trail counts never feed the main trail count.
  - A candidate where open is greater than total is skipped.
- **Status.** The resort's operating status is taken only from explicit resort-level wording:
  `Mountain Status: Open` (also Resort, Operating, Operations, Lift Operations, Today's or Current status),
  `closed for the season`, `not yet open`, `we are open today` and `the mountain is closed today`. When in doubt the
  status stays `null`: a wrong resort status is worse than an unknown one, because unknown is never treated as open
  and a closure overrides every score.
  - A bare `Status:` never counts. It is usually a table column or one facility's field.
  - A status about one facility, service or product never becomes the resort status, for example
    `Tubing Status: Open`, `Terrain Park: Not yet open`, `Hope Lake Water Park is closed for the season`,
    `Night skiing: closed for the season` or `Registration is not yet open`. The clause before the phrase is checked
    for lifts, trails, parks, tubing, lodges, rentals, lessons, passes, tickets, registration, summer activities and
    similar words. A word that is part of a resort name ("Snowshoe Mountain", "Stevens Pass") does not count.
  - A table row (`Chair 2 | Closed for the season`) and a legend (`Status: Open / Closed`,
    `Open / Closed / Closed for the season`) are ignored.
  - A status value on its own line is read together with the line above it: `Night Skiing` followed by
    `Closed for the season` is about night skiing.
  - `not yet open` also needs the season (`not yet open for the 2026-27 season`), a resort subject (we, the mountain,
    the resort, the ski area) or nothing else in its clause.
  - Trail counts and announced opening dates **never** set the status to "open".
  - With no explicit status, the status is `null`.
  - Remaining risk: a standalone `Closed for the season` line under an item with no facility word, such as a bare
    trail name, can still set the status.
- **Report time.** Recognised labels: "Last updated", "Updated", "Report date", "As of". Accepted formats:
  ISO-8601, `January 15, 2027 7:02 AM`, `1/15/2027 6:45 AM`, and a weekday with a date. The time is interpreted in
  the resort's zone.
  - A date without a time gives `localDate` but `reportedAt: null`. The time is not invented.
  - A missing year is taken from the clock; if that would put the date more than a day in the future, the previous
    year is used.
  - A stamp more than 6 h in the future is ignored.
  - If the page has no date at all, the report is dated by the day it was retrieved, and a limitation says so.

### What the adapter returns

- **Provenance.** Kind `official` and publisher `greekpeak.net` or `alta.com`.
  - `publishedAt` is `reportedAt`.
  - `validFrom` and `validTo` span the report's resort-local day.
  - `staleAfter` is the end of the report's local day. It is measured from the **report** date, not the fetch, so
    refetching an old report does not make it fresh.
  - `verification` is `unverified` until the parser has been checked against the live page.
- **Change detection.** Use `reportContentHash(report)`, a stable hash of the normalised report content, to decide
  whether a fetch is a new report. Like the jobs hash, it excludes `localDate` and `reportedAt`: an undated page is
  dated by the retrieval day, and a page may re-render its timestamp, so neither may make an unchanged report look
  new and reset its observation age. The raw-page hash in `SourceFetch.contentHash` changes whenever the markup
  changes, for example with tokens or ads.
- **Extracts.** `SourceFetch.extract` stores only the matched label snippets and the normalised hash, never a copy
  of the page.

### Greek Peak

- **URLs:** `https://www.greekpeak.net/ski-ride/current-conditions/`, falling back to
  `https://greekpeak.net/conditions-print`.
- **Required anchor:** trail or lift counts.
- **Status:** unverified. The adapter was built from the catalog's description of the page (open/closed trails
  and lifts, surfaces, grooming) and synthetic fixtures.

If the live page renders its data with JavaScript, or lists each trail without totals, the adapter fails with
`schema-changed` and the manual report flow takes over. Counting per-trail open/closed lists is **not**
implemented, to avoid guessing which list is authoritative.

### Alta

- **URL:** `https://www.alta.com/conditions`. **The path is unverified.** The catalog has no confirmed Alta
  snow-report URL (see `catalog/resorts/alta.json` → `reportSource: null`).
- **Required anchor:** base depth or any snowfall window.
- **Status:** unverified.

### Verifying a report adapter

1. Save the live page as a fixture under `reports/__fixtures__/`.
2. Add assertions for the values you can see on the page.
3. Adjust the labels or anchors if needed.
4. Set `maturity: 'verified'`.

Keep the synthetic "changed layout" fixtures. They prove that failures stay loud.

### Adding another resort

Write a `LabelReportConfig` like the ones in `greek-peak.ts` and `alta.ts`, add it to `reports/index.ts`, and add
fixtures and tests.

## OpenStreetMap lifts & runs (`osm/overpass.ts`)

The "full list" of a resort's lifts and runs, as mapped by OpenStreetMap contributors (data © OpenStreetMap
contributors, ODbL; the attribution is shown with every list). Community-mapped: it can be incomplete or out of date,
and it never says whether a lift or run is open today. The resort page says so once and links the resort's own live
lift status page when the catalog has one (`links.liftStatus`) — Piste cannot read it.

- **Endpoint:** `POST https://overpass-api.de/api/interpreter`, body `data=<Overpass QL>` (form-encoded, `Accept:
  application/json`). That is a CORS "simple" request, and the service answers `Access-Control-Allow-Origin: *`, so
  the single-file build calls it from `file://` too.
- **Finding the ski area** (two small requests, a third when needed):
  1. `landuse=winter_sports` ways/relations within 2.5 km of the line from Piste's base point to its summit point
     (`around` with both points), `out tags bb` (names and bounds).
  2. The resort's own ones are kept: names sharing a distinctive word with the resort's name or short name (generic
     words such as "ski", "mountain", "resort" do not count), plus unnamed ones whose bounds hold a weather point;
     else those whose bounds hold a weather point; else the nearest. So Snowbird's area, whose bounds hold Alta's base
     point, is not read as part of Alta. They become areas (`map_to_area`), and `aerialway` ways (cable_car, gondola,
     mixed_lift, chair_lift, drag_lift, t-bar, j-bar, platter, rope_tow, magic_carpet), `railway=funicular` ways and
     `piste:type=downhill` ways (`out tags geom`) and relations (`out body geom`) inside are read.
  3. Fallback, a bounding box: when nothing is found inside (the area is not in Overpass' area index), the chosen
     ski areas' bounds plus 300 m; when no ski area is mapped nearby, the weather points plus 1.5 km. A box can take
     in a neighbouring area's lifts; the extract records the method and the page says so.
- **Parsing:** lengths are summed along the returned geometry (haversine, whole metres; map distance, so steep lines
  are a little longer on the ground), then the geometry is dropped. Capacity (`aerialway:capacity`, "2400", "2,400",
  "2.400" or "2 400"), seats (`aerialway:occupancy`) and ride time (`aerialway:duration`: minutes, `mm:ss`,
  `h:mm:ss` or ISO `PT…`) are read when valid, else unknown. Disused, abandoned and demolished lifts and runs are left
  out; so are stations, zip lines and goods lifts. Named piste ways are grouped into runs by name/ref and
  difficulty; a route relation is one run (its unnamed member ways, and members of the same name, are not listed
  again; with no difficulty of its own it takes its members' only when they all state the same); unnamed ways are
  counted per difficulty as sections, never as runs; pistes mapped only as outlines are counted, not listed.
- **Difficulty** is shown in the resort's convention, as text plus a shape (`domain/lifts.ts`): US, Canada,
  Australia, New Zealand — green circle (novice, easy), blue square, black diamond, double black diamond; Japan —
  green, red, black; elsewhere (Europe) — green (novice), blue, red, black, then "freeride / itinerary" (expert and
  freeride). A run without `piste:difficulty` is "difficulty not mapped", never guessed.
- **Politeness:** per-host spacing of 2 s, at most one retry (5 s backoff), `Retry-After` honoured up to 30 s. After
  HTTP 429/504, a longer `Retry-After`, or a server-side "runtime error" remark (which arrives as HTTP 200 and is
  treated as a failure, never as an empty ski area), nothing is requested for a minute; a load asked for meanwhile
  fails as `rate-limited` without a request, and the job leaves the remaining resorts for their next turn.
- **Storage:** one `source_records` row per load (adapter `osm-overpass`, the endpoint as URL): the compact extract
  `{ skiArea, requests }` on success (no geometry; about 10–60 KB for a large area), the error on failure. The resort
  page reads the newest successful row, so a failed load never replaces the last good list; retention keeps the
  newest row and the newest successful row per adapter/resort/URL whatever their age. No schema change.
- **Provenance:** kind `manual` (community-mapped), provider "OpenStreetMap contributors (ODbL)", verification
  `unverified`, `publishedAt` = the server's OpenStreetMap data timestamp, source URL = the ski area on
  openstreetmap.org. `capabilities.missing` always lists live lift and run status.

## Frankfurter FX (`fx/frankfurter.ts`)

- **Request:** `GET https://api.frankfurter.app/latest?from=USD&to=CAD,EUR`. No key is needed.
- **Response:** `{ amount, base, date, rates }`, the ECB euro reference rates. There is one rate per TARGET
  business day, published around 16:00 CET. `date` is the ECB reference date, so a weekend request returns
  Friday's rate.
- **Rates:** JSON numbers are converted to plain decimal strings with big.js, for example `"0.00000091"`, never
  `9.1e-7`. Floats are never used for money downstream (`domain/money.ts`).
- **Missing currencies** are listed in `capabilities.missing`.
- **Validation:** an `amount` of zero or less is malformed and returns `parse`, never a thrown error.
- **Provenance:** kind `official`, provider "Frankfurter (ECB reference rates)", `validFrom` set to the reference
  date, stale after 36 h.
- **Scope:** these are informational rates, not what a card or bank charges.
- **Host:** Frankfurter also serves `api.frankfurter.dev/v1/`. If the `.app` host is retired, switch
  `FRANKFURTER_URL`.

## Duffel flight offers (`flights/duffel.ts`)

The adapter runs only when `DUFFEL_ACCESS_TOKEN` is set. `configured()` reads the variable at call time. Without
it, `searchOffers` returns `not-configured` and makes **no** network call. The UI falls back to search links and
manual itinerary or quote entry.

**Request.** `POST https://api.duffel.com/air/offer_requests?return_offers=true`

- Headers: `Authorization: Bearer <token>`, `Duffel-Version: v2`, `Accept: application/json`,
  `Content-Type: application/json`, `Accept-Encoding: gzip`.
- Body: `{ data: { slices, passengers: [{type:'adult'}…], cabin_class } }`.
- The request is not retried. Offer requests are not idempotent, and they are slow (timeout 60 s).

**Normalisation.**

- **Amounts.** `total_amount`, a decimal string, becomes integer minor units via `fromMajor`, in
  `total_currency`.
- **Times.** Duffel gives segment times as airport-local wall times without an offset. They are converted to UTC
  only when the airport `time_zone` is supplied. The local wall time is always kept in `departLocal` and
  `arriveLocal`. If a zone is missing, the time stays local and a limitation says so.
- **Flight identifiers** come from the marketing carrier's IATA code and `marketing_carrier_flight_number`.
  Nothing is invented.
- **Expiry.** `expiresAt` comes from `expires_at`; a value without an offset becomes null. Provenance `staleAfter`
  is the earliest offer expiry.
- **Baggage.** `baggageNotes` lists included bags only, for the first passenger. For each bag type it takes the
  **minimum** across the segments that state baggage (a type a segment omits counts as 0), so a bag included on one
  leg only is never shown as included for the trip. When some segments give no baggage data, the note adds "Not
  stated for every segment." Duffel offers do not include ski or sports-equipment fees.

**Test mode.** Offers are marked `testMode: true` when any of these holds:

- the token starts with `duffel_test_`;
- the response has `live_mode: false`;
- the offer has `live_mode: false`.

For test mode, provenance kind is `demo` and a `TEST MODE` limitation comes first. Test data therefore cannot look
like a real fare, and it never feeds live recommendations.

**Errors.** HTTP 401 or 403 means "Duffel rejected the access token", and the error is not retriable. The token
never appears in errors or records.

## Links (`links/`)

Builders return `null` for invalid input, so the UI simply does not offer that link. The builders are pure and
safe in client components, but only if you import them from `@/lib/providers/links/builders`. The
`@/lib/providers/links` index also exports the server-only checker.

| Builder | URL form |
|---|---|
| `googleFlightsSearchUrl` | `https://www.google.com/travel/flights?q=Flights%20from%20ITH%20to%20SLC%20on%202027-01-15%20through%202027-01-19` |
| `kayakFlightsUrl` | `https://www.kayak.com/flights/ITH-SLC/2027-01-15/2027-01-19` |
| `googleMapsDirectionsUrl` | `https://www.google.com/maps/dir/?api=1&origin=…&destination=…&travelmode=driving` (Maps URLs API, values URL-encoded) |
| `openSkiMapUrl` | `https://openskimap.org/#12/lat/lon` |
| `nwsForecastPageUrl` | `https://forecast.weather.gov/MapClick.php?lat=..&lon=..` |
| `OPEN_METEO_ATTRIBUTION_LINK` | Open-Meteo attribution and CC BY 4.0 licence |

`flightSearchLinks()` and `directionsLink()` wrap these in `SearchLink` objects. Each has `liveData: false`, a
label that starts with "Search …" or "Driving directions", and a note saying Piste shows no fares, schedules or
travel times from them. Piste never scrapes Google Flights.

`checkLink(url)` behaves as follows:

- It applies the SSRF guard on every hop.
- It sends HEAD first. If HEAD fails or returns an error status of 400 or above, it falls back to GET without
  downloading the body.
- It follows at most 5 redirects, manually.
- It records `finalUrl` and `httpStatus`.
- It sets `embeddable: false` when `X-Frame-Options` is DENY or SAMEORIGIN, or when CSP `frame-ancestors` is
  `'none'` or a list of specific origins. In that case the page should be opened externally.

## Registry (`registry.ts`)

- `weatherProviders` lists Open-Meteo (primary) first and NWS grid (secondary, US only) second.
- `alertsProvider` is NWS, `fxProvider` is Frankfurter, `travelProvider` is Duffel and `skiAreaProvider` is the
  OpenStreetMap Overpass adapter (connector role `lifts-runs`, job `osm`).
- `reportProviders` and `getReportProvider(resortId)` are re-exported from `reports/index.ts`.
- `weatherProvidersFor(req)` returns the enabled providers that support a point.
- `providerStatus(env)` returns the connector states described above.
- Set `PISTE_DISABLED_PROVIDERS=nws-grid,greek-peak-official` (a comma-separated list of ids) to turn connectors
  off. For example, you might silence a parser that keeps failing until it is fixed. Disabled connectors show as
  `disabled`.

## Contract extensions (backward compatible)

These optional fields were added to `types.ts`, and nothing existing was changed:

- `SourceFetch.ok`, `error`, `attempts` and `fromCache`.
- `OfficialAlert.expires` and `areaDesc`.
- On `FlightOffer` segments: `departLocal`, `arriveLocal`, `carrierName` and `operatingCarrier`.

## Testing

Every adapter is tested with a scripted fake `fetch` (`src/lib/providers/test-helpers.ts`), with injectable sleep,
random and clocks. No test touches the network.

Fixtures under `weather/__fixtures__`, `flights/__fixtures__` and `osm/__fixtures__` are written in the documented
response formats (the Overpass ones by hand: a North American resort next to a neighbour, and an Alps resort whose
ski area is not in the area index).
Report fixtures under `reports/__fixtures__` are **synthetic**, and each is marked as such in the file. They
include "changed layout" pages that must produce `schema-changed`.
