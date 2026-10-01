/** next/dynamic for the single-file build: React.lazy behind a Suspense boundary with the optional loading UI. */
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'

type Loader<P> = () => Promise<ComponentType<P> | { default: ComponentType<P> }>

interface Options {
  ssr?: boolean
  loading?: (props: { error?: Error | null; isLoading?: boolean; pastDelay?: boolean }) => ReactNode
}

export default function dynamic<P extends object>(loader: Loader<P>, options: Options = {}): ComponentType<P> {
  const Lazy = lazy(async () => {
    const mod = await loader()
    return { default: (typeof mod === 'function' ? mod : (mod as { default: ComponentType<P> }).default) as ComponentType<P> }
  })
  const Loading = options.loading
  function Dynamic(props: P) {
    return (
      <Suspense fallback={Loading ? <Loading isLoading pastDelay error={null} /> : null}>
        <Lazy {...(props as P & object)} />
      </Suspense>
    )
  }
  return Dynamic
}
