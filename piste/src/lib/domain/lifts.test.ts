import { describe, expect, it } from 'vitest'
import {
  conventionLegend,
  difficultyConvention,
  difficultyStyle,
  groomingText,
  groupLifts,
  groupRuns,
  liftCountsText,
  liftKindText,
  liftName,
  runCountsText,
  runName,
  skiAreaTotals,
  type MappedLift,
  type MappedRun,
  type RunDifficulty,
} from './lifts'

const lift = (o: Partial<MappedLift> & Pick<MappedLift, 'type'>): MappedLift => ({ osm: `way/${Math.random()}`, name: null, ref: null, lengthM: null, capacityPerHour: null, occupancy: null, durationMin: null, ...o })
const run = (difficulty: RunDifficulty, name: string | null, o: Partial<MappedRun> = {}): MappedRun => ({ osm: `way/${name}`, name, ref: null, difficulty, grooming: null, lengthM: 500, segments: 1, ...o })

describe('difficulty conventions', () => {
  it('uses North American signs in the US, Canada, Australia and New Zealand', () => {
    for (const c of ['US', 'ca', 'AU', 'NZ']) expect(difficultyConvention(c)).toBe('north-america')
    expect(difficultyConvention('JP')).toBe('japan')
    for (const c of ['AT', 'FR', 'CH', 'IT', 'CL', null]) expect(difficultyConvention(c)).toBe('europe')
  })

  it('shows every level as text plus a shape — never colour alone', () => {
    const na = (d: RunDifficulty) => difficultyStyle(d, 'north-america')
    expect([na('novice').label, na('easy').label]).toEqual(['Green circle', 'Green circle'])
    expect(na('easy').shape).toBe('circle')
    expect(na('intermediate')).toMatchObject({ label: 'Blue square', shape: 'square', tone: 'blue' })
    expect(na('advanced')).toMatchObject({ label: 'Black diamond', shape: 'diamond', tone: 'black' })
    expect(na('expert')).toMatchObject({ label: 'Double black diamond', shape: 'double-diamond' })
    expect(na('freeride').shape).toBe('route')

    const eu = (d: RunDifficulty) => difficultyStyle(d, 'europe')
    expect(eu('novice')).toMatchObject({ label: 'Green', tone: 'green' })
    expect(eu('easy')).toMatchObject({ label: 'Blue', tone: 'blue' })
    expect(eu('intermediate')).toMatchObject({ label: 'Red', tone: 'red' })
    expect(eu('advanced')).toMatchObject({ label: 'Black', tone: 'black' })
    expect(eu('expert').key).toBe(eu('freeride').key)
    expect(eu('expert')).toMatchObject({ label: 'Freeride / itinerary', shape: 'route' })

    const jp = (d: RunDifficulty) => difficultyStyle(d, 'japan')
    expect([jp('easy').label, jp('intermediate').label, jp('advanced').label]).toEqual(['Green', 'Red', 'Black'])

    for (const c of ['north-america', 'europe', 'japan'] as const) {
      expect(difficultyStyle('unknown', c)).toMatchObject({ label: 'Difficulty not mapped', shape: 'none' })
      for (const s of conventionLegend(c)) expect(s.label.length).toBeGreaterThan(2)
    }
    expect(conventionLegend('north-america').map((s) => s.label)).toEqual([
      'Green circle',
      'Blue square',
      'Black diamond',
      'Double black diamond',
      'Extreme terrain',
      'Freeride terrain',
    ])
  })
})

