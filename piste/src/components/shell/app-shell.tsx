'use client'
/**
 * Application frame.
 * - ≥1280px: 232px navigation rail with labels, utility area and data-mode card.
 * - 768–1279px: compact 76px rail (icon + short label).
 * - <768px: sticky top bar + bottom navigation (Today, Explore, Forecast, Trips, More).
 * The active indicator glides between items (shared layoutId, ~200ms).
 */
import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, MotionConfig } from 'motion/react'
import { Bell, Ellipsis, FlaskConical, Radio } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { Badge } from '@/components/ui/badge'
import { Sheet } from '@/components/ui/sheet'
import { ToastProvider } from '@/components/ui/toast'
import { PRIMARY_NAV, UTILITY_NAV, MOBILE_PRIMARY, MOBILE_MORE, type NavItem } from './nav'
import { setMode } from '@/lib/actions/mode'

export interface ShellProps {
  mode: 'live' | 'demo'
  seasonLabel: string
  homeName: string
  todayLabel: string
  unreadAlerts: number
  children: ReactNode
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" aria-hidden className="size-8 shrink-0">
        <rect width="32" height="32" rx="8" fill="var(--teal)" />
        <path d="M4 23.5 12.2 12l4.6 6 3.4-4.2L28 23.5" fill="none" stroke="var(--on-teal)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d="M12.2 12c1.6 3.2 1 6.4-1.6 11.5" fill="none" stroke="var(--on-teal)" strokeWidth="1.4" strokeDasharray="1.6 2.2" strokeLinecap="round" opacity=".85" />
      </svg>
      {compact ? null : <span className="font-display text-[26px] leading-none tracking-[0.01em] text-ink">Piste</span>}
    </span>
  )
}

function RailLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex rounded-[10px] font-medium outline-offset-0 transition-colors duration-150',
        'h-[58px] flex-col items-center justify-center gap-1 px-1 text-[12px]',
        'xl:h-10 xl:flex-row xl:justify-start xl:gap-3 xl:px-3 xl:text-[14.5px]',
        active ? 'text-teal' : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
      )}
    >
      {active ? <motion.span layoutId="rail-active" transition={t.select} className="absolute inset-0 rounded-[10px] bg-glacier" aria-hidden /> : null}
      <item.Icon aria-hidden className="relative size-5 shrink-0 xl:size-[18px]" strokeWidth={1.8} />
      <span className="relative truncate xl:hidden">{item.short ?? item.label}</span>
      <span className="relative hidden truncate xl:inline">{item.label}</span>
    </Link>
  )
}

function ModeCard({ mode, homeName, todayLabel }: { mode: 'live' | 'demo'; homeName: string; todayLabel: string }) {
  const pathname = usePathname()
  return (
    <form
      action={setMode.bind(null, mode === 'demo' ? 'live' : 'demo', pathname)}
      className={cn(
        'rounded-[12px] border p-3 text-[12.5px] leading-snug',
        mode === 'demo' ? 'border-demo/40 bg-demo-bg text-ink' : 'border-divider bg-surface-2 text-ink-2',
      )}
    >
      <p className="flex items-center gap-1.5 font-semibold text-ink">
        {mode === 'demo' ? <FlaskConical aria-hidden className="size-3.5 text-demo" /> : <Radio aria-hidden className="size-3.5 text-positive" />}
        {mode === 'demo' ? 'Demo data' : 'Live data'}
      </p>
      <p className="mt-0.5">
        {homeName} · {todayLabel}
      </p>
      <button type="submit" className="mt-2 font-medium text-teal underline-offset-2 hover:underline">
        {mode === 'demo' ? 'Return to live data' : 'Explore demo mode'}
      </button>
    </form>
  )
}

function DemoBanner({ todayLabel }: { todayLabel: string }) {
  const pathname = usePathname()
  return (
    <form
      action={setMode.bind(null, 'live', pathname)}
      role="region"
      aria-label="Demo mode notice"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-demo/30 bg-demo-bg px-4 py-2 text-[13px] text-ink md:px-8"
    >
      <FlaskConical aria-hidden className="size-4 text-demo" />
      <p className="min-w-0 flex-1">
        <strong className="font-semibold">Demo mode.</strong> Simulated data for {todayLabel}. Nothing here is live, and it never mixes with your
        records, exports or alerts.
      </p>
      <button type="submit" className="font-semibold text-teal underline-offset-2 hover:underline">
        Switch to live
      </button>
    </form>
  )
}

