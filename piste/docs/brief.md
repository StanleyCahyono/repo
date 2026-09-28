# Piste — product brief (acceptance criteria)

This is the build brief Piste is implemented against, kept verbatim in substance. Where the implementation had
to adapt (for example, network restrictions in the build environment), the adaptation is recorded in
`docs/assumptions.md`.

Build Piste, a polished personal ski planning and tracking app for the 2026–2027 season. Deliver a working
application with persistent data, useful public-data integrations, an explainable conditions model, and a
carefully designed responsive interface.

## 1. Product purpose and personal defaults

The app should help me answer:

- Where should I ski this weekend, considering conditions, my ability, travel, and cost?
- Which resorts are opening, and which dates are confirmed announcements versus estimates?
- What is the snow like today, how has it changed, and what might it be like over the next week?
- What does my exact pass cover at each resort on my selected dates?
- How much will a day or trip actually cost?
- How do I get there from Ithaca, including airport alternatives and the final transfer?
- What events, hotels, lessons, maps, and other useful resources are available?

Editable defaults:

- Home: Ithaca, New York; home timezone: America/New_York.
- Active season: 2026–2027. Keep the data model ready for subsequent seasons.
- Initial favorites: Greek Peak and Alta.
- Starting ability: beginner, with an editable progression profile. Support a separate advanced companion profile when comparing trips.
- Preferred display currency: USD, while preserving original quoted currencies.
- Temperature, snow, distance, and elevation units must be independently switchable.
- Pass ownership starts unset. Resort affiliation must never imply that I own a pass.

Keep onboarding to a short, skippable panel: home, ability, preferred units, owned passes, and travel preferences.
Budget, gear ownership, companions, lodging style, and available dates can be added later. Store preferences and
favorites across reloads.

## 2. Scope and resort coverage

Start with a researched, editable catalog of approximately 25–35 resorts. Prioritize places practical from Ithaca
and a useful selection of destination resorts:

- Central/western New York: Greek Peak, Labrador Mountain, Song Mountain, Bristol Mountain, Holiday Valley.
- Northeast: Whiteface, Gore, Hunter, Windham, Belleayre, Killington, Sugarbush, Stowe, Okemo, Mount Snow, Jay Peak.
- Destination examples: Alta, Snowbird, Brighton, Solitude, Deer Valley, Park City, Vail, Breckenridge, Copper Mountain, Steamboat, Jackson Hole, Big Sky, Whistler Blackcomb.
- Allow adding international resorts, including Ski Arlberg, without changing the schema.

These are catalog candidates, not assertions about current pass partnerships, access arrangements, or prices.
Research those independently for the selected season. Preserve separately ticketed ski areas as separate records,
even where they share a valley or brand.

Enable live weather for the catalog where supported. Build the most complete official-report adapters first for
Greek Peak and Alta, then expand through documented, reusable adapters. Every catalog entry must have useful
verified source links; unsupported fields should have an honest missing-data state and a manual-edit route.

Do not create fake completeness by filling missing opening dates, reports, prices, or events with invented values.
If a resort source cannot be accessed reliably, keep the resort useful through weather, source links, and clearly
labeled manual records.

## 3. Information architecture and key screens

Desktop navigation: Today, Explore, Forecast, Trips, Passes & Costs, My Season. Put Events inside Explore and
relevant resort/trip pages. Put Settings and Sources & Sync in the utility area.

Mobile navigation: Today, Explore, Forecast, Trips, More. Preserve filters and navigation state when returning
from a resort.

### Today: the decision dashboard

Compact editorial header with the season, local date, date-range selector, and home location. Above the fold:

- A personalized "Where to ski" recommendation for the chosen date, with up to three alternatives and a plain-language explanation.
- A concise favorite-resort watchlist: operating status, conditions, weather, next opening information, and important changes.
- A seven-day forecast strip that connects directly to the date filter.

