/* ===================== Views: companies ===================== */
const POSTURE_CLASS = { 'defense-native': 'amber', 'dual-use': 'accent', commercial: 'outline' };
function postureChip(p) { if (!p) return null; const k = String(p).toLowerCase(); const key = Object.keys(POSTURE_CLASS).find((x) => k.includes(x.replace('-', '')) || k.includes(x)); return chip(p, POSTURE_CLASS[key] || 'outline'); }
function tractionChip(t) { if (!t) return chip('unknown', 'outline'); const k = String(t).toLowerCase(); return chip(t, k.startsWith('strong') ? 'good' : k.startsWith('mod') ? 'warn' : k.startsWith('weak') ? 'bad' : 'outline'); }

route('companies', (r) => {
  if (r.id) return companyDetail(r);
  const cos = arr(D.companies);
  const segName = (id) => arr(D.segments).find((s) => s.segment_id === id)?.segment_name || id;
  const cols = [
    { key: 'name', title: 'Company', render: (c) => h('div', null, h('a', { href: '#companies/' + c.slug }, h('b', null, c.name)), h('span', { class: 'cell-sub' }, [c.headquarters_short, c.founding_year].filter(Boolean).join(' · '))), sort: (c) => c.name.toLowerCase(), width: '220px' },
    { key: 'market_posture', title: 'Posture', render: (c) => (c.market_posture ? h('span', { title: c.market_posture_note }, postureChip(c.market_posture)) : '—') },
    { key: 'hw_sw_mix', title: 'HW/SW', render: (c) => h('span', { style: { whiteSpace: 'nowrap' } }, (c.hw_sw_mix || '—').split(' - ')[0].split(' (')[0].split(';')[0].slice(0, 14)) },
    { key: 'segment_ids', title: 'Segments', render: (c) => h('div', { class: 'chips' }, arr(c.segment_ids).map((s) => h('a', { class: 'chip mono', href: '#segments/' + s, title: segName(s) }, s))), width: '150px' },
    { key: 'technical_layer', title: 'Chain steps', render: (c) => { const l = arr(c.technical_layer).map((x) => String(x).toLowerCase()); return h('div', { class: 'chips' }, l.slice(0, 5).map((x) => chip(x, 'mono')), l.length > 5 ? chip('+' + (l.length - 5), 'mono outline') : null); }, width: '200px' },
    { key: 'total_disclosed_funding_usd', title: 'Disclosed funding', render: (c) => h('span', { title: c.total_disclosed_funding_usd || '' }, c.funding_short || '—'), sort: (c) => moneyNum(c.funding_short) },
    { key: 'contracts', title: 'Contracts', num: true, render: (c) => String(arr(c.contracts).length), sort: (c) => arr(c.contracts).length },
    { key: 'traction', title: 'Traction', render: (c) => tractionChip(c.traction) },
    { key: 'employee_count_approx', title: 'Employees', render: (c) => h('span', { title: c.employee_count_approx || '' }, c.employees_short || '—'), sort: (c) => num(c.employees_short) },
  ];
  const facets = [
    { title: 'Segment', get: (c) => c.segment_ids },
    { title: 'Posture', get: (c) => c.market_posture },
    { title: 'Chain step', get: (c) => arr(c.technical_layer).map((x) => x.toUpperCase()) },
    { title: 'Echelon', get: (c) => arr(c.whitespace_cells).map((w) => w.echelon) },
    { title: 'Type', get: (c) => c.public_private },
    { title: 'Traction', get: (c) => c.traction },
    { title: 'Source batch', get: (c) => c.batch_theme },
  ];
  return h('div', { class: 'page' },
    pageHead('Deliverable 4 · Competitive database', cos.length + ' companies across the C4ISR chain', 'Startups and incumbents, each with a 40-field record: founders and funding, products and the exact problem solved, users and buyers, contracts with ceiling and obligation separated, deployments, exercises, interfaces, moat, weaknesses, and evidence of adoption, repeat procurement and prototype-to-production transition. Sort any column; filter by segment, posture, chain step or echelon.'),
    h('div', { class: 'callout amber' }, h('p', { class: 'small' }, h('b', null, 'Contract-data discipline: '), 'an IDIQ ceiling is not revenue; a prototype OTA is not a program of record; a selected vendor is not a production award. Every contract row keeps ceiling, obligated and awarded amounts separate and carries a confidence level.')),
    dataTable(cos, cols, { facets, sortKey: 'name', id: 'companies', pageSize: 100, placeholder: 'Filter by name, product, investor, customer…' }),
    discoveredTable());
});
function discoveredTable() {
  const found = arr(D.discovery).flatMap((d) => arr(d.new_companies).map((c) => ({ ...c, via: d.discovery_id })));
  if (!found.length) return null;
  const profiled = new Set(arr(D.companies).map((c) => c.slug));
  const rows = found.filter((c) => !profiled.has(slug(c.name)));
  return card('Additional companies surfaced by award and portfolio mining (' + rows.length + ', not yet given a full profile)', h('p', { class: 'small muted' }, 'Found in SBIR, xTech, AFWERX, DIU, program vendor rosters, prime teaming announcements and venture portfolios. Priority 5 = most relevant to the gaps under study.'), dataTable(rows, [{ key: 'name', title: 'Company', render: (c) => h('div', null, h('b', null, c.name), h('span', { class: 'cell-sub' }, [c.hq, c.founding_year].filter(Boolean).join(' · '))) }, { key: 'relevance', title: 'C4ISR relevance' }, { key: 'segment_ids', title: 'Segments', render: (c) => h('div', { class: 'chips' }, arr(c.segment_ids).map((s) => h('a', { class: 'chip mono', href: '#segments/' + s }, s))) }, { key: 'priority', title: 'Priority', num: true, render: (c) => scorePill(c.priority ?? 0) }, { key: 'evidence', title: 'Evidence', render: (c) => (arr(c.evidence).length ? h('ul', { class: 'small' }, arr(c.evidence).map((e) => h('li', null, e.what, e.date ? ' (' + e.date + ')' : '', e.source_url ? [' ', h('a', { href: e.source_url, target: '_blank', rel: 'noopener' }, '↗')] : null))) : '—') }, { key: 'via', title: 'Via', render: (c) => h('span', { class: 'mono' }, c.via || '') }], { facets: [{ title: 'Segment', get: (c) => c.segment_ids }], sortKey: 'priority', desc: true, id: 'discovered', pageSize: 50 }));
}

