/**
 * Standalone-only screens around the app: start-up, the one-time demo generation progress, the "not kept in this
 * browser" notice, transient notices, and the recovery screens (saved data from another version; a fatal error).
 * They use the app's design tokens, so they look like Piste in both themes.
 */
import { Component, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { CircleAlert, Download, FlaskConical, HardDriveDownload, RotateCcw, TriangleAlert, X } from 'lucide-react'
import { dismiss, useChrome } from './notices'
import { saveBlob } from './api'

function Mark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className="size-10 shrink-0">
      <rect width="32" height="32" rx="8" fill="var(--teal)" />
      <path d="M4 23.5 12.2 12l4.6 6 3.4-4.2L28 23.5" fill="none" stroke="var(--on-teal)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function BootScreen({ text }: { text: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4" aria-busy="true">
      <div className="flex items-center gap-3 text-ink-2">
        <Mark />
        <div>
          <p className="font-display text-[26px] leading-none text-ink">Piste</p>
          <p role="status" className="mt-1 text-[13.5px]">
            {text}
          </p>
        </div>
      </div>
    </div>
  )
}

export function DemoOverlay() {
  const { demo } = useChrome()
  if (!demo) return null
  const pct = Math.round(Math.min(1, Math.max(0, demo.fraction)) * 100)
  const seconds = Math.round((performance.now() - demo.startedAt) / 1000)
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-overlay px-4" role="dialog" aria-modal="true" aria-labelledby="demo-gen-title">
      <div className="w-full max-w-[460px] rounded-[14px] border border-divider bg-surface p-5 shadow-overlay md:p-6">
        <p className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] text-demo uppercase">
          <FlaskConical aria-hidden className="size-4" /> Demo mode
        </p>
        <h2 id="demo-gen-title" className="mt-2 font-display text-[28px] leading-tight text-ink">
          {demo.error ? 'The demo could not be built' : demo.done ? 'Demo data ready' : 'Building the demo season'}
        </h2>
        {demo.error ? (
          <>
            <p className="mt-2 text-[14px] text-ink-2">Nothing was changed in your own data. The error was:</p>
            <p className="mt-2 rounded-md border border-critical/40 bg-critical-bg px-3 py-2 text-[13px] text-ink">{demo.error}</p>
            <button type="button" onClick={() => location.reload()} className="mt-4 inline-flex h-10 items-center gap-2 rounded-md border border-divider-strong bg-surface px-4 text-[14px] font-medium text-ink hover:border-teal hover:text-teal">
              <RotateCcw aria-hidden className="size-4" /> Reload Piste
            </button>
          </>
        ) : (
          <>
            <p className="mt-2 text-[14px] text-ink-2">
              Once only: Piste simulates a mid-season snapshot (Fri 15 Jan 2027) in this browser — modeled weather, reports, trips and ski days, all labelled demo and
              kept apart from your records. It usually takes under a minute.
            </p>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Demo generation progress">
              <div className="h-full rounded-full bg-demo transition-[width] duration-300" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 flex justify-between text-[13px] text-ink-2">
              <span role="status">{demo.phase}…</span>
              <span className="tnum">
                {pct}% · {seconds}s
              </span>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

export function StorageBanner() {
  const { memoryOnly, saveError } = useChrome()
  const text = memoryOnly
    ? `This browser is not keeping Piste’s data for this file (${memoryOnly}). Your changes will not be kept after closing — use “Download my data” in Settings → Export & backup.`
    : saveError
      ? `Your last changes could not be saved in this browser (${saveError}). They are still on screen — use “Download my data” in Settings → Export & backup to keep a copy.`
      : null
  if (!text) return null
  return (
    <div role="status" className="flex items-start gap-2 border-b border-critical/40 bg-critical-bg px-4 py-2 text-[13px] text-ink md:px-8">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-critical" />
      <p className="min-w-0 flex-1">{text}</p>
    </div>
  )
}

export function Notices() {
  const { notices } = useChrome()
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[80] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
      <AnimatePresence>
        {notices.map((n) => (
          <motion.div
            key={n.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="pointer-events-auto flex max-w-[520px] items-start gap-2 rounded-[10px] border border-divider bg-surface px-3 py-2.5 text-[13.5px] text-ink shadow-overlay"
          >
            <CircleAlert aria-hidden className={n.tone === 'error' ? 'mt-0.5 size-4 shrink-0 text-critical' : 'mt-0.5 size-4 shrink-0 text-teal'} />
            <p className="min-w-0 flex-1">{n.text}</p>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(n.id)} className="text-ink-3 hover:text-ink">
              <X aria-hidden className="size-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

function Frame({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[680px] flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <Mark />
        <span className="font-display text-[26px] text-ink">Piste</span>
      </div>
      <p className="eyebrow mb-2">{eyebrow}</p>
      <h1 className="font-display text-[32px] leading-[1.05] text-ink md:text-[40px]">{title}</h1>
      <div className="mt-3 text-[15px] text-ink-2">{children}</div>
    </main>
  )
}

const buttonCls =
  'inline-flex h-11 items-center gap-2 rounded-md border px-4 text-[14.5px] font-medium transition-colors duration-150 md:h-10'

export function RecoveryScreen({ detail, bytes, onReset }: { detail: string; bytes: Uint8Array | null; onReset: () => void }) {
  return (
    <Frame eyebrow="Saved data needs attention" title="Your saved data is from another version of this file">
      <p>
        The records this browser kept for Piste were written by a different build of the single-file app, and their database layout differs ({detail}). Nothing has
        been changed or deleted.
      </p>
      <p className="mt-2">Download them first — the file opens in any SQLite tool and in the server version of Piste of the matching build. Then start fresh here.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {bytes ? (
          <button type="button" className={`${buttonCls} border-teal bg-teal text-on-teal hover:bg-teal-strong`} onClick={() => saveBlob(new Blob([bytes as BlobPart], { type: 'application/vnd.sqlite3' }), 'piste-data-previous-version.db')}>
            <HardDriveDownload aria-hidden className="size-4" /> Download saved data (.db)
          </button>
        ) : null}
        <button type="button" className={`${buttonCls} border-divider-strong bg-surface text-ink hover:border-teal hover:text-teal`} onClick={onReset}>
          <RotateCcw aria-hidden className="size-4" /> Start fresh
        </button>
      </div>
    </Frame>
  )
}

export function FatalScreen({ error, onDownload }: { error: unknown; onDownload?: () => void }) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <Frame eyebrow="Something went wrong" title="Piste could not start">
      <p>An error stopped the app before it could show a page. Your saved records were not changed.</p>
      <p className="mt-3 rounded-md border border-critical/40 bg-critical-bg px-3 py-2 font-mono text-[12.5px] break-words text-ink">{message}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" className={`${buttonCls} border-teal bg-teal text-on-teal hover:bg-teal-strong`} onClick={() => location.reload()}>
          <RotateCcw aria-hidden className="size-4" /> Reload
        </button>
        {onDownload ? (
          <button type="button" className={`${buttonCls} border-divider-strong bg-surface text-ink hover:border-teal hover:text-teal`} onClick={onDownload}>
            <Download aria-hidden className="size-4" /> Download my data (.db)
          </button>
        ) : null}
      </div>
    </Frame>
  )
}

export class FatalBoundary extends Component<{ children: ReactNode; onDownload?: () => void }, { error: unknown }> {
  state = { error: null as unknown }
  static getDerivedStateFromError(error: unknown) {
    return { error }
  }
  componentDidCatch(error: unknown) {
    console.error(error)
  }
  render() {
    return this.state.error ? <FatalScreen error={this.state.error} onDownload={this.props.onDownload} /> : this.props.children
  }
}
