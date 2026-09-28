import type { Metadata, Viewport } from 'next'
import { count, isNull } from 'drizzle-orm'
import './globals.css'
import { barlowCondensed, plexSans, plexMono } from './fonts'
import { AppShell } from '@/components/shell/app-shell'
import { getCtx } from '@/lib/context'
import { alerts } from '@/lib/db/schema'
import { formatInstant } from '@/lib/domain/time'

export const metadata: Metadata = {
  title: { default: 'Piste', template: '%s · Piste' },
  description: 'Personal ski planning and tracking for the 2026–27 season.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f5f1' },
    { media: '(prefers-color-scheme: dark)', color: '#0c1a24' },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx()
  const [{ n }] = await ctx.db.select({ n: count() }).from(alerts).where(isNull(alerts.readAt))
  const theme = ctx.prefs.theme
  return (
    <html
      lang="en"
      data-theme={theme === 'system' ? undefined : theme}
      className={`${barlowCondensed.variable} ${plexSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <AppShell
          mode={ctx.mode}
          seasonLabel={ctx.prefs.activeSeasonId.replace('-', '–')}
          homeName={ctx.prefs.homeName}
          todayLabel={formatInstant(ctx.now, ctx.prefs.homeTimezone, 'ccc d LLL yyyy')}
          unreadAlerts={n}
        >
          {children}
        </AppShell>
      </body>
    </html>
  )
}
