'use client'
/**
 * Who's going and trip notes. Party size drives per-person vs shared costs; named companions (name + ability) feed
 * the fit check — including the separate advanced companion profile from Settings. Notes save on demand.
 */
import { useId, useState } from 'react'
import { Minus, Plus, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Select, TextInput, Textarea } from '@/components/ui/form'
import { cn } from '@/lib/ui/cn'
import { ABILITY_LEVELS, type AbilityLevel } from '@/lib/domain/types'
import { setTripCompanions, updateTrip } from '@/lib/actions/trips'
import { ABILITY_LABEL } from './format'
import { useTripUi } from './trip-ui'

type Companion = { name: string; ability: AbilityLevel | null }

export function PartyAndCompanions({ partySize, companions, saved, ability }: { partySize: number; companions: Companion[]; saved: { name: string | null; ability: AbilityLevel } | null; ability: AbilityLevel }) {
  const { data, run, pending } = useTripUi()
  const [list, setList] = useState<Companion[]>(companions)
  const [dirty, setDirty] = useState(false)
  const uid = useId()
  const sig = JSON.stringify(companions)
  const [seen, setSeen] = useState(sig)
  if (seen !== sig) {
    setSeen(sig)
    setList(companions)
    setDirty(false)
  }
  const edit = (next: Companion[]) => {
    setList(next)
    setDirty(true)
  }
  const savedAlready = saved && list.some((c) => c.name.trim().toLowerCase() === (saved.name ?? 'Companion').trim().toLowerCase())
  const cancelled = data.status === 'cancelled'

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[12px] border border-divider bg-surface p-4">
        <div>
          <p className="text-[14.5px] font-semibold text-ink">Party size</p>
          <p className="text-[12.5px] text-ink-3">You{list.length ? ` + ${list.length} named` : ''} · per-person costs count once for each person</p>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Party size">
          <button
            type="button"
            aria-label="One fewer person"
            disabled={pending || cancelled || partySize <= Math.max(1, list.length + 1)}
            onClick={() => run(() => updateTrip({ tripId: data.tripId, partySize: partySize - 1 }), { success: `Party of ${partySize - 1}` })}
            className="inline-flex size-11 items-center justify-center rounded-md border border-divider-strong bg-surface text-ink hover:border-teal hover:text-teal disabled:opacity-40 md:size-10"
          >
            <Minus aria-hidden className="size-4" />
          </button>
          <output aria-live="polite" className="w-12 text-center font-display text-[30px] leading-none text-ink tnum">
            {partySize}
          </output>
          <button
            type="button"
            aria-label="One more person"
            disabled={pending || cancelled || partySize >= 12}
            onClick={() => run(() => updateTrip({ tripId: data.tripId, partySize: partySize + 1 }), { success: `Party of ${partySize + 1}` })}
            className="inline-flex size-11 items-center justify-center rounded-md border border-divider-strong bg-surface text-ink hover:border-teal hover:text-teal disabled:opacity-40 md:size-10"
          >
            <Plus aria-hidden className="size-4" />
          </button>
        </div>
      </div>

      <div className="rounded-[12px] border border-divider bg-surface p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[14.5px] font-semibold text-ink">Companions</p>
          <p className="text-[12.5px] text-ink-3">You: {ABILITY_LABEL[ability]}</p>
        </div>
        {list.length ? (
          <ul className="mt-3 flex flex-col gap-2">
            {list.map((c, k) => (
              <li key={k} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto]">
                <Field label="Name" htmlFor={`${uid}-n${k}`} className={cn('col-span-2 sm:col-span-1', k > 0 && 'sm:[&>label]:sr-only')}>
                  <TextInput id={`${uid}-n${k}`} value={c.name} maxLength={60} onChange={(e) => edit(list.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)))} />
                </Field>
                <Field label="Ability" htmlFor={`${uid}-a${k}`} className={cn(k > 0 && 'sm:[&>label]:sr-only')}>
                  <Select id={`${uid}-a${k}`} value={c.ability ?? ''} onChange={(e) => edit(list.map((x, j) => (j === k ? { ...x, ability: (e.target.value || null) as AbilityLevel | null } : x)))}>
                    <option value="">Unknown</option>
                    {ABILITY_LEVELS.map((a) => (
                      <option key={a} value={a}>
                        {ABILITY_LABEL[a]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <button type="button" aria-label={`Remove ${c.name || 'companion'}`} onClick={() => edit(list.filter((_, j) => j !== k))} className="inline-flex size-11 items-center justify-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-critical md:size-10">
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13.5px] text-ink-2">Just you so far. Add who is coming — their ability is used to check the resort suits everyone.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" className="h-10 md:h-8" disabled={cancelled || list.length >= 11} onClick={() => edit([...list, { name: '', ability: null }])}>
            <UserPlus aria-hidden className="size-4" /> Add companion
          </Button>
          {saved && !savedAlready ? (
            <Button variant="quiet" size="sm" className="h-10 md:h-8" disabled={cancelled} onClick={() => edit([...list, { name: saved.name ?? 'Companion', ability: saved.ability }])}>
              <Plus aria-hidden className="size-4" /> {saved.name ?? 'Saved companion'} · {ABILITY_LABEL[saved.ability]}
            </Button>
          ) : null}
          {dirty ? (
            <Button
              variant="primary"
              size="sm"
              className="h-10 md:h-8"
              disabled={pending || list.some((c) => !c.name.trim())}
              onClick={() => run(() => setTripCompanions({ tripId: data.tripId, companions: list.map((c) => ({ name: c.name.trim(), ability: c.ability })) }), { success: (d) => (d.partySize !== partySize ? `Companions saved · party of ${d.partySize}` : 'Companions saved'), onDone: () => setDirty(false) })}
            >
              Save companions
            </Button>
          ) : null}
        </div>
        {!saved ? <p className="mt-2 text-[12.5px] text-ink-3">Tip: a saved companion profile (for example an advanced skier you often ski with) can be set in Settings.</p> : null}
      </div>
    </div>
  )
}

export function TripNotes({ notes }: { notes: string | null }) {
  const { data, run, pending } = useTripUi()
  const [value, setValue] = useState(notes ?? '')
  const [seen, setSeen] = useState(notes)
  if (seen !== notes) {
    setSeen(notes)
    setValue(notes ?? '')
  }
  const dirty = value.trim() !== (notes ?? '').trim()
  const uid = useId()
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        run(() => updateTrip({ tripId: data.tripId, notes: value }), { success: 'Notes saved' })
      }}
    >
      <Field label="Trip notes" htmlFor={`${uid}-notes`} hint="Private. Exported with the trip calendar (.ics) description.">
        <Textarea id={`${uid}-notes`} value={value} rows={5} maxLength={4000} onChange={(e) => setValue(e.target.value)} placeholder="Road conditions to check, who drives, what to pack…" />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" variant={dirty ? 'primary' : 'secondary'} className="h-11 md:h-10" disabled={!dirty || pending}>
          Save notes
        </Button>
        {!dirty && notes ? <span className="text-[12.5px] text-ink-3">Saved</span> : null}
      </div>
    </form>
  )
}