Further down: the next saved trip, opening-date timeline, new snow watch, pass deadlines, relevant events, and
recent changes. Prioritize actual decisions; avoid an entire screen of disconnected statistics.

Support presets such as Learning day, Best snow, Lowest total cost, Short drive, and Après weekend. Explain the
winning recommendation with the main benefits and trade-offs. If evidence is incomplete, show that limitation
beside the recommendation.

Before the season, make opening watch, passes, trip planning, and preseason information prominent. A closed snowy
resort must not appear as an available skiing recommendation.

### Explore: list, map, and comparison

Desktop: synchronized list/map layout with an adjustable divider. Mobile: full-width list with a map toggle and a
bottom-sheet resort preview.

Search and filters for region, dates, operating status, travel time, condition score, learning suitability, pass
family/product, total cost, night skiing, lessons, rentals, lodging, and events. Clearly distinguish "unknown" from
"does not offer."

Resort cards: name/location, one good image or a designed fallback, operating status, daily score or missing
state, snow summary, pass badges, expense tier, travel estimate, and favorite/compare controls. Keep secondary
information behind expansion.

Compare 2–4 resorts in a sticky comparison tray. Include conditions, beginner terrain, opening dates/hours, pass
access on the selected date, cost basket, travel, lodging, and events. Keep the selected scenario identical across
columns.

### Resort detail

Compact photographic header with an anchored navigation bar. Sections:

- Overview: location, elevation range, character, suitability, season opening/closing information, current status, and my rating.
- Conditions: reported snow, model estimates, open terrain/lifts, grooming, weather, daily history, and score explanation.
- Plan a visit: hours, tickets/passes, lessons, rentals, parking, road/transit links, and expected costs.
- Getting there: practical airports, driving, flights where available, and airport-to-resort transfers.
- Stay & après: hotels, restaurants/venues, and dated events.
- Maps & links: official trail map, interactive piste map if available, webcams, weather report, booking, and official website.

Always make Save, Compare, and Add to trip easy to find. A source drawer should be accessible from important facts
without cluttering the page.

### Forecast

Hourly timeline for the next 48 hours, daily outlook for roughly seven days, and a daily history calendar. Extend
to days 8–16 only when the provider supports them; visually mark this as a less certain trend.

Show snowfall, temperature, rain, wind/gusts, and available visibility/freezing-level information, with separate
base and upper-mountain views. Scrub across time and compare a small set of favorite resorts. Distinguish reported
observations, weather-model output, and app-derived interpretations.

Do not generate weather forecasts for dates months away. For dates beyond the supported horizon, show resort
planning information and, only when sourced, clearly labeled historical seasonal context.

### Trips, passes, and season journal

Trip creation starts from dates and resort(s), then adds travel, lodging, companions, pass access, lessons,
rentals, and a cost estimate. Save draft and booked components separately.

My Season: ski days, destinations, actual spending, pass usage, notes, and skill practice. Editable learning
checklist such as controlled stopping, turning, linking turns, and using lifts. Completion is self-reported or
instructor-confirmed; the app must not infer skiing ability from spending or distance traveled.

## 4. Resort operations, snow history, and ratings

### Opening dates and opening hours

Separate fields for season, announced target opening, estimated opening window, actual opening, announced
closing, and actual closing. Include the source, announcement date where available, and last check.

Labels: Announced, Estimated, Opened, Not announced. An official announced date is still subject to
operations/weather. Do not turn an announced opening into "Open" automatically when the calendar reaches that date.

Statuses: Not yet open, Open, Partially open, Temporarily closed, Closed for season, and Status unavailable. Save
status changes rather than overwriting history.

Operating hours by resort-local date, activity, and exceptions: weekday/weekend, holiday, night skiing, lifts,
ticket office, rentals, and lessons. Distinguish published hours from live operations. Show which timezone
applies. Do not assume advertised opening hours mean every lift is running.

### Snow records

For each resort and local date, persist available:

