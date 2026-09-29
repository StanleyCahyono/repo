'use client'
/**
 * Scoring mode for the conditions score (Learning day / All-mountain / Powder), kept in the URL (`?mode=`) so the
 * page, the comparison and a shared link all use the same weights. The selection glides (Segmented).
 */
import { useOptimistic, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LoaderCircle } from 'lucide-react'
import { Segmented } from '@/components/ui/segmented'
import { CONDITIONS_CONFIG_V1 } from '@/lib/domain/conditions/config.v1'
import { SCORING_MODE_LABEL, SCORING_MODES, type ScoringMode } from '@/lib/domain/types'

const SHORT: Record<ScoringMode, string> = { learning: 'Learning', 'all-mountain': 'All-mountain', powder: 'Powder' }
const hint = (m: ScoringMode) => {
  const w = CONDITIONS_CONFIG_V1.weights[m]
  return `${SCORING_MODE_LABEL[m]} weights: surface ${w.S}%, terrain ${w.T}%, wind ${w.W}%, visibility ${w.V}%, temperature ${w.C}%`
}

export function ModeSwitch({ mode, preferred }: { mode: ScoringMode; preferred: ScoringMode }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, start] = useTransition()
  const [shown, setShown] = useOptimistic(mode)
  return (
    // 44px targets on phones; the compact segmented size from md up.
    <div className="flex items-center gap-2 max-md:[&_[role=radio]]:h-11 max-md:[&_[role=radio]]:px-3">
      {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin text-ink-3" /> : null}
      <Segmented
        label="Scoring mode"
        size="sm"
        value={shown}
        options={SCORING_MODES.map((m) => ({ value: m, label: SHORT[m], hint: hint(m) }))}
        onChange={(m) =>
          start(() => {
            setShown(m)
            const next = new URLSearchParams(params.toString())
            if (m === preferred) next.delete('mode')
            else next.set('mode', m)
            const qs = next.toString()
            router.push(`${pathname}${qs ? `?${qs}` : ''}#conditions`, { scroll: false })
          })
        }
      />
    </div>
  )
}
