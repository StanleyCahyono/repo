# Prompt for Claude Design — redesign Piste

Copy everything below the line into Claude Design. Attach screenshots of the current app showing your own data, if
you have them.

---

You are a world-class product designer and motion designer — think Apple's Human Interface team, a premium
automotive configurator studio and a top-tier travel app working together. Redesign **Piste**, my personal ski
planner, so it is the most beautiful, cinematic and fun ski app I have ever used — **as cool as you can possibly
make it** — while staying fast, legible and honest. The current app works and is "okay"; I want it to feel
spectacular.

## What Piste is (keep all of this working)
A single-user ski planning and tracking app for the 2026–27 season. Home base: Ithaca, New York. It runs as one
offline HTML file in the browser (data stays on my computer) and also as a Next.js app.
- **108 resorts worldwide:** New York and the Northeast US, the Rockies, Utah, Whistler, Japan (Niseko, Hakuba,
  Nozawa…), Australia and New Zealand, Austria, Switzerland, France, Italy, Germany, Andorra, Spain, Sweden.
- **Today:** the decision dashboard — where to ski this weekend (ranked, with an explanation), a 7-day snow strip,
  favourites, alerts, opening dates, pass deadlines, and when the data was last updated, with an "Update now" button.
- **Explore:** list and map of resorts, filters, compare up to four side by side, events.
- **Resort pages:** status and opening, conditions score (suitability, never safety), snow report, modeled weather,
  lifts by type, uphill capacity, km of pistes, a "Lifts & runs" list from OpenStreetMap with runs grouped by
  difficulty (green circle / blue square / black diamond / double black in North America; blue / red / black in
  Europe), a live lift-status link to the resort's own site, prices, pass access, travel from Ithaca, lodging, links.
- **Forecast:** 48 h and 16-day modeled weather, plus a history calendar ("what was forecast then" vs "reported").
- **Trips:** dates, drive vs fly (from ITH, SYR, ELM, ROC or BUF), lodging, events, an itemised budget and a
  checklist.
- **Passes & Costs:** Ikon, Epic, Indy, Mountain Collective; a "can I use my exact pass here on this date?" checker;
  day costs; pass vs lift tickets.