- Reported snowfall amounts and their actual accumulation windows: overnight, 24-hour, 48-hour, seven-day, etc.
- Reported base depth, with measurement location/elevation if supplied.
- Surface descriptions, terrain/lift counts, grooming report, and snowmaking statements.
- Weather observations and weather-model values with their separate origins.
- App-derived surface interpretation, daily score, confidence label, and model version.

Preserve source wording alongside normalized tags. Keep surface condition, grooming, and snow production as
separate concepts (grooming is a management action; machine-made snow is an origin; firm or wet describes the
surface).

Surface tags: fresh snow, packed powder, firm/hardpack, icy or refrozen, wet/slushy, spring snow, mixed, unknown.
An official or personal report can support a precise description; a model inference should say "Likely…".

Maintain daily snapshots and intra-day revisions for meaningful changes. The calendar opens a day and shows what
was reported, what was forecast, and what the app estimated then. Never fabricate daily history before
collection began; show gaps and the start of tracking.

### Ratings must describe different things

- Conditions today: calculated, date-specific, explained below.
- Fit for me: personal match based on ability, terrain, lessons, travel, budget, and preferences.
- My rating: an editable personal review after a visit.
- External review rating: only if a permitted source supplies it; show provider, scale, sample count, and retrieval date. Otherwise omit it.

Do not turn invented editorial star ratings into apparently factual resort reviews.

## 5. Built-in conditions model — "Piste Conditions v1"

A transparent, deterministic first version. A configurable planning heuristic, not a validated meteorological or
safety model. An LLM is optional for phrasing explanations; calculations and source grounding must work without
an LLM or paid AI API.

### Inputs and time handling

Use documented weather data for verified mountain coordinates and relevant elevations. Keep provider-returned
coordinates, elevation, units, and timestamps. Request base and upper-mountain locations/elevations where
feasible, and display the resolution limitation. An elevation adjustment does not create an independent weather
station or resolve individual slopes.

Potential inputs: temperature, apparent temperature, snowfall, rain, wind/gusts, humidity, visibility,
cloud/solar information, freezing level, and recent weather history. Request only supported variables. An
unavailable variable must remain null.

Normalize units explicitly. Snowfall accumulation, snow depth, and precipitation water equivalent are different
quantities. Do not count liquid precipitation as snowfall or add a fresh-snow forecast directly to a groomed
piste base measurement.

Compute rolling snow windows from their documented interval semantics; compute daily aggregates in the resort
timezone. Avoid overlapping-window double counting and DST errors. Record forecast retrieval time and model
run/issue time when supplied; do not invent an issuance time from API response-generation duration.

### Surface interpretation

Use recent surface evidence, subsequent weather, and source age. Model forecasts alone cannot establish exact
piste conditions, traffic, grooming, artificial snow coverage, or untouched powder.

Explicit, editable heuristics with documented thresholds and tests. Permissible starting hypotheses:

- Recent modeled snowfall with sufficiently cold conditions and little subsequent rain can suggest fresh snow, with uncertainty about grooming and coverage.
- Recent wetting/thaw followed by a sustained freeze can suggest firmer or refrozen conditions where snow is known to exist.
- Sustained warmth and rain can suggest wetter snow; warming later in a day may change the preferred time window.
- Wind exposure can reduce comfort and suggest wind-affected snow. It does not prove that a particular lift will close.

Numeric thresholds are initial engineering assumptions in versioned configuration, with documented calibration
paths. Do not claim forecast-derived "powder" or "corn" as a confirmed observation.

### Explainable daily score

Components 0–100:

- S — Surface suitability for the selected skiing style.
- T — Terrain availability: usable, appropriate reported open terrain. Beginner mode considers accessible beginner terrain rather than whole-mountain acreage.
- W — Wind comfort: explicit curve on available mountain wind/gust information.
- V — Visibility: available visibility information, with clearly labeled proxies if used.
- C — Temperature comfort: editable curve using relevant temperature/wind-chill data.

