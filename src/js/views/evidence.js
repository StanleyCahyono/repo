/* ===================== Views: evidence, allied ===================== */
const EV_ORDER = ['E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07'];
const EV_SHORT = { E01: 'GAO & DoD IG', E02: 'RFIs & solicitations', E03: 'Exercises', E04: 'SBIR & prototype patterns', E05: 'Budget lines', E06: 'Allied markets', E07: 'Regulatory & eligibility' };

route('evidence', (r) => {
  const ids = EV_ORDER.filter((k) => D.evidence?.[k]);
  const cur = ids.includes(r.id) ? r.id : (ids[0] || 'E01');
  const e = D.evidence?.[cur] || {};
  const segName = (id) => arr(D.segments).find((s) => s.segment_id === id)?.segment_name || id;
  const bar = h('div', { class: 'tabs' }, ids.map((k) => h('button', { class: k === cur ? 'active' : '', onclick: () => (location.hash = '#evidence/' + k) }, EV_SHORT[k] || k)));
  const findings = arr(e.findings);
  const cols = [
    { key: 'title', title: 'Finding', render: (f) => h('div', null, h('b', null, f.title), f.detail ? h('div', { class: 'small' }, f.detail) : null, f.quote_or_paraphrase ? h('div', { class: 'small muted', style: { fontStyle: 'italic', marginTop: '3px' } }, '“' + f.quote_or_paraphrase + '”') : null, f.startup_relevance ? h('div', { class: 'small', style: { marginTop: '3px' } }, h('b', null, 'Startup relevance: '), f.startup_relevance) : null), width: '380px' },
    { key: 'segment_ids', title: 'Segments', render: (f) => h('div', { class: 'chips' }, arr(f.segment_ids).map((s) => h('a', { class: 'chip mono', href: '#segments/' + s, title: segName(s) }, s))) },
    { key: 'chain_steps', title: 'Chain', render: (f) => chips(f.chain_steps, 'mono') },
    { key: 'pain_keywords', title: 'Pain words', render: (f) => chips(f.pain_keywords, 'amber') },
    { key: 'label', title: 'Label', render: (f) => h('div', { class: 'stack' }, labelTag(f.label), confTag(f.confidence)) },
    { key: 'pub_date', title: 'Date', render: (f) => h('div', null, f.pub_date || '—', f.event_date && f.event_date !== f.pub_date ? h('span', { class: 'cell-sub' }, 'event ' + f.event_date) : null), sort: (f) => f.pub_date || '' },
    { key: 'source_url', title: 'Source', render: (f) => h('div', null, f.source_url ? h('a', { href: f.source_url, target: '_blank', rel: 'noopener' }, f.source_title || shortUrl(f.source_url)) : '—', f.source_tier ? h('span', { class: 'tier' }, ' T' + f.source_tier) : null) },
  ];
  const structured = e.structured && typeof e.structured === 'object' ? Object.entries(e.structured).filter(([, v]) => nonEmpty(v)) : [];
  return h('div', { class: 'page' },
    pageHead('Evidence base', 'What government documents, exercises, solicitations and budgets actually say', 'Government primary sources dominate: GAO and Inspector General reports, SAM.gov notices, exercise reporting, SBIR and prototype award patterns, budget justification books, allied programs, and the regulatory rules that shape what this founding team can do.'),
    bar,
    h('h2', null, e.name || cur),
    e.summary ? h('div', { class: 'callout' }, h('p', null, e.summary)) : null,
    card('Findings (' + findings.length + ')', dataTable(findings, cols, { facets: [{ title: 'Segment', get: (f) => f.segment_ids }, { title: 'Label', get: (f) => f.label }, { title: 'Chain step', get: (f) => f.chain_steps }], id: 'ev-' + cur, pageSize: 60 })),
    structured.length ? card('Structured extracts', h('div', { class: 'stack' }, structured.map(([k, v]) => fold(titleCase(k) + (Array.isArray(v) ? ' (' + v.length + ')' : ''), structuredTable(v))))) : null,
    e.saturation_statement ? card('Saturation statement', h('p', null, e.saturation_statement)) : null,
    sourceList(e.sources));
});
function structuredTable(v) {
  if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
    const keys = Array.from(new Set(v.flatMap((x) => Object.keys(x)))).slice(0, 12);
    return dataTable(v, keys.map((k) => ({ key: k, title: titleCase(k), render: (row) => (/url/.test(k) && isStr(row[k]) && /^https?:/.test(row[k]) ? h('a', { href: row[k], target: '_blank', rel: 'noopener' }, shortUrl(row[k])) : val(row[k], { chips: true })) })), { filterable: v.length > 10, pageSize: 50 });
  }
  return val(v);
}

route('allied', () => {
  const e = D.evidence?.E06 || {};
  const st = e.structured || {};
  const markets = arr(st.allied_markets || st.markets || st.countries);
  const surv = arr(D.survivorsOrder).map((id) => ({ id, reg: (D.registry?.gaps || []).find((g) => g.id === id), gtm: D.survivors?.[id]?.gtm }));
  return h('div', { class: 'page' },
    pageHead('Phase 18 · Allied-market lens', 'Does the opportunity get bigger outside the United States?', 'NATO, Germany, the United Kingdom, Australia, Japan, Singapore and other allies: standards, exportability, sovereignty and data-residency rules, domestic-procurement preferences, national C2 systems, and whether allied interoperability itself could be the larger business.'),
    e.summary ? h('div', { class: 'callout' }, h('p', null, e.summary)) : null,
    markets.length ? card('Markets', h('div', { class: 'stack' }, markets.map((m) => fold(m.market || m.country || m.name || 'Market', structuredTable([m]))))) : null,
    surv.length ? card('Allied extension for each surviving opportunity', dataTable(surv.filter((s) => s.gtm?.allied_extension), [{ key: 'id', title: 'Opportunity', render: (s) => h('a', { href: '#opportunities/' + s.id }, s.id + ' ' + (s.reg?.title || '')) }, { key: 'bigger', title: 'Bigger with allies?', render: (s) => s.gtm.allied_extension.bigger_with_allies || '—' }, { key: 'what', title: 'What changes', render: (s) => s.gtm.allied_extension.what_changes || '—' }, { key: 'markets', title: 'Markets', render: (s) => chips(s.gtm.allied_extension.markets) }], { filterable: false })) : null,
    card('Findings (' + arr(e.findings).length + ')', evidenceList(arr(e.findings).map((f) => ({ claim: f.title + (f.detail ? ' — ' + f.detail : ''), source_url: f.source_url, source_title: f.source_title, pub_date: f.pub_date, label: f.label, confidence: f.confidence, tier: f.source_tier })))),
    h('p', { class: 'small' }, h('a', { href: '#evidence/E06' }, 'Open the full allied evidence table →')),
    sourceList(e.sources));
});
