'use client'
/** Home base, time zone and active season. */
import { ExternalLink } from 'lucide-react'
import { saveHome } from '@/lib/actions/settings'
import { Select, TextInput } from '@/components/ui/form'
import { SaveBar } from './save-bar'
import { FieldError, SettingRow, SettingsPanel } from './section'
import { useSave } from './use-save'
import { errorFor, useDraft } from './use-draft'

export interface HomeValues {
  homeName: string
  homeLat: string
  homeLon: string
  homeTimezone: string
  activeSeasonId: string
}

/** Time zones offered first (the full list follows). */
const COMMON_ZONES = [
  'America/New_York',
  'America/Toronto',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Vancouver',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Zurich',
  'Europe/Vienna',
]

const num = (s: string) => (s.trim() === '' ? NaN : Number(s.trim().replace(',', '.')))

export function HomeForm({
  saved,
  seasons,
  zones,
}: {
  saved: HomeValues
  seasons: { id: string; label: string; startDate: string; endDate: string }[]
  /** Every IANA zone the server knows (computed on the server, so the list cannot differ at hydration). */
  zones: string[]
}) {
  const d = useDraft(saved)
  const { run, pending } = useSave()
  const v = d.values
  const common = COMMON_ZONES.filter((z) => zones.includes(z))
  const rest = zones.filter((z) => !common.includes(z))
  const known = zones.includes(v.homeTimezone)
  const lat = num(v.homeLat)
  const lon = num(v.homeLon)
  const mapHref = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=11/${lat}/${lon}` : null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const prev = d.baseline
    const input = { homeName: v.homeName, homeLat: num(v.homeLat), homeLon: num(v.homeLon), homeTimezone: v.homeTimezone, activeSeasonId: v.activeSeasonId }
    const toValues = (x: typeof input): HomeValues => ({ homeName: x.homeName, homeLat: String(x.homeLat), homeLon: String(x.homeLon), homeTimezone: x.homeTimezone, activeSeasonId: x.activeSeasonId })
    run(() => saveHome(input), {
      onDone: (data) => d.commit(toValues(data)),
      onError: (r) => d.setErrors(r.fieldErrors ?? {}),
      undo: () =>
        run(() => saveHome({ ...prev, homeLat: num(prev.homeLat), homeLon: num(prev.homeLon) }), {
          onDone: (data) => d.commit(toValues(data)),
          success: 'Home and season restored',
        }),
    })
  }

  const err = (k: keyof HomeValues) => errorFor(d.errors, k)

  return (
    <SettingsPanel as="form" onSubmit={submit} noValidate aria-label="Home and season">
      <SettingRow label="Home base" htmlFor="home-name" hint="How Piste names where you start from.">
        <TextInput
          id="home-name"
          value={v.homeName}
          maxLength={80}
          autoComplete="off"
          onChange={(e) => d.set({ homeName: e.target.value })}
          aria-invalid={!!err('homeName')}
          aria-describedby={err('homeName') ? 'home-name-err' : undefined}
          className="max-w-sm"
        />
        <FieldError id="home-name-err" error={err('homeName')} />
      </SettingRow>
      <SettingRow
        label="Location"
        labelId="home-location"
        hint={
          <>
            Decimal degrees, used for maps and direction links. Catalog drive times are curated estimates from Ithaca, NY — they are not recomputed from
            here.
          </>
        }
      >
        <div role="group" aria-labelledby="home-location" className="grid max-w-sm grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-ink-2">Latitude</span>
            <TextInput
              inputMode="decimal"
              value={v.homeLat}
              onChange={(e) => d.set({ homeLat: e.target.value })}
              aria-invalid={!!err('homeLat')}
              aria-describedby={err('homeLat') ? 'home-lat-err' : undefined}
              className="tnum"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-ink-2">Longitude</span>
            <TextInput
              inputMode="decimal"
              value={v.homeLon}
              onChange={(e) => d.set({ homeLon: e.target.value })}
              aria-invalid={!!err('homeLon')}
              aria-describedby={err('homeLon') ? 'home-lon-err' : undefined}
              className="tnum"
            />
          </label>
        </div>
        <FieldError id="home-lat-err" error={err('homeLat')} />
        <FieldError id="home-lon-err" error={err('homeLon')} />
        {mapHref ? (
          <a href={mapHref} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-teal hover:underline">
            Check on OpenStreetMap <ExternalLink aria-hidden className="size-3.5" />
          </a>
        ) : null}
      </SettingRow>
      <SettingRow label="Home time zone" htmlFor="home-tz" hint="Decides what “today” is for you. Resort days always use each resort’s own zone.">
        <Select
          id="home-tz"
          value={v.homeTimezone}
          onChange={(e) => d.set({ homeTimezone: e.target.value })}
          aria-invalid={!!err('homeTimezone')}
          aria-describedby={err('homeTimezone') ? 'home-tz-err' : undefined}
          className="max-w-sm"
        >
          {!known ? <option value={v.homeTimezone}>{v.homeTimezone}</option> : null}
          <optgroup label="Common">
            {common.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </optgroup>
          <optgroup label="All time zones">
            {rest.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </optgroup>
        </Select>
        <FieldError id="home-tz-err" error={err('homeTimezone')} />
      </SettingRow>
      <SettingRow label="Active season" htmlFor="home-season" hint="Pass products, prices and opening dates are shown for this season.">
        <Select
          id="home-season"
          value={v.activeSeasonId}
          onChange={(e) => d.set({ activeSeasonId: e.target.value })}
          aria-invalid={!!err('activeSeasonId')}
          aria-describedby={err('activeSeasonId') ? 'home-season-err' : undefined}
          className="max-w-[14rem]"
        >
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} season
            </option>
          ))}
        </Select>
        <FieldError id="home-season-err" error={err('activeSeasonId')} />
      </SettingRow>
      <SaveBar dirty={d.dirty} pending={pending} error={Object.keys(d.errors).length ? 'Check the highlighted fields' : null} onDiscard={d.discard} />
    </SettingsPanel>
  )
}
