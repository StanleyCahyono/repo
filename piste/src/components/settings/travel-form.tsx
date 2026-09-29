'use client'
/** Travel preferences: longest drive, flying, origin airports in order of preference, winter driving buffer. */
import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { saveTravel } from '@/lib/actions/settings'
import type { AirportChoice } from '@/lib/data/settings-screen'
import type { TravelPrefs } from '@/lib/db/schema'
import { formatDuration } from '@/lib/domain/units'
import { Select, TextInput } from '@/components/ui/form'
import { IconButton } from '@/components/ui/button'
import { t } from '@/lib/ui/motion'
import { SaveBar } from './save-bar'
import { FieldError, SettingRow, SettingsPanel } from './section'
import { Switch } from './switch'
import { useSave } from './use-save'
import { errorFor, useDraft } from './use-draft'

interface TravelValues {
  maxDriveHours: string
  noLimit: boolean
  willingToFly: boolean
  originAirports: string[]
  winterBufferPct: string
}

const toValues = (p: TravelPrefs): TravelValues => ({
  maxDriveHours: p.maxDriveHours === null ? '' : String(p.maxDriveHours),
  noLimit: p.maxDriveHours === null,
  willingToFly: p.willingToFly,
  originAirports: [...p.originAirports],
  winterBufferPct: String(p.winterBufferPct),
})

const numOrNaN = (s: string) => (s.trim() === '' ? NaN : Number(s.trim().replace(',', '.')))

const toInput = (v: TravelValues) => ({
  maxDriveHours: v.noLimit ? null : numOrNaN(v.maxDriveHours),
  willingToFly: v.willingToFly,
  originAirports: v.originAirports,
  winterBufferPct: numOrNaN(v.winterBufferPct),
})

