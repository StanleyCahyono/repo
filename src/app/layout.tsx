import type { Metadata, Viewport } from 'next'
import { count, isNull } from 'drizzle-orm'
import './globals.css'
import { geist, geistMono } from './fonts'
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
    { media: '(prefers-color-scheme: light)', color: '#e4eef7' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1622' },
  ],
}

/** "42.44°N 76.50°W" */
function coords(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx()
  const [{ n }] = await ctx.db.select({ n: count() }).from(alerts).where(isNull(alerts.readAt))
  const theme = ctx.prefs.theme
  return (
    <html
      lang="en"
      data-theme={theme === 'system' ? undefined : theme}
      className={`${geist.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <AppShell
          mode={ctx.mode}
          seasonLabel={ctx.prefs.activeSeasonId.replace('-', '–')}
          homeName={ctx.prefs.homeName}
          homeCoords={coords(ctx.prefs.homeLat, ctx.prefs.homeLon)}
          todayLabel={formatInstant(ctx.now, ctx.prefs.homeTimezone, 'ccc d LLL yyyy')}
          unreadAlerts={n}
        >
          {children}
        </AppShell>
      </body>
    </html>
  )
}
