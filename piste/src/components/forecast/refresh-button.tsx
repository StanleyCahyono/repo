'use client'
/**
 * Manual weather refresh for the chosen resorts through POST /api/refresh (one request per resort, in order).
 * Reports honestly: a failed fetch says so (and never counts as an update), a cooldown says when to retry.
 * Live mode only — demo data is simulated and never fetched from live sources.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/ui/cn'

interface RefreshResult {
  status?: string
  error?: string | null
  items?: { ok: boolean; error?: string | null }[]
  nextAllowedAt?: string | null
}

function firstError(r: RefreshResult): string | null {
  const e = r.items?.find((i) => !i.ok && i.error)?.error ?? r.error ?? null
  return e ? e.replace(/^http:\s*/, '') : null
}

export function RefreshWeatherButton({
  targets,
  size = 'md',
  variant = 'secondary',
  className,
  label = 'Refresh weather',
}: {
  /** Resort ids with their display names. */
  targets: { id: string; name: string }[]
  size?: 'sm' | 'md'
  variant?: 'primary' | 'secondary'
  className?: string
  label?: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [, start] = useTransition()

  const run = async () => {
    const failed: string[] = []
    const ok: string[] = []
    const cooling: string[] = []
    let reason: string | null = null
    for (const t of targets) {
      setBusy(t.name)
      try {
        const res = await fetch('/api/refresh', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ job: 'weather', target: t.id }),
        })
        const body = (await res.json().catch(() => ({}))) as RefreshResult
        if (res.status === 429) cooling.push(t.name)
        else if (!res.ok || body.status === 'error') {
          failed.push(t.name)
          reason ??= firstError(body) ?? `HTTP ${res.status}`
        } else if (body.status === 'partial') {
          ok.push(t.name)
          reason ??= firstError(body)
        } else ok.push(t.name)
      } catch {
        failed.push(t.name)
        reason ??= 'Network error'
      }
    }
    setBusy(null)
    start(() => router.refresh())
    if (failed.length)
      toast.show(`Weather fetch failed for ${failed.join(', ')}${reason ? ` — ${reason}` : ''}. Last good data is kept.`, { tone: 'error', durationMs: 7000 })
    if (ok.length) toast.show(`Weather updated for ${ok.join(', ')}`)
    if (cooling.length) toast.show(`${cooling.join(', ')} refreshed recently — try again in a few minutes`, { tone: 'info' })
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={run}
      disabled={!!busy || !targets.length}
      className={cn('min-h-11 md:min-h-0', className)}
      aria-live="polite"
    >
      {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <RefreshCw aria-hidden className="size-4" />}
      {busy ? `Refreshing ${busy}…` : label}
    </Button>
  )
}
