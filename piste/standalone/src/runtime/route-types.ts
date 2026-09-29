import type { ComponentType, ReactNode } from 'react'

export type { RouteModule, RouteNodeDef, ApiRouteDef } from 'virtual:piste/routes'

export type ServerComponent = (props: Record<string, unknown>) => ReactNode | Promise<ReactNode>
export type ErrorComponent = ComponentType<{ error: Error & { digest?: string }; reset: () => void; retry: () => void }>
