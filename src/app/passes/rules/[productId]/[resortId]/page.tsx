import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, ExternalLink, History } from 'lucide-react'
import { PassBadge } from '@/components/ui/badge'
import { SourceDrawer } from '@/components/ui/source-drawer'
import { EmptyState } from '@/components/ui/states'
import { ACCESS_TYPE_LABEL, dotJoin, familyId, instantDate, plural } from '@/components/passes/format'
import { checkerHref } from '@/components/passes/params'
import { Rise } from '@/components/passes/rise'
import { RuleEditor } from '@/components/passes/rule-editor'
import { PassesSection, YouEnteredTag } from '@/components/passes/section'
import { getCtx } from '@/lib/context'
import { getRuleEditorView } from '@/lib/data/passes-screen'

export const metadata: Metadata = { title: 'Enter an access rule · Passes & Costs' }

const ID = /^[a-z0-9-]{1,100}$/

export default async function RuleEditorPage({ params, searchParams }: { params: Promise<{ productId: string; resortId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { productId, resortId } = await params
  const sp = await searchParams
  const ctx = await getCtx()
  const view = ID.test(productId) && ID.test(resortId) ? await getRuleEditorView(ctx, productId, resortId) : null
  if (!view) {
    return (
      <EmptyState
        title="That product or resort isn’t in the catalog"
        body={
          <>
            Rules can only be entered for a {ctx.prefs.activeSeasonId.replace('-', '–')} product at a catalog resort. Pick both in the checker, then choose “Enter the rule”.
          </>
        }
        action={
          <Link href="/passes" className="inline-flex h-10 items-center rounded-md border border-divider-strong bg-surface px-4 text-[14px] font-medium text-ink hover:border-teal hover:text-teal">
            Open the checker
          </Link>
        }
      />
    )
  }
  const own = typeof sp.own === 'string' && /^\d+$/.test(sp.own) ? Number(sp.own) : null
  const from = typeof sp.from === 'string' ? sp.from : null
  const returnHref = checkerHref({ own, pass: own == null ? view.product.id : null, resort: view.resort.id, from })
  const cur = view.current
  const initial = cur
    ? {
        access: cur.access,
        days: cur.days,
        poolId: cur.poolId,
        poolLabel: cur.poolLabel,
        blackouts: cur.blackouts.map((b) => ({ from: b.from, to: b.to, label: b.label ?? null })),
        reservationRequired: cur.reservationRequired,
        // Free-text notes from the earlier record are not carried into an entry labelled "you entered".
        reservationNotes: cur.youEntered ? cur.reservationNotes : null,
        discountText: cur.youEntered ? cur.discountText : null,
        eligibilityNotes: cur.youEntered ? cur.eligibilityNotes : null,
        notes: cur.youEntered ? cur.notes : null,
      }
    : null

  return (
    <div>
      <Link href={returnHref} className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-[13.5px] font-medium text-teal hover:underline md:min-h-0">
        <ArrowLeft aria-hidden className="size-4" /> Back to the checker
      </Link>
      <PassesSection
        id="rule"
        rule={false}
        title={
          <>
            Enter the rule: {view.product.name} at {view.resort.name}
          </>
        }
        meta={
          <>
            Read the official page, then record what it says. Saving adds <strong className="font-semibold text-ink">version {view.nextVersion}</strong>
            {cur ? ` — version ${cur.version}${cur.verificationLabel ? ` (${cur.verificationLabel.toLowerCase()})` : ''} stays in the history` : ''}. Your entry is shown as “Manual — you entered” with
            its source link.
          </>
        }
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start xl:grid-cols-[minmax(0,1fr)_360px]">
          <Rise index={0} className="min-w-0 glass rounded-[24px] p-4 md:p-6">
            <RuleEditor
              productId={view.product.id}
              productName={view.product.name}
              resortId={view.resort.id}
              resortName={view.resort.name}
              nextVersion={view.nextVersion}
              initial={initial}
              pools={view.pools.map((p) => ({ id: p.id, label: p.label, total: p.total, members: p.members.map((m) => m.name) }))}
              season={view.season}
              today={ctx.today}
              links={view.product.links}
              returnHref={returnHref}
            />
          </Rise>
          <Rise index={1} as="aside" className="flex min-w-0 flex-col gap-4">
            <section aria-labelledby="current-title" className="glass rounded-[24px] p-4">
              <h2 id="current-title" className="mb-2 text-[15px] font-semibold text-ink">
                On file now
              </h2>
              <p className="mb-3 flex flex-wrap items-center gap-2">
                <PassBadge family={familyId(view.product.familyId)} size="sm" />
                <span className="text-[13.5px] text-ink-2">{view.product.familyName}</span>
              </p>
              {cur ? (
                <>
                  <p className="text-[15px] font-medium text-ink">
                    {ACCESS_TYPE_LABEL[cur.access]}
                    {cur.days != null ? <span className="text-ink-2"> · {plural(cur.days, 'day')}</span> : null}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                    <span>Version {cur.version}</span>
                    {cur.youEntered ? <YouEnteredTag /> : cur.verificationLabel ? <span>{cur.verificationLabel}</span> : null}
                    <SourceDrawer title="Current rule" items={[{ label: `Version ${cur.version}`, value: ACCESS_TYPE_LABEL[cur.access], prov: cur.prov }]} />
                  </p>
                  {cur.notes ? <p className="mt-2 text-[13px] text-ink-2">{cur.notes}</p> : null}
                </>
              ) : (
                <p className="text-[13.5px] text-ink-2">No rule recorded — not counted as access.</p>
              )}
              {view.history.length > 1 ? (
                <details className="mt-3 border-t border-divider pt-2">
                  <summary className="flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-teal select-none hover:underline">
                    <History aria-hidden className="size-3.5" /> {plural(view.history.length, 'version')}
                  </summary>
                  <ol className="mt-2 flex flex-col gap-1.5 text-[12.5px]">
                    {view.history.map((h) => (
                      <li key={h.id} className="text-ink-2">
                        <span className="font-medium text-ink tnum">v{h.version}</span> · {ACCESS_TYPE_LABEL[h.access]}
                        {h.days != null ? ` · ${plural(h.days, 'day')}` : ''}
                        {h.verificationLabel ? ` · ${h.verificationLabel}` : ''}
                        {instantDate(h.youEntered ? h.prov?.fetchedAt : h.updatedAt) ? ` · ${instantDate(h.youEntered ? h.prov?.fetchedAt : h.updatedAt)}` : ''}
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </section>
            {view.pools.length ? (
              <section aria-labelledby="pools-title" className="glass rounded-[24px] p-4">
                <h2 id="pools-title" className="mb-2 text-[15px] font-semibold text-ink">
                  Shared pools on this pass
                </h2>
                <ul className="flex flex-col gap-2 text-[13px]">
                  {view.pools.map((p) => (
                    <li key={p.id}>
                      <span className="font-medium text-ink">{p.label ?? p.id}</span>
                      <span className="block text-ink-2">{dotJoin(p.total != null ? plural(p.total, 'day') : 'size not recorded', p.members.map((m) => m.name).join(', '))}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <section aria-labelledby="links-title" className="rounded-[18px] border border-divider bg-surface-2 p-4">
              <h2 id="links-title" className="mb-2 text-[15px] font-semibold text-ink">
                Official pages
              </h2>
              {view.product.links.length ? (
                <ul className="flex flex-col gap-1.5">
                  {view.product.links.map((l) => (
                    <li key={l.url}>
                      <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1.5 text-[13.5px] font-medium break-all text-teal hover:underline">
                        {l.label} <ExternalLink aria-hidden className="size-3.5 shrink-0" />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-ink-3">No official link is recorded for this product.</p>
              )}
              {view.product.blackoutsSummary ? <p className="mt-3 text-[12.5px] text-ink-2">Product blackout notes: {view.product.blackoutsSummary}</p> : null}
              {view.otherRuleResorts.length ? (
                <p className="mt-3 text-[12.5px] text-ink-3">Other resorts with a rule for this pass: {view.otherRuleResorts.map((r) => r.shortName).join(', ')}.</p>
              ) : null}
            </section>
          </Rise>
        </div>
      </PassesSection>
    </div>
  )
}
