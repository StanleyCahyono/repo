/**
 * Gear locker logic (pure): labels, which avatar slot an item fills, what my owned gear covers, and what that means
 * for packing and for rental.
 *
 * Honesty rules
 * - Owning is only what I recorded in the locker. An empty locker means "nothing recorded", so every trip still
 *   counts gear as rental — nothing is assumed owned.
 * - The rental suggestion is a suggestion: the basket's rental option stays my choice (Settings / Passes → Costs).
 */
import type { AvatarPrefs, AvatarSlot, GearType } from '@/lib/db/schema'

export const GEAR_TYPE_LABEL: Record<GearType, string> = {
  skis: 'Skis',
  snowboard: 'Snowboard',
  boots: 'Boots',
  bindings: 'Bindings',
  poles: 'Poles',
  helmet: 'Helmet',
  goggles: 'Goggles',
  jacket: 'Jacket',
  pants: 'Pants',
  gloves: 'Gloves',
  backpack: 'Backpack',
  other: 'Other',
}

/** Short HUD code shown on a gear card. */
export const GEAR_CODE: Record<GearType, string> = {
  skis: 'SKI',
  snowboard: 'BRD',
  boots: 'BT',
  bindings: 'BND',
  poles: 'PL',
  helmet: 'HLM',
  goggles: 'GOG',
  jacket: 'JKT',
  pants: 'PNT',
  gloves: 'GLV',
  backpack: 'BAG',
  other: 'OTH',
}

/** The avatar slot an item can be worn in (snowboards, bindings and "other" are not drawn on the avatar). */
export const GEAR_SLOT: Record<GearType, AvatarSlot | null> = {
  skis: 'skis',
  snowboard: null,
  boots: 'boots',
  bindings: null,
  poles: 'poles',
  helmet: 'helmet',
  goggles: 'goggles',
  jacket: 'jacket',
  pants: 'pants',
  gloves: 'gloves',
  backpack: 'backpack',
  other: null,
}

export const DEFAULT_AVATAR: AvatarPrefs = {
  look: 'suit',
  colors: {
    jacket: '#f1f4f7',
    pants: '#22374a',
    helmet: '#f4f6f8',
    goggles: '#0b1520',
    gloves: '#1b2733',
    boots: '#1b2733',
    skis: '#13202c',
    poles: '#aab6c1',
    backpack: '#1c6c9c',
  },
  backpack: false,
  poles: true,
  wearing: {},
}

/** Stored avatar prefs merged over the defaults (older or partial rows stay valid). */
export function avatarOf(stored: Partial<AvatarPrefs> | null | undefined): AvatarPrefs {
  if (!stored)
    return {
      ...DEFAULT_AVATAR,
      colors: { ...DEFAULT_AVATAR.colors },
      wearing: {},
    }
  return {
    look: stored.look === 'holo' ? 'holo' : 'suit',
    colors: { ...DEFAULT_AVATAR.colors, ...(stored.colors ?? {}) },
    backpack: stored.backpack ?? DEFAULT_AVATAR.backpack,
    poles: stored.poles ?? DEFAULT_AVATAR.poles,
    wearing: { ...(stored.wearing ?? {}) },
  }
}

/** Put an owned item on the avatar: its colour (when it has one) fills the slot, and a backpack/poles item shows. */
export function wearItem(a: AvatarPrefs, item: { id: number; type: GearType; color: string | null }): AvatarPrefs {
  const slot = GEAR_SLOT[item.type]
  if (!slot) return a
  return {
    ...a,
    colors: item.color ? { ...a.colors, [slot]: item.color } : a.colors,
    backpack: slot === 'backpack' ? true : a.backpack,
    poles: slot === 'poles' ? true : a.poles,
    wearing: { ...a.wearing, [slot]: item.id },
  }
}

/** Take an item off (or forget it after it was removed from the locker). */
export function unwearItem(a: AvatarPrefs, id: number): AvatarPrefs {
  const wearing = Object.fromEntries(Object.entries(a.wearing).filter(([, v]) => v !== id)) as AvatarPrefs['wearing']
  return { ...a, wearing }
}

export interface OwnedGear {
  type: GearType
  brandModel: string
}

export type RentalOption = 'full-package' | 'skis-only' | 'boots-only' | 'none'

export interface GearCoverage {
  /** Nothing recorded in the locker. */
  empty: boolean
  ownsSkis: boolean
  ownsBoard: boolean
  ownsBoots: boolean
  ownsPoles: boolean
  ownsHelmet: boolean
  /**
   * The rental basket my locker implies: owning skis (or a board) and boots → none; only boots → skis only; only skis
   * → boots only; otherwise the full package. A suggestion; the stored rental option is never changed silently.
   */
  suggestedRental: RentalOption
  /** Plain-language reason for the suggestion. */
  rentalNote: string
  /** Packing-list lines from what I own ("Skis — Brand Model"), in a stable order. */
  packing: { type: GearType; label: string }[]
  /** Hard goods I would still rent (for a packing list's "rent there" line). */
  toRent: string[]
}

const PACK_ORDER: GearType[] = ['skis', 'snowboard', 'bindings', 'boots', 'poles', 'helmet', 'goggles', 'jacket', 'pants', 'gloves', 'backpack', 'other']

export function gearCoverage(items: readonly OwnedGear[]): GearCoverage {
  const has = (t: GearType) => items.some((i) => i.type === t)
  const ownsSkis = has('skis')
  const ownsBoard = has('snowboard')
  const ownsBoots = has('boots')
  const ownsPoles = has('poles')
  const ownsHelmet = has('helmet')
  const ride = ownsSkis || ownsBoard
  const suggestedRental: RentalOption = ride && ownsBoots ? 'none' : ownsBoots ? 'skis-only' : ride ? 'boots-only' : 'full-package'
  const rentalNote = !items.length
    ? 'Your locker is empty, so trips count skis, boots and poles as rental.'
    : suggestedRental === 'none'
      ? 'You own skis or a board and boots, so no rental is needed.'
      : suggestedRental === 'skis-only'
        ? 'You own boots; rent skis (and poles) only.'
        : suggestedRental === 'boots-only'
          ? `You own ${ownsSkis ? 'skis' : 'a board'}; rent boots only.`
          : 'Your locker has no skis, board or boots, so trips count the full rental package.'
  const packing = [...items]
    .sort((a, b) => PACK_ORDER.indexOf(a.type) - PACK_ORDER.indexOf(b.type) || a.brandModel.localeCompare(b.brandModel))
    .map((i) => ({
      type: i.type,
      label: `${GEAR_TYPE_LABEL[i.type]} — ${i.brandModel}`,
    }))
  const toRent = [!ride ? 'Skis' : null, !ownsBoots ? 'Boots' : null, !ownsPoles && !ownsBoard ? 'Poles' : null, !ownsHelmet ? 'Helmet' : null].filter((x): x is string => !!x)
  return {
    empty: !items.length,
    ownsSkis,
    ownsBoard,
    ownsBoots,
    ownsPoles,
    ownsHelmet,
    suggestedRental,
    rentalNote,
    packing,
    toRent,
  }
}

/** Approximate byte size of a base64 data URL's payload. */
export function dataUrlBytes(url: string): number {
  const i = url.indexOf(',')
  const b64 = i >= 0 ? url.slice(i + 1) : url
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - pad
}

export const MAX_PHOTO_BYTES = 200 * 1024