export function TravelForm({ saved, airports, homeName }: { saved: TravelPrefs; airports: AirportChoice[]; homeName: string }) {
  const d = useDraft(toValues(saved))
  const { run, pending } = useSave()
  const [announce, setAnnounce] = useState('')
  const v = d.values
  const byCode = new Map(airports.map((a) => [a.iata, a]))
  const addable = airports.filter((a) => a.role !== 'destination' && !v.originAirports.includes(a.iata))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const prev = d.baseline
    run(() => saveTravel(toInput(v)), {
      onDone: (data) => d.commit(toValues(data)),
      onError: (r) => d.setErrors(r.fieldErrors ?? {}),
      undo: () => run(() => saveTravel(toInput(prev)), { onDone: (data) => d.commit(toValues(data)), success: 'Travel preferences restored' }),
    })
  }

  function move(i: number, by: -1 | 1) {
    const list = [...v.originAirports]
    const j = i + by
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    d.set({ originAirports: list })
    setAnnounce(`${list[j]} moved to position ${j + 1} of ${list.length}`)
  }

  const err = (k: string) => errorFor(d.errors, k)

  return (
    <SettingsPanel as="form" onSubmit={submit} noValidate aria-label="Travel preferences">
      <SettingRow label="Longest drive" htmlFor="max-drive" hint="One way. A resort whose drive (plus the winter buffer) is longer counts as a fly-in trip — or as out of reach if you prefer not to fly.">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <TextInput
              id="max-drive"
              inputMode="decimal"
              value={v.noLimit ? '' : v.maxDriveHours}
              placeholder={v.noLimit ? 'No limit' : 'e.g. 4'}
              disabled={v.noLimit}
              onChange={(e) => d.set({ maxDriveHours: e.target.value })}
              aria-invalid={!!err('maxDriveHours')}
              aria-describedby={err('maxDriveHours') ? 'max-drive-err' : undefined}
              className="max-w-24 tnum"
            />
            <span className="text-[14px] text-ink-2">hours</span>
          </div>
          <Switch checked={v.noLimit} onChange={(noLimit) => d.set({ noLimit, maxDriveHours: noLimit ? v.maxDriveHours : v.maxDriveHours || '4' }, ['maxDriveHours'])} label="No drive limit" onText="No limit" offText="No limit" />
        </div>
        <FieldError id="max-drive-err" error={err('maxDriveHours')} />
      </SettingRow>
      <SettingRow label="Willing to fly" labelId="fly-label" hint="When off, resorts beyond your longest drive count as out of reach in rankings. You can still plan a flight by hand.">
        <Switch checked={v.willingToFly} onChange={(willingToFly) => d.set({ willingToFly })} labelledBy="fly-label" onText="Yes — consider flights" offText="No — drive only" />
      </SettingRow>
      <SettingRow
        label="Origin airports"
        labelId="origins-label"
        hint={<>In order of preference. Drive times from {homeName} are curated estimates, not live routing.</>}
      >
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
        {v.originAirports.length ? (
          <ol aria-labelledby="origins-label" className="max-w-xl divide-y divide-divider rounded-[10px] border border-divider">
            <AnimatePresence initial={false}>
              {v.originAirports.map((code, i) => {
                const a = byCode.get(code)
                return (
                  <motion.li
                    key={code}
                    layout="position"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={t.spring}
                    className="grid grid-cols-[1rem_2.75rem_minmax(0,1fr)] items-center gap-x-3 bg-surface py-2 pr-1.5 pl-3 first:rounded-t-[10px] last:rounded-b-[10px] sm:grid-cols-[1rem_2.75rem_minmax(0,1fr)_auto] sm:py-1.5"
                  >
                    <span aria-hidden className="font-mono text-[12px] text-ink-3 tnum">
                      {i + 1}
                    </span>
                    <span className="font-mono text-[14px] font-medium text-ink">{code}</span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] text-ink sm:truncate">{a?.city ?? a?.name ?? 'Unknown airport'}</span>
                      <span className="block text-[12.5px] text-ink-3 tnum">
                        {a?.driveMinutes != null ? `${formatDuration(a.driveMinutes)} drive · estimate` : 'Drive time unknown'}
                      </span>
                    </span>
                    <span className="col-span-3 -mt-0.5 flex justify-end sm:col-span-1 sm:mt-0">
                      <IconButton label={`Move ${code} up`} size="lg" className="md:size-9" disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp aria-hidden className="size-4" />
                      </IconButton>
                      <IconButton label={`Move ${code} down`} size="lg" className="md:size-9" disabled={i === v.originAirports.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown aria-hidden className="size-4" />
                      </IconButton>
                      <IconButton
                        label={`Remove ${code}`}
                        size="lg"
                        className="md:size-9"
                        onClick={() => {
                          d.set({ originAirports: v.originAirports.filter((x) => x !== code) })
                          setAnnounce(`${code} removed`)
                        }}
                      >
                        <X aria-hidden className="size-4" />
                      </IconButton>
                    </span>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ol>
        ) : (
          <p className="max-w-xl rounded-[10px] border border-dashed border-divider-strong bg-surface-2 px-3 py-3 text-[13.5px] text-ink-2">
            No origin airports — flight planning will ask for one each time.
          </p>
        )}
        {addable.length ? (
          <label className="mt-3 flex max-w-xl items-center gap-2">
            <Plus aria-hidden className="size-4 shrink-0 text-ink-3" />
            <span className="sr-only">Add an origin airport</span>
            <Select
              value=""
              onChange={(e) => {
                if (!e.target.value) return
                d.set({ originAirports: [...v.originAirports, e.target.value] })
                setAnnounce(`${e.target.value} added`)
              }}
              className="max-w-xs"
            >
              <option value="">Add an airport…</option>
              {addable.map((a) => (
                <option key={a.iata} value={a.iata}>
                  {a.iata} — {a.city ?? a.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <FieldError id="origins-err" error={err('originAirports')} />
      </SettingRow>
      <SettingRow label="Winter driving buffer" htmlFor="winter-buffer" hint="Added to every drive estimate in winter — your planning assumption, shown wherever it is applied.">
        <div className="flex items-center gap-2">
          <TextInput
            id="winter-buffer"
            inputMode="numeric"
            value={v.winterBufferPct}
            onChange={(e) => d.set({ winterBufferPct: e.target.value })}
            aria-invalid={!!err('winterBufferPct')}
            aria-describedby={err('winterBufferPct') ? 'winter-buffer-err' : 'winter-buffer-eg'}
            className="max-w-20 tnum"
          />
          <span className="text-[14px] text-ink-2">%</span>
        </div>
        <FieldError id="winter-buffer-err" error={err('winterBufferPct')} />
        {!err('winterBufferPct') && Number.isFinite(numOrNaN(v.winterBufferPct)) ? (
          <p id="winter-buffer-eg" className="mt-1.5 text-[12.5px] text-ink-3 tnum">
            A 2 h estimate is planned as {formatDuration(Math.round(120 * (1 + numOrNaN(v.winterBufferPct) / 100)))}.
          </p>
        ) : null}
      </SettingRow>
      <SaveBar dirty={d.dirty} pending={pending} error={Object.keys(d.errors).length ? 'Check the highlighted fields' : null} onDiscard={d.discard} />
    </SettingsPanel>
  )
}
