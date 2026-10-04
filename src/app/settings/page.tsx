import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { ArrowRight } from 'lucide-react'
import { ButtonLink } from '@/components/ui/button'
import { DemoBadge } from '@/components/ui/badge'
import { OfflineBanner } from '@/components/ui/offline-banner'
import { PageHeader } from '@/components/ui/page-header'
import { AlertsPanel } from '@/components/settings/alerts-panel'
import { AppearancePanel } from '@/components/settings/appearance-panel'
import { CostsForm } from '@/components/settings/costs-form'
import { HomeForm } from '@/components/settings/home-form'
import { AccessPanel, ExportPanel, PassesShortcut, type AccessState } from '@/components/settings/info-panels'
import { THEMES, type Theme } from '@/components/settings/options'
import { ProfileForm } from '@/components/settings/profile-form'
import { Rise } from '@/components/settings/rise'
import { ScrollRise } from '@/components/season/scroll-rise'
import { SettingsSection } from '@/components/settings/section'
import { SettingsNav, type NavSection } from '@/components/settings/settings-nav'
import { TravelForm } from '@/components/settings/travel-form'
import { UnitsPanel } from '@/components/settings/units-panel'
import { WeightsForm } from '@/components/settings/weights-form'
import { CorrectionsPanel } from '@/components/sources/corrections-panel'
import { authConfig, SESSION_COOKIE, verifySession } from '@/lib/auth'
import { getCtx } from '@/lib/context'
import { getSettingsView } from '@/lib/data/settings-screen'
import { seasonLabel } from '@/lib/data/core'

export const metadata: Metadata = { title: 'Settings' }

/** Every IANA zone the server knows (region/city names only), for the home time-zone picker. */
function timeZones(current: string): string[] {
  let zones: string[] = []
  try {
    zones = Intl.supportedValuesOf('timeZone').filter((z) => z.includes('/') && !z.startsWith('Etc/'))
  } catch {
    zones = []
  }
  return zones.includes(current) ? zones : [current, ...zones]
}

async function accessState(): Promise<AccessState> {
  const cfg = authConfig()
  if (cfg.state === 'off') return { state: 'off' }
  if (cfg.state === 'misconfigured') return { state: 'misconfigured' }
  // Sessions expire in wall-clock time (not the app clock), exactly as the proxy checks them.
  const v = verifySession(cfg, (await cookies()).get(SESSION_COOKIE)?.value, Math.floor(Date.now() / 1000))
  return { state: 'on', expiresAt: v.ok ? new Date(v.expiresAt * 1000).toISOString() : null }
}