function companyDetail(r) {
  const c = arr(D.companies).find((x) => x.slug === r.id) || arr(D.companies).find((x) => slug(x.name) === r.id);
  if (!c) return h('div', { class: 'page' }, crumbs([{ text: 'Companies', href: '#companies' }]), empty('Unknown company.'));
  const segName = (id) => arr(D.segments).find((s) => s.segment_id === id)?.segment_name || id;
  const gapsNear = (D.registry?.gaps || []).filter((g) => arr(g.companies_near).some((n) => String(n).toLowerCase().includes(c.name.toLowerCase().split(' ')[0].toLowerCase())));
  const tabDefs = [
    { title: 'Profile', render: () => h('div', { class: 'stack' },
      h('div', { class: 'two-col' },
        card('Company', kv([['Also known as', c.aka], ['Founded', c.founding_year], ['Headquarters', c.headquarters], ['Ownership', c.public_private], ['Employees (approx.)', c.employee_count_approx], ['Founders', val(c.founders, { chips: true })], ['Founder backgrounds', c.founder_backgrounds], ['Disclosed funding', c.total_disclosed_funding_usd], ['Latest valuation', c.latest_valuation], ['Major investors', val(c.major_investors, { chips: true })]])),
        card('Position', kv([['Exact problem solved', c.exact_problem_solved], ['Primary users', val(c.primary_users, { chips: true })], ['Primary buyers', val(c.primary_buyers, { chips: true })], ['Technical layer', val(c.technical_layer, { chips: true })], ['Mission layer', val(c.mission_layer, { chips: true })], ['Segments', h('div', { class: 'chips' }, arr(c.segment_ids).map((s) => h('a', { class: 'chip accent', href: '#segments/' + s }, s + ' ' + segName(s))))], ['Hardware / software', c.hw_sw_mix], ['Market posture', postureChip(c.market_posture) || '—']]))),
      card('C4ISR products', arr(c.c4isr_products).length ? h('div', { class: 'stack' }, arr(c.c4isr_products).map((p) => h('div', { class: 'ev-item' }, h('b', null, p.name), h('div', null, p.description), p.input_process_output_user ? h('div', { class: 'small muted' }, 'INPUT → PROCESS → OUTPUT → USER: ' + p.input_process_output_user) : null))) : empty()),
      h('div', { class: 'two-col' }, card('Differentiator and moat', kv([['Technical differentiator', c.technical_differentiator], ['Suspected moat', c.suspected_moat], ['APIs / SDKs / open interfaces', c.apis_sdks_open_interfaces], ['Integration partners', val(c.integration_partners, { chips: true })]])), card('Weaknesses and competition', kv([['Obvious weaknesses', c.obvious_weaknesses], ['Major competitors', h('div', { class: 'chips' }, arr(c.major_competitors).map((n) => { const cc = findCompany(n); return cc ? h('a', { class: 'chip accent', href: '#companies/' + cc.slug }, n) : chip(n); }))], ['Security / classification requirements', c.security_classification_requirements], ['Allied / international activity', c.allied_international_activity]]))),
      gapsNear.length ? card('Registry gaps where this company is close to the problem', h('div', { class: 'chips' }, gapsNear.map((g) => h('a', { class: 'chip', href: '#gaps/' + g.id }, g.id + ' ' + g.title)))) : null) },
    { title: 'Contracts & traction', render: () => h('div', { class: 'stack' },
      card('Known government contracts (' + arr(c.contracts).length + ')', contractTable(c.contracts)),
      h('div', { class: 'grid cols-3' }, card('Evidence of user adoption', val(c.evidence_user_adoption)), card('Evidence of repeat procurement', val(c.evidence_repeat_procurement)), card('Prototype → production', val(c.evidence_prototype_to_production))),
      h('div', { class: 'two-col' }, card('Operational deployments', arr(c.operational_deployments).length ? evidenceList(arr(c.operational_deployments).map((d) => ({ claim: d.what + (d.evidence ? ' — ' + d.evidence : ''), source_url: d.source_url }))) : empty()), card('Exercises and demonstrations', arr(c.exercises_demos).length ? evidenceList(arr(c.exercises_demos).map((d) => ({ claim: [d.event, d.year].filter(Boolean).join(' · ') + (d.note ? ' — ' + d.note : ''), source_url: d.source_url }))) : empty())),
      c.whitespace_cells?.length ? card('White-space cells occupied', chips(arr(c.whitespace_cells).map((w) => w.chain_step + ' × ' + w.echelon), 'mono')) : null) },
    { title: 'Notes & sources', render: () => h('div', { class: 'stack' }, card('Tech stack inference (from job postings; labeled inference)', val(c.tech_stack_inference_from_jobs)), card('Confidence notes', val(c.confidence_notes)), c.batch_theme ? h('p', { class: 'small muted' }, 'Research batch: ' + c.batch_theme + (c.discovered_via ? ' · discovered via ' + c.discovered_via : '')) : null, sourceList(c.sources)) },
  ];
  return h('div', { class: 'page' }, crumbs([{ text: 'Companies', href: '#companies' }, { text: c.name }]), pageHead('Company record', c.name, c.exact_problem_solved ? c.exact_problem_solved.slice(0, 240) : null, [postureChip(c.market_posture), tractionChip(c.traction), c.public_private ? chip(c.public_private, 'outline') : null, c.founding_year ? chip('Founded ' + c.founding_year, 'mono') : null, c.headquarters ? chip(c.headquarters, 'outline') : null]), tabs(tabDefs, tabIndexFor(tabDefs, r.sub)));
}

function moneyNum(s) { const m = String(s || '').match(/([\d.,]+)\s?(billion|million|bn|mn|B|M|K|k)?/i); if (!m) return 0; const v = parseFloat(m[1].replace(/,/g, '')) || 0; const u = (m[2] || '').toLowerCase(); return v * (u.startsWith('b') ? 1e9 : u.startsWith('m') ? 1e6 : u === 'k' ? 1e3 : 1); }
