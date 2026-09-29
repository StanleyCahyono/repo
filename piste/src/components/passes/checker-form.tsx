'use client'
/**
 * "Can I use my exact pass here on these dates?" — the question, as a form. Choices write to the URL (own/pass,
 * resort, from, to) and the server answers from the product's own rules. Works without JavaScript as a GET form
 * (the `pick` field carries the pass choice).
 */
import { useId, type FormEvent } from 'react'
import { CalendarRange, RotateCcw } from 'lucide-react'
import { Select, TextInput } from '@/components/ui/form'
import { cn } from '@/lib/ui/cn'
import type { PassOption, ResortOption } from '@/lib/data/passes-screen'
import { PendingNote, usePassesNav } from './nav'
import { saturdayFrom, shiftDate } from './params'
import { dayLabel } from './format'

export function CheckerForm({
  passes,
  resorts,
  ruleResortIds,
  selection,
  season,
  today,
}: {
  passes: PassOption[]
  resorts: ResortOption[]
  ruleResortIds: string[]
  selection: { key: string | null; resortId: string | null; from: string; to: string }
  season: { start: string; end: string; label: string }
  today: string
}) {
  const id = useId()
  const { navigate } = usePassesNav()
  const pickValue = selection.key ?? 'none'

  const setPick = (v: string) => {
    if (v.startsWith('own:')) navigate({ own: v.slice(4), pass: null, pick: null })
    else if (v.startsWith('product:')) navigate({ pass: v.slice(8), own: null, pick: null })
    else navigate({ pass: 'none', own: null, pick: null })
  }
  const setDates = (from: string, to: string | null) => navigate({ from, to: to && to !== from ? to : null })

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    // With JavaScript every change already applied; keep Enter from reloading the page.
    e.preventDefault()
  }

  const mine = passes.filter((p) => p.ownershipId != null && p.holder === 'me')
  const others = passes.filter((p) => p.ownershipId != null && p.holder !== 'me')
  const products = passes.filter((p) => p.ownershipId == null)
  const families = [...new Set(products.map((p) => p.familyName))]
  const onRule = new Set(ruleResortIds)
  const hasProduct = selection.key !== null
  const byName = (a: ResortOption, b: ResortOption) => a.name.localeCompare(b.name)
  const ruleResorts = resorts.filter((r) => onRule.has(r.id)).sort(byName)
  const otherResorts = resorts.filter((r) => !onRule.has(r.id)).sort(byName)
  const favorites = resorts.filter((r) => r.isFavorite).sort(byName)

  const sat = saturdayFrom(today < season.start ? season.start : today)
  const presets: { label: string; from: string; to: string | null }[] = [
    { label: 'Today', from: today, to: null },
    { label: today === sat ? 'This weekend' : 'Sat–Sun', from: sat, to: shiftDate(sat, 1) },
    { label: 'Next weekend', from: shiftDate(sat, 7), to: shiftDate(sat, 8) },
    { label: 'A week', from: selection.from, to: shiftDate(selection.from, 6) },
  ].filter((p) => p.from >= season.start && (p.to ?? p.from) <= season.end)
  const isSingle = selection.from === selection.to

  return (
    <form action="/passes" method="get" onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-pass`} className="text-[13.5px] font-medium text-ink">
            Pass
          </label>
          <Select id={`${id}-pass`} name="pick" value={pickValue} onChange={(e) => setPick(e.target.value)}>
            <option value="none">{hasProduct ? 'No pass — every product at the resort' : 'Choose a pass…'}</option>
            {mine.length ? (
              <optgroup label="Your passes">
                {mine.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name} (yours)
                  </option>
                ))}
              </optgroup>
            ) : null}
            {others.length ? (
              <optgroup label="Held by others">
                {others.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name} ({p.holder}’s)
                  </option>
                ))}
              </optgroup>
            ) : null}
            {families.map((f) => (
              <optgroup key={f} label={f}>
                {products
                  .filter((p) => p.familyName === f)
                  .map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-resort`} className="text-[13.5px] font-medium text-ink">
            Resort
          </label>
          <Select id={`${id}-resort`} name="resort" value={selection.resortId ?? ''} onChange={(e) => navigate({ resort: e.target.value || null })}>
            <option value="">{hasProduct ? 'Any resort — where does it work?' : 'Choose a resort…'}</option>
            {hasProduct ? (
              <>
                {ruleResorts.length ? (
                  <optgroup label="Rules recorded for this pass">
                    {ruleResorts.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <optgroup label="No rule recorded — not confirmed">
                  {otherResorts.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              </>
            ) : (
              <>
                {favorites.length ? (
                  <optgroup label="Favourites">
                    {favorites.map((r) => (
                      <option key={`f-${r.id}`} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <optgroup label="All resorts">
                  {[...resorts].sort(byName).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              </>
            )}
          </Select>
        </div>
      </div>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-medium text-ink">
          <CalendarRange aria-hidden className="size-4 text-ink-2" />
          Dates
          <span className="font-normal text-ink-3">· {season.label} season, up to 14 days</span>
        </legend>
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <div className="flex w-[176px] flex-col gap-1">
            <label htmlFor={`${id}-from`} className="text-[12.5px] text-ink-2">
              From
            </label>
            <TextInput
              id={`${id}-from`}
              name="from"
              type="date"
              value={selection.from}
              min={season.start}
              max={season.end}
              onChange={(e) => {
                const v = e.target.value
                if (!v) return
                setDates(v, selection.to < v ? null : isSingle ? null : selection.to)
              }}
            />
          </div>
          <div className="flex w-[176px] flex-col gap-1">
            <label htmlFor={`${id}-to`} className="text-[12.5px] text-ink-2">
              To <span className="text-ink-3">(optional)</span>
            </label>
            <TextInput
              id={`${id}-to`}
              name="to"
              type="date"
              value={isSingle ? '' : selection.to}
              min={selection.from}
              max={season.end}
              onChange={(e) => setDates(selection.from, e.target.value || null)}
            />
          </div>
          {!isSingle ? (
            <button
              type="button"
              onClick={() => setDates(selection.from, null)}
              className="inline-flex h-11 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-teal hover:bg-glacier/60 md:h-10"
            >
              <RotateCcw aria-hidden className="size-3.5" /> Single day
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Date shortcuts">
          {presets.map((p) => {
            const on = p.from === selection.from && (p.to ?? p.from) === selection.to
            return (
              <button
                key={p.label}
                type="button"
                aria-pressed={on}
                onClick={() => setDates(p.from, p.to)}
                title={p.to ? `${dayLabel(p.from)} – ${dayLabel(p.to)}` : dayLabel(p.from)}
                className={cn(
                  'inline-flex h-9 items-center rounded-full border px-3 text-[13px] font-medium transition-colors duration-150 max-md:h-11',
                  on ? 'border-teal bg-glacier text-teal' : 'border-divider bg-surface text-ink-2 hover:border-teal hover:text-teal',
                )}
              >
                {p.label}
              </button>
            )
          })}
          <PendingNote className="ml-1" />
        </div>
      </fieldset>
      <noscript>
        <button type="submit" className="h-10 rounded-md border border-divider-strong px-4 text-[14px] font-medium">
          Check access
        </button>
      </noscript>
    </form>
  )
}
