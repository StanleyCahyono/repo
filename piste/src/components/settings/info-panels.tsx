/**
 * Server-rendered Settings panels: owned passes (a shortcut to Passes & Costs), export & backup, and sign-in status.
 */
import { ArrowRight, CalendarDays, Download, FileJson, KeyRound, LockOpen, ShieldCheck, Ticket } from 'lucide-react'
import type { OwnedPassView } from '@/lib/data/settings-screen'
import { formatMoney } from '@/lib/domain/money'
import { formatInstant } from '@/lib/domain/time'
import { PERSONAL_TABLE_LABEL, PERSONAL_TABLES } from '@/lib/export/json'
import { MIN_SECRET_LENGTH } from '@/lib/auth'
import { PassBadge } from '@/components/ui/badge'
import { Button, ButtonLink } from '@/components/ui/button'
import { Code, SettingRow, SettingsPanel } from './section'

export function PassesShortcut({ owned, seasonLabel }: { owned: OwnedPassView[]; seasonLabel: string }) {
  return (
    <SettingsPanel>
      {owned.length ? (
        <ul className="divide-y divide-divider">
          {owned.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 md:px-5">
              {p.familyId ? <PassBadge family={p.familyId} /> : <Ticket aria-hidden className="size-4 text-ink-3" />}
              <span className="min-w-0 flex-1 text-[14.5px] font-medium text-ink">{p.productName}</span>
              <span className="text-[13px] text-ink-2 tnum">
                {p.holder === 'me' ? 'You' : p.holder} · {p.daysLogged} day{p.daysLogged === 1 ? '' : 's'} logged
                {p.pricePaid ? ` · paid ${formatMoney(p.pricePaid)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-4 py-4 md:px-5">
          <p className="text-[14.5px] font-semibold text-ink">No pass recorded for {seasonLabel}</p>
          <p className="mt-1 max-w-[68ch] text-[13.5px] text-ink-2">
            Pass ownership starts unset. A resort being on a pass never means you own that pass — add the exact product you bought and Piste checks access
            against it.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-2 px-4 py-3 md:px-5">
        <p className="text-[13px] text-ink-2">Buying, logging days and comparing products happen in Passes &amp; Costs.</p>
        <ButtonLink href="/passes" variant={owned.length ? 'secondary' : 'primary'} className="min-h-11 md:min-h-0">
          {owned.length ? 'Manage passes' : 'Add a pass'} <ArrowRight aria-hidden className="size-4" />
        </ButtonLink>
      </div>
    </SettingsPanel>
  )
}

export function ExportPanel({ demo }: { demo: boolean }) {
  return (
    <SettingsPanel>
      <SettingRow
        label="Everything, as JSON"
        hint={
          <>
            Every personal table in one file: preferences, favourites, passes, trips, journal, alerts, corrections and what you added. Metric units, money in
            minor units, <Code>null</Code> for unknown.
          </>
        }
      >
        <a
          href="/api/export/json"
          download
          className="inline-flex h-11 items-center gap-2 rounded-md border border-teal bg-teal px-4 text-[14.5px] font-medium text-on-teal transition-colors duration-150 hover:border-teal-strong hover:bg-teal-strong md:h-10"
        >
          <FileJson aria-hidden className="size-4" /> Download JSON
        </a>
        {demo ? <p className="mt-2 text-[12.5px] text-ink-3">Demo mode: the file comes from the demo database and is labelled DEMO.</p> : null}
      </SettingRow>
      <SettingRow label="One table, as CSV" labelId="csv-label" hint="For spreadsheets (UTF-8 with BOM).">
        <ul aria-labelledby="csv-label" className="flex flex-wrap gap-1.5">
          {PERSONAL_TABLES.map((t) => (
            <li key={t}>
              <a
                href={`/api/export/csv?table=${t}`}
                download
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-divider bg-surface-2 px-2.5 text-[13px] font-medium text-ink transition-colors duration-150 hover:border-teal hover:text-teal md:min-h-8"
              >
                <Download aria-hidden className="size-3.5 text-ink-3" />
                {PERSONAL_TABLE_LABEL[t]}
              </a>
            </li>
          ))}
        </ul>
      </SettingRow>
      <SettingRow label="Calendar files" hint="Trips and dated events export as .ics from their own pages. Events without an announced date are never exported with a guessed one.">
        <ButtonLink href="/trips" variant="secondary" className="min-h-11 md:min-h-0">
          <CalendarDays aria-hidden className="size-4" /> Open Trips
        </ButtonLink>
      </SettingRow>
      <SettingRow
        label="Backup & restore"
        hint="Whole-database copies, run on the machine that hosts Piste. Keep a copy off that machine — a backup on the same disk does not survive the disk."
      >
        <dl className="grid gap-2 text-[13px]">
          <div>
            <dt className="text-ink-2">Back up (safe while Piste runs)</dt>
            <dd className="mt-0.5">
              <Code>npm run backup</Code>
            </dd>
          </div>
          <div>
            <dt className="text-ink-2">Check, then restore (stop Piste and the worker first)</dt>
            <dd className="mt-0.5 flex flex-col items-start gap-1">
              <Code>npm run restore -- data/backups/&lt;file&gt;.db --check</Code>
              <Code>npm run restore -- data/backups/&lt;file&gt;.db</Code>
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-[12.5px] text-ink-3">
          Live and demo backups are kept apart and can never be restored into each other. Details in <Code>docs/backup.md</Code>.
        </p>
      </SettingRow>
    </SettingsPanel>
  )
}

export type AccessState = { state: 'off' } | { state: 'on'; expiresAt: string | null } | { state: 'misconfigured' }

export function AccessPanel({ access, tz }: { access: AccessState; tz: string }) {
  if (access.state === 'on') {
    return (
      <SettingsPanel>
        <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4 md:px-5">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[14.5px] font-semibold text-ink">
              <ShieldCheck aria-hidden className="size-4 text-positive" /> Protected with a passcode
            </p>
            <p className="mt-1 max-w-[64ch] text-[13.5px] text-ink-2">
              Every page and API needs a signed session. This browser stays signed in
              {access.expiresAt ? (
                <>
                  {' '}
                  until{' '}
                  <time dateTime={access.expiresAt} className="font-medium text-ink tnum">
                    {formatInstant(access.expiresAt, tz, 'ccc d LLL yyyy')}
                  </time>
                </>
              ) : null}
              . Changing <Code>PISTE_PASSCODE</Code> or <Code>PISTE_SESSION_SECRET</Code> signs every browser out.
            </p>
          </div>
          <form method="post" action="/signin/signout">
            <Button type="submit" variant="secondary" className="min-h-11 md:min-h-0">
              <KeyRound aria-hidden className="size-4" /> Sign out
            </Button>
          </form>
        </div>
      </SettingsPanel>
    )
  }
  if (access.state === 'misconfigured') {
    // The proxy normally shows its own configuration page instead of any route; this is a fallback.
    return (
      <SettingsPanel>
        <p className="px-4 py-4 text-[13.5px] font-medium text-critical md:px-5">
          Sign-in is misconfigured: <Code>PISTE_PASSCODE</Code> is set without a usable <Code>PISTE_SESSION_SECRET</Code> ({MIN_SECRET_LENGTH}+ characters).
        </p>
      </SettingsPanel>
    )
  }
  return (
    <SettingsPanel>
      <div className="px-4 py-4 md:px-5">
        <p className="flex items-center gap-2 text-[14.5px] font-semibold text-ink">
          <LockOpen aria-hidden className="size-4 text-ink-2" /> Sign-in is off
        </p>
        <p className="mt-1 max-w-[68ch] text-[13.5px] text-ink-2">
          Fine on your own computer: anyone who can reach this address can use Piste. Before exposing it to a network, set <Code>PISTE_PASSCODE</Code> and a
          random <Code>PISTE_SESSION_SECRET</Code> ({MIN_SECRET_LENGTH}+ characters) in <Code>.env.local</Code>, then restart. Every page then asks for the
          passcode and every API answers 401 without a session.
        </p>
      </div>
    </SettingsPanel>
  )
}