| Mode | S | T | W | V | C |
|---|---|---|---|---|---|
| Learning day | 25% | 30% | 20% | 15% | 10% |
| All-mountain day | 35% | 25% | 20% | 10% | 10% |
| Powder preference | 45% | 20% | 20% | 10% | 5% |

`score = round(sum(weight × component) / sum(available weights))`

A complete operational conditions score requires surface evidence, terrain status, wind, and at least 80% weighted
input coverage. Display the coverage and any excluded components. If that gate fails, show "Limited data" and
available component estimates; do not silently substitute neutral or zero values.

Future forecasts may show a separate weather potential score using available weather-derived components, with
assumptions labeled. If displaying a projected full score conditional on terrain staying open, state that
assumption and its source age. Do not represent future open-terrain counts as known.

Integer scores, a short descriptor, source freshness, and an expandable factor breakdown. Descriptors: 85–100
Excellent, 70–84 Good, 55–69 Mixed, below 55 Challenging. These describe suitability, not safety.

Hard rules:

- A confirmed closure overrides recommendation eligibility. Display Closed rather than a misleading ski-day score.
- Unknown operating status must be visible and must not be treated as confirmed open.
- Fresh snow must not automatically make a beginner day better. Deep or ungroomed snow may reduce beginner suitability.
- Official warnings and closures appear independently of the score and cannot be offset by better component values.
- The model must not advise backcountry travel or declare terrain safe. Link to relevant official mountain, road, and avalanche information where useful.

### Confidence and validation

High / Medium / Low evidence confidence based on freshness, input coverage, lead time, source quality, and model
disagreement where genuinely available — a qualitative evidence label, not a probability.

Store forecasts before their valid time. When comparable observations or personal feedback arrive, support error
review by resort, horizon, and metric. Never use later weather data to rewrite the historical forecast or claim an
accuracy result without comparable data and sufficient samples. Start with deterministic model tests and an honest
"not yet calibrated" status in methodology.

## 6. Passes, pricing, and affordability

Use the correct spelling Ikon Pass. Support Ikon, Epic, Indy, Mountain Collective, resort-specific passes, and
extensible regional products. A resort can have multiple affiliations.

Represent pass family, exact product, season, and per-resort access rules separately. Rules may include day
limits, shared destination day pools, blackout dates, reservations, eligibility, discounts rather than included
days, and benefit exceptions. Preserve source-backed unknowns.

Show family badges for discovery, then answer "Can I use my exact pass here on these dates?" from product-specific
rules. Log use manually and track remaining days. Explain group day pools and reservation requirements.

| Family | Accent | Treatment |
|---|---|---|
| Ikon | Ochre #C49A36 | Dark text on pale ochre |
| Epic | Blue #2764A5 | Dark blue text on pale blue |
| Indy | Terracotta #B45B43 | Dark terracotta text on pale peach |
| Mountain Collective | Teal #28766F | Dark teal text on pale teal |
| Regional / resort pass | Slate #5D6873 | Slate text on pale gray |

App categories, not claims of official brand identity. Do not rely on color alone or assume permission to reuse
pass logos.

Season-pass price snapshots with product, currency, season, purchase date window, age/eligibility category,
fees/tax inclusion, and source. Also date-specific lift tickets, rentals, lessons, parking, food estimates,
lodging, flights, and transfers. Store observed quotes separately from user estimates.

Expense tier per resort from a transparent per-person day basket: lift access + selected rental option + lunch +
allocated parking. Lessons, lodging, and long-distance travel itemized separately. Same basket assumptions across
resorts. Initial configurable USD bands: $ under 125; $$ 125–249; $$$ 250–449; $$$$ 450+ — UI classification
thresholds, not factual price estimates. Recalculate when dates, owned pass, gear ownership, party size, or
currency conversion changes. If important prices are missing, show "Incomplete estimate".

Trip budgets show original currency, conversion rate/date if used, per-person versus shared cost, occupancy,
dates, fees, and missing items. Editable estimate ranges without suggesting live quotes.