- **My Season:** ski-day journal, pass days, spending, a learning checklist (I'm a beginner), lessons.
- **Settings, Sources & Sync:** units, currency (USD, EUR, CHF, JPY, AUD, NZD and more), theme, data sources.

## Creative direction (my words, take them seriously)
- **"Mirror style like Apple."** A premium Apple-grade look inspired by Liquid Glass: translucent, refractive glass
  panels with specular edges that pick up colour from the content behind them, deep layered depth, soft light,
  huge confident typography, generous space, buttery spring motion. Make it feel like a 2026 Apple product page
  crossed with a high-end mountain guide.
- **"Scrolling everything looks super cool."** Scroll-driven storytelling everywhere it helps: sticky scenes,
  parallax mountain layers, numbers that count up as they enter, sections that glide and focus, a camera that moves
  through the mountains as I scroll a resort page.
- **"A 3D hologram of a person skiing — me."** See signature experience 1.
- **"I can add gear and stuff."** See signature experience 1.
- **"An Uber-like map"** that animates the roads to the resort, or the flight. See signature experience 2.
- Push it. Surprise me. Then make sure every effect earns its place by making information clearer or the app more
  delightful to come back to every day.

## Signature experience 1 — "You": a holographic 3D skier with a gear locker
- A stylised 3D skier (or snowboarder) avatar that represents me, rendered as a hologram: fresnel rim light,
  fine scanlines, subtle flicker, a light particle-snow aura and a glowing base pad. It should look premium and
  futuristic, not like a game character.
- **Customisable:** skis or snowboard; helmet, goggles, jacket, pants, gloves, poles, backpack; colours; stance;
  body proportions and skin tone. It is stylised, never generated from photos, and nothing about me leaves my device.
- **Gear locker:** I add the gear I own (type, brand and model as text, size, bought on, notes, photo optional) and
  choose what the avatar wears. Gear feeds the trip packing checklist and the "own vs rent" cost logic. Brands are
  plain text only — no brand logos.
- **Where it lives:** the Today hero (idle sway; it carves when I hover or scroll); My Season as my skier profile,
  surrounded by real stats only (days skied, vertical if logged, resorts visited, ability and skills progress);
  celebrations when I log a ski day or reach a learning milestone; tasteful empty and loading states.
- **States:** idle, carving loop, celebrate, sleeping (offseason), editing gear. Reduced motion: a still, beautifully
  lit pose.

## Signature experience 2 — "Ride there": an Uber-style journey map
- **A "Where to?" sheet:** type or pick a resort, and the map flies from Ithaca to it.
- **Driving:** the route draws itself along the roads with a glowing line and a car glyph gliding along it.
  - Chips for distance and drive time, a "leave by" time worked out from the drive estimate and the resort's
    posted first-lift time, and a weather-on-the-road strip.
  - The camera ends with a tilted approach into the mountain.
- **Flying:**
  - The ground leg to the departure airport (ITH, SYR, ELM, ROC or BUF).
  - A great-circle arc with a plane glyph to the gateway airport (for example Sapporo for Niseko, Zurich or Geneva
    for the Alps, Queenstown for New Zealand).
  - The transfer road or train to the resort, then the mountain approach.
- **Drive vs fly:** compare them like Uber ride options: time, cost range, effort, and what's unknown.
- It becomes the travel section of every resort page and the heart of the trip planner, as a bottom sheet over a
  full-bleed map on mobile.

## Signature experience 3 — cinematic resort pages
- A 3D terrain flyover of the resort (open elevation data on MapLibre GL), with lifts and runs drawn on the
  mountain in their difficulty colours and shapes. Tap a lift or run to see its details.
- **Apple-style scroll story:** a sticky hero where the mountain rotates and the camera descends as I scroll, then
  conditions (glass score card, snow depth as a stacked "snowpack" visual, an animated snowfall forecast), lifts &
  runs, plan a visit, ride there, stay.
- **The conditions score is the star number:** huge, calm, with its confidence and "Likely…" wording.

## Also redesign
- **Today:** a hero that answers "where should I ski this weekend?" in one glance, with the hologram skier, glass
  weather cards and a beautiful 7-day snow strip.
- **Explore:** a map-first worldwide view (108 resorts) with clustered markers, a glass filter bar and region jumps
  (Northeast, Rockies, Alps, Japan, Australia & NZ). Compare becomes a stunning side-by-side.
- **Forecast:** snow and temperature charts that feel alive (animated, glass, readable), each with a table
  alternative.
- **Passes, My Season, Settings:** the same system, calmer.
- Light and dark themes: dark should feel like an alpine night, light like a bright bluebird day.

## Hard constraints (non-negotiable)
1. **Honest data.**
   - Unknown stays visibly unknown ("Unknown", "Not yet announced"), never 0 and never a fake value.
   - Weather is "Modeled", never "observed"; forecast wording reads "Likely…".
   - Researched facts look like any other fact, with a quiet source drawer; facts with no source are not shown.
   - No sample, placeholder or made-up content anywhere (see "Real content only").
   - Scores describe suitability, never safety.
   - Estimated drive times are labelled estimates. If real road geometry isn't available, the route animation must
     show "approximate route", not imply precise routing.
   - Flight animations are illustrative: never invent flight numbers, times or prices.
   - No fake reviews, ratings or photos: use the topographic or 3D terrain art instead of resort photos.

   Design these labels to look premium, not like warnings.
2. **Accessibility (WCAG AA).**
   - Text on glass must keep 4.5:1 contrast, so design an opaque fallback layer behind text.
   - Visible focus rings, full keyboard use, 44 px touch targets.
   - Text alternatives for every 3D scene and chart (tables, lists). The map has a list alternative.
   - Respect prefers-reduced-motion: no scroll-jacking; scroll effects become simple fades, and 3D becomes still
     images.
   - Never colour alone: difficulty uses shape plus label.
3. **Performance.**
   - It runs as one offline HTML file, about 7 MB today, on an ordinary laptop and a recent iPhone.
   - Target 60 fps. 3D loads lazily and pauses when offscreen or the tab is hidden.
   - Avatar: procedural or a compact model, ≤ 300 KB. The 3D engine adds ≤ 1.5 MB in total.
   - Glass blur must degrade gracefully on weak GPUs.
4. **Offline and free.**
   - No paid services or API keys; no runtime CDNs (everything bundled).
   - Map tiles, terrain and routes need internet. Design the offline state as a first-class, beautiful fallback
     (schematic map and straight arcs, labelled).
5. **Buildable by Claude Code in the existing stack.**
   - React 19, Tailwind v4 (CSS tokens), Motion (motion/react), Radix primitives, lucide icons.
   - MapLibre GL for maps, and three.js / React Three Fiber for 3D.
   - Keep or extend the current token names where possible: canvas, surface, surface-2/3, ink, ink-2/3, teal,
     glacier, copper, divider, positive/caution/critical/info, and pass families ikon/epic/indy/mc/regional.
   - Current fonts: Barlow Condensed (display), IBM Plex Sans and Mono. You may propose an upgrade, but only to
     open-licensed, self-hostable fonts. Not Inter, Roboto, Montserrat or Arial. Don't embed SF Pro; system-ui may
     show it on Apple devices.
   - No Apple logos or assets.

## Real content only
Every screen, prototype and state uses Piste's real data: no sample, placeholder or made-up content. Leave demo mode
out of the redesign entirely (no entry point, banner or simulated day).
- **Design for the real moment:** 1 October 2026, home Ithaca, NY.
  - The northern winter season hasn't started. Zermatt's summer glacier skiing runs until 31 Oct, and Hintertux
    opens tomorrow.
  - The southern season is ending.
- **Show gaps honestly:** where a value isn't known, show "Not yet announced", "Unknown", or an estimate labelled as
  one. Never fill a gap with a plausible number, date, price or name.
- **Weather and alerts are fetched live** from Open-Meteo and NWS. Use real output (labelled "Modeled", with its
  fetch time) if you can get it. Otherwise design the charts' structure in the "Not fetched yet" state, never with
  invented numbers.
- **Lift and run names come from OpenStreetMap at runtime.** Use real names from OSM or the resort's own trail map.
  Otherwise show the list loading, with the real counts below.
- **My ski days and gear start empty.** The 2026–27 season hasn't started and the gear locker is new, so design the
  real first-run states. Filled-in layouts use field labels, never invented days, gear, trips or spending.
- **Ikon, Epic and Mountain Collective 2026–27 prices and deadlines aren't in the catalog.** Show them as unknown,
  with the official link.

**Catalog facts to use.** These come from web research checked 28–30 Sep 2026 and show like any other fact.
Third-party projections show as estimates. Airport times are the transfer from that airport to the resort.
- **Greek Peak, NY (home mountain):**
  - 33 min (32 km) from Ithaca via NY-13 and NY-392.
  - 2026–27 opening not announced. It opened on 28 Nov 2025 and on 5 Dec 2024; OnTheSnow projects 27 Nov 2026.
  - 350–640 m. 55 trails, 8 lifts (6 chairs, 2 other), 8,225 skiers/h, 220 acres.
  - The adult season pass rose from $799 to $999 for purchases from 1 Oct 2026.
  - Indy Base and Indy+: 2 days each. Reports say the 2026–27 Indy Pass sold out in September (unconfirmed).
  - 2025–26 tickets: $48 on Tuesdays; the resort cites day tickets "around $120".
- **Whiteface, NY:**
  - About 5 h 20 min (440 km) by road (an estimate). BTV 120 min, ALB 155 min.
  - No 2026–27 dates yet; ORDA announced last season's on 21 Nov 2025. OnTheSnow projects 21 Nov 2026.
  - 372–1,417 m. 96 trails, 12 lifts (1 gondola, 9 chairs, 2 surface).
  - $134 adult peak day (the source's season is unclear).
  - Pass access unknown: ORDA SKI3, Snow Pass, Mountain Collective.
- **Zermatt, Switzerland:**
  - Summer skiing on the Theodul glacier until 31 Oct 2026.
  - Winter season 1 Nov 2026 – 3 May 2027. The glacier opens first; Sunnegga-Rothorn and Gornergrat follow on 28 Nov.
  - The Matterhorn Alpine Crossing to Cervinia is closed for maintenance until 23 Oct 2026.
  - 1,524–3,883 m. 51 lifts (11 gondolas, 8 cable cars, 22 chairs, 6 surface, 4 other), 96,074 skiers/h, 360 km.
  - Day pass from CHF 89 (dynamic pricing). Ikon (days not researched).
  - MXP 165 min, GVA 195 min, ZRH 210 min.
- **Niseko United, Japan:**
  - All four resorts plan to open 28 Nov 2026, snow permitting; last season's opening slipped into December for lack
    of snow. The last of them closes 5 May 2027.
  - 240–1,308 m. 73 courses, 30 lifts (6 gondolas, 24 chairs), 42 km.
  - All Mountain Pass ¥13,500 a day at peak (24 Dec – 28 Feb). Ikon (days not researched).
  - CTS 130 min.
- **Thredbo, Australia:**
  - Season over: it closed 13 Sep 2026, with 0 cm reported on 18–21 Sep.
  - 2027 dates not announced. The traditional start is the King's Birthday weekend, 12–14 June 2027 (an inference,
    not an announcement).
  - 1,365–2,037 m. 16 lifts, 52 km.
  - AUD 239 weekday, 259 weekend (2026 winter). Ikon (days not researched).
  - CBR 155 min, SYD 340 min.
- **Cardrona, New Zealand:**
  - Open until 18 Oct 2026 (season extended by a week). 112 cm natural base and 6 cm new on 26 Sep 2026.
  - 1,670–1,860 m. 47 trails, 11 lifts.
  - NZD 199 a day (season not stated).
  - ZQN 60 min.
- **Hintertux Glacier, Austria:**
  - Opens 2 Oct 2026. It closed in mid-August and is no longer open year-round.
  - 1,500–3,250 m. 21 lifts, 94,000 skiers/h, 64 km.
  - €82 a day (season and scope unclear).
  - Epic: up to 5 consecutive days, shared across the Zillertal.
  - INN 80 min, MUC 145 min.
- **Kitzbühel, Austria:**
  - 6 Nov 2026 – 4 Apr 2027 (early-season operation may be partial).
  - 800–2,000 m. 58 lifts (12 gondolas, 1 cable car, 28 chairs, 8 surface), 110,323 skiers/h, 188 km.
  - €83 a day (2026–27).
  - Ikon 7 days; Ikon Base 5 days with blackouts.
  - INN 75 min, SZG 80 min, MUC 115 min.
- **Val Thorens, France (Les 3 Vallées):**
  - 21 Nov 2026 – 2 May 2027.
  - 2,300–3,200 m. 85 pistes, 32 lifts, 150 km.
  - €66.10 a day until 18 Dec, €73.50 from 19 Dec (2026–27). Epic (days not researched).
  - CMF 125 min, LYS 160 min, GVA 170 min.

## What I want from you
1. **Three distinct directions** first, each with a short moodboard description, key frames and the Today hero.
   For example: "Liquid Glass Alpine" (bright, refractive), "Night Hologram" (dark, luminous, sci-fi) and
   "Editorial Summit" (Apple product-page storytelling). Recommend one.
2. **The chosen direction as a design system:**
   - colour tokens for light and dark;
   - glass materials (blur, tint, border, specular), elevation and lighting;
   - type scale, spacing and radii, iconography;
   - a motion system (springs, durations, scroll-timeline patterns);
   - 3D and hologram shader guidelines.

   Express it as CSS custom properties plus a short spec.
3. **High-fidelity screens** at 1440 and 390 px, in light and dark:
   - Today; Explore (map and list) and Compare; a resort page (full scroll story);
   - the Ride There journey map (drive and fly variants); the trip planner;
   - My Season with the hologram and gear locker; Forecast; the Passes checker.
4. **Interactive prototypes** (HTML/React with real motion) of the three signature experiences and the resort-page
   scroll story.
5. **Component specs with every state:** loading, empty, unknown, stale, error, offline, reduced motion.
6. **Handoff notes for Claude Code:**
   - build order;
   - the libraries and techniques for each effect (for example the glass material, the route-draw animation and
     the hologram shader);
   - performance budgets;
   - exactly how each effect degrades.

Make it unforgettable.
