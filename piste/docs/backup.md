# Backup, restore and export

All data lives in SQLite files under `PISTE_DATA_DIR` (default `./data`): `piste.db` (live) and `piste-demo.db`
(demo). Keep that directory on persistent storage.

## Backup

```sh
npm run backup                 # → data/backups/piste-YYYYMMDD-HHmm.db (UTC time), keeps the newest 14
npm run backup -- --keep 30    # or PISTE_BACKUP_KEEP=30
npm run backup -- --dir /mnt/usb/piste-backups   # or PISTE_BACKUP_DIR
```

- Uses SQLite `VACUUM INTO`, which writes a consistent, compacted copy including committed WAL content. It is safe
  to run while the app and the worker are running.
- Rotation only removes files named `piste-YYYYMMDD-HHmm[-n].db`; safety copies made by restore are never rotated.
- Schedule it like any job, e.g. `15 3 * * * cd /srv/piste && npm run backup`, and copy `data/backups/` off the
  machine now and then — a backup on the same disk does not survive the disk.

## Restore

```sh
npm run restore -- data/backups/piste-20270115-1400.db --check   # validate only
npm run restore -- data/backups/piste-20270115-1400.db
```

1. **Stop** `npm run dev`/`npm run start` and the worker. Restore refuses while the worker heartbeat is less than
   5 minutes old (override with `--force`).
2. The file is validated before anything changes: SQLite header, `PRAGMA quick_check`, the expected Piste tables,
   the Drizzle `__drizzle_migrations` table, and that it was not written by a newer Piste version than the code you
   run.
3. The current database is copied to `data/backups/piste-pre-restore-YYYYMMDD-HHmmss.db` (a raw copy if it is too
   damaged to vacuum).
4. The file replaces `piste.db` atomically; stale `piste.db-wal`/`-shm` files are removed first so the old WAL cannot
   be replayed onto the restored database.
5. Start the app. If the backup is older than the code, pending migrations apply on first open.

To undo a restore, restore the `piste-pre-restore-…` copy the same way. `--demo` targets the demo database.

## Personal export (JSON / CSV)

- `GET /api/export/json` — one JSON document with every personal table: preferences, favorites, ratings, pass
  ownership and usage, trips with items and checklists, checklist templates, ski-day journal, skills, lessons,
  expenses, alert rules, manual and personal reports, resort corrections, and resorts/hotels/events/price estimates
  I added. Units are canonical metric, money is integer minor units with a currency, `null` means unknown.
- `GET /api/export/csv?table=<name>` — one table as CSV (RFC 4180, CRLF, UTF-8 with BOM for spreadsheet apps).
  Table names: `preferences`, `favorites`, `ratings`, `pass-ownership`, `pass-usage`, `trips`, `trip-items`,
  `trip-checklist`, `checklist-templates`, `ski-logs`, `skills`, `lessons`, `expenses`, `alert-rules`,
  `manual-reports`, `resort-overrides`, `my-resorts`, `my-hotels`, `my-events`, `price-estimates`. Unknown values are
  empty cells (never 0); nested values are JSON. Text starting with `=`, `+`, `-`, `@` is prefixed with `'` so
  spreadsheets do not evaluate it — use the JSON export for a lossless copy.
- In demo mode the export comes from the demo database: the JSON carries `"demo": true` and a DEMO label, CSV rows
  carry `data_label = DEMO`, and file names start with `piste-DEMO-`. Live exports never contain demo rows.

## Calendar export (ICS)

- `GET /api/export/ics?trip=<id>` — the trip as an all-day event (`DTSTART;VALUE=DATE`, exclusive `DTEND` the day
  after the last day) plus one event per dated trip item (lodging ends on the check-out day). Items linked to a timed
  event use that event's time.
- `GET /api/export/ics?event=<id>` — one event. Events without an announced date are refused (`422`) rather than
  given an invented date.
- **Time zones:** timed events keep the venue's wall-clock time with `TZID=<IANA zone>` (e.g.
  `DTSTART;TZID=America/Denver:20270313T183000`), and the calendar includes a `VTIMEZONE` generated from the IANA
  database for the years involved, with the exact DST transitions. We chose TZID over UTC conversion so the event
  keeps its local meaning ("18:30 at the venue") in every client, including ones that do not know IANA names.
- UIDs are stable (`trip-<id>@piste.local`, `trip-<id>-item-<n>@piste.local`, `event-<id>@piste.local`): importing
  again updates events instead of duplicating them. Demo exports use `demo-…` UIDs and `[DEMO]` titles.
- Text is escaped per RFC 5545 (backslash, `;`, `,`, newlines), lines are folded at 75 octets without splitting UTF-8
  characters, and only `http(s)` URLs are written.
