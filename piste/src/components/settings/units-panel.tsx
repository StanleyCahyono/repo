'use client'
/**
 * Units and display currency. Each switch applies at once (checkmark toast with Undo).
 *
 * The conversion boundary: these choices change how values are SHOWN. Measurements stay stored in metric and prices
 * in the currency they were quoted in — the server actions write the preference and nothing else.
 */
import { ArrowRight, Database, Eye } from 'lucide-react'
import Link from 'next/link'
import { saveCurrency, saveUnits } from '@/lib/actions/settings'
import type { FxView } from '@/lib/data/settings-screen'
import { formatInstant, relativeLabel, formatLocalDate, isLocalDate } from '@/lib/domain/time'
import type { UnitPrefs } from '@/lib/domain/types'
import { formatDistance, formatElevation, formatSnow, formatSpeed, formatTemp } from '@/lib/domain/units'
import { Badge } from '@/components/ui/badge'
import { Segmented } from '@/components/ui/segmented'
import { cn } from '@/lib/ui/cn'
import { CURRENCY_LABEL, DISPLAY_CURRENCIES, TALL, UNIT_ROWS, type DisplayCurrency } from './options'
import { useSave } from './use-save'
import { useDraft } from './use-draft'

/** Stored unit and a sample conversion per row (a unit example, not a resort fact). */
const STORED: Record<keyof UnitPrefs, { stored: string; sample: (u: UnitPrefs) => string }> = {
  temperature: { stored: '°C', sample: (u) => `−5 °C shows as ${formatTemp(-5, u)}` },
  snow: { stored: 'cm (precipitation in mm)', sample: (u) => `30 cm shows as ${formatSnow(30, u)}` },
  distance: { stored: 'km', sample: (u) => `100 km shows as ${formatDistance(100, u)}` },
  elevation: { stored: 'm', sample: (u) => `3,000 m shows as ${formatElevation(3000, u)}` },
  speed: { stored: 'km/h', sample: (u) => `40 km/h shows as ${formatSpeed(40, u)}` },
}

export function UnitsPanel({ units, currency, fx, now, homeTimezone, demo }: { units: UnitPrefs; currency: string; fx: FxView; now: string; homeTimezone: string; demo: boolean }) {
  const u = useDraft(units)
  const c = useDraft({ currency: (DISPLAY_CURRENCIES as readonly string[]).includes(currency) ? (currency as DisplayCurrency) : ('USD' as DisplayCurrency) })
  const { run } = useSave()

  function changeUnit<K extends keyof UnitPrefs>(key: K, value: UnitPrefs[K]) {
    const prev = u.baseline
    const next = { ...u.values, [key]: value }
    u.set({ [key]: value } as Partial<UnitPrefs>)
    run(() => saveUnits(next), {
      onDone: (data) => u.commit(data),
      onError: () => u.discard(),
      undo: () => {
        u.set(prev)
        run(() => saveUnits(prev), { onDone: (data) => u.commit(data), onError: () => u.discard(), success: 'Units restored — stored values are unchanged' })
      },
    })
  }

  function changeCurrency(value: DisplayCurrency) {
    const prev = c.baseline
    c.set({ currency: value })
    run(() => saveCurrency({ currency: value }), {
      onDone: (data) => c.commit({ currency: data.currency as DisplayCurrency }),
      onError: () => c.discard(),
      undo: () => {
        c.set(prev)
        run(() => saveCurrency(prev), { onDone: (data) => c.commit({ currency: data.currency as DisplayCurrency }), onError: () => c.discard(), success: `Display currency back to ${prev.currency}` })
      },
    })
  }

  const cur = c.values.currency
  return (
    <div className="overflow-hidden rounded-[12px] border border-divider bg-surface">
      <div className="flex flex-col gap-2 border-b border-divider bg-surface-2 px-4 py-3 text-[13px] text-ink-2 sm:flex-row sm:items-center sm:gap-5 md:px-5">
        <p className="flex items-center gap-2">
          <Database aria-hidden className="size-4 shrink-0 text-ink-3" />
          <span>
            <span className="font-medium text-ink">Stored:</span> metric measurements, prices in their quoted currency
          </span>
        </p>
        <ArrowRight aria-hidden className="hidden size-3.5 shrink-0 text-ink-3 sm:block" />
        <p className="flex items-center gap-2">
          <Eye aria-hidden className="size-4 shrink-0 text-ink-3" />
          <span>
            <span className="font-medium text-ink">Shown:</span> your choices below — switching never rewrites a stored value
          </span>
        </p>
      </div>
      <ul className="divide-y divide-divider">
        {UNIT_ROWS.map((row) => {
          const labelId = `unit-${row.key}`
          return (
            <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,13rem)_auto_minmax(0,1fr)] sm:gap-x-6 sm:py-3.5 md:px-5">
              <div className="min-w-0">
                <p id={labelId} className="text-[14.5px] font-semibold text-ink">
                  {row.label}
                </p>
                <p className="text-[12.5px] text-ink-3">Stored in {STORED[row.key].stored}</p>
              </div>
              <Segmented
                label={row.label}
                options={row.options}
                value={u.values[row.key]}
                onChange={(val) => changeUnit(row.key, val as UnitPrefs[typeof row.key])}
                className={cn('justify-self-end sm:justify-self-start', TALL)}
              />
              <p className="col-span-2 text-[13px] text-ink-2 tnum sm:col-span-1" aria-live="polite">
                {STORED[row.key].sample(u.values)}
              </p>
            </li>
          )
        })}
        <li className="grid gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] md:px-5">
          <div className="min-w-0">
            <p className="text-[14.5px] font-semibold text-ink">Display currency</p>
            <p className="text-[12.5px] text-ink-3">Totals and comparisons use it where a stored rate allows. Quotes keep their original currency.</p>
          </div>
          <div className="min-w-0">
            <Segmented
              label="Display currency"
              options={DISPLAY_CURRENCIES.map((x) => ({ value: x, label: x, hint: CURRENCY_LABEL[x] }))}
              value={cur}
              onChange={(val) => changeCurrency(val)}
              className={cn('max-w-[34rem]', TALL)}
              wrap
            />
            <p className="mt-1.5 text-[12.5px] text-ink-3">{CURRENCY_LABEL[cur]}</p>
            <FxInfo fx={fx} now={now} tz={homeTimezone} demo={demo} display={cur} />
          </div>
        </li>
      </ul>
    </div>
  )
}

