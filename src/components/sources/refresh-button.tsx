'use client'
/**
 * Manual refresh of one job (optionally for one resort) through POST /api/refresh, with honest feedback: what ran,
 * whether it fetched anything, the error when it failed, and the cooldown when it is too soon (HTTP 429). A failed
 * refresh never advances "last successful update" — the page re-reads its data afterwards to show exactly that.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { reportNetworkFailure, reportNetworkOk } from '@/components/ui/offline-banner'
import { cn } from '@/lib/ui/cn'

interface Summary {
  status?: 'ok' | 'partial' | 'error' | 'skipped'
  itemsWritten?: number
  error?: string | null
  notes?: string[]
  nextAllowedAt?: string | null
  items?: { ok: boolean; skipped?: boolean }[]
}

type Feedback = { tone: 'ok' | 'warn' | 'error'; text: string } | null

const minutesUntil = (iso: string | null | undefined, retryAfter: string | null) => {
  const fromHeader = retryAfter ? Number(retryAfter) : NaN
  if (Number.isFinite(fromHeader) && fromHeader > 0) return Math.max(1, Math.ceil(fromHeader / 60))
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? Math.max(1, Math.ceil((t - Date.now()) / 60000)) : null
}

function describe(res: Response, body: Summary & { error?: string }): Feedback {
  if (res.status === 429) {
    const m = minutesUntil(body.nextAllowedAt, res.headers.get('retry-after'))
    return { tone: 'warn', text: `On cooldown — manual refreshes are limited to one per 10 min${m ? `; try again in ${m} min` : ''}.` }
  }
  if (res.status === 409) return { tone: 'warn', text: body.error ?? 'Already running — wait for it to finish.' }
  if (!res.ok) return { tone: 'error', text: body.error ?? `Refresh refused (HTTP ${res.status}).` }
  const counted = (body.items ?? []).filter((i) => !i.skipped)
  const failed = counted.filter((i) => !i.ok).length
  if (body.status === 'error') return { tone: 'error', text: `Failed${body.error ? `: ${body.error.slice(0, 140)}` : ''}. Last success is unchanged.` }
  if (body.status === 'partial') return { tone: 'warn', text: `Partly failed — ${failed} of ${counted.length} sources. ${body.itemsWritten ?? 0} written.` }
  if (!counted.length) return { tone: 'warn', text: `Nothing fetched${body.notes?.[0] ? ` — ${body.notes[0].toLowerCase()}` : ''}.` }
  return { tone: 'ok', text: `Done — ${body.itemsWritten ?? 0} written${body.itemsWritten ? '' : ' (nothing changed)'}.` }
}

const JOB_LABEL: Record<string, string> = { weather: 'Weather', 'nws-alerts': 'Alerts', fx: 'Exchange rates', reports: 'Official reports', osm: 'Lifts & runs', links: 'Links' }

/** Several jobs run one after another: one line for all of them, naming only the ones that did not go well. */
function combine(results: { job: string; fb: Feedback; written: number }[]): Feedback {
  const bad = results.filter((r) => r.fb && r.fb.tone !== 'ok')
  if (!bad.length) {
    const written = results.reduce((n, r) => n + r.written, 0)
    return { tone: 'ok', text: written ? `Updated — ${written} written.` : 'Up to date — nothing changed.' }
  }
  return {
    tone: bad.some((r) => r.fb!.tone === 'error') ? 'error' : 'warn',
    text: bad.map((r) => `${JOB_LABEL[r.job] ?? r.job}: ${r.fb!.text}`).join(' '),
  }
}

export function RefreshButton({
  job,
  jobs,
  target = null,
  label,
  idleText = 'Refresh',
  busyText = 'Refreshing…',
  disabledReason,
  size = 'md',
  className,
}: {
  /** One job to run. */
  job?: string
  /** Several jobs, run one after another (overrides `job`). */
  jobs?: readonly string[]
  target?: string | null
  /** Accessible name, e.g. "Refresh weather for Alta". */
  label: string
  /** Visible button text. */
  idleText?: string
  busyText?: string
  /** When set, the button is disabled and this explains why. */
  disabledReason?: string | null
  size?: 'sm' | 'md'
  className?: string
}) {
  const list = jobs ?? (job ? [job] : [])
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [, startTransition] = useTransition()

  async function refresh() {
    setBusy(true)
    setFeedback(null)
    try {
      const results: { job: string; fb: Feedback; written: number }[] = []
      for (const j of list) {
        const res = await fetch('/api/refresh', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ job: j, target }),
        })
        reportNetworkOk()
        let body: Summary & { error?: string } = {}
        try {
          body = await res.json()
        } catch {
          body = {}
        }
        if (res.status === 401) {
          setFeedback({ tone: 'error', text: 'Signed out — sign in again, then retry.' })
          return
        }
        results.push({ job: j, fb: describe(res, body), written: res.ok ? (body.itemsWritten ?? 0) : 0 })
      }
      const fb = results.length === 1 ? results[0].fb : combine(results)
      setFeedback(fb)
      if (fb) toast.show(`${label}: ${fb.text}`, { tone: fb.tone === 'ok' ? 'success' : fb.tone === 'error' ? 'error' : 'info', durationMs: 6000 })
      startTransition(() => router.refresh())
    } catch {
      reportNetworkFailure()
      setFeedback({ tone: 'error', text: 'Piste’s server could not be reached — nothing was refreshed.' })
    } finally {
      setBusy(false)
    }
  }

  const id = `refresh-${list.join('-') || 'none'}-${target ?? 'all'}`
  return (
    <div className={cn('flex min-w-0 flex-col items-start gap-1', className)}>
      <Button
        variant="secondary"
        size={size}
        onClick={refresh}
        disabled={busy || !!disabledReason || !list.length}
        aria-label={label}
        aria-describedby={feedback || disabledReason ? `${id}-fb` : undefined}
        title={disabledReason ?? undefined}
        className={cn(size === 'md' ? 'min-h-11 md:min-h-0' : 'min-h-11 md:min-h-8')}
      >
        {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <RefreshCw aria-hidden className="size-4" />}
        {busy ? busyText : idleText}
      </Button>
      <p id={`${id}-fb`} aria-live="polite" className={cn('max-w-[36ch] text-[12.5px] leading-snug', !feedback && !disabledReason && 'sr-only', feedback?.tone === 'error' ? 'text-critical' : feedback?.tone === 'warn' ? 'text-caution' : feedback ? 'text-positive' : 'text-ink-3')}>
        {feedback?.text ?? disabledReason ?? ''}
      </p>
    </div>
  )
}
