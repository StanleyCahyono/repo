/* ===================== Views: overview, architecture ===================== */
route('overview', () => {
  const ex = D.executive || {};
  const m = D.meta || {}; const c = m.counts || {};
  const ff = D.founderfit || {};
  const survivors = arr(D.survivorsOrder).map((id) => ({ id, reg: (D.registry?.gaps || []).find((g) => g.id === id), score: D.gaps?.[id]?.score }));
  return h('div', { class: 'page' },
    pageHead('Deliverable 1 · Executive landscape', 'C4ISR Startup Landscape', ex.sections?.[0]?.paragraphs?.[0] || 'Where, within the modern C4ISR ecosystem, are there important, funded, technically tractable problems that are still inadequately solved and could credibly support a new venture-backed company?', [chip('Research date ' + (m.generated || '2026-09'), 'mono'), chip('Founders: 2 students · ~$250k', 'outline'), chip('U.S. first, allies later', 'outline')]),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, String(c.companies || 0)), h('div', { class: 'l' }, 'companies profiled')),
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, String(c.segments || 0)), h('div', { class: 'l' }, 'segment deep dives')),
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, String(c.findings || 0)), h('div', { class: 'l' }, 'evidence findings')),
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, String(c.gaps || 0)), h('div', { class: 'l' }, 'candidate gaps red-teamed')),
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, String(c.survivors || 0)), h('div', { class: 'l' }, 'surviving opportunities')),
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, String(c.sources || 0)), h('div', { class: 'l' }, 'sources cited'))),
    ex.primary_conclusion ? h('div', { class: 'callout' }, h('div', { class: 'eyebrow' }, 'Primary conclusion'), h('p', null, ex.primary_conclusion)) : null,
    survivors.length ? card('Surviving opportunities at a glance', h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'ID'), h('th', null, 'Opportunity'), h('th', null, 'Verdict'), h('th', { class: 'num' }, 'Market'), h('th', { class: 'num' }, 'Founder fit'), h('th', null, 'Categories'))), h('tbody', null, survivors.map((s) => h('tr', { class: 'clickable', onclick: () => (location.hash = '#opportunities/' + s.id) }, h('td', { class: 'mono' }, s.id), h('td', null, h('a', { href: '#opportunities/' + s.id }, s.reg?.title || s.id)), h('td', null, verdictBadge(s.score?.verdict)), h('td', { class: 'num' }, scorePill(s.score?.market_attractiveness ?? 0)), h('td', { class: 'num' }, scorePill(s.score?.founder_fit ?? 0)), h('td', null, chips(s.reg?.categories, 'cat'))))))), h('p', { class: 'small muted' }, 'Scores are analytical heuristics (0–5), not facts. Market attractiveness is independent of this team; founder fit is specific to two founders with ~$250k.')) : null,
    ff.founder_fit?.portfolio ? card('Recommended portfolio', kv([['Primary bet', ff.founder_fit.portfolio.primary], ['Secondary bet', ff.founder_fit.portfolio.secondary], ['Option', ff.founder_fit.portfolio.option], ['Rationale', ff.founder_fit.portfolio.rationale]]), h('p', { class: 'small' }, h('a', { href: '#founderfit' }, 'Full founder-fit analysis →'))) : null,
    ...arr(ex.sections).map((s) => card(s.heading, h('div', { class: 'prose' }, arr(s.paragraphs).map((p) => h('p', null, linkify(p)))), s.label_notes ? h('p', { class: 'small muted' }, s.label_notes) : null)),
    ex.key_numbers?.length ? card('Key numbers', dataTable(ex.key_numbers, [{ key: 'label', title: 'Metric' }, { key: 'value', title: 'Value' }, { key: 'note', title: 'Note' }, { key: 'source_url', title: 'Source', render: (r) => (r.source_url ? h('a', { href: r.source_url, target: '_blank', rel: 'noopener' }, shortUrl(r.source_url)) : '—') }], { filterable: false })) : null,
    ex.top_uncertainties?.length ? card('Top uncertainties to resolve next', h('ol', null, arr(ex.top_uncertainties).map((u) => h('li', null, isStr(u) ? u : val(u))))) : null,
    ex.saturation_statement ? card('Research saturation', h('p', null, ex.saturation_statement)) : null,
    sourceList(ex.sources));
});

