/**
 * Export & portability (server-rendered, works without JavaScript): every personal table as JSON, one table as CSV,
 * trips as calendar files (ICS), and how backup / restore work (docs/backup.md). In demo mode the downloads come from
 * the demo database and are labelled DEMO in the file name and inside the file.
 */
import { CalendarPlus, Database, FileJson, FlaskConical, Sheet as SheetIcon } from 'lucide-react'
import { Select } from '@/components/ui/form'
import { PERSONAL_TABLES, PERSONAL_TABLE_LABEL, type PersonalTable } from '@/lib/export/json'
import type { PickerTrip } from '@/lib/data/season-screen'
import { rangeLabel } from './format'

const SEASON_TABLES: PersonalTable[] = ['ski-logs', 'skills', 'lessons', 'expenses', 'gear', 'pass-usage', 'pass-ownership', 'ratings', 'manual-reports']

const action =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md border border-divider-strong bg-surface px-4 text-[14.5px] font-medium text-ink transition-colors duration-150 hover:border-teal hover:text-teal md:h-10'

function Block({ icon, title, body, children, stack }: { icon: React.ReactNode; title: string; body: React.ReactNode; children: React.ReactNode; stack?: boolean }) {
  return (
    <li className={stack ? 'grid gap-3 px-4 py-4 md:px-5' : 'grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center md:px-5'}>
      <div className="flex min-w-0 gap-3">
        <span aria-hidden className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-divider bg-surface-2 text-ink-2">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          <div className="mt-0.5 text-[13px] text-ink-2">{body}</div>
        </div>
      </div>
      <div className={stack ? 'flex flex-wrap items-center gap-2 pl-12' : 'flex flex-wrap items-center gap-2 pl-12 sm:pl-0'}>{children}</div>
    </li>
  )
}

export function ExportPanel({ demo, trips }: { demo: boolean; trips: PickerTrip[] }) {
  const rest = PERSONAL_TABLES.filter((t) => !SEASON_TABLES.includes(t))
  const prefix = demo ? 'piste-DEMO-' : 'piste-'
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        {demo ? (
          <div role="note" className="flex gap-3 rounded-[10px] border border-demo/30 bg-demo-bg px-4 py-3 text-[13.5px] text-ink">
            <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0 text-demo" />
            <p>
              <span className="font-semibold text-demo">These downloads are DEMO data.</span> They come from the demo database — file names start with{' '}
              <code className="font-mono text-[12.5px]">piste-DEMO-</code>, the JSON is marked <code className="font-mono text-[12.5px]">&quot;demo&quot;: true</code>, CSV rows carry{' '}
              <code className="font-mono text-[12.5px]">data_label = DEMO</code> and calendar events are titled [DEMO]. Your own records are never included.
            </p>
          </div>
        ) : null}
        <ul className="divide-y divide-divider rounded-[12px] border border-divider bg-surface">
          <Block icon={<FileJson className="size-4" />} title="Everything, as JSON" body={<>All personal tables in one lossless file — metric units, money in minor units, unknown as null. <span className="font-mono text-[12.5px] text-ink-3">{prefix}export-…json</span></>}>
            <a href="/api/export/json" download className={action}>
              Download .json
            </a>
          </Block>
          <Block stack icon={<SheetIcon className="size-4" />} title="One table, as CSV" body="For spreadsheets. Unknown values are empty cells, never 0; text that looks like a formula is escaped.">
            <form method="get" action="/api/export/csv" className="flex flex-wrap items-center gap-2">
              <label htmlFor="export-table" className="sr-only">
                Table to export
              </label>
              <div className="w-[min(15rem,100%)]">
              <Select id="export-table" name="table" defaultValue="ski-logs" className="text-[14.5px]">
                <optgroup label="My Season">
                  {SEASON_TABLES.map((t) => (
                    <option key={t} value={t}>
                      {PERSONAL_TABLE_LABEL[t]}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Everything else">
                  {rest.map((t) => (
                    <option key={t} value={t}>
                      {PERSONAL_TABLE_LABEL[t]}
                    </option>
                  ))}
                </optgroup>
              </Select>
              </div>
              <button type="submit" className={action}>
                Download .csv
              </button>
            </form>
          </Block>
          <Block
            icon={<CalendarPlus className="size-4" />}
            title="Trips, for your calendar"
            body={trips.length ? 'One .ics per trip: the trip span plus each dated item. Importing again updates the events instead of duplicating them.' : 'No trips this season yet — each trip can be exported as an .ics file once planned.'}
          >
            {trips.length ? (
              <ul className="flex flex-col gap-1.5 sm:items-end">
                {trips.map((t) => (
                  <li key={t.id}>
                    <a href={`/api/export/ics?trip=${encodeURIComponent(t.id)}`} download className="inline-flex h-11 items-center gap-1.5 rounded-md px-1 text-[13.5px] font-medium text-teal hover:underline md:h-8">
                      <CalendarPlus aria-hidden className="size-4" /> {t.name}
                      <span className="font-normal text-ink-3 tnum">· {rangeLabel(t.startDate, t.endDate)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </Block>
        </ul>
      </div>

      <section aria-labelledby="backup-title" className="rounded-[12px] border border-divider bg-surface-2 px-4 py-4 md:px-5">
        <h3 id="backup-title" className="inline-flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Database aria-hidden className="size-4 text-ink-2" /> Backup and restore
        </h3>
        <p className="mt-1.5 text-[13.5px] text-ink-2">
          Everything is stored in two SQLite files in the data folder: your records (<code className="font-mono text-[12.5px]">piste.db</code>) and the separate demo data (
          <code className="font-mono text-[12.5px]">piste-demo.db</code>). Exports are for reading elsewhere; a backup is the whole database.
        </p>
        <ol className="mt-3 flex flex-col gap-3 text-[13.5px] text-ink-2">
          <li>
            <p className="font-medium text-ink">Back up — safe while Piste is running</p>
            <pre className="mt-1 overflow-x-auto rounded-md border border-divider bg-surface px-3 py-2 font-mono text-[12.5px] text-ink">npm run backup</pre>
            <p className="mt-1">Writes a consistent copy to data/backups/ and keeps the newest 14. Copy that folder off the machine now and then.</p>
          </li>
          <li>
            <p className="font-medium text-ink">Restore — stop the app and the worker first</p>
            <pre className="mt-1 overflow-x-auto rounded-md border border-divider bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed text-ink">
              {'npm run restore -- <backup.db> --check\nnpm run restore -- <backup.db>'}
            </pre>
            <p className="mt-1">The file is checked first; your current database is kept as a pre-restore copy. A demo backup is never restored over your records.</p>
          </li>
        </ol>
        <p className="mt-3 text-[12.5px] text-ink-3">
          Full guide: <code className="font-mono">docs/backup.md</code> in the Piste folder.
        </p>
      </section>
    </div>
  )
}
