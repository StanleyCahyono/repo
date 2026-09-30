import type { Metadata } from 'next'
import Link from 'next/link'
import { AccessLegend } from '@/components/passes/access-mark'
import { dayLabel, plural } from '@/components/passes/format'
import { MatrixList, MatrixTable } from '@/components/passes/matrix'
import { PassesNav, PendingNote, PendingVeil } from '@/components/passes/nav'
import { parseMatrix } from '@/components/passes/params'
import { Rise } from '@/components/passes/rise'
import { PassesSection } from '@/components/passes/section'
import { ChipFilter, DateField } from '@/components/passes/toolbar'
import { getCtx } from '@/lib/context'
import { getPassesView } from '@/lib/data/passes'
import { defaultDate, planningSeason } from '@/lib/data/passes-screen'
import { PASS_FAMILIES } from '@/lib/domain/types'

export const metadata: Metadata = { title: 'Access matrix · Passes & Costs' }

export default async function MatrixPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = parseMatrix(await searchParams)
  const ctx = await getCtx()
  const season = await planningSeason(ctx)
  const date = q.date && q.date >= season.start && q.date <= season.end ? q.date : defaultDate(ctx.today, season)
  const pv = await getPassesView(ctx, { date })
  const m = pv.matrix

  const families = pv.families.filter((f) => f.productIds.length)
  const family = q.family && families.some((f) => f.id === q.family) ? q.family : 'all'
  const rows = family === 'all' ? m.rows : m.rows.filter((r) => r.familyId === family)
  // Columns: resorts where at least one visible row has a rule — the matrix stays as narrow as the question.
  const withRule = new Set(rows.flatMap((r) => r.cells.filter((c) => c.hasRule).map((c) => c.resortId)))
  const resorts = m.resorts.filter((r) => withRule.has(r.id))
  const cells = rows.flatMap((r) => r.cells.filter((c) => c.hasRule))
  const unknown = cells.filter((c) => c.status === 'unknown').length
  const usable = cells.filter((c) => c.canSki).length
  const familyOrder = (id: string) => (PASS_FAMILIES as readonly string[]).indexOf(id)

  return (
    <PassesNav>
      <PassesSection
        id="matrix"
        rule={false}
        title="Access matrix"
        meta={
          <>
            Every exact {season.label} product against every resort it has a rule for, on {dayLabel(date, true)}. Your passes come first and count the days you
            have logged. Family badges are discovery only — this table answers from each product’s own rules.
          </>
        }
      >
        <Rise index={0}>
          <div className="mb-4 flex flex-col gap-4 rounded-[12px] border border-divider bg-surface px-4 py-4 md:flex-row md:flex-wrap md:items-end md:justify-between md:px-5">
            <DateField value={date} today={ctx.today} season={season} label="Access on" />
            <ChipFilter
              label="Family"
              param="family"
              value={family}
              defaultValue="all"
              options={[
                { value: 'all', label: 'All', count: m.rows.length },
                ...[...families]
                  .sort((a, b) => familyOrder(a.id) - familyOrder(b.id))
                  .map((f) => ({ value: f.id, label: f.id === 'regional' ? 'Resort & regional' : f.name.replace(/ Pass$/, ''), count: m.rows.filter((r) => r.familyId === f.id).length })),
              ]}
            />
          </div>
        </Rise>

        <Rise index={1}>
          <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <p className="text-[13.5px] text-ink-2">
              <span className="font-medium text-ink tnum">{plural(rows.length, 'product')}</span> × <span className="font-medium text-ink tnum">{plural(resorts.length, 'resort')}</span>
              {' · '}
              <span className="tnum">{usable}</span> usable on this date · <span className="tnum">{unknown}</span> not confirmed <PendingNote className="ml-2" />
            </p>
            <AccessLegend statuses={['included', 'discount-only', 'blackout', 'days-exhausted', 'not-included', 'unknown', 'no-rule']} className="text-[12px]" />
          </div>
        </Rise>

        <PendingVeil>
          {rows.length && resorts.length ? (
            <>
              <div className="max-md:hidden">
                <MatrixTable date={date} resorts={resorts} rows={rows} />
              </div>
              <div className="md:hidden">
                <MatrixList date={date} resorts={resorts} rows={rows} />
              </div>
            </>
          ) : (
            <p className="rounded-[12px] border border-dashed border-divider-strong bg-surface-2 p-5 text-[14px] text-ink-2">
              No access rules are recorded for these products yet — nothing is confirmed. Open a product in the checker to enter a rule from its official page.
            </p>
          )}
        </PendingVeil>

        <div className="mt-5 grid gap-4 text-[13px] text-ink-2 md:grid-cols-2">
          <p>
            <span className="font-medium text-ink">“Not confirmed”</span> means a rule exists but its access is unknown (usually unverified research).{' '}
            <span className="font-medium text-ink">“—”</span> means no rule is recorded at all. Neither is access. Pick any cell to see the reasons and enter a confirmed
            rule — it is saved as a new version, never over the old one.
          </p>
          <p>
            Pass rules only — whether a resort is open on {dayLabel(date)} is separate.{' '}
            {m.resortsWithoutRules.length ? (
              <>
                No pass rule is recorded at {plural(m.resortsWithoutRules.length, 'resort')}:{' '}
                {m.resortsWithoutRules.map((r, i) => (
                  <span key={r.id}>
                    {i ? ', ' : ''}
                    <Link href={`/resorts/${r.id}`} className="text-teal hover:underline">
                      {r.name}
                    </Link>
                  </span>
                ))}
                .
              </>
            ) : null}
          </p>
        </div>
      </PassesSection>
    </PassesNav>
  )
}
