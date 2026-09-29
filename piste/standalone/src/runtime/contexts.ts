import { createContext } from 'react'
import type { AppUrl } from './url'

/** The URL the app hooks (usePathname, useSearchParams) report. Provided by the React root. */
export const UrlContext = createContext<AppUrl | null>(null)

/** Dynamic route params of the rendered route (useParams). */
export const ParamsContext = createContext<Record<string, string>>({})
