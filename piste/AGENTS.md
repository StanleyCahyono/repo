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

## Design system (see docs/design.md for the full spec)
- Fonts: Barlow Condensed 600 (`font-display`) for wordmark, page titles and selected large numbers; IBM Plex Sans (body, controls, tables); IBM Plex Mono (`font-mono`) sparingly for compact measurements/timestamps. Never Inter, Roboto, Montserrat or Arial.
- Colours only through tokens: `bg-canvas`, `bg-surface`, `bg-surface-2`, `text-ink`, `text-ink-2`, `text-ink-3`, `bg-teal`/`text-teal`, `bg-glacier`, `text-copper`, `border-divider`, `positive|caution|critical|info|demo` (+ `-bg`), pass families `ikon|epic|indy|mc|regional` (+ `-bg`, `-ink`). No raw hex in components. Dark theme is automatic via tokens.
- Radii 10–14px for panels (`rounded-[12px]`), fine borders, shadow only on overlays (`shadow-overlay`). 8px spacing rhythm.
- Tabular numerals (`tnum`) for prices, times and measurements. Metadata text ≥ 12px.
- No purple gradients, neon glows, glassmorphism, emoji navigation, oversized slogans or repetitive identical card grids.
- Accessibility: semantic landmarks, labelled controls, visible focus, 44px touch targets for primary mobile actions, text/icon alongside colour, table alternatives for charts, list alternative for maps, `prefers-reduced-motion` respected.
- Motion: opacity/transform only; timings from `src/lib/ui/motion.ts` (page-in 180–240ms, hover 120–160ms, sheets 220–300ms, score bars 300–450ms once).

## Primitives available
`Button`, `ButtonLink`, `IconButton` (ui/button) · `Badge`, `PassBadge` (ui/badge) · `StatusPill`, `OpeningTag` (ui/status) · `KindTag`, `Freshness`, `Missing` (ui/provenance) · `Panel`, `PanelHeader`, `Fact`, `Divider` (ui/panel) · `PageHeader` (ui/page-header) · `TopoArt`, `PhotoPlaceholder` (ui/topo) · `Sheet` (ui/sheet: bottom sheet / drawer / dialog with focus management) · `useToast` (ui/toast, supports Undo).

## Checks before you finish
`npm run typecheck && npm run lint && npm test` must pass; run `npm run build` for route-level changes. If you change `src/lib/db/schema.ts`, regenerate the migration with `npm run db:regen` (the project is pre-release: the single init migration is regenerated, not appended).
