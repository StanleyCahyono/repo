'use client'
/**
 * "You" — the skier profile at the top of My Season: the 3D avatar on its glass stage (drag or the turn buttons to
 * rotate it; suit or hologram look; pose chips) and the Wearing panel (a colour per slot, backpack and poles).
 *
 * Avatar state lives in <ProfileProvider/>: changes apply to the avatar at once and are saved shortly after (one
 * request per burst of clicks). The gear locker shares it to put owned items on the avatar. Celebrations come from
 * the season UI (a ski day logged, a skill confirmed, gear added): the skier celebrates and a HUD caption shows.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, RotateCcw, RotateCw, Undo2 } from 'lucide-react'
import { SkierAvatar } from '@/components/avatar/skier-avatar'
import { sceneColors, SLOT_LABEL, SLOT_SWATCHES, swatchName } from '@/components/avatar/presets'
import type { SkierState } from '@/components/avatar/skier-scene'
import { useToast } from '@/components/ui/toast'
import { resetAvatar, saveAvatar, type AvatarInput } from '@/lib/actions/gear'
import { AVATAR_SLOTS, type AvatarPrefs, type AvatarSlot } from '@/lib/db/schema'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { assetUrl } from '@/lib/ui/assets'
import { useSeasonUi } from './season-ui'

export interface WornItem {
  id: number
  brandModel: string
}

interface ProfileApi {
  avatar: AvatarPrefs
  /** Apply now, save shortly after. */
  update: (patch: AvatarInput) => void
  /** Replace with what the server returned (after wearing / adding gear). */
  replace: (a: AvatarPrefs) => void
  /** Locker items by id, for "from your locker" labels. */
  items: Map<number, WornItem>
}

const Ctx = createContext<ProfileApi | null>(null)

export function useProfile(): ProfileApi {
  const c = useContext(Ctx)
  if (!c) throw new Error('useProfile must be used inside <ProfileProvider>')
  return c
}

function applyPatch(a: AvatarPrefs, p: AvatarInput): AvatarPrefs {
  const wearing = { ...a.wearing }
  for (const k of Object.keys(p.colors ?? {}) as AvatarSlot[]) delete wearing[k]
  if (p.backpack === false) delete wearing.backpack
  if (p.poles === false) delete wearing.poles
  return {
    look: p.look ?? a.look,
    colors: { ...a.colors, ...(p.colors ?? {}) },
    backpack: p.backpack ?? a.backpack,
    poles: p.poles ?? a.poles,
    wearing,
  }
}

export function ProfileProvider({ initial, items, children }: { initial: AvatarPrefs; items: WornItem[]; children: ReactNode }) {
  const toast = useToast()
  const [avatar, setAvatar] = useState(initial)
  const [seen, setSeen] = useState(initial)
  const pending = useRef<AvatarInput | null>(null)
  const [dirty, setDirty] = useState(false)
  const timer = useRef<number | null>(null)

  // A fresh server value (after a save or another tab) wins unless a local change is still waiting to be saved.
  if (seen !== initial && JSON.stringify(seen) !== JSON.stringify(initial)) {
    setSeen(initial)
    if (!dirty) setAvatar(initial)
  }

  const flush = useCallback(async () => {
    timer.current = null
    const patch = pending.current
    pending.current = null
    if (!patch) return
    const r = await saveAvatar(patch)
    if (!pending.current) setDirty(false)
    if (!r.ok) toast.show(`Avatar not saved: ${r.error}`, { tone: 'error' })
  }, [toast])

  const update = useCallback(
    (patch: AvatarInput) => {
      setAvatar((a) => applyPatch(a, patch))
      setDirty(true)
      const prev = pending.current ?? {}
      pending.current = {
        ...prev,
        ...patch,
        colors: { ...(prev.colors ?? {}), ...(patch.colors ?? {}) },
      }
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void flush(), 450)
    },
    [flush],
  )

  useEffect(
    () => () => {
      if (timer.current) {
        window.clearTimeout(timer.current)
        void flush()
      }
    },
    [flush],
  )

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const api = useMemo(() => ({ avatar, update, replace: setAvatar, items: byId }), [avatar, update, byId])
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

