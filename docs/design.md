# Piste design system — Glass HUD

Apple-style glass crossed with a mission-control HUD: translucent, specular glass panels floating on a pale sky
gradient, huge light Geist type, thin lines and tracked mono labels, one dark "HUD chip" for whatever is selected or
primary. Useful information first; the glass and motion are the finish, never the content. Today is the loudest
screen; Passes, My Season, Settings and Sources & Sync use the same system, calmer (smaller titles, no hero art).

The source of truth is `src/app/globals.css` (tokens, materials, utilities, keyframes) and the primitives in
`src/components/ui/`. Mockups: `project/*.dc.html` in the design bundle.

## Typography
| Role | Face | Size / weight | Class |
|---|---|---|---|
| Page title | Geist | 300; 40px phone / 52px tablet / 60px desktop; tracking −0.035em; line-height 1.02 | `title-hud` (via `PageHeader`) |
| Hero title (Today) | Geist | 300; up to 88px; tracking −0.04em | screen-specific |
| Big numbers (scores, prices, counts) | Geist | 300; 28–64px; `tnum` | `font-display font-light tnum` |
| Section titles | Geist | 500; 22–26px; tracking −0.02em | `SettingsSection` / screen sections |
| Panel titles | Geist | 600; 17–18px | `PanelHeader`, sheet titles |
| Body | Geist | 400; 15–16px; line-height 1.55 | max ~68ch |
| Controls, tables | Geist | 500; 13–15px | |
| Page eyebrow | Geist Mono | 500; 12px; +0.16em; uppercase; teal (`--eyebrow`) | `eyebrow-hud` |
| HUD labels, card titles | Geist Mono | 500; 12px; +0.12em; uppercase; ink-2 | `hud`, `eyebrow` |
| Measurements, timestamps | Geist Mono | 400/500; 12–13px | `font-mono tnum` |

Minimum text size 12px (including badges and tags). Never Inter, Roboto, Montserrat or Arial. Uppercase mono only for
short labels — never sentences.

The custom utilities (`glass*`, `hud`, `eyebrow*`, `title-hud`, `font-display`, `tnum`, `ink-chip`) are wrapped in
`:where()` (zero specificity), so any Tailwind utility on the same element wins: `glass rounded-none border-x-0`,
`hud text-[13px]`, `eyebrow text-teal` all do what they say.

## Colour tokens
Light values below; the dark theme ("alpine night": deep navy sky, same roles) is in `globals.css` and swaps
automatically (system preference, or `data-theme` from Settings). No raw hex in components.

| Token | Light | Use |
|---|---|---|
| sky-1…sky-4 | #CFE3F4 → #F6F8FA | the page gradient (body background) |
| canvas / surface / surface-2 / surface-3 | #EEF4F9 / #FFF / #F4F8FB / #E6EDF3 | opaque fallbacks, insets |
| ink / ink-2 / ink-3 | #13202C / #3B4A57 / #4B5A67 | text hierarchy (all ≥ 4.5:1 on every glass material) |
| teal / glacier | #1A6694 / #DBEAF5 | links, focus, "on" states, quiet buttons |
| eyebrow | #1A6593 | page eyebrows over the sky |
| copper | #A8571C | Piste estimates, unread dots, sparse emphasis |
| ink-chip / on-ink-chip(-2, -accent) | #13202C / #FFF / #C7D6E2 / #9FD2EF | the dark HUD chip and text on it (inverts in dark) |
| glass / glass-strong / glass-soft | white 66% / 90% / 55% | glass tints (dark: navy 70 / 92 / 58%) |
| glass-edge / glass-shine / glass-line | white 95% / #FFF / ink 8% | panel edge, specular top edge, hairlines on glass |
| chip-track / chip-hover | ink 6% / 8% | segmented tracks, ghost hovers, inset rows |
| field / field-edge | #FFF / ink 50% | form fields: opaque fill, 3:1 boundary |
| divider / divider-strong | #DAE3EB / #B6C6D3 | rules on opaque surfaces |
| positive / caution / critical / info (+ `-bg`) | #2E6C50 / #8C620E / #A13F42 / #2C5C86 | states — always with text or icon |
| demo (+ `-bg`) | #6A4C93 | demo-mode labelling only |
| Pass families | ikon, epic, indy, mc, regional (+ `-bg`, `-ink`, ikon `-edge`) | badge border + pale fill + dark ink + monogram |

`node scripts/contrast.mjs` checks every pair, compositing translucent tokens over the sky (the darkest light sky and
the lightest dark sky) so "text on glass" is measured against what is really behind it.

## Materials
| Material | Recipe | Use |
|---|---|---|
| `glass` | tint 66%, 1px glass-edge, inset 1px shine, `--glass-shadow`, blur 24px saturate 1.6 | panels, nav pill, cards |
| `glass-strong` | tint 90%, blur 18px | sheets, dialogs, secondary buttons, utility buttons, banners |
| `glass-soft` | tint 55%, blur 16px, no shadow | empty states, skeleton panels |
| HUD chip (`bg-ink-chip text-on-ink-chip`) | opaque | selected nav/segment/index item, primary buttons, toasts, saved favourites |
| Field (`bg-field border-field-edge`) | opaque | inputs and selects — text never sits on bare glass |

