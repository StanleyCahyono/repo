<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Piste — working conventions

Piste is a single-user ski planning app (Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Motion, Drizzle + libsql/SQLite). The product brief lives in `docs/brief.md`; it is the acceptance standard.

## Stack facts that differ from older habits
- Next 16: `params`, `searchParams`, `cookies()`, `headers()` are **async** (await them). `middleware.ts` is now `proxy.ts`. Turbopack is the default bundler. Lint with the ESLint CLI (`npm run lint`), not `next lint`. `revalidateTag` needs a second argument; prefer `revalidatePath` / `refresh()` from `next/cache` after mutations.
- Cache Components are **off**; routes are dynamic because the root layout reads cookies. Do not add `'use cache'`.
- Tailwind v4 is configured in CSS (`src/app/globals.css`, `@theme inline`). There is no tailwind.config.js.
- Motion: `import { motion, AnimatePresence } from 'motion/react'`. Presets in `src/lib/ui/motion.ts`. The shell wraps everything in `<MotionConfig reducedMotion="user">`.
- Radix primitives: `import { Dialog, Tabs, Popover, ... } from 'radix-ui'`.
- Icons: `lucide-react` only (outline family), `strokeWidth={1.8}` in navigation, default elsewhere.
- DB: `const ctx = await getCtx()` (src/lib/context.ts) gives `{ mode, db, now, today, prefs }`. `db` is a Drizzle libsql database. Queries are async (`await db.select()...`). Live and demo data live in separate SQLite files — never write demo rows to the live DB or vice versa.
- Use the app clock (`ctx.now`, `ctx.today`), never `new Date()` in data/logic code, so demo mode and tests work.

## Data honesty rules (non-negotiable)
- Unknown is `null` and renders via `<Missing/>` ("Unknown" vs "Not offered"). Never render 0 for unknown, never invent values, dates, prices, events, flight numbers, ratings or photos.
- Every important mutable fact carries provenance (`Provenance` in `src/lib/domain/types.ts`): kind (official / observed / modeled / derived / manual / historical / demo), provider, sourceUrl, publishedAt, fetchedAt, staleAfter, verification.
- Catalog facts researched by web search have `verification: 'search-summary'` and must be shown as "Researched — confirm at source", never as live or official-verified.
- Weather-model output is `modeled`, never "observed". Forecast-derived surfaces read "Likely …". Scores describe suitability, not safety.
- An announced opening date never turns into "Open" automatically. Unknown operating status is never treated as open. A confirmed closure overrides any score.
- A failed refresh must not advance "last successful update"; refetching an unchanged report must not reset its observation age.
- Demo data is labelled everywhere it appears and never feeds live recommendations, exports or alerts.

## Code layout
- `src/lib/domain/` — pure, framework-free logic (types, time, units, money, conditions engine, pass rules, costs, recommendation). No DB or network imports. Unit-tested with Vitest (`*.test.ts` beside the file).
- `src/lib/providers/` — external data adapters behind typed interfaces; each returns values **plus provenance and capability/missing-field info**. Network via `src/lib/providers/http.ts` only.
- `src/lib/jobs/` — refresh jobs, scheduler, snapshotting, alerts evaluation. Idempotent.
- `src/lib/data/` — server-side read models (queries → view models) used by pages.
- `src/lib/actions/` — server actions (`'use server'`) for mutations; validate input with zod; call `revalidatePath` after writes.
- `src/components/ui/` — design-system primitives. `src/components/<area>/` — feature components.
- `src/app/` — routes. Server components by default; `'use client'` only where interaction needs it.
- `catalog/` — curated seed data (JSON) with per-fact sources. `scripts/` — CLI entry points (tsx).
- Stored units are metric (cm, mm, °C, km/h, m, km); convert only for display with `src/lib/domain/units.ts`. Money is integer minor units + currency via `src/lib/domain/money.ts`.
- Times: instants are UTC ISO strings; resort days are `YYYY-MM-DD` in the resort's IANA zone via `src/lib/domain/time.ts` (Luxon). Never compute resort days with `Date` local time.

