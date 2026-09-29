'use client'
/**
 * "Your data in this browser" — the single-file build's replacement for the server's backup/restore instructions
 * (`npm run backup` / `npm run restore` do not exist here). The bundler puts it where Settings → Export & backup and
 * My Season → Export already explain backups.
 *
 * - Download: the whole live (or demo) database as a standard SQLite file — the same format as the server version's
 *   data/piste.db.
 * - Import: replaces the LIVE database after checking the file (SQLite, Piste's schema, not a demo database).
 */
import { useEffect, useRef, useState } from 'react'
import { Database, Download, FlaskConical, HardDrive, TriangleAlert, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SettingRow } from '@/components/settings/section'
import { exportBytes, importLive, onSave, storageSummary, type StorageSummary } from '../db/client'
import { saveBlob } from './api'
import { hasDemoData } from './demo'
import { ensureLiveReady } from './live'
import { refresh } from './router'

const bytesText = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`)
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const timeText = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

function useBrowserData() {
  const [summary, setSummary] = useState<StorageSummary | null>(null)
  const [demoExists, setDemoExists] = useState(false)
  useEffect(() => {
    let alive = true
    const load = () =>
      void storageSummary().then((s) => {
        if (alive) setSummary(s)
      })
    load()
    void hasDemoData()
      .then((ok) => alive && setDemoExists(ok))
      .catch(() => undefined)
    const off = onSave(load)
    return () => {
      alive = false
      off()
    }
  }, [])
  return { summary, demoExists }
}

function Controls({ demo }: { demo: boolean }) {
  const { summary, demoExists } = useBrowserData()
  const [busy, setBusy] = useState<string | null>(null)
  const [pending, setPending] = useState<File | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const download = async (mode: 'live' | 'demo') => {
    setBusy(mode)
    setMessage(null)
    try {
      const bytes = await exportBytes(mode)
      saveBlob(new Blob([bytes as BlobPart], { type: 'application/vnd.sqlite3' }), `piste-${mode === 'demo' ? 'DEMO-' : ''}data-${today()}.db`)
    } catch (e) {
      setMessage({ tone: 'error', text: `Download failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  const confirmImport = async () => {
    if (!pending) return
    setBusy('import')
    setMessage(null)
    try {
      const r = await importLive(new Uint8Array(await pending.arrayBuffer()))
      if (!r.ok) {
        setMessage({ tone: 'error', text: r.reason })
        return
      }
      await ensureLiveReady()
      setMessage({ tone: 'ok', text: `Imported ${pending.name}. Your live records now come from that file.` })
      setPending(null)
      await refresh()
    } catch (e) {
      setMessage({ tone: 'error', text: `Import failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  const persistent = summary?.persistent ?? true
  const live = summary?.live
  return (
    <div className="flex flex-col gap-3 text-[13.5px]">
      <p className={persistent ? 'flex items-start gap-2 text-ink-2' : 'flex items-start gap-2 font-medium text-critical'}>
        {persistent ? <HardDrive aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" /> : <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />}
        <span>
          {persistent
            ? live?.savedAt
              ? `Saved in this browser · last saved ${timeText(live.savedAt)} · ${bytesText(live.size)}`
              : 'Saved in this browser (IndexedDB) a moment after each change.'
            : 'Not kept: this browser does not allow storage for this file, so everything is lost when the tab closes. Download your data before closing.'}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" className="min-h-11 md:min-h-0" onClick={() => void download('live')} disabled={busy !== null}>
          <Download aria-hidden className="size-4" /> {busy === 'live' ? 'Preparing…' : 'Download my data (.db)'}
        </Button>
        {demoExists ? (
          <Button className="min-h-11 md:min-h-0" onClick={() => void download('demo')} disabled={busy !== null}>
            <FlaskConical aria-hidden className="size-4" /> {busy === 'demo' ? 'Preparing…' : 'Download demo data (.db)'}
          </Button>
        ) : null}
        <Button className="min-h-11 md:min-h-0" onClick={() => input.current?.click()} disabled={busy !== null}>
          <Upload aria-hidden className="size-4" /> Import a .db file…
        </Button>
        <input
          ref={input}
          type="file"
          accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3,application/x-sqlite3"
          className="sr-only"
          aria-label="Choose a Piste database file to import"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            e.target.value = ''
            setMessage(null)
            setPending(f)
          }}
        />
      </div>
      {pending ? (
        <div role="alertdialog" aria-label="Confirm import" className="rounded-[10px] border border-caution/40 bg-caution-bg px-3 py-3 text-ink">
          <p>
            Replace your live records with <span className="font-semibold">{pending.name}</span> ({bytesText(pending.size)})? Everything currently saved in live mode is
            replaced{demo ? ' (demo data is not touched)' : ''}. Download your current data first if you may want it back.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="primary" className="min-h-11 md:min-h-0" onClick={() => void confirmImport()} disabled={busy !== null}>
              {busy === 'import' ? 'Importing…' : 'Replace live data'}
            </Button>
            <Button className="min-h-11 md:min-h-0" onClick={() => setPending(null)} disabled={busy !== null}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {message ? (
        <p role="status" className={message.tone === 'error' ? 'font-medium text-critical' : 'font-medium text-positive'}>
          {message.text}
        </p>
      ) : null}
      <p className="text-[12.5px] text-ink-3">
        A download is a standard SQLite file — the same format as the server version’s <code className="font-mono">data/piste.db</code>. Import accepts a Piste
        database of this version; demo databases are never imported over your records.
      </p>
    </div>
  )
}

/** Settings → Export & backup: replaces the "Backup & restore" row. */
export function StandaloneBackupRow({ demo }: { demo: boolean }) {
  return (
    <SettingRow
      label="Your data in this browser"
      hint="This single-file Piste keeps your records in this browser’s storage for this file, not in a folder. Another browser, another computer or clearing site data starts empty — download a copy now and then."
    >
      <Controls demo={demo} />
    </SettingRow>
  )
}

/** My Season → Export: replaces the "Backup and restore" box. */
export function StandaloneBackupSection({ demo }: { demo: boolean }) {
  return (
    <section aria-labelledby="backup-title" className="rounded-[12px] border border-divider bg-surface-2 px-4 py-4 md:px-5">
      <h3 id="backup-title" className="inline-flex items-center gap-2 text-[15px] font-semibold text-ink">
        <Database aria-hidden className="size-4 text-ink-2" /> Backup and restore
      </h3>
      <p className="mt-1.5 mb-3 text-[13.5px] text-ink-2">
        Everything is stored in this browser, in two separate databases: your records and the demo data. Exports are for reading elsewhere; a backup is the
        whole database.
      </p>
      <Controls demo={demo} />
    </section>
  )
}