// ---------------------------------------------------------------------------
// Stage

type Pose = 'auto' | 'carve' | 'celebrate' | 'sleep'
const POSES: { value: Pose; label: string }[] = [
  { value: 'auto', label: 'Idle' },
  { value: 'carve', label: 'Carve' },
  { value: 'celebrate', label: 'Celebrate' },
  { value: 'sleep', label: 'Offseason' },
]

const chip = (on: boolean) =>
  cn(
    'inline-flex h-11 items-center justify-center gap-1.5 rounded-full border text-[13px] font-medium whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px md:h-10',
    on ? 'border-ink-chip bg-ink-chip text-on-ink-chip' : 'border-[var(--glass-edge)] bg-glass-strong text-ink hover:border-teal hover:text-teal',
  )

const TURN =
  'max-sm:hidden inline-flex size-11 items-center justify-center rounded-full border border-[var(--glass-edge)] bg-glass-strong text-ink transition-colors duration-150 hover:border-teal hover:text-teal active:translate-y-px md:size-10'

function Bracket({ className }: { className: string }) {
  return <span aria-hidden className={cn('pointer-events-none absolute size-5 border-teal/50', className)} />
}

/** Snow-burst particles for a celebration (decoration; skipped under reduced motion). */
function Burst({ seq }: { seq: number }) {
  const parts = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => {
        const a = (i / 22) * Math.PI * 2 + (seq % 7) * 0.3
        const r = 90 + ((i * 37 + seq * 13) % 70)
        return {
          x: Math.cos(a) * r,
          y: Math.sin(a) * r * 0.7 - 30,
          s: 4 + ((i * 7) % 5),
          d: (i % 5) * 0.03,
        }
      }),
    [seq],
  )
  return (
    <div aria-hidden className="pointer-events-none absolute top-[42%] left-1/2">
      {parts.map((p, i) => (
        <motion.span
          key={i}
          className={cn('absolute rounded-full', i % 3 === 0 ? 'bg-copper' : 'bg-teal', i % 4 === 0 && 'bg-surface ring-1 ring-teal/40')}
          style={{
            width: p.s,
            height: p.s,
            marginLeft: -p.s / 2,
            marginTop: -p.s / 2,
          }}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
          animate={{
            x: p.x,
            y: [0, p.y, p.y + 60],
            opacity: [0, 1, 0],
            scale: [0.4, 1, 0.8],
          }}
          transition={{
            duration: 1.6,
            delay: p.d,
            ease: [0.22, 0.8, 0.26, 1],
            times: [0, 0.45, 1],
          }}
        />
      ))}
    </div>
  )
}

