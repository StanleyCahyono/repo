'use client'
/**
 * Manual catalog corrections (shared by Settings and Sources & Sync): what was corrected, the catalog value it
 * replaces, where it comes from, and a Revert (with Undo). A correction that could not be applied says why.
 */
import { useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, ExternalLink, PenLine, Plus, RotateCcw, TriangleAlert } from 'lucide-react'
import { restoreCorrections, revertCorrection } from '@/lib/actions/sources'
import type { CorrectionItem, ResortChoice } from '@/lib/data/settings-screen'
import { formatInstant, relativeLabel } from '@/lib/domain/time'
import type { UnitPrefs } from '@/lib/domain/types'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/states'
import { useSave } from '@/components/settings/use-save'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { correctionField, fieldLabel, formatCorrectionValue } from './correction-fields'
import { CorrectionSheet } from './correction-sheet'

const shown = (field: string, value: unknown, units: UnitPrefs) => {
  const f = correctionField(field)
  return f ? formatCorrectionValue(f.kind, value, units) : value === null || value === undefined ? 'Unknown / not set' : typeof value === 'string' ? value : JSON.stringify(value)
}

export function CorrectionsPanel({
  items,
  resorts,
  units,
  now,
  tz,
  demo,
  headingLevel = 3,
}: {
  items: CorrectionItem[]
  resorts: ResortChoice[]
  units: UnitPrefs
  now: string
  tz: string
  demo: boolean
  headingLevel?: 3 | 4
}) {
  const { run, pending } = useSave()
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const key = (c: Pick<CorrectionItem, 'resortId' | 'field'>) => `${c.resortId}|${c.field}`
  const visible = items.filter((c) => !hidden.has(key(c)))
  const H = headingLevel === 3 ? 'h3' : 'h4'

  function revert(c: CorrectionItem) {
    const k = key(c)
    setHidden((h) => new Set(h).add(k))
    const unhide = () =>
      setHidden((h) => {
        const next = new Set(h)
        next.delete(k)
        return next
      })
    run(() => revertCorrection({ resortId: c.resortId, field: c.field }), {
      onError: unhide,
      success: `${fieldLabel(c.field)} for ${c.resortName}: catalog value back`,
      undo: (rows) => run(() => restoreCorrections(rows), { onDone: unhide }),
    })
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px] text-ink-2">
          {visible.length ? (
            <>
              <span className="font-semibold text-ink tnum">{visible.length}</span> field{visible.length === 1 ? '' : 's'} corrected by you
              {demo ? ' (demo database)' : ''}
            </>
          ) : (
            'No corrections yet'
          )}
        </p>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={(e) => {
            opener.current = e.currentTarget
            setOpen(true)
          }}
          className="min-h-11 md:min-h-0"
        >
          <Plus aria-hidden className="size-4" /> Correct a fact
        </Button>
      </div>

      {visible.length ? (
        <ul className="overflow-hidden glass rounded-[24px]">
          <AnimatePresence initial={false}>
            {visible.map((c, i) => (
              <motion.li
                key={key(c)}
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={t.hover}
                className={cn('grid gap-x-6 gap-y-3 px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_auto] md:px-5', i > 0 && 'border-t border-divider')}
              >
                <div className="min-w-0">
                  <H className="flex flex-wrap items-baseline gap-x-2 text-[14.5px] font-semibold text-ink">
                    <span>{fieldLabel(c.field)}</span>
                    <span className="font-normal text-ink-2">·</span>
                    <Link href={`/resorts/${c.resortId}`} className="font-medium text-ink-2 hover:text-teal hover:underline">
                      {c.resortName}
                    </Link>
                  </H>
                  <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13.5px]">
                    <dt className="text-ink-3">Now</dt>
                    <dd className={cn('min-w-0 break-words', c.applied ? 'font-medium text-ink' : 'text-ink-3 line-through')}>{shown(c.field, c.value, units)}</dd>
                    <dt className="text-ink-3">Catalog</dt>
                    <dd className={cn('min-w-0 break-words text-ink-2', c.applied && 'line-through decoration-ink-3/60')}>{shown(c.field, c.catalogValue, units)}</dd>
                  </dl>
                  {!c.applied ? (
                    <p className="mt-2 flex items-start gap-1.5 text-[13px] font-medium text-critical">
                      <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                      Not applied{c.reason ? `: ${c.reason}` : ''}. The catalog value is shown instead.
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
                    <span className="inline-flex items-center gap-1">
                      <PenLine aria-hidden className="size-3.5" /> Your correction
                    </span>
                    <time dateTime={c.at} title={formatInstant(c.at, tz, 'ccc d LLL yyyy, HH:mm')} className="tnum">
                      {relativeLabel(c.at, now)}
                    </time>
                    {c.revisions > 1 ? <span className="tnum">{c.revisions} revisions kept</span> : null}
                    {c.sourceUrl ? (
                      <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 font-medium break-all text-teal hover:underline">
                        <ExternalLink aria-hidden className="size-3.5 shrink-0" />
                        {c.sourceUrl.replace(/^https?:\/\//, '').slice(0, 60)}
                      </a>
                    ) : null}
                  </div>
                  {c.note ? <p className="mt-1.5 max-w-[68ch] text-[13px] text-ink-2">“{c.note}”</p> : null}
                </div>
                <div className="flex items-start md:justify-end">
                  <Button variant="ghost" onClick={() => revert(c)} disabled={pending} className="min-h-11 md:min-h-0">
                    <RotateCcw aria-hidden className="size-4" /> Revert
                  </Button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <EmptyState
          seed="corrections-empty"
          title="Nothing corrected"
          body={
            <>
              If a catalog fact is wrong or out of date — an opening date, a link, a feature — correct it with the page you checked.
            </>
          }
        />
      )}
      <p className="mt-3 flex flex-wrap items-center gap-1 text-[12.5px] text-ink-3">
        Corrections survive catalog re-seeding and are included in exports.
        <a href="/api/export/csv?table=resort-overrides" download className="inline-flex items-center gap-1 font-medium text-teal hover:underline">
          Download as CSV <ArrowRight aria-hidden className="size-3.5" />
        </a>
      </p>

      <CorrectionSheet
        open={open}
        onOpenChange={setOpen}
        resorts={resorts}
        units={units}
        onCloseAutoFocus={(e) => {
          if (opener.current?.isConnected) {
            e.preventDefault()
            opener.current.focus()
          }
        }}
      />
    </div>
  )
}
