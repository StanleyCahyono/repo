'use client'
/**
 * In-app alert rules: grouped by what they watch, each with an on/off switch, edit and delete (with Undo), plus the
 * most recent alerts and an honest note about what in-app alerts can and cannot do.
 */
import { useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'motion/react'
import { BellOff, BellRing, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { addDefaultAlertRules, deleteAlertRule, restoreAlertRule, updateAlertRule } from '@/lib/actions/settings'
import type { AlertRuleView, RecentAlertView, ResortChoice } from '@/lib/data/settings-screen'
import { formatInstant, relativeLabel } from '@/lib/domain/time'
import type { UnitPrefs } from '@/lib/domain/types'
import { Button, IconButton } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/states'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { AlertEditor } from './alert-editor'
import { ALERT_SPECS, ALERT_TYPE_ORDER, describeRule } from './alert-specs'
import { Switch } from './switch'
import { useSave } from './use-save'

export function AlertsPanel({
  rules,
  recent,
  unread,
  resorts,
  units,
  now,
  tz,
}: {
  rules: AlertRuleView[]
  recent: RecentAlertView[]
  unread: number
  resorts: ResortChoice[]
  units: UnitPrefs
  now: string
  tz: string
}) {
  const { run, pending } = useSave()
  const [editing, setEditing] = useState<AlertRuleView | null>(null)
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  /** Optimistic on/off state per rule id until the server confirms. */
  const [enabledOverride, setEnabledOverride] = useState<Record<number, boolean>>({})
  const [hidden, setHidden] = useState<Set<number>>(new Set())

  const visible = rules.filter((r) => !hidden.has(r.id))
  const on = visible.filter((r) => enabledOverride[r.id] ?? r.enabled).length
  const groups = ALERT_TYPE_ORDER.map((type) => ({ type, rules: visible.filter((r) => r.type === type) })).filter((g) => g.rules.length)

  function openEditor(rule: AlertRuleView | null, from: HTMLElement | null) {
    opener.current = from
    setEditing(rule)
    setOpen(true)
  }

  function toggle(rule: AlertRuleView, enabled: boolean) {
    setEnabledOverride((o) => ({ ...o, [rule.id]: enabled }))
    const clear = () =>
      setEnabledOverride((o) => {
        const next = { ...o }
        delete next[rule.id]
        return next
      })
    run(() => updateAlertRule({ id: rule.id, enabled }), {
      onError: clear,
      undo: () => {
        setEnabledOverride((o) => ({ ...o, [rule.id]: !enabled }))
        run(() => updateAlertRule({ id: rule.id, enabled: !enabled }), { onError: clear, success: !enabled ? 'Alert rule back on' : 'Alert rule paused again' })
      },
    })
  }

  function remove(rule: AlertRuleView) {
    setHidden((h) => new Set(h).add(rule.id))
    const unhide = () =>
      setHidden((h) => {
        const next = new Set(h)
        next.delete(rule.id)
        return next
      })
    run(() => deleteAlertRule({ id: rule.id }), {
      onError: unhide,
      success: `Deleted: ${ALERT_SPECS[rule.type].title}${rule.resortName ? ` · ${rule.resortName}` : ''}`,
      undo: (row) =>
        run(() => restoreAlertRule(row), { onDone: unhide }),
    })
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13.5px] text-ink-2 tnum" aria-live="polite">
            {visible.length ? (
              <>
                <span className="font-semibold text-ink">{visible.length}</span> rule{visible.length === 1 ? '' : 's'} · <span className="font-semibold text-ink">{on}</span> on
              </>
            ) : (
              'No rules'
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => addDefaultAlertRules())}
              className="min-h-11 md:min-h-0"
            >
              <Sparkles aria-hidden className="size-4" /> Defaults for favourites
            </Button>
            <Button variant="secondary" onClick={(e) => openEditor(null, e.currentTarget)} className="min-h-11 md:min-h-0">
              <Plus aria-hidden className="size-4" /> Add rule
            </Button>
          </div>
        </div>

        {groups.length ? (
          <div className="overflow-hidden rounded-[12px] border border-divider bg-surface">
            {groups.map((g, gi) => (
              <section key={g.type} aria-labelledby={`alerts-${g.type}`} className={cn(gi > 0 && 'border-t border-divider')}>
                <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 bg-surface-2 px-4 py-2.5 md:px-5">
                  <h3 id={`alerts-${g.type}`} className="text-[14.5px] font-semibold text-ink">
                    {ALERT_SPECS[g.type].title}
                  </h3>
                  {ALERT_SPECS[g.type].caveat ? <p className="text-[12.5px] text-ink-3">{ALERT_SPECS[g.type].caveat}</p> : null}
                </header>
                <ul className="divide-y divide-divider border-t border-divider">
                  <AnimatePresence initial={false}>
                    {g.rules.map((r) => {
                      const enabled = enabledOverride[r.id] ?? r.enabled
                      const labelId = `rule-${r.id}-label`
                      return (
                        <motion.li
                          key={r.id}
                          layout="position"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={t.hover}
                          className="grid items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] md:px-5"
                        >
                          <div className={cn('min-w-0', !enabled && 'opacity-70')}>
                            <p id={labelId} className="text-[14px] font-medium text-ink">
                              {r.resortName ?? ALERT_SPECS[r.type].allScope}
                            </p>
                            <p className="mt-0.5 text-[13px] text-ink-2">{describeRule(r.type, r.params, units)}</p>
                            <p className="mt-1 text-[12.5px] text-ink-3 tnum">
                              Cooldown {r.cooldownHours} h ·{' '}
                              {r.lastFiredAt ? (
                                <time dateTime={r.lastFiredAt} title={formatInstant(r.lastFiredAt, tz, 'ccc d LLL yyyy, HH:mm')}>
                                  last alert {relativeLabel(r.lastFiredAt, now)}
                                </time>
                              ) : (
                                'no alert yet'
                              )}
                              {r.fired > 0 ? ` · ${r.fired} in total` : ''}
                            </p>
                          </div>
                          <div className="-ml-0.5 flex items-center gap-1 sm:ml-0">
                            <Switch
                              checked={enabled}
                              onChange={(next) => toggle(r, next)}
                              labelledBy={labelId}
                              describedBy={`alerts-${g.type}`}
                              onText="On"
                              offText="Paused"
                              className="mr-auto sm:mr-1"
                            />
                            <IconButton label={`Edit rule: ${r.resortName ?? ALERT_SPECS[r.type].allScope}`} size="lg" className="md:size-9" onClick={(e) => openEditor(r, e.currentTarget)}>
                              <Pencil aria-hidden className="size-4" />
                            </IconButton>
                            <IconButton label={`Delete rule: ${r.resortName ?? ALERT_SPECS[r.type].allScope}`} size="lg" className="md:size-9 hover:text-critical" onClick={() => remove(r)}>
                              <Trash2 aria-hidden className="size-4" />
                            </IconButton>
                          </div>
                        </motion.li>
                      )
                    })}
                  </AnimatePresence>
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <EmptyState
            seed="alerts-empty"
            title="No alert rules"
            body="Add the default rules for your favourites (openings, date changes and forecast snow), or add a rule of your own."
          />
        )}
      </div>

      <aside aria-label="Recent alerts and how alerts work" className="flex flex-col gap-4">
        <div className="rounded-[12px] border border-divider bg-surface">
          <p className="flex items-center justify-between gap-2 border-b border-divider px-4 py-2.5 text-[13.5px] font-semibold text-ink">
            Recent alerts
            <span className="text-[12.5px] font-normal text-ink-3 tnum">{unread ? `${unread} unread` : 'All read'}</span>
          </p>
          {recent.length ? (
            <ul className="divide-y divide-divider">
              {recent.map((a) => (
                <li key={a.id} className="flex gap-2.5 px-4 py-2.5">
                  <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', a.read ? 'bg-divider-strong' : 'bg-copper')} />
                  <div className="min-w-0">
                    {a.link ? (
                      <Link href={a.link} className="text-[13.5px] font-medium text-ink hover:text-teal hover:underline">
                        {a.title}
                      </Link>
                    ) : (
                      <p className="text-[13.5px] font-medium text-ink">{a.title}</p>
                    )}
                    <p className="text-[12.5px] text-ink-3 tnum">
                      <time dateTime={a.firedAt}>{relativeLabel(a.firedAt, now)}</time>
                      {a.read ? '' : ' · unread'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-[13px] text-ink-2">No alerts yet. They appear here and on Today when a rule matches new data.</p>
          )}
        </div>
        <div className="rounded-[12px] border border-divider bg-surface-2 px-4 py-3.5 text-[13px] text-ink-2">
          <p className="flex items-center gap-2 font-semibold text-ink">
            <BellRing aria-hidden className="size-4 text-teal" /> In-app only
          </p>
          <p className="mt-1">Rules are checked after every refresh pass. A machine that is asleep checks nothing, so alerts can arrive late — never early.</p>
          <p className="mt-3 flex items-center gap-2 font-semibold text-ink">
            <BellOff aria-hidden className="size-4 text-ink-3" /> Browser notifications: not yet
          </p>
          <p className="mt-1">
            They would need your opt-in and a push service. Even then, Piste cannot notify you from a closed tab by itself — so nothing here promises
            background notifications.
          </p>
        </div>
      </aside>

      <AlertEditor
        open={open}
        onOpenChange={setOpen}
        rule={editing}
        resorts={resorts}
        units={units}
        onSaved={() => undefined}
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
