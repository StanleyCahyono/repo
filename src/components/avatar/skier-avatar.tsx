'use client'
/**
 * <SkierAvatar/>: the user's 3D skier (see skier-scene.ts). three.js and the body model load only once the avatar
 * scrolls near the viewport; rendering pauses offscreen and in hidden tabs. Reduced motion shows a still, lit pose.
 * Without WebGL, or when the model cannot load, a labelled still state takes its place (text alternative included).
 */
import { useEffect, useRef, useState } from 'react'
import { assetUrl } from '@/lib/ui/assets'
import { cn } from '@/lib/ui/cn'
import { DEFAULT_SKIER, type SkierOptions, type SkierScene } from './skier-scene'

export function SkierAvatar({ label, className, ...opts }: Partial<SkierOptions> & { label: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<SkierScene | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const merged: SkierOptions = { ...DEFAULT_SKIER, ...opts }
  const key = JSON.stringify(merged)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let cancelled = false
    let started = false
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting)
        scene.current?.setVisible(visible)
        if (!visible || started) return
        started = true
        setState('loading')
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
        import('./skier-scene')
          .then(({ SkierScene }) => SkierScene.create(el, assetUrl('skier-body.glb'), JSON.parse(key) as SkierOptions, reduced))
          .then((s) => {
            if (cancelled) return s.dispose()
            scene.current = s
            setState('ready')
          })
          .catch((e) => {
            console.warn('Skier avatar unavailable', e)
            if (!cancelled) setState('failed')
          })
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => {
      cancelled = true
      io.disconnect()
      scene.current?.dispose()
      scene.current = null
    }
    // The scene is built once; option changes go through setOptions below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    scene.current?.setOptions(JSON.parse(key) as SkierOptions)
  }, [key])

  return (
    <div
      ref={host}
      role="img"
      aria-label={label}
      className={cn('relative h-full w-full', merged.drag && 'cursor-grab touch-pan-y active:cursor-grabbing', className)}
    >
      {state !== 'ready' ? (
        <div className="hud absolute inset-0 flex items-center justify-center text-ink-2" aria-hidden>
          {state === 'failed' ? 'Avatar unavailable on this device' : 'Loading avatar…'}
        </div>
      ) : null}
    </div>
  )
}