export function ProfileStage({ ability, caption }: { ability: string; caption: string }) {
  const { avatar, update } = useProfile()
  const { celebration } = useSeasonUi()
  const reduce = useReducedMotion()
  const [pose, setPose] = useState<Pose>('auto')
  const [yaw, setYaw] = useState(0)
  const state: SkierState = celebration ? 'celebrate' : pose
  const label = `Your skier avatar (${ability}), ${avatar.look === 'holo' ? 'hologram' : 'ski suit'} look, ${POSES.find((p) => p.value === state)?.label.toLowerCase() ?? 'idle'}. Drag sideways or use the turn buttons to rotate it.`

  return (
    <div className="relative h-[460px] overflow-hidden rounded-[36px] border border-[var(--glass-edge)] shadow-[inset_0_1px_0_var(--glass-shine),var(--glass-shadow-lg)] sm:h-[520px] lg:h-[560px]">
      {/* Stage light: a soft pool behind the skier, a faint Matterhorn ridge, a horizon line. */}
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_70%,var(--glass-strong),var(--glass-soft)_70%)]" />
      {/* eslint-disable-next-line @next/next/no-img-element -- a bundled local asset (also inlined in the single-file build) */}
      <img
        src={assetUrl('matterhorn-duo.webp')}
        alt=""
        aria-hidden
        decoding="async"
        className="pointer-events-none absolute top-6 left-[-10%] w-[120%] max-w-none opacity-[0.14] mix-blend-luminosity dark:opacity-[0.1]"
      />
      <div aria-hidden className="absolute inset-x-8 bottom-[22%] h-px bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--teal)_35%,transparent),transparent)]" />
      <Bracket className="top-4 left-4 rounded-tl-[10px] border-t border-l" />
      <Bracket className="top-4 right-4 rounded-tr-[10px] border-t border-r max-sm:hidden" />
      <Bracket className="bottom-4 left-4 rounded-bl-[10px] border-b border-l max-sm:hidden" />
      <Bracket className="right-4 bottom-4 rounded-br-[10px] border-r border-b max-sm:hidden" />

      <div className="absolute inset-0">
        <SkierAvatar label={label} {...sceneColors(avatar)} state={state} drag distance={6.3} yaw={yaw} rim="#2a9fd6" />
      </div>

      <div className="hud pointer-events-none absolute top-7 left-8 flex flex-col gap-1 text-ink-2">
        <span className="text-ink">Skier · {ability}</span>
        <span className="max-sm:hidden">{caption}</span>
        <span className="max-sm:hidden">Drag to turn</span>
      </div>

      <div role="radiogroup" aria-label="Avatar look" className="glass-strong absolute top-4 right-4 flex gap-1 rounded-full p-1">
        {(['suit', 'holo'] as const).map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={avatar.look === l}
            onClick={() => update({ look: l })}
            className={cn('h-9 rounded-full px-3.5 text-[13px] font-medium transition-colors duration-150', avatar.look === l ? 'bg-ink-chip text-on-ink-chip' : 'text-ink-2 hover:text-ink')}
          >
            {l === 'suit' ? 'Suit' : 'Hologram'}
          </button>
        ))}
      </div>

      <AnimatePresence>
        {celebration ? (
          <motion.div key={celebration.seq} className="pointer-events-none absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={t.pageIn}>
            {reduce ? null : <Burst seq={celebration.seq} />}
            <motion.p
              role="status"
              initial={{ y: -10, scale: 0.96 }}
              animate={{ y: 0, scale: 1 }}
              transition={t.spring}
              className="hud absolute top-[68px] left-1/2 m-0 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink-chip px-4 py-2 whitespace-nowrap text-on-ink-chip shadow-overlay"
            >
              <Check aria-hidden className="size-4" /> {celebration.label}
            </motion.p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-center gap-1.5 sm:inset-x-4 sm:bottom-4">
        <button type="button" aria-label="Turn the avatar left" onClick={() => setYaw((y) => y - Math.PI / 4)} className={TURN}>
          <RotateCcw aria-hidden className="size-4 shrink-0" />
        </button>
        <div role="radiogroup" aria-label="Avatar pose" className="contents">
          {POSES.map((p) => (
            <button key={p.value} type="button" role="radio" aria-checked={pose === p.value} onClick={() => setPose(p.value)} className={cn(chip(pose === p.value), 'px-3 sm:px-4')}>
              {p.label}
            </button>
          ))}
        </div>
        <button type="button" aria-label="Turn the avatar right" onClick={() => setYaw((y) => y + Math.PI / 4)} className={TURN}>
          <RotateCw aria-hidden className="size-4 shrink-0" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Wearing panel

/** Tick colour that reads on a swatch (paint colours, not theme tokens). */
function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#13202c' : '#ffffff'
}

export function WearingPanel() {
  const { avatar, update, replace, items } = useProfile()
  const toast = useToast()
  const [slot, setSlot] = useState<AvatarSlot>('jacket')
  const worn = avatar.wearing[slot] != null ? items.get(avatar.wearing[slot]!) : undefined
  const swatches = SLOT_SWATCHES[slot]
  const current = avatar.colors[slot]
  const custom = !swatches.some((s) => s.hex.toLowerCase() === current.toLowerCase())
  const hidden = (slot === 'backpack' && !avatar.backpack) || (slot === 'poles' && !avatar.poles)

  return (
    <section aria-labelledby="wearing-title" className="glass flex flex-col gap-4 rounded-[28px] px-5 py-5 sm:px-[22px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="wearing-title" className="hud m-0 tracking-[0.14em] text-ink-2">
          Wearing
        </h2>
        <p className="m-0 text-[12.5px] text-ink-2">Stylised only. Nothing leaves this device.</p>
      </div>

      <div role="tablist" aria-label="What to colour" className="-mx-1 flex flex-wrap gap-1.5 px-1">
        {AVATAR_SLOTS.map((s) => {
          const on = s === slot
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls="wearing-swatches"
              onClick={() => setSlot(s)}
              className={cn(
                'relative inline-flex h-11 items-center gap-2 rounded-full px-3 text-[13px] font-medium transition-colors duration-150 md:h-9',
                on ? 'text-on-ink-chip' : 'text-ink-2 hover:text-ink',
              )}
            >
              {on ? <motion.span layoutId="wearing-slot" transition={t.select} aria-hidden className="absolute inset-0 rounded-full bg-ink-chip" /> : null}
              <span aria-hidden className="relative size-3 rounded-full ring-1 ring-[color-mix(in_srgb,var(--ink)_25%,transparent)]" style={{ backgroundColor: avatar.colors[s] }} />
              <span className="relative">{SLOT_LABEL[s]}</span>
              {avatar.wearing[s] != null ? <span aria-label="(from your locker)" className="relative size-1.5 rounded-full bg-copper" /> : null}
            </button>
          )
        })}
      </div>

      <div id="wearing-swatches" role="tabpanel" aria-label={`${SLOT_LABEL[slot]} colour`} className="flex flex-col gap-3">
        <div role="radiogroup" aria-label={`${SLOT_LABEL[slot]} colour`} className="flex flex-wrap gap-2.5">
          {swatches.map((s) => {
            const on = s.hex.toLowerCase() === current.toLowerCase()
            return (
              <motion.button
                key={s.hex}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={`${SLOT_LABEL[slot]}: ${s.name}`}
                onClick={() => update({ colors: { [slot]: s.hex } })}
                whileHover={{ y: -2, scale: 1.06 }}
                whileTap={{ scale: 0.94 }}
                transition={t.hover}
                className={cn(
                  'relative size-11 rounded-full border shadow-[inset_0_2px_4px_rgb(255_255_255/0.4),inset_0_-3px_6px_rgb(0_0_0/0.12)]',
                  on ? 'border-transparent ring-[3px] ring-ink ring-offset-2 ring-offset-[var(--surface)]' : 'border-[color-mix(in_srgb,var(--ink)_18%,transparent)]',
                )}
                style={{ backgroundColor: s.hex }}
              >
                {on ? <Check aria-hidden className="absolute inset-0 m-auto size-4" style={{ color: inkOn(s.hex) }} strokeWidth={2.6} /> : null}
              </motion.button>
            )
          })}
        </div>
        <p className="m-0 min-h-5 text-[12.5px] text-ink-2">
          {worn ? (
            <>
              From your locker: <span className="font-medium text-ink">{worn.brandModel}</span>
            </>
          ) : (
            <>
              {SLOT_LABEL[slot]}: {custom ? 'custom colour' : swatchName(slot, current)}
            </>
          )}
          {hidden ? ' · hidden on the avatar' : ''}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={avatar.backpack} onClick={() => update({ backpack: !avatar.backpack })} className={cn(chip(avatar.backpack), 'px-4')}>
          Backpack
        </button>
        <button type="button" aria-pressed={avatar.poles} onClick={() => update({ poles: !avatar.poles })} className={cn(chip(avatar.poles), 'px-4')}>
          Poles
        </button>
        <button
          type="button"
          onClick={async () => {
            const before = avatar
            const r = await resetAvatar()
            if (!r.ok) return toast.show(r.error, { tone: 'error' })
            replace(r.data.avatar)
            toast.show('Avatar reset to the default look', {
              undo: async () => {
                const back = await saveAvatar({
                  look: before.look,
                  colors: before.colors,
                  backpack: before.backpack,
                  poles: before.poles,
                })
                if (back.ok) replace(back.data.avatar)
              },
            })
          }}
          className="ml-auto inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-ink-2 hover:text-teal md:h-10"
        >
          <Undo2 aria-hidden className="size-4" /> Reset look
        </button>
      </div>
    </section>
  )
}