Pass comparison calculator based on the actual planned resort-day basket: buying a pass plus uncovered days versus
comparable ticket alternatives. Simple break-even only where assumptions fit; do not use one resort's most
expensive walk-up ticket as the universal denominator. Separate already-paid pass cost from incremental cost while
allowing a season-total view.

## 7. Travel from Ithaca, hotels, and events

### Airports and flights

Default flight origin ITH. Nearby-airport alternatives SYR, ELM, ROC, BUF with sourced or clearly estimated ground
travel. Verify current routes rather than hardcoding remembered hubs.

For each destination, distinguish geographically closest airport from most practical airport. Compare:
home-to-origin-airport travel and parking; airport buffer, flight segments, connections, overnight layovers, and
schedule dates; ski baggage charges and fare restrictions where available; arrival-to-resort transfer, car
rental/shuttle options, winter-road information, and total door-to-door travel; ticketed itinerary versus
independently booked connections.

Drive-versus-fly comparison and airport-to-resort maps. Sourced routing for travel time; straight-line distance is
never presented as driving time. Winter disruption buffers are explicit planning assumptions.

Optional authenticated flight-data adapter (e.g. Duffel), with test data separated from live offers, quote
retrieval/expiry shown, and coverage limits explained. Without credentials: verified airport/airline links,
supported prefilled flight-search links, and manual itinerary/quote entry. Never claim live schedules, fares,
availability, or price monitoring in that state. Do not scrape Google Flights or invent flight numbers, booking
URLs, or fare histories.

### Hotels and useful links

For each priority resort, a small curated selection across budget, comfortable, and premium: official link, map
location, distance/transfer to a named lift or base, parking/shuttle information, and ski-in/ski-out only where
verified. Optional loyalty/brand filters.

Room prices only for a sourced date/occupancy quote with fees and currency; otherwise "Check rates". Save options
to a trip and compare lodging/transfer cost. User-entered room prices and bookings stay private and identified.

Prominent link shelf: official trail map/PDF, interactive resort map, webcam, snow report, hours, pass/tickets,
lesson booking, rentals, parking, road/transit information, accommodation, and tourism office. Validate URLs and
show when a target is unavailable. Prefer opening externally when embedding is restricted. Do not invent a trail
geometry layer from a raster trail map.

### Après-ski, festivals, and events

Events from official resort, venue, tourism, and organizer calendars: live music, festivals, night-ski events,
opening celebrations, competitions, food events, other activities.

Store title, venue/location, start/end in venue timezone, ticket link, price/currency if available, source, last
verification, and status: announced, tentative, postponed, or cancelled. Stated age restrictions and booking
requirements without assuming missing ones.

Calendar/list views, filters for trip dates, distance from resort, category, and price. Deduplicate syndicated
listings. Do not roll a previous season's festival forward a year unless the organizer announces it. Save an event
to a trip and export it as an ICS calendar file.

## 8. Additional personal features

- Weekend finder: availability, home, budget, ability, pass access, conditions, travel limits → compare feasible days; editable preference weights; explain rankings.
- Watchlists and alerts: opening-date changes, actual openings, pass sale deadlines, forecast snow thresholds, forecast deterioration, relevant events, verified price changes where supported.
- Lesson planner: notes, instructor links, focus skills, booking details, estimated/actual cost.
- Trip checklist: gear, lesson booking, rentals, lift reservation, parking, transfer, saved documents/links; editable templates.
- Season budget: actual vs planned, cost per ski day, pass usage, spending by category; never double count a pass as purchase and daily cash expense.
- Personal notes and rating: surface feedback, preferred time of day, crowds, learning progress. Crowd estimates are guesses; no fabricated live queues.
- Export and portability: JSON/CSV of personal records, ICS of trips/events, documented backup/restore.

Start with in-app alerts. Browser notifications require opt-in and supported scheduling infrastructure. Dedup and
cooldown rules so repeated forecast refreshes do not spam alerts. Do not promise background notifications from a
closed browser tab.

