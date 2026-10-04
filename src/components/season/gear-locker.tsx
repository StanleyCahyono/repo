'use client'
/**
 * Gear locker: what I own (type, brand and model as plain text, size, bought on, notes, an avatar colour and an
 * optional photo). Items can be worn by the avatar. The locker starts empty; until something is added every trip
 * budget counts gear as rental, and the own-vs-rent line says so.
 *
 * Photos are resized on this device (≤ 200 KB JPEG) and stored in the local database only.
 */
import { useId, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'motion/react'
import { Camera, Check, PencilLine, Plus, Shirt, Trash2, X } from 'lucide-react'
import { SLOT_LABEL, SLOT_SWATCHES } from '@/components/avatar/presets'
import { RENTAL_TEXT } from '@/components/settings/options'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Field, Select, TextInput, Textarea } from '@/components/ui/form'
import { Sheet } from '@/components/ui/sheet'
import { useToast } from '@/components/ui/toast'
import { deleteGear, restoreGear, saveGear, setWearing } from '@/lib/actions/gear'
import type { GearItemView } from '@/lib/data/gear'
import { GEAR_TYPES, type GearType } from '@/lib/db/schema'
import { GEAR_SLOT, GEAR_TYPE_LABEL, MAX_PHOTO_BYTES, dataUrlBytes, type GearCoverage, type RentalOption } from '@/lib/domain/gear'
import { formatLocalDate } from '@/lib/domain/time'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { useProfile } from './profile'
import { useSeasonUi } from './season-ui'
import { plural } from './format'

// ---------------------------------------------------------------------------
// Photo: resize on this device to a small JPEG data URL.

async function resizePhoto(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp|heic|heif|gif|avif)$/.test(file.type) && !file.type.startsWith('image/')) throw new Error('Choose an image file')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('This photo could not be read'))
      i.src = url
    })
    for (const max of [640, 480, 360]) {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.naturalWidth * k))
      c.height = Math.max(1, Math.round(img.naturalHeight * k))
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      for (const q of [0.82, 0.7, 0.58]) {
        const out = c.toDataURL('image/jpeg', q)
        if (dataUrlBytes(out) <= MAX_PHOTO_BYTES) return out
      }
    }
    throw new Error('This photo could not be made small enough')
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ---------------------------------------------------------------------------
// Form (add inline, edit in a sheet)

interface FormState {
  type: GearType
  brandModel: string
  size: string
  boughtOn: string
  notes: string
  color: string | null
  photo: string | null
  wear: boolean
}

const blank = (): FormState => ({
  type: 'skis',
  brandModel: '',
  size: '',
  boughtOn: '',
  notes: '',
  color: null,
  photo: null,
  wear: true,
})
const fromItem = (g: GearItemView): FormState => ({
  type: g.type,
  brandModel: g.brandModel,
  size: g.size ?? '',
  boughtOn: g.boughtOn ?? '',
  notes: g.notes ?? '',
  color: g.color,
  photo: g.photo,
  wear: g.worn,
})

