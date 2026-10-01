/**
 * Avatar colour presets per slot (the only place raw colours live outside the 3D scene: they are paint for the
 * stylised skier, not UI colours). Names are spoken by screen readers ("Jacket: signal orange").
 */
import type { AvatarPrefs, AvatarSlot } from '@/lib/db/schema'
import type { SkierOptions } from './skier-scene'

export interface Swatch {
  hex: string
  name: string
}

const W = { hex: '#f1f4f7', name: 'glacier white' }
const NIGHT = { hex: '#13202c', name: 'night' }
const BLUE = { hex: '#1c6c9c', name: 'glacier blue' }
const ORANGE = { hex: '#c8502a', name: 'signal orange' }
const PINE = { hex: '#2f5d46', name: 'pine' }
const SUN = { hex: '#e3b23c', name: 'sun yellow' }
const BERRY = { hex: '#8c2f4a', name: 'berry' }
const SLATE = { hex: '#22374a', name: 'slate' }
const STONE = { hex: '#5b6670', name: 'stone' }
const TAN = { hex: '#8a5a3c', name: 'tan' }
const CARBON = { hex: '#1b2733', name: 'carbon' }

export const SLOT_SWATCHES: Record<AvatarSlot, Swatch[]> = {
  jacket: [W, ORANGE, BLUE, PINE, SUN, BERRY, NIGHT],
  pants: [SLATE, NIGHT, STONE, TAN, W, PINE],
  helmet: [{ hex: '#f4f6f8', name: 'white' }, NIGHT, BLUE, ORANGE, { hex: '#7b8792', name: 'matte grey' }, SUN],
  goggles: [
    { hex: '#0b1520', name: 'smoke' },
    { hex: '#b8862b', name: 'gold mirror' },
    { hex: '#2a6fa8', name: 'blue mirror' },
    { hex: '#b4566a', name: 'rose' },
    { hex: '#3f7d5a', name: 'green mirror' },
  ],
  gloves: [CARBON, W, ORANGE, SLATE, TAN],
  boots: [CARBON, W, BLUE, ORANGE, STONE],
  skis: [NIGHT, W, ORANGE, BLUE, SUN, PINE],
  poles: [{ hex: '#aab6c1', name: 'silver' }, CARBON, ORANGE, BLUE, SUN],
  backpack: [BLUE, NIGHT, ORANGE, PINE, SUN, STONE],
}

export const SLOT_LABEL: Record<AvatarSlot, string> = {
  jacket: 'Jacket',
  pants: 'Pants',
  helmet: 'Helmet',
  goggles: 'Goggles',
  gloves: 'Gloves',
  boots: 'Boots',
  skis: 'Skis',
  poles: 'Poles',
  backpack: 'Backpack',
}

export function swatchName(slot: AvatarSlot, hex: string): string {
  return SLOT_SWATCHES[slot].find((s) => s.hex.toLowerCase() === hex.toLowerCase())?.name ?? 'custom'
}

/** Avatar prefs → scene options. */
export function sceneColors(a: AvatarPrefs): Pick<SkierOptions, 'look' | 'jacket' | 'pants' | 'helmet' | 'goggles' | 'gloves' | 'boots' | 'skis' | 'poleColor' | 'pack' | 'backpack' | 'poles'> {
  const c = a.colors
  return {
    look: a.look,
    jacket: c.jacket,
    pants: c.pants,
    helmet: c.helmet,
    goggles: c.goggles,
    gloves: c.gloves,
    boots: c.boots,
    skis: c.skis,
    poleColor: c.poles,
    pack: c.backpack,
    backpack: a.backpack,
    poles: a.poles,
  }
}