Fallbacks: without `backdrop-filter`, or with `prefers-reduced-transparency: reduce`, every glass material becomes the
opaque `surface`. Text contrast never depends on the blur.

## Shape, space, elevation
- 8px rhythm with 4px refinements. Page gutters 16px phone / 32px tablet / 48px desktop; content max-width 1440px.
- Radii: pills (buttons, segmented, nav, chips) fully rounded; panels 24px (`Panel`, settings panels); hero cards
  28px; sheets 28px top corners on phones, floating 24px drawers/dialogs at md+; insets and list rows 14–18px; fields 12px;
  badges 8px.
- Elevation comes from the glass shadow; overlays use `--glass-shadow-lg`. No neon glows or purple gradients.

## Layout
- Desktop (≥1024px): top bar — PISTE wordmark, glass nav pill (dark chip glides to the active item), home coordinates
  (≥1280px), Sources & Settings as round glass buttons, alert bell when unread. 768–1023px: the nav pill gets its own
  centred row (and scrolls inside itself if it ever outgrows it).
- Mobile (<768px): sticky glass top bar (wordmark + season · home), fixed 64px glass bottom bar (Today, Explore,
  Forecast, Trips, More) whose dark chip slides to the active item; More opens a bottom sheet. Other fixed bars sit at
  `bottom: calc(4rem + safe-area)`; toasts stay above them. 44px minimum targets; safe-area padding; no horizontal page
  scroll (long segmented rows and tab strips scroll inside themselves).
- Settings / Sources & Sync: numbered sections (teal mono index, Geist 500 title, one line of context) over glass
  panels of setting rows; a sticky glass section index — a pill strip on phones/tablets, a vertical glass index ≥1280px.

## Components (src/components/ui)
- **Button / ButtonLink**: `primary` dark chip, `secondary` glass-strong pill, `ghost`, `quiet` (glacier), `danger`;
  sizes sm 36 / md 40 / lg 48px (add `h-11` for 44px phone targets). Hover lifts 1px; press scales to 0.98. Disabled is a
  flat chip-track pill with ink-3 text. `IconButton` is round (`ghost` or glass `secondary`).
- **Segmented**: glass chip track; the selected option is the dark chip, sliding with a shared layoutId. Arrow keys
  move the selection. Scrolls inside itself; `wrap` wraps.
- **Sheet**: glass-strong bottom sheet / floating drawer / dialog over a dimmed, lightly blurred page; Radix focus trap,
  Escape, focus return; 44px round close button; spring-in (CSS).
- **Toast**: dark chip with a tone icon (check / alert / info), Undo and link as pill buttons; springs up; stays
  above the bottom bar and any fixed action bar.
- **Badge / PassBadge / StatusPill / OpeningTag**: 12px minimum; text + icon or monogram, never colour alone.
- **Form** (`Field`, `TextInput`, `Select`, `Textarea`, `Checkbox`): opaque field, 3:1 boundary, teal edge + soft halo
  on focus plus the global focus outline; theme-aware select chevron (`--chevron`).
- **States**: `EmptyState` (glass-soft + contours + optional icon), `Notice` (opaque tone tint + tone icon; error /
  stale / offline / info), `Skeleton` (breathing tint), `OfflineBanner` (glass-strong, sticky), `Missing` ("Unknown" vs
  "Not offered"), `Freshness` (caution + "stale" past its window), `KindTag` evidence tags.
- **Score**: Geist Light number + descriptor + confidence; "Limited data" and "Closed" are distinct designed states.
  Breakdown bars reveal once.
- **Source drawer**: from any important fact — provider, URL, kind, published/fetched times, verification.
- **Loading / error / not-found**: skeletons in the real layout's shape on glass; errors say nothing was changed and
  offer Try again; 404 is "Off the map", never a guess.

## Motion
| Interaction | Spec |
|---|---|
| Page/section entrance | 180–240ms fade + 8px rise, first ~4 items only; CSS `.piste-rise` for server-rendered sections (never invisible while hydrating) |
| Hover / focus | 120–160ms; pills and cards lift ≤ 2px (`.lift`), deeper glass shadow |
| Selection glide (nav pill, segmented, section index, bottom bar) | 200ms shared layoutId |
| Sheets / drawers / dialogs | 260–300ms spring-in (`--ease-spring`), 160–200ms ease-out close |
| Toasts | spring up (stiffness 520, damping 42) |
| Switch thumb | spring |
| Score bars | 300–450ms reveal, once |
| Map selection | 400–700ms flyTo only on explicit selection |
Transform and opacity only. `MotionConfig reducedMotion="user"` plus a global CSS rule collapse everything under
`prefers-reduced-motion`; skeletons stop breathing and beacons stop pulsing. Never scroll hijacking, sound or looping
bounces outside the Today hero.

## Accessibility
WCAG AA: text on glass ≥ 4.5:1 against the tint over the sky (checked), opaque fallback for glass, form boundaries
3:1, visible focus (2px teal outline, offset 2px, plus field halo), keyboard reachability, landmarks, labelled controls,
Radix dialogs for focus management, 44px touch targets for primary mobile actions, chart tables, map list
alternatives, reduced motion and reduced transparency respected, no hover-only information.