export function AppShell({ mode, seasonLabel, homeName, todayLabel, unreadAlerts, children }: ShellProps) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = MOBILE_MORE.some((i) => i.match(pathname))

  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <a
          href="#main"
          className="sr-only-focusable fixed top-2 left-2 z-[70] rounded-md bg-teal px-3 py-2 text-on-teal"
        >
          Skip to content
        </a>
        <div className="min-h-dvh md:grid md:grid-cols-[76px_1fr] xl:grid-cols-[232px_1fr]">
          {/* Desktop / tablet rail */}
          <aside className="sticky top-0 hidden h-dvh flex-col border-r border-divider bg-surface md:flex" aria-label="Primary">
            <div className="flex h-[72px] items-center px-4 xl:px-5">
              <Link href="/" className="rounded-md" aria-label="Piste — Today">
                <span className="hidden xl:inline-flex">
                  <Wordmark />
                </span>
                <span className="inline-flex xl:hidden">
                  <Wordmark compact />
                </span>
              </Link>
            </div>
            <p className="eyebrow hidden px-5 pb-3 xl:block">Season {seasonLabel}</p>
            <nav aria-label="Main" className="flex flex-col gap-0.5 px-2 xl:px-3">
              {PRIMARY_NAV.map((item) => (
                <RailLink key={item.href} item={item} active={item.match(pathname)} />
              ))}
            </nav>
            <div className="mt-auto flex flex-col gap-0.5 px-2 pb-3 xl:px-3">
              <p className="eyebrow hidden px-3 pt-3 pb-1 xl:block">Utility</p>
              {UTILITY_NAV.map((item) => (
                <RailLink key={item.href} item={item} active={item.match(pathname)} />
              ))}
              <div className="mt-3 hidden xl:block">
                <ModeCard mode={mode} homeName={homeName} todayLabel={todayLabel} />
              </div>
            </div>
          </aside>

          <div className="flex min-w-0 flex-col">
            {/* Mobile top bar */}
            <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-divider bg-surface/95 px-4 backdrop-blur-sm md:hidden">
              <Link href="/" aria-label="Piste — Today" className="rounded-md">
                <Wordmark />
              </Link>
              <span className="text-[12.5px] text-ink-2">
                {seasonLabel} · {homeName}
              </span>
            </header>
            {mode === 'demo' ? <DemoBanner todayLabel={todayLabel} /> : null}
            <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1320px] flex-1 px-4 pt-6 pb-28 outline-none md:px-8 md:pt-8 md:pb-16">
              {children}
            </main>
          </div>
        </div>

        {/* Mobile bottom navigation */}
        <nav
          aria-label="Main"
          className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-divider bg-surface/97 backdrop-blur-sm md:hidden"
        >
          <ul className="grid h-16 grid-cols-5">
            {MOBILE_PRIMARY.map((item) => {
              const active = item.match(pathname)
              return (
                <li key={item.href} className="relative">
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn('flex h-full flex-col items-center justify-center gap-1 text-[12px] font-medium', active ? 'text-teal' : 'text-ink-2')}
                  >
                    {active ? (
                      <motion.span layoutId="bottom-active" transition={t.select} aria-hidden className="absolute top-0 h-[3px] w-10 rounded-b-full bg-teal" />
                    ) : null}
                    <item.Icon aria-hidden className="size-[22px]" strokeWidth={1.8} />
                    {item.short ?? item.label}
                  </Link>
                </li>
              )
            })}
            <li className="relative">
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-haspopup="dialog"
                aria-describedby={unreadAlerts > 0 ? 'more-unread' : undefined}
                className={cn('flex h-full w-full flex-col items-center justify-center gap-1 text-[12px] font-medium', moreActive ? 'text-teal' : 'text-ink-2')}
              >
                {moreActive ? <span aria-hidden className="absolute top-0 h-[3px] w-10 rounded-b-full bg-teal" /> : null}
                <span className="relative">
                  <Ellipsis aria-hidden className="size-[22px]" strokeWidth={1.8} />
                  {unreadAlerts > 0 ? <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-copper" aria-hidden /> : null}
                </span>
                More
                {/* Described, not named: the button's accessible name stays "More". */}
                {unreadAlerts > 0 ? (
                  <span id="more-unread" hidden>
                    {unreadAlerts} unread {unreadAlerts === 1 ? 'alert' : 'alerts'}
                  </span>
                ) : null}
              </button>
            </li>
          </ul>
        </nav>
        <Sheet open={moreOpen} onOpenChange={setMoreOpen} side="bottom" title="More">
          <ul className="flex flex-col gap-1 pb-2">
            {unreadAlerts > 0 ? (
              // The dot on "More" means unread alerts; say where they are instead of leaving it unexplained.
              <li>
                <Link
                  href="/#alerts"
                  onClick={() => setMoreOpen(false)}
                  className="flex h-12 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium text-ink hover:bg-surface-3"
                >
                  <Bell aria-hidden className="size-5 text-copper" strokeWidth={1.8} />
                  Unread alerts
                  <Badge tone="copper" className="tnum ml-auto">
                    {unreadAlerts}
                  </Badge>
                </Link>
              </li>
            ) : null}
            {MOBILE_MORE.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={item.match(pathname) ? 'page' : undefined}
                  className={cn(
                    'flex h-12 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium',
                    item.match(pathname) ? 'bg-glacier text-teal' : 'text-ink hover:bg-surface-3',
                  )}
                >
                  <item.Icon aria-hidden className="size-5" strokeWidth={1.8} />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <ModeCard mode={mode} homeName={homeName} todayLabel={todayLabel} />
          </div>
        </Sheet>
      </ToastProvider>
    </MotionConfig>
  )
}
