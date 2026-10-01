import { Sunrise, Compass, CloudSnow, Navigation, Route, Ticket, NotebookPen, RefreshCw, Settings2, type LucideIcon } from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  short?: string
  Icon: LucideIcon
  match: (path: string) => boolean
}

const starts = (prefix: string) => (p: string) => p === prefix || p.startsWith(prefix + '/')

export const PRIMARY_NAV: NavItem[] = [
  { href: '/', label: 'Today', Icon: Sunrise, match: (p) => p === '/' },
  { href: '/explore', label: 'Explore', Icon: Compass, match: (p) => starts('/explore')(p) || starts('/resorts')(p) },
  { href: '/forecast', label: 'Forecast', Icon: CloudSnow, match: starts('/forecast') },
  { href: '/ride', label: 'Ride there', Icon: Navigation, match: starts('/ride') },
  { href: '/trips', label: 'Trips', Icon: Route, match: starts('/trips') },
  { href: '/passes', label: 'Passes & Costs', short: 'Passes', Icon: Ticket, match: starts('/passes') },
  { href: '/season', label: 'My Season', short: 'Season', Icon: NotebookPen, match: starts('/season') },
]

export const UTILITY_NAV: NavItem[] = [
  { href: '/sources', label: 'Sources & Sync', short: 'Sources', Icon: RefreshCw, match: starts('/sources') },
  { href: '/settings', label: 'Settings', Icon: Settings2, match: starts('/settings') },
]

/** Mobile bottom bar: first four primary destinations + More. */
export const MOBILE_PRIMARY = PRIMARY_NAV.slice(0, 4)
export const MOBILE_MORE = [...PRIMARY_NAV.slice(4), ...UTILITY_NAV]
