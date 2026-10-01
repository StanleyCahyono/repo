'use client'
/**
 * Theme (system / light / dark) and data mode (live / demo).
 *
 * Theme: the root layout renders `data-theme` on <html> from the stored preference, so every page load is already
 * correct before first paint (no flash). Changing it here applies the attribute at once, then saves.
 */
import { useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { FlaskConical, Monitor, Moon, Radio, Sun } from 'lucide-react'
import { saveTheme } from '@/lib/actions/settings'
import { setMode } from '@/lib/actions/mode'
import { Segmented } from '@/components/ui/segmented'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/ui/cn'
import { TALL, THEMES, type Theme } from './options'
import { SettingRow, SettingsPanel } from './section'
import { useSave } from './use-save'
import { useDraft } from './use-draft'

function applyTheme(theme: Theme) {
  const el = document.documentElement
  if (theme === 'system') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', theme)
}

const darkQuery = '(prefers-color-scheme: dark)'
function subscribeScheme(cb: () => void) {
  const m = window.matchMedia(darkQuery)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}

const THEME_LABEL: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' }

export function AppearancePanel({ theme, mode }: { theme: Theme; mode: 'live' | 'demo' }) {
  const d = useDraft({ theme })
  const { run } = useSave()
  const pathname = usePathname()
  const systemDark = useSyncExternalStore(
    subscribeScheme,
    () => window.matchMedia(darkQuery).matches,
    () => null,
  )

  function change(next: Theme) {
    const prev = d.baseline.theme
    d.set({ theme: next })
    applyTheme(next)
    run(() => saveTheme({ theme: next }), {
      onDone: (data) => d.commit({ theme: data.theme }),
      onError: () => {
        d.discard()
        applyTheme(prev)
      },
      undo: () => {
        d.set({ theme: prev })
        applyTheme(prev)
        run(() => saveTheme({ theme: prev }), {
          onDone: (data) => d.commit({ theme: data.theme }),
          onError: () => {
            d.discard()
            applyTheme(next)
          },
          success: `Theme back to ${THEME_LABEL[prev].toLowerCase()}`,
        })
      },
    })
  }

  const current = d.values.theme
  const target = mode === 'demo' ? 'live' : 'demo'
  return (
    <SettingsPanel>
      <SettingRow label="Theme" labelId="theme-label" hint="Applies at once on this and every device that opens Piste.">
        <Segmented
          label="Theme"
          options={THEMES.map((x) => ({ value: x, label: THEME_LABEL[x] }))}
          value={current}
          onChange={change}
          className={TALL}
        />
        <p className="mt-2 flex items-center gap-1.5 text-[13px] text-ink-2">
          {current === 'system' ? <Monitor aria-hidden className="size-3.5 text-ink-3" /> : current === 'dark' ? <Moon aria-hidden className="size-3.5 text-ink-3" /> : <Sun aria-hidden className="size-3.5 text-ink-3" />}
          {current === 'system'
            ? systemDark === null
              ? 'Follows your device’s light or dark setting.'
              : `Follows your device — currently ${systemDark ? 'dark' : 'light'}.`
            : `Always ${current}, whatever the device prefers.`}
        </p>
      </SettingRow>
      <SettingRow
        label="Data mode"
        labelId="mode-label"
        hint="Demo mode opens a separate, simulated database. Nothing from it reaches your live records, recommendations, exports or alerts."
      >
        <div role="group" aria-labelledby="mode-label" className="grid gap-2 sm:grid-cols-2">
          <ModeOption
            active={mode === 'live'}
            icon={<Radio aria-hidden className="size-4 text-positive" />}
            title="Live data"
            body="Your records, the real catalog and whatever the refresh jobs could fetch — failures shown as failures."
          />
          <ModeOption
            active={mode === 'demo'}
            icon={<FlaskConical aria-hidden className="size-4 text-demo" />}
            title="Demo data"
            body="Simulated mid-season data dated Fri 15 Jan 2027, labelled everywhere. Changes stay in the demo database."
          />
        </div>
        <form action={setMode.bind(null, target, pathname || '/settings')} className="mt-3">
          <Button type="submit" variant={mode === 'demo' ? 'primary' : 'secondary'} className="min-h-11 md:min-h-0">
            {mode === 'demo' ? <Radio aria-hidden className="size-4" /> : <FlaskConical aria-hidden className="size-4" />}
            {mode === 'demo' ? 'Return to live data' : 'Explore demo mode'}
          </Button>
        </form>
      </SettingRow>
    </SettingsPanel>
  )
}

function ModeOption({ active, icon, title, body }: { active: boolean; icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className={cn('rounded-[14px] border px-3.5 py-3', active ? 'border-teal bg-glacier/60' : 'border-glass-line bg-chip-track')}>
      <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
        {icon}
        {title}
        {active ? <span className="ml-auto rounded-sm bg-teal px-1.5 py-0.5 text-[12px] leading-none font-semibold text-on-teal">In use</span> : null}
      </p>
      <p className="mt-1 text-[13px] leading-snug text-ink-2">{body}</p>
    </div>
  )
}
