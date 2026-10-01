'use client'
/**
 * Application frame (Glass HUD).
 * - ≥768px: a sticky top bar — PISTE wordmark, a glass navigation pill whose dark active chip glides between items
 *   (shared layoutId, ~200ms), and the home position with Sources, Settings and alerts.
 * - <768px: sticky glass top bar + glass bottom navigation (Today, Explore, Forecast, Trips, More).
 * Content sits on the sky gradient (body background); pages use glass panels.
 */
import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, MotionConfig } from 'motion/react'
import { Bell, Ellipsis, FlaskConical } from 'lucide-react'
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
  /** "42.44°N 76.50°W" */
  homeCoords: string
  todayLabel: string
  unreadAlerts: number
  children: ReactNode
}

export function Wordmark() {
  return <span className="text-[20px] leading-none font-semibold tracking-[0.22em] text-ink">PISTE</span>
}

function PillLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex h-10 items-center rounded-full px-3.5 text-[14px] font-medium whitespace-nowrap outline-offset-2 transition-colors duration-150 lg:px-4',
        active ? 'text-on-ink-chip' : 'text-ink-2 hover:text-ink',
      )}
    >
      {active ? <motion.span layoutId="pill-active" transition={t.select} className="absolute inset-0 rounded-full bg-ink-chip" aria-hidden /> : null}
      <span className="relative">{item.short ?? item.label}</span>
    </Link>
  )
}

function UtilityLink({ item, active, badge }: { item: NavItem; active: boolean; badge?: number }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      aria-label={item.label}
      title={item.label}
      className={cn(
        'glass-strong relative flex size-10 items-center justify-center rounded-full transition-colors duration-150',
        active ? 'text-teal' : 'text-ink-2 hover:text-ink',
      )}
    >
      <item.Icon aria-hidden className="size-[18px]" strokeWidth={1.8} />
      {badge ? <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-surface bg-copper" aria-hidden /> : null}
    </Link>
  )
}

function DemoBanner({ todayLabel }: { todayLabel: string }) {
  const pathname = usePathname()
  return (
    <form
      action={setMode.bind(null, 'live', pathname)}
      role="region"
      aria-label="Demo mode notice"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-demo/30 bg-demo-bg px-4 py-2 text-[13px] text-ink md:px-12"
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

export function AppShell({ mode, seasonLabel, homeName, homeCoords, todayLabel, unreadAlerts, children }: ShellProps) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = MOBILE_MORE.some((i) => i.match(pathname))

  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <a href="#main" className="sr-only-focusable fixed top-2 left-2 z-[70] rounded-md bg-teal px-3 py-2 text-on-teal">
          Skip to content
        </a>
        <div className="flex min-h-dvh min-w-0 flex-col">
          {/* Desktop / tablet top bar */}
          <header className="relative z-30 hidden md:block">
            <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-5 gap-y-3 px-8 pt-6 lg:px-12">
              <Link href="/" className="rounded-md" aria-label="Piste — Today">
                <Wordmark />
              </Link>
              <nav aria-label="Main" className="glass flex gap-0.5 rounded-full p-[5px]">
                {PRIMARY_NAV.map((item) => (
                  <PillLink key={item.href} item={item} active={item.match(pathname)} />
                ))}
              </nav>
              <div className="flex items-center gap-2.5">
                <span className="hud hidden text-ink-2 xl:inline" title={`Home: ${homeName} · season ${seasonLabel}`}>
                  {homeName} · {homeCoords}
                </span>
                {unreadAlerts > 0 ? (
                  <Link
                    href="/#alerts"
                    aria-label={`${unreadAlerts} unread ${unreadAlerts === 1 ? 'alert' : 'alerts'}`}
                    className="glass-strong relative flex size-10 items-center justify-center rounded-full text-copper"
                  >
                    <Bell aria-hidden className="size-[18px]" strokeWidth={1.8} />
                    <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-surface bg-copper" aria-hidden />
                  </Link>
                ) : null}
                {UTILITY_NAV.map((item) => (
                  <UtilityLink key={item.href} item={item} active={item.match(pathname)} />
                ))}
              </div>
            </div>
          </header>

          {/* Mobile top bar */}
          <header className="glass sticky top-0 z-30 flex h-14 items-center justify-between rounded-none border-x-0 border-t-0 px-4 md:hidden">
            <Link href="/" aria-label="Piste — Today" className="rounded-md">
              <Wordmark />
            </Link>
            <span className="hud text-ink-2">
              {seasonLabel} · {homeName}
            </span>
          </header>
          {mode === 'demo' ? <DemoBanner todayLabel={todayLabel} /> : null}
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1440px] min-w-0 flex-1 px-4 pt-6 pb-28 outline-none md:px-8 md:pt-8 md:pb-16 lg:px-12">
            {children}
          </main>
        </div>

        {/* Mobile bottom navigation */}
        <nav aria-label="Main" className="glass safe-bottom fixed inset-x-0 bottom-0 z-40 rounded-none border-x-0 border-b-0 md:hidden">
          <ul className="grid h-16 grid-cols-5">
            {MOBILE_PRIMARY.map((item) => {
              const active = item.match(pathname)
              return (
                <li key={item.href} className="relative">
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn('flex h-full flex-col items-center justify-center gap-1 text-[12px] font-medium', active ? 'text-ink' : 'text-ink-2')}
                  >
                    {active ? (
                      <motion.span layoutId="bottom-active" transition={t.select} aria-hidden className="absolute top-0 h-[3px] w-10 rounded-b-full bg-ink-chip" />
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
                className={cn('flex h-full w-full flex-col items-center justify-center gap-1 text-[12px] font-medium', moreActive ? 'text-ink' : 'text-ink-2')}
              >
                {moreActive ? <span aria-hidden className="absolute top-0 h-[3px] w-10 rounded-b-full bg-ink-chip" /> : null}
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
                  className="flex h-12 items-center gap-3 rounded-[12px] px-3 text-[15px] font-medium text-ink hover:bg-surface-3"
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
                    'flex h-12 items-center gap-3 rounded-[12px] px-3 text-[15px] font-medium',
                    item.match(pathname) ? 'bg-glacier text-teal' : 'text-ink hover:bg-surface-3',
                  )}
                >
                  <item.Icon aria-hidden className="size-5" strokeWidth={1.8} />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="hud mt-3 px-3 text-ink-2">
            {homeName} · {homeCoords} · {todayLabel}
          </p>
        </Sheet>
      </ToastProvider>
    </MotionConfig>
  )
}
