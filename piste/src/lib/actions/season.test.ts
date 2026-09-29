import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))
const ctxRef: { current: unknown } = { current: null }
vi.mock('@/lib/context', () => ({ getCtx: async () => ctxRef.current }))
const runJob = vi.fn(async () => ({ status: 'ok' }))
vi.mock('@/lib/jobs/runner', () => ({ runJob: (...args: unknown[]) => runJob(...(args as [])) }))

import { and, eq } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import { buildFixture, NOW, type Fixture } from '@/lib/data/fixtures.test-helpers'
import {
  addSkill,
  deleteExpense,
  deleteSkiDay,
  moveSkill,
  removeSkill,
  restoreSkiDay,
  restoreSkill,
  saveDayReport,
  saveExpense,
  saveLesson,
  saveSkiDay,
  setSkillStatus,
  type SkiDayInput,
} from './season'

let fx: Fixture
const day = (over: Partial<SkiDayInput> = {}): SkiDayInput => ({ date: '2027-01-09', resortId: 'test-peak', surfaceFeedback: [], skillsPracticed: [], ...over })

beforeAll(async () => {
  fx = await buildFixture()
  ctxRef.current = fx.ctx
})

beforeEach(() => {
  runJob.mockClear()
})

describe('saveSkiDay — the ski-day journal', () => {
  it('refuses a day that has not started at the resort, another season, and an unknown resort', async () => {
    expect(await saveSkiDay(day({ date: '2027-01-16' }))).toMatchObject({ ok: false, fieldErrors: { date: expect.stringMatching(/or earlier/) } })
    expect(await saveSkiDay(day({ date: '2026-03-01' }))).toMatchObject({ ok: false, fieldErrors: { date: expect.stringMatching(/2026–27/) } })
    expect(await saveSkiDay(day({ resortId: 'nowhere' }))).toMatchObject({ ok: false, fieldErrors: { resortId: expect.any(String) } })
  })

  it('stores what I typed: quarter-hour hours, spend in minor units (unknown stays null), known skills only', async () => {
    const skills = await fx.db.select().from(s.skillChecklist)
    const r = await saveSkiDay(day({ hoursSkied: 3.4, rating: 4, surfaceFeedback: ['firm', 'unknown'], crowdGuess: '  Busy  ', skillsPracticed: [skills[0].id, 99999], spend: '64.5', currency: 'usd', notes: 'Good day' }))
    expect(r).toMatchObject({ ok: true, data: { created: true, reportSaved: false } })
    if (!r.ok) return
    const [row] = await fx.db.select().from(s.skiDayLogs).where(eq(s.skiDayLogs.id, r.data.id))
    expect(row).toMatchObject({ hoursSkied: 3.5, rating: 4, surfaceFeedback: ['firm'], crowdGuess: 'Busy', skillsPracticed: [skills[0].id], spendMinor: 6450, currency: 'USD', notes: 'Good day' })
    const bare = await saveSkiDay(day({ date: '2027-01-08' }))
    if (!bare.ok) throw new Error(bare.error)
    const [b] = await fx.db.select().from(s.skiDayLogs).where(eq(s.skiDayLogs.id, bare.data.id))
    expect(b).toMatchObject({ hoursSkied: null, rating: null, spendMinor: null, currency: null, preferredTime: null })
  })

  it('refuses a second entry for the same resort and date', async () => {
    expect(await saveSkiDay(day())).toMatchObject({ ok: false, fieldErrors: { date: 'Already logged at this resort' } })
  })

  it('saves surface feedback as a PERSONAL report only when asked — kind manual, note personal, never official', async () => {
    const r = await saveSkiDay(day({ date: '2027-01-07', surfaceFeedback: ['icy-refrozen'], saveReport: true }))
    expect(r).toMatchObject({ ok: true, data: { reportSaved: true } })
    const reports = await fx.db
      .select()
      .from(s.operationalReports)
      .where(and(eq(s.operationalReports.resortId, 'test-peak'), eq(s.operationalReports.localDate, '2027-01-07')))
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ kind: 'manual', status: null, surfaceTags: ['icy-refrozen'], prov: { provider: 'You', note: 'personal', kind: 'manual' } })
    expect(runJob).toHaveBeenCalled()
    // Asking without tags is refused rather than saving an empty report.
    expect(await saveSkiDay(day({ date: '2027-01-06', saveReport: true }))).toMatchObject({ ok: false, fieldErrors: { surfaceFeedback: expect.any(String) } })
  })

  it('saveDayReport adds a revision for a logged day and refuses a day without surface feedback', async () => {
    const [logged] = await fx.db.select().from(s.skiDayLogs).where(eq(s.skiDayLogs.date, '2027-01-07'))
    expect(await saveDayReport({ id: logged.id })).toMatchObject({ ok: true, data: { revision: 2 } })
    const [bare] = await fx.db.select().from(s.skiDayLogs).where(eq(s.skiDayLogs.date, '2027-01-08'))
    expect(await saveDayReport({ id: bare.id })).toMatchObject({ ok: false, error: 'Add surface feedback to this day first' })
  })

  it('logs, moves and removes the pass day with the form — and deleting the entry keeps the pass day', async () => {
    const usage = () => fx.db.select().from(s.passUsage).where(eq(s.passUsage.ownershipId, fx.ownershipId))
    const r = await saveSkiDay(day({ date: '2027-01-05', passOwnershipId: fx.ownershipId }))
    if (!r.ok) throw new Error(r.error)
    expect((await usage()).map((u) => u.date).sort()).toEqual(['2027-01-02', '2027-01-05'])
    // Moving the day moves the pass day.
    await saveSkiDay(day({ id: r.data.id, date: '2027-01-04', passOwnershipId: fx.ownershipId }))
    expect((await usage()).map((u) => u.date).sort()).toEqual(['2027-01-02', '2027-01-04'])
    // Unticking removes it.
    await saveSkiDay(day({ id: r.data.id, date: '2027-01-04', passOwnershipId: null }))
    expect((await usage()).map((u) => u.date)).toEqual(['2027-01-02'])
    // Deleting a journal entry never deletes a pass day logged in Passes.
    const onPassDay = await saveSkiDay(day({ date: '2027-01-02' }))
    if (!onPassDay.ok) throw new Error(onPassDay.error)
    const del = await deleteSkiDay({ id: onPassDay.data.id })
    expect(del).toMatchObject({ ok: true, data: { passDayKept: true } })
    expect((await usage()).map((u) => u.date)).toEqual(['2027-01-02'])
    if (!del.ok) return
    expect(await restoreSkiDay({ snapshot: del.data.snapshot })).toMatchObject({ ok: true, data: { id: onPassDay.data.id } })
  })
})