## 9. Visual design system

A premium alpine field journal combined with a precise travel dashboard: clean, professional, tactile, enjoyable.
Mountain photography (licensed), subtle topographic linework, strong typography, varied but orderly layouts,
generous breathing room. Avoid generic AI-dashboard styling. The first screen contains useful information
immediately.

Typography: Barlow Condensed 600 for wordmark, large titles, selected numbers; IBM Plex Sans 400/500/600 for body,
controls, tables, labels; IBM Plex Mono sparingly. Never Inter, Roboto, Montserrat, or Arial as designed typeface.
Self-hosted with licenses and `font-display: swap`. Desktop titles ~40–48px; mobile 30–34px; body 15–16px; small
metadata ≥12px. Line height 1.45–1.6. Tabular numerals for prices, times, measurements.

Palette: Canvas #F4F5F1, Surface #FFFFFF, Ink #142938, Secondary ink #52616B, Alpine teal #245D65, Glacier tint
#DCEBEA, Copper #A85F3A, Divider #D7DFDF, Positive #2E6C50, Caution #8C620E, Critical #A13F42. Validate contrast. Dark
theme with deep navy backgrounds; status colors consistent across themes.

8px spacing rhythm with 4px refinements, 10–14px panel radii, fine borders, soft shadows only for elevated
overlays. One outline-icon family. Desktop 224–240px navigation rail. Mobile 16px gutters, generous touch targets,
safe-area spacing, bottom sheets for filters. Limited photographic hero height.

Photos need a legitimate usage source and attribution. No hotlinked search thumbnails. Designed topographic
placeholder when no licensed photo exists. Never an unrelated mountain as an apparently authentic resort photo.

Motion (Motion for React): initial page 180–240ms fade + 6–10px rise, stagger first few items; card hover/focus
120–160ms elevation/border, ≤2px translation; favorite toggle 140–180ms scale + immediate saved state;
drawer/bottom sheet 220–300ms with focus management; date/forecast selection 180–240ms highlight movement preserving
axes; score breakdown 300–450ms bar reveal once; map selection 400–700ms pan/zoom on explicit selection; trip
timeline reorder short spring; successful save brief checkmark/toast with undo. Optional subtle header snowfall or
contour animation: away from data, capped density, paused offscreen/hidden, disabled with reduced motion. No
full-screen snowstorms, scroll hijacking, autoplay sound, or continuous bouncing.

Accessibility: WCAG AA contrast, keyboard navigation, visible focus, semantic landmarks, labels, accessible dialog
focus, screen-reader descriptions, reduced motion, text/table alternatives for charts, list alternative for the
map, ≥44px primary mobile touch targets, no hover-only information, text/icons alongside color. Designed loading,
empty, error, missing-source, offline, and stale-data states.

## 10. Data sourcing, provenance, and refresh

Official resort/operator sources for operations and prices, official pass sources for access rules, documented
weather APIs for forecasts, official organizers for events. Third-party sources only with attribution and a clear
role. Public visibility does not automatically permit scraping or redistribution.

Starting integrations: Open-Meteo (verify variables, units, horizons, attribution, limits, terms; modeled current
conditions are not station observations); NWS / api.weather.gov (application identification, caching); official
resort report pages/feeds/structured data; official pass pages; official airport, airline, tourism, hotel, and
event sites. Separate adapters with typed normalized output; source-linked manual records where automated
extraction is unsuitable.

Provenance for every important mutable fact: source URL/provider, season, published/observed time, fetched time,
valid interval, expiry/staleness policy, unit/currency, data kind (officially reported, observed, weather-modeled,
app-derived, manually entered, historical, demo). Keep snapshots/extracts/hashes to debug changes. Field-level
provenance preferred. Preserve conflicting reports; don't average incompatible windows or let a low-quality page
overwrite authoritative information. A fetched page doesn't mean a new report. Failed refreshes don't advance
"last successfully updated"; refetching an old report doesn't reset its observation age.

