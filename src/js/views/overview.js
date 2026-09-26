/* ===================== Views: overview, architecture ===================== */
function statusPanel() {
  const st = arr(D.meta?.stages); if (!st.length) return null;
  const done = st.filter((x) => x.done).length;
  return card(h('div', { class: 'card-head' }, h('h3', null, 'Research pipeline status'), chip(done + ' of ' + st.length + ' stages complete', done === st.length ? 'good' : 'warn')), h('ol', null, st.map((x) => h('li', null, chip(x.done ? 'done' : 'pending', x.done ? 'good' : 'outline'), ' ', x.name, h('span', { class: 'muted' }, ' · ' + x.detail)))), done < st.length ? h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'Pending stages run as multi-agent pipelines and are rate-limited by the research environment; every page below already shows the evidence gathered so far and fills in automatically when the remaining stages land.') : null);
}
function verdictStrip() {
  const gaps = arr(D.registry?.gaps); if (!gaps.length) return null;
  const v = (g) => String(D.gaps?.[g.id]?.score?.verdict || 'pending').toLowerCase();
  const order = { survive: 0, borderline: 1, kill: 2, pending: 3 };
  const sorted = gaps.slice().sort((a, b) => (order[v(a)] ?? 3) - (order[v(b)] ?? 3) || (num(D.gaps?.[b.id]?.score?.market_attractiveness) + num(D.gaps?.[b.id]?.score?.founder_fit)) - (num(D.gaps?.[a.id]?.score?.market_attractiveness) + num(D.gaps?.[a.id]?.score?.founder_fit)));
  const color = (k) => (k === 'survive' ? 'var(--good)' : k === 'borderline' ? 'var(--warning)' : k === 'kill' ? 'var(--critical)' : 'var(--surface-3)');
  return card(h('div', { class: 'card-head' }, h('h3', null, 'Every candidate, and what the red team did to it'), h('div', { class: 'legend' }, ['borderline', 'kill'].map((k) => h('span', null, h('i', { class: 'sw', style: { background: color(k) } }), k === 'kill' ? 'killed' : k)))),
    h('div', { class: 'verdict-strip' }, sorted.map((g) => { const k = v(g); const sc = D.gaps?.[g.id]?.score || {}; const el = h('a', { class: 'vs-cell', href: '#gaps/' + g.id, style: { background: color(k) }, 'aria-label': g.id + ' ' + k }, h('span', null, g.id)); withTip(el, `<b>${esc(g.id)} · ${esc(k)}</b><br>${esc(g.title)}<br>Market ${esc(sc.market_attractiveness ?? '—')} · Founder fit ${esc(sc.founder_fit ?? '—')}`); return el; })),
    h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'Each tile is one of the ' + gaps.length + ' registry gaps (G29 to G36 are second-generation candidates built from the red team\'s own narrower suggestions). Hover for the title and scores; click for the evidence card, red team and 18-criterion scores.'));
}
function segmentVerdicts() {
  const segs = arr(D.segments); if (!segs.length) return null;
  return card('Segment verdicts at a glance', h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'Segment'), h('th', null, 'Market stage'), h('th', null, 'Regulatory'), h('th', null, 'Verdict'))), h('tbody', null, segs.map((s) => h('tr', { class: 'clickable', onclick: () => (location.hash = '#segments/' + s.segment_id) }, h('td', null, h('a', { href: '#segments/' + s.segment_id }, h('b', null, s.segment_id + ' ' + s.segment_name))), h('td', null, stageChip(s.market_stage?.stage) || '—'), h('td', null, s.regulatory_access?.overall ? chip(s.regulatory_access.overall, /high/i.test(s.regulatory_access.overall) ? 'bad' : /med/i.test(s.regulatory_access.overall) ? 'warn' : 'good') : '—'), h('td', { class: 'small' }, s.attractiveness?.verdict || '—')))))));
}
function interimLandscape() {
  const ch = D.chain || {}; const segs = arr(D.segments); const reg = arr(D.registry?.gaps);
  const ev = D.evidence || {};
  const attr = (g) => String(g.initial_attractiveness || '').toLowerCase();
  return [
    ch.where_value_is_moving ? card('Where value is moving (from the first-principles chain map)', h('div', { class: 'prose' }, P(ch.where_value_is_moving))) : null,
    h('div', { class: 'grid cols-2' }, card('Crowded layers', val(ch.crowded_layers)), card('Fragmented layers', val(ch.fragmented_layers))),
    segs.length ? card('Segment verdicts at a glance', h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'Segment'), h('th', null, 'Market stage'), h('th', null, 'Regulatory'), h('th', null, 'Verdict'))), h('tbody', null, segs.map((s) => h('tr', { class: 'clickable', onclick: () => (location.hash = '#segments/' + s.segment_id) }, h('td', null, h('a', { href: '#segments/' + s.segment_id }, h('b', null, s.segment_id + ' ' + s.segment_name))), h('td', null, stageChip(s.market_stage?.stage) || '—'), h('td', null, s.regulatory_access?.overall ? chip(s.regulatory_access.overall, /high/i.test(s.regulatory_access.overall) ? 'bad' : /med/i.test(s.regulatory_access.overall) ? 'warn' : 'good') : '—'), h('td', { class: 'small' }, s.attractiveness?.verdict || '—'))))))) : null,
    reg.length ? card('Gap registry: where the evidence points before red-teaming', h('p', { class: 'small muted' }, 'Initial attractiveness comes from the segment analyses and the registry consolidation; the three-lens red team and 18-criterion scores replace it when that stage completes.'), h('div', { class: 'stack' }, ['high', 'medium', 'low', 'second'].map((lvl) => { const rows = reg.filter((g) => attr(g).startsWith(lvl)); return rows.length ? h('div', null, h('div', { class: 'eyebrow', style: { margin: '6px 0' } }, (lvl === 'second' ? 'second-generation candidates' : lvl + ' initial attractiveness') + ' · ' + rows.length), h('ul', null, rows.map((g) => h('li', null, h('a', { href: '#gaps/' + g.id }, h('span', { class: 'mono' }, g.id + ' '), g.title), ' ', chips(g.categories, 'cat'))))) : null; }))) : null,
    Object.keys(ev).length ? card('Evidence in brief', h('div', { class: 'stack' }, EV_ORDER.filter((k) => ev[k]?.summary).map((k) => h('div', null, h('h4', null, h('a', { href: '#evidence/' + k }, ev[k].name || k)), h('p', { class: 'small' }, ev[k].summary))))) : null,
    ch.taxonomy_critique ? card('Taxonomy critique from the chain map', kv([['Keep', val(ch.taxonomy_critique.keep, { chips: true })], ['Change', val(ch.taxonomy_critique.change)], ['Added segments', val(ch.taxonomy_critique.added_segments)]])) : null,
  ];
}
function heroRadar(gaps, verdictOf) {
  const svg = svgEl('svg', { class: 'hero-radar', viewBox: '0 0 360 360', 'aria-hidden': 'true' });
  [60, 115, 170].forEach((r) => svg.append(svgEl('circle', { cx: 180, cy: 180, r })));
  svg.append(svgEl('line', { x1: 10, y1: 180, x2: 350, y2: 180 }), svgEl('line', { x1: 180, y1: 10, x2: 180, y2: 350 }));
  const a0 = (-34 * Math.PI) / 180;
  svg.append(svgEl('g', { class: 'sweep' }, svgEl('path', { d: `M180,180 L180,10 A170,170 0 0 0 ${(180 + 170 * Math.sin(a0)).toFixed(1)},${(180 - 170 * Math.cos(a0)).toFixed(1)} Z`, fill: 'rgba(95,208,176,.16)' }), svgEl('line', { x1: 180, y1: 180, x2: 180, y2: 10, style: 'stroke: rgba(95,208,176,.7)' })));
  gaps.forEach((g, i) => {
    const ang = (i * 137.508) % 360, rad = 38 + ((i * 53) % 124);
    const x = 180 + rad * Math.sin((ang * Math.PI) / 180), y = 180 - rad * Math.cos((ang * Math.PI) / 180);
    const k = verdictOf(g);
    svg.append(svgEl('circle', { class: 'blip' + (k === 'borderline' || k === 'survive' ? ' warm' : ''), cx: x.toFixed(1), cy: y.toFixed(1), r: k === 'borderline' || k === 'survive' ? 4.5 : 2.6, style: `animation-delay:${((ang / 360) * 7 - 7).toFixed(2)}s` }));
  });
  return svg;
}
function kpi(n, label, sub) {
  return h('div', { class: 'kpi' }, h('div', { class: 'v', dataset: { count: String(n) } }, String(n)), h('div', { class: 'l' }, label), sub ? h('div', { class: 'kpi-sub' }, sub) : null);
}
function bottomLine(ff) {
  const pf = ff?.portfolio; if (!pf) return null;
  const idOf = (t) => (String(t || '').match(/\bG\d{2}\b/) || [])[0];
  const gapT = (id) => (D.registry?.gaps || []).find((g) => g.id === id)?.title || '';
  const betCard = (tone, iconName, eyebrow, title, text) => { const id = idOf(text); return h('div', { class: 'bl-card', style: { '--bl': tone } }, h('div', { class: 'eyebrow' }, eyebrow), h('h3', null, icon(iconName, 18), title), id ? h('a', { class: 'bl-gap', href: '#opportunities/' + id }, h('span', { class: 'mono' }, id), ' ', gapT(id)) : null, rich(String(text || '').replace(/^G\d{2}\s*[-–—]\s*/, ''), { limit: 2, threshold: 140 })); };
  return h('section', { class: 'stack' },
    h('div', { class: 'section-head' }, h('div', { class: 'eyebrow' }, 'Bottom line for the two founders'), h('h2', null, 'What to do with $250k')),
    h('div', { class: 'bottom-line' },
      betCard('var(--good)', 'opportunities', 'Pursue, gated', 'Primary bet', pf.primary),
      betCard('var(--s2)', 'plan', 'Fund only if the primary fails', 'Fallback', pf.secondary),
      betCard('var(--s4)', 'founderfit', 'Cheap side project', 'Option', pf.option)),
    arr(ff.do_not_do).length ? h('div', { class: 'bl-card avoid', style: { '--bl': 'var(--critical)' } }, h('div', { class: 'eyebrow' }, 'Avoid'), h('h3', null, 'What not to do (' + arr(ff.do_not_do).length + ' rules)'), rich(arr(ff.do_not_do).map((x) => String(x).replace(/\s+/g, ' ').trim().replace(/([^.])$/, '$1.')).join(' '), { limit: 4, threshold: 0 }), h('a', { class: 'small', href: '#founderfit' }, 'Full founder-fit analysis →')) : null);
}
function oppFlips(survivors) {
  const ff = D.founderfit || {};
  return h('div', { class: 'flip-grid' }, survivors.map((s, i) => {
    const sc = s.score || {}; const k = String(sc.verdict || 'pending').toLowerCase();
    const gtm = D.survivors?.[s.id]?.gtm || {}; const tech = D.survivors?.[s.id]?.tech || {};
    const rank = arr(ff.founder_fit?.ranking).findIndex((x) => x.gap_id === s.id);
    const rk = arr(ff.founder_fit?.ranking)[rank] || {};
    const q = gtm.most_important_question || {};
    const back = [
      rk.reaches_fundable_milestone_in_12_months ? [h('div', { class: 'eyebrow' }, 'Fundable within 12 months?'), P(inline(firstSentences(rk.reaches_fundable_milestone_in_12_months, 1, 190)))] : [h('div', { class: 'eyebrow' }, 'Verdict'), P(firstSentences(sc.verdict_rationale || '', 2, 220))],
      q.build_first ? [h('div', { class: 'eyebrow' }, 'Build first'), P(inline(firstSentences(q.build_first, 1, 170)))] : null,
      h('a', { class: 'flip-cta', href: '#opportunities/' + s.id }, 'Open the deep dive →')];
    return flipCard({ className: 'v-' + k, href: '#opportunities/' + s.id, label: s.id + ' ' + (s.reg?.title || ''), height: 300,
      front: [h('div', { class: 'flip-meta' }, h('span', { class: 'mono muted' }, s.id), verdictBadge(sc.verdict), rank >= 0 ? chip(['Primary bet', 'Fallback', 'Option'][rank] || 'Rank ' + (rank + 1), 'outline') : null), h('div', { class: 'flip-title' }, s.reg?.title || s.id), D.survivors?.[s.id]?.status ? h('div', { class: 'small muted' }, 'Status: ' + D.survivors[s.id].status) : null, h('div', { class: 'chips' }, chips(s.reg?.categories, 'cat')), h('div', { class: 'flip-foot' }, h('span', null, 'Market ', scorePill(sc.market_attractiveness ?? 0)), h('span', null, 'Founder fit ', scorePill(sc.founder_fit ?? 0)))],
      back });
  }));
}
route('overview', () => {
  const ex = D.executive || {};
  const m = D.meta || {}; const c = m.counts || {};
  const ff = D.founderfit || {};
  const gaps = arr(D.registry?.gaps);
  const vOf = (g) => String(D.gaps?.[g.id]?.score?.verdict || 'pending').toLowerCase();
  const V = m.verdicts || {};
  const alive = gaps.filter((g) => ['survive', 'borderline'].includes(vOf(g)));
  const scored = (V.survive || 0) + (V.borderline || 0) + (V.kill || 0);
  const survivors = arr(D.survivorsOrder).map((id) => ({ id, reg: gaps.find((g) => g.id === id), score: D.gaps?.[id]?.score }));
  const hero = h('section', { class: 'hero' }, heroRadar(gaps, vOf),
    h('div', { class: 'eyebrow' }, 'C4ISR startup landscape · research as of ' + (m.generated || 'September 2026')),
    scored ? h('h1', null, h('em', null, String(V.kill || 0) + ' of ' + scored), ' candidate gaps failed the red team.') : h('h1', null, 'Where can two founders with $250k build in C4ISR?'),
    alive.length ? h('p', { class: 'hero-sub' }, (alive.length === 1 ? 'One survives, and only as borderline: ' : alive.length + ' survive: '), alive.map((g, i) => { const rk = arr(ff.founder_fit?.ranking).find((x) => x.gap_id === g.id); const short = (rk?.title || g.title).split(/\s[(\-–]/)[0].trim(); return [i ? '; ' : '', h('b', null, g.id + ', a ' + short.charAt(0).toLowerCase() + short.slice(1))]; }), '. It is worth a gated 90-day validation, not a full company build-out.') : null,
    h('p', { class: 'hero-sub small-sub' }, 'Question studied: where in modern C4ISR are there important, funded, technically tractable problems that are still unsolved and could support a new company for two university founders?'),
    h('div', { class: 'hero-actions' },
      alive[0] ? h('a', { class: 'hero-btn primary', href: '#opportunities/' + alive[0].id }, 'See the survivor', h('span', { 'aria-hidden': 'true' }, '→')) : null,
      h('a', { class: 'hero-btn', href: '#gaps' }, 'All ' + gaps.length + ' gaps'),
      h('a', { class: 'hero-btn', href: '#founderfit' }, 'Founder fit'),
      h('a', { class: 'hero-btn', href: '#architecture' }, 'How C4ISR works')));
  return h('div', { class: 'page' }, hero,
    h('div', { class: 'kpis' },
      kpi(c.companies || 0, 'companies profiled'),
      kpi(c.segments || 0, 'market segments analysed'),
      kpi(c.findings || 0, 'evidence findings'),
      kpi(c.gaps || 0, c.scored_gaps ? 'gaps red-teamed' : 'gaps in registry'),
      kpi((V.survive || 0) + (V.borderline || 0), 'survived', (V.borderline || 0) + ' borderline · ' + (V.kill || 0) + ' killed'),
      kpi(c.sources || 0, 'sources cited')),
    bottomLine(ff.founder_fit),
    verdictStrip(),
    survivors.length ? card(h('div', { class: 'card-head' }, h('h3', null, 'The three deep-dived opportunities'), h('span', { class: 'small muted' }, 'Hover or tap a card to flip it')), oppFlips(survivors), h('p', { class: 'small muted', style: { marginTop: '12px' } }, 'Scores run from 0 to 5 and are analytical judgments, not facts. Market attractiveness ignores this team. Founder fit is specific to two founders with about $250k.')) : null,
    ex.primary_conclusion ? h('div', { class: 'callout' }, h('div', { class: 'eyebrow' }, 'Primary conclusion, in full'), rich(ex.primary_conclusion, { limit: 6 })) : null,
    ...(ex.sections?.length ? [] : interimLandscape()),
    ex.sections?.length ? h('section', { class: 'stack' }, h('div', { class: 'section-head' }, h('div', { class: 'eyebrow' }, 'Deliverable 1'), h('h2', null, 'Executive landscape'), h('p', { class: 'muted small' }, 'Eight sections. Each paragraph is split into points; open a section to read it.')), h('div', { class: 'fold-list' }, arr(ex.sections).map((s, i) => fold(h('span', { class: 'fold-title' }, s.heading), [h('div', { class: 'stack' }, arr(s.paragraphs).map((p) => rich(p, { limit: 4 }))), s.label_notes ? h('p', { class: 'small muted' }, s.label_notes) : null], i === 0)))) : null,
    ex.sections?.length ? segmentVerdicts() : null,
    ex.key_numbers?.length ? card('Key numbers', dataTable(ex.key_numbers, [{ key: 'label', title: 'Metric' }, { key: 'value', title: 'Value', render: (r) => h('b', null, r.value) }, { key: 'note', title: 'Note' }, { key: 'source_url', title: 'Source', render: (r) => (r.source_url ? h('a', { href: r.source_url, target: '_blank', rel: 'noopener' }, shortUrl(r.source_url)) : '—') }], { filterable: false, id: 'keynums' })) : null,
    ex.top_uncertainties?.length ? card('Top uncertainties to resolve next', h('ol', { class: 'rt-ol' }, arr(ex.top_uncertainties).map((u) => h('li', null, isStr(u) ? leadBold(u) : val(u))))) : null,
    statusPanel(),
    ex.saturation_statement ? card('Research saturation', rich(ex.saturation_statement, { limit: 3 })) : null,
    sourceList(ex.sources));
});

route('architecture', (r) => {
  const ch = D.chain || {}; const steps = arr(ch.chain_steps);
  const active = steps.find((s) => s.step === r.id) || steps[0];
  const stepBtns = h('div', { class: 'chain' }, steps.map((s, i) => h('button', { class: s === active ? 'active' : '', onclick: () => (location.hash = '#architecture/' + s.step) }, h('span', { class: 'step-n' }, String(i + 1).padStart(2, '0')), h('span', { class: 'step-name' }, s.step), h('span', { class: 'step-sub' }, firstSentences(s.who_performs || '', 1, 64)))));
  const detail = active ? card(h('div', { class: 'card-head' }, h('h2', null, active.step), h('span', { class: 'chip mono' }, 'Step ' + (steps.indexOf(active) + 1) + ' of ' + steps.length)),
    active.what_happens ? h('div', { class: 'lede' }, rich(active.what_happens, { limit: 4 })) : null,
    h('div', { class: 'eyebrow', style: { margin: '14px 0 8px' } }, 'Who and what'),
    infoGrid([['Who performs it', active.who_performs], ['Hardware', active.hardware], ['Software', active.software], ['Data formats and protocols', arr(active.data_formats_protocols).length ? val(active.data_formats_protocols, { chips: true }) : null], ['Owning organizations', active.owning_organizations], ['Humans in the loop', active.human_in_loop]]),
    h('div', { class: 'eyebrow', style: { margin: '18px 0 8px' } }, 'Where it breaks'),
    infoGrid([['Latency sources', active.latency_sources], ['Comms dependencies', active.comms_dependencies], ['When connectivity disappears', active.when_connectivity_disappears], ['Interoperability requirements', active.interoperability_requirements], ['Security domain', active.security_domain]]),
    h('div', { class: 'eyebrow', style: { margin: '18px 0 8px' } }, 'Incumbent systems at this step'),
    arr(active.incumbent_systems).length ? h('div', { class: 'rec-grid sys-grid' }, arr(active.incumbent_systems).map((s, i) => h('article', { class: 'rec', style: { '--i': i } }, h('div', { class: 'rec-title' }, s.name, h('span', { class: 'cell-sub' }, [s.service, s.vendor].filter(Boolean).join(' · ') || '—')), s.note ? h('div', { class: 'rec-val' }, rich(s.note, { limit: 2, threshold: 160 })) : null))) : empty(),
    arr(active.sources).length ? h('p', { class: 'small muted', style: { marginTop: '10px' } }, 'Sources: ', arr(active.sources).map((s, i) => [i ? ' · ' : null, h('a', { href: s.url, target: '_blank', rel: 'noopener' }, shortUrl(s.url))])) : null) : empty();
  const g = ch.architecture_graph || {};
  const graph = arr(g.nodes).length ? layeredGraph(arr(g.nodes).map((n) => ({ ...n, id: n.id, label: n.label })), arr(g.edges), { layers: ['sensor', 'transport', 'data', 'processing', 'application', 'user', 'security'], layerOf: (n) => n.layer, layerLabel: (k) => ({ sensor: 'Sensors & sources', transport: 'Transport & comms', data: 'Data layer', processing: 'Processing & AI', application: 'Applications', user: 'Users & decisions', security: 'Security & cross-domain' })[k] || titleCase(k) }) : empty();
  return h('div', { class: 'page' },
    pageHead('Deliverable 2 · Architecture map', 'The C4ISR information and decision chain', 'Fifteen steps from collection to assessment. Click a step to see who performs it, what hardware and software are involved, which protocols matter, where latency and connectivity dependencies sit, and which incumbent systems own it today.'),
    stepBtns, detail,
    card(h('div', { class: 'card-head' }, h('h3', null, 'Architecture graph'), h('span', { class: 'small muted' }, 'Read top to bottom: data flows from sensors down to the people who decide')), P('Each row is one layer of the stack. Hover a box to trace what feeds it and what it feeds. Click a box to list its links and the protocol on each one.'), graph),
    ch.where_value_is_moving ? card('Where value is moving', rich(ch.where_value_is_moving, { limit: 5 })) : null,
    h('div', { class: 'grid cols-2' }, card('Crowded layers', val(ch.crowded_layers)), card('Fragmented layers', val(ch.fragmented_layers))),
    arr(ch.cross_cutting_observations).length ? card('Cross-cutting observations', evidenceList(arr(ch.cross_cutting_observations).map((o) => ({ claim: o.observation + (o.evidence ? ' — ' + o.evidence : ''), source_url: o.source_url, label: o.label })))) : null,
    ch.taxonomy_critique ? card('Taxonomy critique', kv([['Keep', val(ch.taxonomy_critique.keep, { chips: true })], ['Change', val(ch.taxonomy_critique.change)], ['Added segments', val(ch.taxonomy_critique.added_segments)]])) : null,
    arr(ch.glossary).length ? fold('Glossary (' + arr(ch.glossary).length + ')', h('dl', { class: 'kv' }, arr(ch.glossary).map((g) => [h('dt', null, g.term), h('dd', null, g.definition)]))) : null,
    sourceList(ch.sources));
});
