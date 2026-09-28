# Piste

A personal ski planning and tracking app for the 2026–27 season, built around a home base in Ithaca, NY.
It answers: where to ski this weekend, what is opening (announced vs estimated), what the snow is like and will be,
what your exact pass covers on your dates, what a day or trip really costs, and how to get there.

> Status of data: see **Data coverage** below. Piste never invents opening dates, prices, events, flight details or
> ratings — unknown is shown as unknown, estimates are labelled, and demo data is isolated.

## Quick start

```bash
cd piste
npm install
npm run db:setup        # create data/piste.db and load the curated catalog
npm run dev             # http://localhost:3000
```

Optional, in a second terminal, keep data fresh:

```bash
npm run worker          # long-running scheduler (weather, reports, links, FX, assessments, alerts)
# or, from cron:  npm run refresh
```

Explore in-season features before the season starts: click **Explore demo mode** in the sidebar (or the More sheet
on mobile). Demo mode uses a separate database (`data/piste-demo.db`) with simulated data for Fri 15 Jan 2027; it is
labelled everywhere and never mixes with your records, exports or alerts.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js development server / production build / production server |
| `npm run db:setup` | migrate + seed the live database |
| `npm run db:seed` | reload `catalog/` (idempotent; keeps your corrections and personal records) |
| `npm run demo:seed` | regenerate the isolated demo database |
| `npm run worker` | scheduler loop (see `docs/scheduler.md`) |
| `npm run refresh` | one refresh pass (for cron) |
| `npm run backup` / `restore` | SQLite backup / validated restore (see `docs/backup.md`) |
| `npm run typecheck` / `lint` / `test` / `e2e` | checks |

## Environment

Copy `.env.example` to `.env.local`. Nothing is required for local use. See `docs/environment.md`.

## Documentation

- `docs/brief.md` — the product brief (acceptance criteria)
- `docs/methodology.md` — Piste Conditions v1 scoring and cost bands
- `docs/providers.md` — source/provider coverage matrix and API notes
- `docs/scheduler.md` — refresh cadences and running the worker
- `docs/backup.md` — backup and restore
- `docs/design.md` — design system
- `docs/assumptions.md` — decisions and build-environment adaptations
- `catalog/README.md` — how the catalog was researched and how to correct it