describe('learning checklist', () => {
  it('needs a date for confirmed statuses, refuses future dates, and clears the date when not confirmed', async () => {
    const [k] = await fx.db.select().from(s.skillChecklist).where(eq(s.skillChecklist.label, 'Controlled stopping (wedge)'))
    expect(await setSkillStatus({ id: k.id, status: 'instructor-confirmed', confirmedOn: null, notes: null })).toMatchObject({ ok: false, fieldErrors: { confirmedOn: expect.any(String) } })
    expect(await setSkillStatus({ id: k.id, status: 'self-confirmed', confirmedOn: '2027-02-01', notes: null })).toMatchObject({ ok: false, fieldErrors: { confirmedOn: expect.any(String) } })
    const r = await setSkillStatus({ id: k.id, status: 'instructor-confirmed', confirmedOn: '2027-01-02', notes: 'Wedge stop checked in the group lesson' })
    expect(r).toMatchObject({ ok: true, data: { previous: { status: 'not-started', confirmedOn: null } } })
    await setSkillStatus({ id: k.id, status: 'practicing', confirmedOn: '2027-01-02', notes: null })
    const [after] = await fx.db.select().from(s.skillChecklist).where(eq(s.skillChecklist.id, k.id))
    expect(after).toMatchObject({ status: 'practicing', confirmedOn: null })
  })

  it('adds at the end of a category, reorders within it, and restores a removed skill with its id', async () => {
    const ordered = async () => (await fx.db.select().from(s.skillChecklist)).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    const added = await addSkill({ label: 'Hockey stop', category: 'Control' })
    if (!added.ok) throw new Error(added.error)
    let control = (await ordered()).filter((k) => k.category === 'Control').map((k) => k.label)
    expect(control[control.length - 1]).toBe('Hockey stop')
    expect(await addSkill({ label: 'hockey STOP', category: null })).toMatchObject({ ok: false, fieldErrors: { label: 'Already on your list' } })
    await moveSkill({ id: added.data.id, direction: 'up' })
    control = (await ordered()).filter((k) => k.category === 'Control').map((k) => k.label)
    expect(control.slice(-2)).toEqual(['Hockey stop', 'Control speed with a wedge on green terrain'])
    const all = await ordered()
    expect(new Set(all.map((k) => k.sortOrder)).size).toBe(all.length)
    const removed = await removeSkill({ id: added.data.id })
    if (!removed.ok) throw new Error(removed.error)
    expect(await restoreSkill({ snapshot: removed.data.snapshot })).toMatchObject({ ok: true, data: { id: added.data.id } })
  })
})