route('architecture', (r) => {
  const ch = D.chain || {}; const steps = arr(ch.chain_steps);
  const active = steps.find((s) => s.step === r.id) || steps[0];
  const stepBtns = h('div', { class: 'chain' }, steps.map((s, i) => h('button', { class: s === active ? 'active' : '', onclick: () => (location.hash = '#architecture/' + s.step) }, h('span', { class: 'step-n' }, String(i + 1).padStart(2, '0')), h('span', { class: 'step-name' }, s.step), h('span', { class: 'step-sub' }, (s.who_performs || '').slice(0, 60)))));
  const detail = active ? card(h('div', { class: 'card-head' }, h('h2', null, active.step), h('span', { class: 'chip mono' }, 'Step ' + (steps.indexOf(active) + 1) + ' of ' + steps.length)),
    h('div', { class: 'two-col' },
      h('div', { class: 'stack' }, kv([['What happens', active.what_happens], ['Who performs it', active.who_performs], ['Hardware', active.hardware], ['Software', active.software], ['Data formats / protocols', val(active.data_formats_protocols, { chips: true })], ['Humans in the loop', active.human_in_loop], ['Latency sources', active.latency_sources]])),
      h('div', { class: 'stack' }, kv([['Comms dependencies', active.comms_dependencies], ['When connectivity disappears', active.when_connectivity_disappears], ['Interoperability requirements', active.interoperability_requirements], ['Security domain', active.security_domain], ['Owning organizations', active.owning_organizations]]))),
    h('h3', { style: { marginTop: '14px' } }, 'Incumbent systems at this step'),
    arr(active.incumbent_systems).length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'System'), h('th', null, 'Service'), h('th', null, 'Vendor'), h('th', null, 'Note'))), h('tbody', null, arr(active.incumbent_systems).map((s) => h('tr', null, h('td', null, s.name), h('td', null, s.service || '—'), h('td', null, s.vendor || '—'), h('td', null, s.note || '—')))))) : empty(),
    arr(active.sources).length ? h('p', { class: 'small muted', style: { marginTop: '10px' } }, 'Sources: ', arr(active.sources).map((s, i) => [i ? ' · ' : null, h('a', { href: s.url, target: '_blank', rel: 'noopener' }, shortUrl(s.url))])) : null) : empty();
  const g = ch.architecture_graph || {};
  const graph = arr(g.nodes).length ? layeredGraph(arr(g.nodes).map((n) => ({ ...n, id: n.id, label: n.label })), arr(g.edges), { layers: ['sensor', 'transport', 'data', 'processing', 'application', 'user', 'security'], layerOf: (n) => n.layer, direction: 'horizontal', nodeW: 150, nodeH: 54, gapX: 60, label: 'C4ISR architecture graph' }) : empty();
  return h('div', { class: 'page' },
    pageHead('Deliverable 2 · Architecture map', 'The C4ISR information and decision chain', 'Fifteen steps from collection to assessment. Click a step to see who performs it, what hardware and software are involved, which protocols matter, where latency and connectivity dependencies sit, and which incumbent systems own it today.'),
    stepBtns, detail,
    card('Architecture graph', h('p', { class: 'small muted' }, 'Layers left to right: sensors → transport → data → processing → applications → users, with the security layer alongside. Hover a node to highlight its links; edge titles carry the protocol.'), graph),
    ch.where_value_is_moving ? card('Where value is moving', h('p', null, ch.where_value_is_moving)) : null,
    h('div', { class: 'grid cols-2' }, card('Crowded layers', val(ch.crowded_layers)), card('Fragmented layers', val(ch.fragmented_layers))),
    arr(ch.cross_cutting_observations).length ? card('Cross-cutting observations', evidenceList(arr(ch.cross_cutting_observations).map((o) => ({ claim: o.observation + (o.evidence ? ' — ' + o.evidence : ''), source_url: o.source_url, label: o.label })))) : null,
    ch.taxonomy_critique ? card('Taxonomy critique', kv([['Keep', val(ch.taxonomy_critique.keep, { chips: true })], ['Change', val(ch.taxonomy_critique.change)], ['Added segments', val(ch.taxonomy_critique.added_segments)]])) : null,
    arr(ch.glossary).length ? fold('Glossary (' + arr(ch.glossary).length + ')', h('dl', { class: 'kv' }, arr(ch.glossary).map((g) => [h('dt', null, g.term), h('dd', null, g.definition)]))) : null,
    sourceList(ch.sources));
});