## Design system — Glass HUD (see docs/design.md for the full spec)
- Look: Apple-style glass panels over a pale sky gradient + mission-control HUD (mono tracked labels, thin lines). One dark **HUD chip** (`bg-ink-chip text-on-ink-chip`) marks whatever is selected or primary: nav pill, segmented selection, section index, bottom bar, primary buttons, toasts. Passes, My Season, Settings and Sources use the same system, calmer.
- Fonts: Geist (self-hosted, OFL) for display and text — page titles `title-hud` (weight 300, tight tracking; `PageHeader` does this); Geist Mono for HUD labels: `eyebrow-hud` (teal page eyebrow), `hud` / `eyebrow` (ink-2 card labels), measurements and timestamps. Never Inter, Roboto, Montserrat or Arial. Minimum text 12px, badges included.
- Colours only through tokens: `bg-canvas`, `bg-surface(-2|-3)`, `text-ink(-2|-3)`, `text-teal`, `bg-glacier`, `text-copper`, `text-eyebrow`, `bg-ink-chip`/`text-on-ink-chip(-2|-accent)`, `bg-chip-track`/`bg-chip-hover`, `border-glass-line`, `bg-field`/`border-field-edge`, `bg-skeleton`, `border-divider(-strong)`, `positive|caution|critical|info|demo` (+ `-bg`), pass families `ikon|epic|indy|mc|regional` (+ `-bg`, `-ink`). No raw hex in components. Dark theme is automatic via tokens.
- Materials: `.glass` (panels), `.glass-strong` (sheets, banners, secondary/utility buttons), `.glass-soft` (empty states, skeleton panels). Each falls back to opaque `surface` without backdrop-filter or under `prefers-reduced-transparency`. Text on glass is contrast-checked against the tint over the sky (`node scripts/contrast.mjs`). Inputs use an opaque field, never bare glass.
- These custom utilities (and `hud`, `eyebrow*`, `title-hud`, `font-display`, `tnum`) are zero-specificity (`:where`), so a Tailwind utility on the same element always wins (`glass rounded-none border-x-0`). `cn()` is clsx only — it does **not** merge conflicting Tailwind classes, so don't rely on overriding a primitive's base class of the same property unless the primitive documents it.
- Shape: pills for buttons/segmented/nav/chips; panels 24px (`Panel`), hero cards 28px; sheets 28px top corners on phones, floating 24px drawers/dialogs at md+; insets 14–18px; fields 12px; badges 8px. 8px spacing rhythm. Tabular numerals (`tnum`) for prices, times and measurements.
- Accessibility: semantic landmarks, labelled controls, visible focus (2px teal outline), 44px touch targets for primary mobile actions, text/icon alongside colour, table alternatives for charts, list alternative for maps, `prefers-reduced-motion` and `prefers-reduced-transparency` respected, no horizontal page scroll on phones (long rows scroll inside themselves).
- Motion: opacity/transform only; timings from `src/lib/ui/motion.ts` (page-in 180–240ms, hover 120–160ms with ≤2px lift — `.lift`, selection glide 200ms via shared layoutId, sheets 260–300ms spring-in via `--ease-spring`, score bars 300–450ms once). Server-rendered entrances use CSS (`.piste-rise` with `--rise-delay`) so content never stays invisible while a long page hydrates.

## Primitives available
`Button`, `ButtonLink`, `IconButton` (ui/button) · `Badge`, `DemoBadge`, `PassBadge` (ui/badge) · `StatusPill`, `OpeningTag` (ui/status) · `KindTag`, `Freshness`, `Missing` (ui/provenance) · `Panel`, `PanelHeader`, `Fact`, `Divider` (ui/panel) · `PageHeader` (ui/page-header) · `Segmented` (ui/segmented) · `Field`, `TextInput`, `Select`, `Textarea`, `Checkbox` (ui/form) · `Disclosure` (ui/disclosure) · `EmptyState` (optional `icon`), `Notice`, `Skeleton` (ui/states) · `OfflineBanner` (ui/offline-banner) · `ScoreChip`, `ScoreBreakdown`, `ConfidenceTag` (ui/score) · `SourceDrawer`, `SourceList` (ui/source-drawer) · `ScrollRow` (ui/scroll-row) · `FavoriteButton` (ui/favorite-button) · `TopoArt`, `PhotoPlaceholder` (ui/topo) · `Sheet` (ui/sheet: bottom sheet / floating drawer / dialog with focus management) · `useToast` (ui/toast, supports Undo and a link).

## Checks before you finish
`npm run typecheck && npm run lint && npm test` must pass; run `npm run build` for route-level changes. If you change `src/lib/db/schema.ts`, regenerate the migration with `npm run db:regen` (the project is pre-release: the single init migration is regenerated, not appended).
