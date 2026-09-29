'use client'
/**
 * "Fetch now" for this resort's weather and official report, through POST /api/refresh (one job at a time).
 * Reports honestly: a failed fetch says so and never counts as an update; a cooldown says when to try again.
 * Live mode only — demo data is simulated and never fetched from live sources (the page hides this in demo).
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { useToast } from '@/components/ui/toast'

type Job = 'weather' | 'reports'
const JOB_TEXT: Record<Job, string> = { weather: 'Weather', reports: 'Official report' }

interface Payload {
  status?: string
  error?: string | null
  items?: { ok: boolean; skipped?: boolean; error?: string | null }[]
  nextAllowedAt?: string | null
}

function describe(job: Job, httpStatus: number, p: Payload): { ok: boolean; text: string } {
  if (httpStatus === 429) return { ok: false, text: `${JOB_TEXT[job]}: fetched recently — try again in a few minutes` }
  if (httpStatus >= 400) return { ok: false, text: `${JOB_TEXT[job]}: ${p.error ?? `request refused (HTTP ${httpStatus})`}` }
  const failed = (p.items ?? []).filter((i) => !i.skipped && !i.ok)
  const done = (p.items ?? []).filter((i) => !i.skipped && i.ok)
  if (p.status === 'ok' && failed.length === 0) return { ok: true, text: `${JOB_TEXT[job]}: updated` }
  if (done.length && failed.length) return { ok: false, text: `${JOB_TEXT[job]}: partly updated — ${failed.length} source${failed.length === 1 ? '' : 's'} failed` }
  const reason = (failed[0]?.error ?? p.error ?? 'fetch failed').replace(/^(http|parse|timeout):\s*/i, '')
  return { ok: false, text: `${JOB_TEXT[job]}: fetch failed (${reason.slice(0, 90)}) — nothing stored was overwritten` }
}

export function RefreshNow({ resortId, jobs, className, label = 'Fetch now' }: { resortId: string; jobs: Job[]; className?: string; label?: string }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()
  const [last, setLast] = useState<string | null>(null)
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const lines: { ok: boolean; text: string }[] = []
            for (const job of jobs) {
              try {
                const res = await fetch('/api/refresh', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ job, target: resortId }),
                })
                const body = (await res.json().catch(() => ({}))) as Payload
                lines.push(describe(job, res.status, body))
              } catch {
                lines.push({ ok: false, text: `${JOB_TEXT[job]}: could not reach Piste’s server` })
              }
            }
            const text = lines.map((l) => l.text).join(' · ')
            setLast(text)
            toast.show(text, { tone: lines.every((l) => l.ok) ? 'success' : 'error', durationMs: 6000 })
            router.refresh()
          })
        }
        className="inline-flex h-11 items-center justify-center gap-2 self-start rounded-md border border-divider-strong bg-surface px-3.5 text-[14px] font-medium text-ink transition-colors duration-150 hover:border-teal hover:text-teal disabled:opacity-60 md:h-9"
      >
        {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <RefreshCw aria-hidden className="size-4" />}
        {pending ? 'Fetching…' : label}
      </button>
      <p className="text-[12px] text-ink-3" aria-live="polite">
        {last ?? 'A failed fetch never replaces the last good data.'}
      </p>
    </div>
  )
}