Refresh schedules (configurable): weather every 3–6 h; official operations ~hourly during operating hours for
favorites; opening dates, pass rules, prices daily; events daily/several times weekly; flight/hotel quotes on
demand; daily snapshots by resort-local day. Timeouts, bounded retries with backoff, caching, rate-limit handling,
per-source failure isolation. Server/worker scheduling, not browser-only. Scheduler health and last successful
refresh visible. A sleeping local machine cannot keep collecting data.

Sources & Sync page: coverage, last success, stale/missing fields, parser failures, connector state, manual
corrections. Never hide a disconnected provider behind live-looking demo data.

## 11. Engineering architecture

TypeScript, Next.js/React, Tailwind with explicit tokens, accessible primitives, Motion, lightweight charts with
accessible alternatives, MapLibre or Leaflet with documented tile provider and attribution, Drizzle, SQLite for a
persistent single-user local deployment, runtime schema validation, provider interfaces, server-side secrets,
documented scheduler/worker plus manual refresh, idempotent jobs. Single application.

Model concepts: Resort, Season, ResortSeason, OperatingSchedule, OperationalReport, SnowObservation, WeatherRun,
WeatherPoint, ConditionsAssessment, SourceRecord, PassFamily, PassProduct, PassAccessRule, PriceSnapshot, Airport,
TravelOption, Hotel, Event, Trip, TripItem, UserPreferences, PassOwnership, PassUsage, SkiDayLog, AlertRule,
RefreshRun. Stable IDs, explicit relations, IANA timezones, original currencies/units, null for unknown. Versioned
assessments and pass rules. Forecast valid time separate from retrieval/run time. Decimal-safe money.

Provider interfaces (WeatherProvider, ResortReportProvider, PassProvider, EventProvider, TravelProvider,
LodgingProvider) return provenance and capability/missing-field information.

Single-user authentication before any remotely accessible deployment; localhost dev can stay simple. Credentials
out of source and bundles; `.env.example`. Sanitize external content; validate imported files/URLs; URL importer
must not reach private/internal addresses.

Runs without paid credentials using public weather, verified links, manual entries, and a separately labeled demo
mode. Demo data isolated from live records, recommendations, exports, alerts. Offline viewing of saved data with
timestamps. Lazy-load maps/charts; responsive on ordinary phones.

## 12. Build sequence and definition of done

Tests for real risks: unit conversion, accumulation windows, midnight/DST, missing data, closures,
beginner/powder scoring differences, pass blackout/day-pool logic, quote expiry, shared trip costs, parser schema
changes, refresh failure behavior.

Journeys:

1. From Today, choose a weekend, compare practical resorts, inspect the ranking explanation, and save a trip.
2. Open Greek Peak and Alta and see sourced facts plus live weather or an explicit fetch failure; unsupported official data has working official links/manual-entry flows.
3. Inspect a past tracked date and distinguish what was forecast then from what was later reported.
4. Select an exact pass product/date and see applicable access restrictions without treating unknown rules as permission.
5. Switch currency/units without corrupting stored values or comparisons.
6. Build a trip with a nearby-origin-airport alternative, hotel option, event, and itemized budget; preserve it across reloads.
7. Load without optional API keys and still complete planning using the supported fallbacks.
8. Simulate an upstream timeout/changed parser and retain the last good data with a visible stale/error state.
9. Use core pages with keyboard navigation, reduced motion, and narrow mobile width.

Production build, type checking, linting, focused tests, screenshots at ~390/768/1440 (text clipping, dialogs,
charts, map controls, dark mode, contrast). README, env-variable guide, source/provider coverage matrix, scheduler
instructions, backup/restore instructions, methodology note for scoring and cost bands. Report which integrations
work live, which use links/manual updates, and which need credentials. Never describe a stub or demo feed as a
completed live integration. Do not purchase services, book trips, or publish externally.