function FxInfo({ fx, now, tz, demo, display }: { fx: FxView; now: string; tz: string; demo: boolean; display: DisplayCurrency }) {
  const { job } = fx
  const failed = job.lastAttemptStatus === 'error'
  return (
    <div className="mt-3 rounded-[10px] border border-divider bg-surface-2">
      <p className="border-b border-divider px-3 py-2 text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase">Exchange rates on file</p>
      <ul className="divide-y divide-divider text-[13px]">
        {fx.quotes.map((q) => (
          <li key={q.to} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
            <span className="font-medium text-ink tnum">
              1 {q.from} = {q.rate} {q.to}
              {display === q.to ? <span className="sr-only"> (your display currency)</span> : null}
            </span>
            <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
              {q.demo ? <Badge tone="demo">Demo rate</Badge> : null}
              <span>
                {q.provider ?? 'Unknown provider'}
                {q.rateDate ? ` · rate for ${isLocalDate(q.rateDate) ? formatLocalDate(q.rateDate, 'd LLL yyyy') : q.rateDate}` : ''}
              </span>
              {q.fetchedAt ? (
                <time dateTime={q.fetchedAt} title={formatInstant(q.fetchedAt, tz, 'ccc d LLL yyyy, HH:mm ZZZZ')} className="tnum">
                  fetched {relativeLabel(q.fetchedAt, now)}
                </time>
              ) : null}
            </span>
          </li>
        ))}
        {fx.missing.map((to) => (
          <li key={to} className="px-3 py-2">
            <span className="font-medium text-ink tnum">USD ⇄ {to}</span>
            <span className="text-ink-2"> — no stored rate. Amounts stay in their quoted currency; nothing is converted with a guessed rate.</span>
          </li>
        ))}
      </ul>
      {!demo ? (
        <p className="border-t border-divider px-3 py-2 text-[12.5px] text-ink-3">
          {job.lastAttemptAt ? (
            <>
              Rate refresh: last attempt{' '}
              <time dateTime={job.lastAttemptAt} className="tnum">
                {relativeLabel(job.lastAttemptAt, now)}
              </time>
              {failed ? <span className="font-medium text-critical"> failed{job.lastError ? ` (${job.lastError.slice(0, 90)})` : ''}</span> : null}
              {!failed && job.lastFetchedNothing ? <> fetched nothing{job.lastNote ? ` — ${job.lastNote.toLowerCase()}` : ''}</> : null}. Last success:{' '}
              {job.lastSuccessAt ? (
                <time dateTime={job.lastSuccessAt} className="tnum">
                  {relativeLabel(job.lastSuccessAt, now)}
                </time>
              ) : (
                <span className="font-medium text-ink-2">never</span>
              )}
              .{' '}
            </>
          ) : (
            <>Rates have never been refreshed. </>
          )}
          <Link href="/sources#jobs" className="font-medium text-teal hover:underline">
            Sources &amp; Sync
          </Link>
        </p>
      ) : (
        <p className="border-t border-divider px-3 py-2 text-[12.5px] text-ink-3">Demo mode: rates are simulated for the demo date and never refreshed.</p>
      )}
    </div>
  )
}