describe('runs by difficulty', () => {
  const extract = {
    runs: [
      run('advanced', 'Ballroom'),
      run('expert', 'High Rustler', { lengthM: 700, segments: 2 }),
      run('advanced', 'Collins Face', { lengthM: null }),
      run('novice', 'Bunny'),
      run('easy', 'Sidewinder'),
      run('expert', "Devil's Castle"),
      run('unknown', 'Mystery'),
      run('advanced', null, { ref: '12' }),
    ],
    unnamed: [
      { difficulty: 'easy' as const, segments: 3, lengthM: 900 },
      { difficulty: 'advanced' as const, segments: 1, lengthM: 250 },
    ],
  }

  it('groups North American runs under their signs, novice and easy together, with counts', () => {
    const groups = groupRuns(extract, 'north-america')
    expect(groups.map((g) => [g.style.label, g.runs.map((r) => r.name ?? r.ref)])).toEqual([
      ['Green circle', ['Bunny', 'Sidewinder']],
      ['Black diamond', ['Ballroom', 'Collins Face', '12']],
      ['Double black diamond', ["Devil's Castle", 'High Rustler']],
      ['Difficulty not mapped', ['Mystery']],
    ])
    expect(groups[0].difficulties).toEqual(['novice', 'easy'])
    expect(groups[0].unnamed).toEqual({ segments: 3, lengthM: 900 })
    // Unknown lengths are not counted as zero-length runs: the group sums only what is known.
    expect(groups[1].lengthM).toBe(1000)
    expect(runCountsText(groups)).toBe('2 green circle · 3 black diamond · 2 double black diamond · 1 without a mapped difficulty')
  })

  it('uses European colours for an Alps resort', () => {
    const groups = groupRuns(extract, 'europe')
    expect(runCountsText(groups)).toBe('1 green · 1 blue · 3 black · 2 freeride / itinerary · 1 without a mapped difficulty')
  })

  it('names runs by name, ref or as unnamed', () => {
    expect(runName({ name: 'Kandahar', ref: '14' })).toBe('Kandahar (14)')
    expect(runName({ name: null, ref: '2' })).toBe('Run 2')
    expect(runName({ name: null, ref: null })).toBe('Unnamed run')
    expect(groomingText('mogul')).toBe('Moguls')
    expect(groomingText('backcountry')).toBe('Ungroomed')
    expect(groomingText('classic')).toBe('Groomed')
    expect(groomingText(null)).toBeNull()
  })
})

describe('lifts by type', () => {
  const lifts = [
    lift({ type: 'chair_lift', name: 'Lift 10', capacityPerHour: 1800, occupancy: 4 }),
    lift({ type: 'chair_lift', name: 'Lift 2', capacityPerHour: null }),
    lift({ type: 'gondola', name: 'Galzigbahn', capacityPerHour: 2400, occupancy: 8 }),
    lift({ type: 't-bar', name: 'Übungslift' }),
    lift({ type: 'rope_tow', ref: 'R1' }),
    lift({ type: 'magic_carpet' }),
  ]

  it('groups surface lifts together and sums only the capacities that are stated', () => {
    const groups = groupLifts(lifts)
    expect(groups.map((g) => [g.label, g.lifts.length])).toEqual([
      ['Gondolas', 1],
      ['Chairlifts', 2],
      ['Surface lifts', 2],
      ['Magic carpets', 1],
    ])
    // Natural order: "Lift 2" before "Lift 10".
    expect(groups[1].lifts.map((l) => l.name)).toEqual(['Lift 2', 'Lift 10'])
    expect(groups[1]).toMatchObject({ capacityPerHour: 1800, capacityKnown: 1 })
    expect(groups[2]).toMatchObject({ capacityPerHour: null, capacityKnown: 0 })
    expect(liftCountsText(groups)).toBe('1 gondola · 2 chairlifts · 2 surface lifts · 1 magic carpet')
  })

  it('describes lifts in words', () => {
    expect(liftName({ name: null, ref: 'R1', type: 'rope_tow' })).toBe('Lift R1')
    expect(liftName({ name: null, ref: null, type: 'magic_carpet' })).toBe('Unnamed magic carpet')
    expect(liftKindText({ type: 'chair_lift', occupancy: 4 })).toBe('4-seat chairlift')
    expect(liftKindText({ type: 'gondola', occupancy: 8 })).toBe('Gondola, 8 per cabin')
    expect(liftKindText({ type: 't-bar', occupancy: null })).toBe('T-bar')
  })

  it('totals what is known, and says how many lifts state a capacity', () => {
    const t = skiAreaTotals({ lifts, runs: [run('easy', 'A', { lengthM: 1200 }), run('easy', 'B', { lengthM: null })], unnamed: [{ difficulty: 'easy', segments: 2, lengthM: 300 }] })
    expect(t).toMatchObject({ lifts: 6, runs: 2, unnamedSegments: 2, capacityPerHour: 4200, capacityKnown: 2, runLengthM: 1500 })
    expect(skiAreaTotals({ lifts: [lift({ type: 'platter' })], runs: [], unnamed: [] }).capacityPerHour).toBeNull()
  })
})