function GearForm({ id, initial, itemId = null, onSaved, compact }: { id: string; initial: FormState; itemId?: number | null; onSaved: (created: boolean) => void; compact?: boolean }) {
  const { data } = useSeasonUi()
  const { replace } = useProfile()
  const toast = useToast()
  const [f, setF] = useState<FormState>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [photoBusy, setPhotoBusy] = useState(false)
  const [pending, start] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)
  const ids = {
    type: useId(),
    model: useId(),
    size: useId(),
    bought: useId(),
    notes: useId(),
    photo: useId(),
    wear: useId(),
  }
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }))
  const slot = GEAR_SLOT[f.type]

  return (
    <form
      id={id}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        if (!f.brandModel.trim()) {
          setErrors({ brandModel: 'Enter the brand and model' })
          return
        }
        start(async () => {
          setErrors({})
          const r = await saveGear({
            id: itemId,
            type: f.type,
            brandModel: f.brandModel,
            size: f.size,
            boughtOn: f.boughtOn || null,
            notes: f.notes,
            color: slot ? f.color : null,
            photo: f.photo,
            wear: !!slot && f.wear,
          })
          if (!r.ok) {
            setErrors(r.fieldErrors ?? { _: r.error })
            toast.show(r.error, { tone: 'error' })
            return
          }
          replace(r.data.avatar)
          toast.show(r.message ?? 'Saved')
          if (r.data.created) setF(blank())
          onSaved(r.data.created)
        })
      }}
      className="grid grid-cols-1 content-start gap-x-3 gap-y-4 sm:grid-cols-2"
    >
      <Field label="Type" htmlFor={ids.type} error={errors.type}>
        <Select
          id={ids.type}
          value={f.type}
          onChange={(e) =>
            setF((x) => ({
              ...x,
              type: e.target.value as GearType,
              color: GEAR_SLOT[e.target.value as GearType] === GEAR_SLOT[x.type] ? x.color : null,
            }))
          }
        >
          {GEAR_TYPES.map((g) => (
            <option key={g} value={g}>
              {GEAR_TYPE_LABEL[g]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Brand and model" htmlFor={ids.model} error={errors.brandModel} hint="Plain text — no logos.">
        <TextInput id={ids.model} value={f.brandModel} maxLength={120} autoComplete="off" onChange={(e) => set('brandModel', e.target.value)} aria-invalid={!!errors.brandModel} />
      </Field>
      <Field label="Size" htmlFor={ids.size} optional error={errors.size}>
        <TextInput
          id={ids.size}
          value={f.size}
          maxLength={40}
          placeholder={f.type === 'skis' ? 'e.g. 160 cm' : f.type === 'boots' ? 'e.g. 27.5 mondo' : ''}
          onChange={(e) => set('size', e.target.value)}
        />
      </Field>
      <Field label="Bought on" htmlFor={ids.bought} optional error={errors.boughtOn}>
        <DatePicker id={ids.bought} max={data.today} today={data.today} clearable placeholder="Not recorded" value={f.boughtOn} onChange={(v) => set('boughtOn', v)} aria-invalid={!!errors.boughtOn} />
      </Field>
      <Field label="Notes" htmlFor={ids.notes} optional error={errors.notes} className="sm:col-span-2">
        <Textarea id={ids.notes} rows={2} maxLength={1000} value={f.notes} onChange={(e) => set('notes', e.target.value)} className="min-h-16" />
      </Field>

      {slot ? (
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0 sm:col-span-2">
          <legend className="mb-2 text-[13.5px] font-medium text-ink">
            Colour on your skier <span className="font-normal text-ink-3">(optional)</span>
          </legend>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={f.color === null}
              onClick={() => set('color', null)}
              className={cn(
                'inline-flex h-9 items-center rounded-full border px-3 text-[12.5px] font-medium',
                f.color === null ? 'border-ink-chip bg-ink-chip text-on-ink-chip' : 'border-divider-strong text-ink-2 hover:text-ink',
              )}
            >
              No colour
            </button>
            {SLOT_SWATCHES[slot].map((s) => {
              const on = f.color?.toLowerCase() === s.hex.toLowerCase()
              return (
                <button
                  key={s.hex}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${SLOT_LABEL[slot]} colour: ${s.name}`}
                  onClick={() => set('color', s.hex)}
                  className={cn(
                    'size-9 rounded-full border transition-transform duration-150 hover:-translate-y-0.5',
                    on ? 'border-transparent ring-[3px] ring-ink ring-offset-2 ring-offset-[var(--surface)]' : 'border-[color-mix(in_srgb,var(--ink)_18%,transparent)]',
                  )}
                  style={{ backgroundColor: s.hex }}
                />
              )
            })}
          </div>
          <label htmlFor={ids.wear} className="mt-1 flex min-h-11 cursor-pointer items-center gap-3 text-[14px] text-ink">
            <input id={ids.wear} type="checkbox" checked={f.wear} onChange={(e) => set('wear', e.target.checked)} className="size-5 shrink-0 accent-[var(--teal)]" />
            Wear it on my skier
          </label>
        </fieldset>
      ) : (
        <p className="m-0 text-[12.5px] text-ink-2 sm:col-span-2">
          {GEAR_TYPE_LABEL[f.type]} {f.type === 'other' ? 'items are' : 'is'} kept in the locker but not drawn on the avatar.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <input
          ref={fileRef}
          id={ids.photo}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            setPhotoBusy(true)
            try {
              set('photo', await resizePhoto(file))
              setErrors((x) => ({ ...x, photo: '' }))
            } catch (err) {
              setErrors((x) => ({
                ...x,
                photo: err instanceof Error ? err.message : 'This photo could not be used',
              }))
            } finally {
              setPhotoBusy(false)
            }
          }}
        />
        {f.photo ? (
          <span className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL made on this device */}
            <img src={f.photo} alt="Photo of this item" className="size-14 rounded-[12px] object-cover" />
            <button
              type="button"
              aria-label="Remove the photo"
              onClick={() => set('photo', null)}
              className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full bg-ink-chip text-on-ink-chip"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
        ) : null}
        <label
          htmlFor={ids.photo}
          className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-divider-strong px-4 text-[13.5px] font-medium text-ink hover:border-teal hover:text-teal focus-within:outline-2 md:h-10"
        >
          <Camera aria-hidden className="size-4" /> {photoBusy ? 'Resizing…' : f.photo ? 'Change photo' : 'Add a photo'}
        </label>
        <span className="text-[12.5px] text-ink-2">Optional · resized and kept on this device</span>
        {errors.photo ? (
          <p role="alert" className="m-0 w-full text-[12.5px] font-medium text-critical">
            {errors.photo}
          </p>
        ) : null}
        {!compact ? (
          <Button type="submit" variant="primary" size="lg" disabled={pending || photoBusy} className="ml-auto">
            <Plus aria-hidden className="size-4" /> {pending ? 'Adding…' : 'Add to locker'}
          </Button>
        ) : null}
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Items

function GearCard({ g, onEdit, index }: { g: GearItemView; onEdit: (g: GearItemView, el: HTMLElement) => void; index: number }) {
  const toast = useToast()
  const { replace, avatar } = useProfile()
  const [pending, start] = useTransition()
  const worn = g.slot != null && avatar.wearing[g.slot] === g.id
  const meta = [g.typeLabel, g.size ? `Size ${g.size}` : null, g.boughtOn ? `Bought ${formatLocalDate(g.boughtOn, 'd LLL yyyy')}` : null].filter(Boolean).join(' · ')
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      whileHover={{ y: -3 }}
      transition={{ ...t.pageIn, delay: Math.min(index, 4) * 0.04 }}
      className="list-none"
    >
      <article
        aria-label={`${g.typeLabel}: ${g.brandModel}`}
        className="flex h-full flex-col gap-3 rounded-[20px] border border-[var(--glass-edge)] bg-glass-strong p-3.5 shadow-[0_10px_30px_-18px_rgb(19_32_44/0.4)]"
      >
        <div className="flex min-w-0 items-start gap-3">
          {g.photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local data URL made on this device
            <img src={g.photo} alt="" className="size-14 shrink-0 rounded-[12px] object-cover" />
          ) : (
            <span aria-hidden className="relative flex size-14 shrink-0 items-center justify-center rounded-[12px] bg-glacier font-mono text-[11px] font-semibold tracking-[0.08em] text-teal">
              {g.code}
              {g.color ? (
                <span className="absolute right-1.5 bottom-1.5 size-2.5 rounded-full ring-1 ring-[color-mix(in_srgb,var(--ink)_25%,transparent)]" style={{ backgroundColor: g.color }} />
              ) : null}
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h3 className="m-0 truncate text-[14.5px] font-semibold text-ink" title={g.brandModel}>
              {g.brandModel}
            </h3>
            <p className="hud m-0 text-[11px] leading-snug tracking-[0.08em] text-ink-2">{meta}</p>
            {g.notes ? <p className="m-0 mt-1 line-clamp-2 text-[12.5px] text-ink-2">{g.notes}</p> : null}
          </div>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          {g.slot ? (
            <button
              type="button"
              aria-pressed={worn}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await setWearing({ id: g.id, wear: !worn })
                  if (!r.ok) return toast.show(r.error, { tone: 'error' })
                  replace(r.data.avatar)
                })
              }
              className={cn(
                'inline-flex h-11 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors duration-150 md:h-9',
                worn ? 'border-teal/40 bg-glacier text-teal' : 'border-divider-strong text-ink hover:border-teal hover:text-teal',
              )}
            >
              {worn ? <Check aria-hidden className="size-3.5" /> : <Shirt aria-hidden className="size-3.5" />}
              {worn ? 'Wearing' : 'Wear'}
            </button>
          ) : (
            <span className="text-[12px] text-ink-3">Not drawn on the avatar</span>
          )}
          <button
            type="button"
            onClick={(e) => onEdit(g, e.currentTarget)}
            className="ml-auto inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-ink-2 hover:text-teal md:h-9"
          >
            <PencilLine aria-hidden className="size-3.5" /> Edit
          </button>
          <button
            type="button"
            aria-label={`Remove ${g.brandModel}`}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deleteGear({ id: g.id })
                if (!r.ok) return toast.show(r.error, { tone: 'error' })
                toast.show(r.message ?? 'Removed', {
                  undo: async () => {
                    const back = await restoreGear({
                      snapshot: r.data.snapshot,
                    })
                    if (!back.ok) toast.show(back.error, { tone: 'error' })
                  },
                })
              })
            }
            className="inline-flex size-11 items-center justify-center rounded-full text-ink-2 hover:bg-critical-bg hover:text-critical md:size-9"
          >
            <Trash2 aria-hidden className="size-4" />
          </button>
        </div>
      </article>
    </motion.li>
  )
}

function OwnVsRent({ coverage, rentalOption }: { coverage: GearCoverage; rentalOption: RentalOption }) {
  const differs = coverage.suggestedRental !== rentalOption
  return (
    <div className="grid gap-3 rounded-[20px] border border-divider bg-[color-mix(in_srgb,var(--ink)_3%,transparent)] p-4 sm:grid-cols-2">
      <div className="min-w-0">
        <p className="hud m-0 text-ink-2">Own vs rent</p>
        <p className="m-0 mt-1 text-[13.5px] leading-snug text-ink">{coverage.rentalNote}</p>
        <p className="m-0 mt-1 text-[12.5px] leading-snug text-ink-2">
          Cost basket uses: {RENTAL_TEXT[rentalOption].label.toLowerCase()}.{' '}
          {differs && !coverage.empty ? (
            <Link href="/settings#costs" className="font-medium text-teal hover:underline">
              Your locker suggests {RENTAL_TEXT[coverage.suggestedRental].label.toLowerCase()} — change it in Settings
            </Link>
          ) : null}
        </p>
      </div>
      <div className="min-w-0">
        <p className="hud m-0 text-ink-2">Packing list</p>
        <p className="m-0 mt-1 text-[13.5px] leading-snug text-ink">{coverage.packing.length ? `${plural(coverage.packing.length, 'item')} you own to pack` : 'Nothing of yours to pack yet'}</p>
        <p className="m-0 mt-1 text-[12.5px] leading-snug text-ink-2">{coverage.toRent.length ? `Rent or borrow: ${coverage.toRent.join(', ').toLowerCase()}` : 'Nothing left to rent'}</p>
      </div>
    </div>
  )
}

export function GearLocker({ items, coverage, rentalOption }: { items: GearItemView[]; coverage: GearCoverage; rentalOption: RentalOption }) {
  const { celebrate } = useSeasonUi()
  const [editing, setEditing] = useState<GearItemView | null>(null)
  const [open, setOpen] = useState(false)
  const [seq, setSeq] = useState(0)
  const opener = useRef<HTMLElement | null>(null)
  const addId = useId()
  const editId = useId()

  return (
    <section
      id="gear"
      aria-labelledby="gear-title"
      className="glass grid scroll-mt-[120px] grid-cols-1 gap-7 rounded-[32px] px-5 py-6 sm:px-7 md:scroll-mt-[76px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]"
    >
      <div className="flex min-w-0 flex-col gap-4">
        <p className="hud m-0 tracking-[0.14em] text-ink-2">Gear locker · {plural(items.length, 'item')}</p>
        <h2 id="gear-title" tabIndex={-1} className="m-0 text-[30px] leading-[1.05] font-light tracking-[-0.03em] text-ink outline-none sm:text-[40px]">
          What you own feeds your packing list and the own-vs-rent maths.
        </h2>
        {items.length ? (
          <ul className="m-0 grid grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <AnimatePresence initial={false}>
              {items.map((g, i) => (
                <GearCard
                  key={g.id}
                  g={g}
                  index={i}
                  onEdit={(item, el) => {
                    opener.current = el
                    setEditing(item)
                    setSeq((n) => n + 1)
                    setOpen(true)
                  }}
                />
              ))}
            </AnimatePresence>
          </ul>
        ) : (
          <div className="flex flex-col gap-1.5 rounded-[20px] border border-dashed border-divider-strong p-[18px]">
            <p className="m-0 text-[15px] font-medium text-ink">Your locker is empty</p>
            <p className="m-0 text-[13px] leading-[1.45] text-ink-2">Add the first thing you own. Until then, every trip budget counts gear as rental.</p>
          </div>
        )}
        <OwnVsRent coverage={coverage} rentalOption={rentalOption} />
      </div>

      <div className="min-w-0">
        <h3 className="hud m-0 mb-4 tracking-[0.14em] text-ink-2">Add to your locker</h3>
        <GearForm id={addId} initial={blank()} onSaved={(created) => created && celebrate('Added to your locker')} />
      </div>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={editing ? `Edit ${editing.brandModel}` : 'Edit gear'}
        description="Brand and model stay plain text. The photo stays on this device."
        onCloseAutoFocus={(e) => {
          if (opener.current && document.contains(opener.current)) {
            e.preventDefault()
            opener.current.focus()
          }
        }}
        footer={
          <div className="flex justify-end">
            <Button type="submit" form={editId} variant="primary" className="h-11 md:h-10">
              Save changes
            </Button>
          </div>
        }
      >
        {editing ? <GearForm key={seq} id={editId} itemId={editing.id} initial={fromItem(editing)} compact onSaved={() => setOpen(false)} /> : null}
      </Sheet>
    </section>
  )
}