export default async function SettingsPage() {
  const ctx = await getCtx()
  const [view, access] = await Promise.all([getSettingsView(ctx), accessState()])
  const p = view.prefs
  const demo = view.mode === 'demo'
  const tz = p.homeTimezone
  const theme: Theme = (THEMES as readonly string[]).includes(p.theme) ? (p.theme as Theme) : 'system'
  const rulesOn = view.alerts.rules.filter((r) => r.enabled).length
  const unapplied = view.corrections.filter((c) => !c.applied).length

  const sections: NavSection[] = [
    { id: 'home', label: 'Home & season', short: 'Home' },
    { id: 'ability', label: 'Ability' },
    { id: 'units', label: 'Units & currency', short: 'Units' },
    { id: 'travel', label: 'Travel' },
    { id: 'costs', label: 'Gear, budget & lodging', short: 'Costs' },
    { id: 'weights', label: 'Recommendations', short: 'Weights' },
    { id: 'passes', label: 'Passes', badge: view.ownedPasses.length ? String(view.ownedPasses.length) : null },
    { id: 'alerts', label: 'Alerts', badge: view.alerts.unread ? `${view.alerts.unread} new` : null, tone: 'caution' },
    { id: 'corrections', label: 'Catalog corrections', short: 'Corrections', badge: unapplied ? `${unapplied} not applied` : view.corrections.length ? String(view.corrections.length) : null, tone: unapplied ? 'critical' : 'neutral' },
    { id: 'appearance', label: 'Appearance & data', short: 'Appearance' },
    { id: 'export', label: 'Export & backup', short: 'Export' },
    { id: 'access', label: 'Sign-in' },
  ]

  return (
    <>
      <OfflineBanner />
      <PageHeader
        eyebrow={
          <>
            <span>Personal defaults</span>
            {demo ? (
              <DemoBadge>
                <span className="sm:hidden">Demo data</span>
                <span className="max-sm:hidden">Demo data — changes stay in the demo database</span>
              </DemoBadge>
            ) : null}
          </>
        }
        title="Settings"
        lead="Your home, ability and planning defaults. Units and currency only change how values are shown — nothing stored is ever converted."
        actions={
          <ButtonLink href="/sources" variant="ghost" className="max-md:hidden">
            Sources &amp; Sync <ArrowRight aria-hidden className="size-4" />
          </ButtonLink>
        }
      />

      <div className="xl:grid xl:grid-cols-[208px_minmax(0,1fr)] xl:gap-10">
        <SettingsNav sections={sections} label="Settings sections" />
        <div className="flex min-w-0 flex-col gap-10 md:gap-12">
          <Rise index={0}>
            <SettingsSection id="home" index={1} title="Home & season" meta="Where you start from, what “today” means, and which season you plan.">
              <HomeForm
                saved={{ homeName: p.homeName, homeLat: String(p.homeLat), homeLon: String(p.homeLon), homeTimezone: p.homeTimezone, activeSeasonId: p.activeSeasonId }}
                seasons={view.seasons}
                zones={timeZones(p.homeTimezone)}
              />
            </SettingsSection>
          </Rise>
          <Rise index={1}>
            <SettingsSection id="ability" index={2} title="Ability" meta="You, and an optional companion for comparing trips.">
              <ProfileForm saved={{ ability: p.ability, scoringMode: p.scoringMode, companionName: p.companionName ?? '', companionAbility: p.companionAbility ?? '' }} />
            </SettingsSection>
          </Rise>
          <Rise index={2}>
            <SettingsSection id="units" index={3} title="Units & currency" meta="Each unit switches on its own and applies at once — display only.">
              <UnitsPanel units={p.units} currency={p.currency} fx={view.fx} now={view.now} homeTimezone={tz} demo={demo} />
            </SettingsSection>
          </Rise>
          <Rise index={3}>
            <SettingsSection id="travel" index={4} title="Travel" meta="How far you drive, whether you fly, and from where.">
              <TravelForm saved={p.travel} airports={view.airports} homeName={p.homeName} />
            </SettingsSection>
          </Rise>
          <ScrollRise>
            <SettingsSection id="costs" index={5} title="Gear, budget & lodging" meta="What day and trip costs assume.">
              <CostsForm gear={p.gear} budget={p.budget} lodgingStyle={p.lodgingStyle} />
            </SettingsSection>
          </ScrollRise>
          <ScrollRise>
            <SettingsSection id="weights" index={6} title="Recommendations" meta="How much each factor counts when the weekend finder ranks with your weights.">
              <WeightsForm saved={p.weights} />
            </SettingsSection>
          </ScrollRise>
          <ScrollRise>
            <SettingsSection id="passes" index={7} title="Passes" meta={`Passes you own for ${seasonLabel(p.activeSeasonId)}.`}>
              <PassesShortcut owned={view.ownedPasses} seasonLabel={seasonLabel(p.activeSeasonId)} />
            </SettingsSection>
          </ScrollRise>
          <ScrollRise>
            <SettingsSection
              id="alerts"
              index={8}
              title="Alerts"
              meta={
                <>
                  In-app alerts from your rules — {rulesOn} of {view.alerts.rules.length} on{demo ? '. Demo alerts never reach your live data' : ''}.
                </>
              }
            >
              <AlertsPanel rules={view.alerts.rules} recent={view.alerts.recent} unread={view.alerts.unread} resorts={view.resorts} units={p.units} now={view.now} tz={tz} />
            </SettingsSection>
          </ScrollRise>
          <ScrollRise>
            <SettingsSection id="corrections" index={9} title="Catalog corrections" meta="Fix a wrong or outdated catalog fact, with the source you checked. Also listed on Sources & Sync.">
              <CorrectionsPanel items={view.corrections} resorts={view.resorts} units={p.units} now={view.now} tz={tz} demo={demo} />
            </SettingsSection>
          </ScrollRise>
          <ScrollRise>
            <SettingsSection id="appearance" index={10} title="Appearance & data" meta="Light or dark, and live or demo data.">
              <AppearancePanel theme={theme} mode={view.mode} />
            </SettingsSection>
          </ScrollRise>
          <ScrollRise>
            <SettingsSection id="export" index={11} title="Export & backup" meta="Your records are yours — take them anywhere.">
              <ExportPanel demo={demo} />
            </SettingsSection>
          </ScrollRise>
          <ScrollRise>
            <SettingsSection id="access" index={12} title="Sign-in" meta="Optional passcode protection for a Piste reachable from other devices.">
              <AccessPanel access={access} tz={tz} />
            </SettingsSection>
          </ScrollRise>
        </div>
      </div>
    </>
  )
}
