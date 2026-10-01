# Piste design system

A premium alpine field journal combined with a precise travel dashboard. Useful information first; character comes
from typography, topographic linework, fine rules and careful motion — not from gradients or glow.

## Typography
| Role | Face | Size / weight | Notes |
|---|---|---|---|
| Wordmark, page titles | Barlow Condensed | 600; 44px desktop / 32px mobile; line-height 1.02 | `font-display` |
| Big numbers (score, snow totals, prices on hero cards) | Barlow Condensed | 600; 28–56px | always `tnum` |
| Section titles | IBM Plex Sans | 600; 17–22px | sentence case |
| Body | IBM Plex Sans | 400; 15–16px; line-height 1.55 | max ~68ch |
| Controls, tables | IBM Plex Sans | 500; 13.5–15px | |
| Eyebrows | IBM Plex Sans | 600; 12px; +0.08em tracking, uppercase | short labels only — never long all-caps text |
| Measurements, timestamps (compact) | IBM Plex Mono | 400/500; 12–13px | sparingly |
Minimum text size 12px. Numerals that change or align (prices, times, snow, scores) use `tnum`.

## Colour tokens
Light values below; the dark theme (deep navy) is defined in `src/app/globals.css` and swaps automatically.

| Token | Light | Use |
|---|---|---|
| canvas | #F4F5F1 | page background |
| surface / surface-2 / surface-3 | #FFFFFF / #F9FAF7 / #ECEEE8 | panels / insets / tracks |
| ink / ink-2 / ink-3 | #142938 / #52616B / #5F6D76 | text hierarchy (ink-3 ≥ 4.5:1 on surface) |
| teal / teal-strong / glacier | #245D65 / #1B4A51 / #DCEBEA | primary actions, selection |
| copper | #A85F3A | sparse emphasis (Piste estimates, highlights) |
| divider / divider-strong | #D7DFDF / #B9C6C7 | rules and borders |
| positive / caution / critical / info | #2E6C50 / #8C620E / #A13F42 / #2C5C86 | states — always with text or icon |
| demo | #6A4C93 | demo-mode labelling only |
| Pass families | ikon #C49A36, epic #2764A5, indy #B45B43, mc #28766F, regional #5D6873 | badge border + pale fill + dark ink + monogram |

## Layout
- 8px rhythm with 4px refinements. Panels: 12px radius, 1px `divider` border, no resting shadow.
- Desktop: 232px navigation rail (≥1280px), compact 76px rail (768–1279px), content max-width 1320px.
- Mobile: 16px gutters, top bar + bottom nav (Today, Explore, Forecast, Trips, More), bottom sheets for filters and
  previews, 44px minimum targets, safe-area padding.
- Resort headers: photo (licensed) or topographic placeholder, max 220px desktop / 160px mobile.
- Vary layouts: editorial lists, split panes, timelines, tables — avoid screens made only of identical cards.

## Components
- **Score**: Barlow number + descriptor + confidence tag; "Limited data" and "Closed" are distinct designed states,
  never a grey number. Breakdown bars reveal once (300–450ms).
- **Evidence tags** (`KindTag`): Reported / Observed / Model / Piste estimate / Manual / Historical / Demo.
- **Freshness**: relative time, turns caution + "stale" past the source's staleness window.
- **Missing**: "Unknown" (italic, ink-3) vs "Not offered" (ink-2) vs "Not yet published".
- **Source drawer**: from any important fact, a right drawer (mobile bottom sheet) listing provider, URL, kind,
  published/fetched times, verification level.
- **Pass badges**: discovery only; exact product access answered in the pass checker.

## Motion
| Interaction | Spec |
|---|---|
| Page/section entrance | 180–240ms fade + 8px rise; stagger only the first ~4 items |
| Card hover/focus | 120–160ms border/elevation, ≤2px translate |
| Favourite toggle | 140–180ms scale pulse; saved state immediate |
| Drawer / sheet | 220–300ms slide + fade; focus trapped, returned on close |
| Date / forecast selection | 180–240ms highlight glide (shared layoutId); axes stay put |
| Score breakdown | 300–450ms bar reveal, once |
| Map selection | 400–700ms flyTo only on explicit selection |
| Trip reorder | short spring |
| Save | checkmark toast with Undo |
Header contour/snow flourish: only inside headers, low density, paused offscreen or when the tab is hidden,
disabled under reduced motion. Never full-screen effects, scroll hijacking, sound or looping bounces.

## Accessibility
WCAG AA contrast (validated in `scripts/contrast.mjs`), keyboard reachability, visible focus ring (teal, 2px),
landmarks, labelled controls, Radix dialogs for focus management, chart tables, map list alternative, reduced
motion, no hover-only information.
