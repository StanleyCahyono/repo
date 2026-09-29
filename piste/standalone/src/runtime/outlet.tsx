/**
 * Rendering of a resolved route: each layout receives `<Outlet level={i} />` as its children; the outlet renders the
 * next level (child layout or page) wrapped in that level's error and not-found boundaries — the same nesting the
 * App Router uses (Layout > ErrorBoundary > NotFoundBoundary > child), keyed by segment so a new resort id remounts
 * the page like a new segment does in Next.
 */
import { Component, createContext, createElement, Fragment, useContext, type ComponentType, type ReactNode } from 'react'
import type { RouteNodeDef } from 'virtual:piste/routes'
import { isNotFoundError, isRedirectError } from './errors'
import type { ErrorComponent } from './route-types'
import { go, refresh } from './router'
import type { AppUrl } from './url'

export interface Resolved {
  id: number
  url: AppUrl
  chain: RouteNodeDef[]
  segments: string[]
  params: Record<string, string>
  /** Result of each chain node's layout (undefined when the node has none). */
  layouts: (ReactNode | undefined)[]
  page: ReactNode
  /** A loader-time notFound()/error replaces the content of Outlet(level). */
  cut: { level: number; element: ReactNode } | null
  /** Children of the root layout's <body>. */
  body: ReactNode
  html: { lang?: string; theme?: string; className?: string }
  title: string
  status: number
  redirect: { url: string; type: 'push' | 'replace' } | null
}

export const ResolvedContext = createContext<Resolved | null>(null)
/** While a slow navigation loads, Outlet(0) shows the target's loading.tsx instead. */
export const LoadingOverrideContext = createContext<ReactNode | null>(null)

function segmentKey(r: Resolved, level: number): string {
  if (level >= r.chain.length) return '__PAGE__'
  const n = r.chain[level]
  return n.kind === 'dynamic' || n.kind === 'catch-all' ? `${n.segment}=${r.segments[level]}` : n.segment
}

export function Outlet({ level }: { level: number }) {
  const r = useContext(ResolvedContext)
  const loading = useContext(LoadingOverrideContext)
  if (!r) return null
  if (level === 0 && loading) return <>{loading}</>
  const node = r.chain[level]
  let inner: ReactNode
  if (r.cut && r.cut.level === level) inner = <Fragment key={`cut:${level}`}>{r.cut.element}</Fragment>
  else if (level + 1 < r.chain.length) {
    const child = r.chain[level + 1]
    inner = <Fragment key={segmentKey(r, level + 1)}>{child.layout ? r.layouts[level + 1] : <Outlet level={level + 1} />}</Fragment>
  } else inner = <Fragment key="__PAGE__">{r.page}</Fragment>

  if (node?.notFound?.default) inner = <NotFoundBoundary fallback={createElement(node.notFound.default as ComponentType)}>{inner}</NotFoundBoundary>
  if (node?.error?.default) {
    inner = (
      <ErrorBoundary fallback={node.error.default as ErrorComponent} pathname={r.url.pathname}>
        {inner}
      </ErrorBoundary>
    )
  }
  return inner
}

// ---------------------------------------------------------------------------------------------------------------------

interface ErrorBoundaryProps {
  fallback: ErrorComponent
  pathname: string
  children: ReactNode
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, { error: Error | null; pathname: string }> {
  state = { error: null as Error | null, pathname: this.props.pathname }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: { error: Error | null; pathname: string }) {
    // A navigation to another page clears the error, like Next's boundary.
    if (props.pathname !== state.pathname) return { error: null, pathname: props.pathname }
    return null
  }

  render() {
    const { error } = this.state
    if (error) {
      if (isNotFoundError(error) || isRedirectError(error)) throw error
      const Fallback = this.props.fallback
      const reset = () => this.setState({ error: null })
      return <Fallback error={error} reset={reset} retry={() => void refresh().then(reset)} />
    }
    return this.props.children
  }
}

export class NotFoundBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (error) {
      if (isNotFoundError(error)) return this.props.fallback
      throw error
    }
    return this.props.children
  }
}

/** A client component that calls redirect() while rendering: navigate instead of crashing. */
export class RedirectBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  componentDidUpdate() {
    const { error } = this.state
    if (isRedirectError(error)) {
      this.setState({ error: null })
      void go(error.url, error.type)
    }
  }

  render() {
    const { error } = this.state
    if (error) {
      if (isRedirectError(error)) return null
      throw error
    }
    return this.props.children
  }
}