describe('lessons and expenses', () => {
  it('stores a standalone lesson and refuses to edit a lesson that belongs to a trip', async () => {
    const r = await saveLesson({ resortId: 'test-peak', date: '2027-01-23', kind: 'private', cost: '120', currency: 'USD', costKind: 'quote', focusSkills: [], bookingUrl: '' })
    if (!r.ok) throw new Error(r.error)
    const [row] = await fx.db.select().from(s.lessons).where(eq(s.lessons.id, r.data.id))
    expect(row).toMatchObject({ tripId: null, costMinor: 12000, currency: 'USD', costKind: 'quote', bookingUrl: null })
    expect(await saveLesson({ resortId: 'test-peak', cost: '50' })).toMatchObject({ ok: false, fieldErrors: { currency: expect.any(String), costKind: expect.any(String) } })
    await fx.db.insert(s.trips).values({ id: 'feb-trip', name: 'Feb', status: 'draft', startDate: '2027-02-06', endDate: '2027-02-07', partySize: 1, companions: [], createdAt: NOW, updatedAt: NOW })
    const [tripLesson] = await fx.db.insert(s.lessons).values({ resortId: 'test-peak', tripId: 'feb-trip', date: '2027-02-06', focusSkills: [], createdAt: NOW }).returning()
    expect(await saveLesson({ id: tripLesson.id, resortId: 'test-peak', kind: 'group' })).toMatchObject({ ok: false, error: expect.stringMatching(/part of a trip/) })
  })

  it('keeps pass purchases linked to a pass out of reach and requires an in-season date', async () => {
    const [linked] = await fx.db
      .insert(s.expenses)
      .values({ date: '2026-04-01', category: 'pass', label: 'Indy purchase', amountMinor: 29900, currency: 'USD', passOwnershipId: fx.ownershipId, createdAt: NOW })
      .returning()
    expect(await saveExpense({ id: linked.id, date: '2027-01-02', category: 'pass', label: 'x', amount: '1', currency: 'USD' })).toMatchObject({ ok: false, error: expect.stringMatching(/Passes/) })
    expect(await deleteExpense({ id: linked.id })).toMatchObject({ ok: false })
    expect(await saveExpense({ date: '2026-05-01', category: 'lift', label: 'Spring ticket', amount: '59', currency: 'USD' })).toMatchObject({ ok: false, fieldErrors: { date: expect.any(String) } })
    const ok = await saveExpense({ date: '2027-01-09', category: 'lift', label: 'Lift ticket', amount: '59.00', currency: 'usd' })
    if (!ok.ok) throw new Error(ok.error)
    const [row] = await fx.db.select().from(s.expenses).where(eq(s.expenses.id, ok.data.id))
    expect(row).toMatchObject({ amountMinor: 5900, currency: 'USD', passOwnershipId: null })
  })
})
