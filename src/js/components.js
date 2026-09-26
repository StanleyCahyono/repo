/* ===================== Components ===================== */

/* Sortable, filterable, paged table.
   cols: [{key, title, render?(row), sort?(row), num?, width?}] */
function dataTable(rows, cols, opts = {}) {
  const state = { sortKey: opts.sortKey || null, desc: !!opts.desc, page: 0, filter: '', filters: {} };
  const pageSize = opts.pageSize || 40;
  const wrap = h('div', { class: 'stack' });
  const toolbar = h('div', { class: 'toolbar' });
  const tableWrap = h('div', { class: 'table-wrap' });
  const pager = h('div', { class: 'pager' });
  if (opts.filterable !== false) { const inp = h('input', { type: 'search', placeholder: opts.placeholder || 'Filter rows…', 'aria-label': 'Filter rows', id: opts.id ? opts.id + '-filter' : null }); inp.addEventListener('input', () => { state.filter = inp.value.toLowerCase(); state.page = 0; render(); }); toolbar.append(inp); }
  for (const f of opts.facets || []) {
    const values = Array.from(new Set(rows.flatMap((r) => arr(f.get(r)).filter(Boolean)))).sort();
    const sel = h('select', { 'aria-label': f.title, id: opts.id ? opts.id + '-' + slug(f.title) : null }, h('option', { value: '' }, f.title + ': all'), values.map((v) => h('option', { value: v }, String(v).length > 42 ? String(v).slice(0, 40) + '…' : v)));
    sel.addEventListener('change', () => { state.filters[f.title] = sel.value; state.page = 0; render(); });
    f._sel = sel; toolbar.append(sel);
  }
  const countEl = h('span', { class: 'small muted' });
  toolbar.append(h('span', { class: 'spacer' }), countEl);
  const rowText = (r) => cols.map((c) => { const v = c.text ? c.text(r) : r[c.key]; return typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''); }).join(' ').toLowerCase();
  rows.forEach((r) => (r.__t = rowText(r)));
  function current() {
    let out = rows;
    if (state.filter) { const terms = state.filter.split(/\s+/).filter(Boolean); out = out.filter((r) => terms.every((t) => r.__t.includes(t))); }
    for (const f of opts.facets || []) { const v = state.filters[f.title]; if (v) out = out.filter((r) => arr(f.get(r)).includes(v)); }
    if (state.sortKey) { const c = cols.find((x) => x.key === state.sortKey); const get = c.sort || ((r) => (c.num ? num(r[c.key]) : String(r[c.key] ?? '').toLowerCase())); out = out.slice().sort((a, b) => { const x = get(a), y = get(b); return (x < y ? -1 : x > y ? 1 : 0) * (state.desc ? -1 : 1); }); }
    return out;
  }
  function render() {
    const all = current(); const start = state.page * pageSize; const slice = all.slice(start, start + pageSize);
    countEl.textContent = all.length + ' of ' + rows.length;
    tableWrap.innerHTML = '';
    const thead = h('thead', null, h('tr', null, cols.map((c) => h('th', { class: (c.num ? 'num ' : '') + (state.sortKey === c.key ? 'sorted ' + (state.desc ? 'desc' : '') : ''), style: c.width ? { minWidth: c.width } : null, onclick: () => { if (state.sortKey === c.key) state.desc = !state.desc; else { state.sortKey = c.key; state.desc = !!c.num; } render(); } }, c.title))));
    const tbody = h('tbody', null, slice.map((r) => { const tr = h('tr', { class: opts.onRow ? 'clickable' : '' }, cols.map((c) => h('td', { class: c.num ? 'num' : '' }, c.render ? c.render(r) : val(r[c.key])))); if (opts.onRow) tr.addEventListener('click', (e) => { if (e.target.closest('a')) return; opts.onRow(r); }); return tr; }));
    if (!slice.length) tbody.append(h('tr', null, h('td', { colspan: cols.length, class: 'empty' }, 'No rows match.')));
    tableWrap.append(h('table', { class: 'data' }, thead, tbody));
    pager.innerHTML = '';
    if (all.length > pageSize) { const pages = Math.ceil(all.length / pageSize); pager.append(h('button', { class: 'btn small', disabled: state.page === 0 || null, onclick: () => { state.page--; render(); } }, '‹ Prev'), h('span', null, 'Page ' + (state.page + 1) + ' of ' + pages), h('button', { class: 'btn small', disabled: state.page >= pages - 1 || null, onclick: () => { state.page++; render(); } }, 'Next ›')); }
  }
  render();
  wrap.append(toolbar, tableWrap, pager);
  return wrap;
}

/* Horizontal score bars (0..max), sequential single hue. */
function scoreBars(items, max = 5) {
  return h('div', { class: 'bars' }, items.map((it) => { const v = clamp(num(it.value), 0, max); const row = h('div', { class: 'bar-row' + (it.warn ? ' warn' : '') }, h('span', { class: 'bar-label', title: it.label }, it.label), h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: (v / max * 100) + '%' } })), h('span', { class: 'bar-val' }, String(v))); if (it.tip) withTip(row, it.tip); return row; }));
}
function scorePill(v) { const n = Math.round(num(v)); return h('span', { class: 'score-pill s' + clamp(n, 0, 5) }, typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(1) : String(n)); }
function verdictBadge(v) { const k = String(v || 'pending').toLowerCase(); const cls = k.startsWith('surv') ? 'survive' : k.startsWith('border') ? 'borderline' : k.startsWith('kill') || k.startsWith('reject') ? 'kill' : 'pending'; return h('span', { class: 'verdict ' + cls }, cls === 'pending' ? 'pending' : v); }
function strengthMeter(n) { return h('div', { class: 'strength', title: 'Bear-case strength ' + n + '/5' }, [1, 2, 3, 4, 5].map((i) => h('i', { class: i <= num(n) ? 'on' : '' }))); }

/* Layered directed graph (SVG). nodes: [{id,label,layer|kind|type,...}], edges: [{from,to,label}]
   layers: ordered list of layer keys; layerOf(node) -> key. */
function layeredGraph(nodes, edges, opts = {}) {
  const layerKeys = opts.layers || Array.from(new Set(nodes.map(opts.layerOf)));
  const layerOf = opts.layerOf || ((n) => n.layer);
  const byLayer = layerKeys.map((k) => nodes.filter((n) => layerOf(n) === k));
  const unplaced = nodes.filter((n) => !layerKeys.includes(layerOf(n)));
  if (unplaced.length) { layerKeys.push('other'); byLayer.push(unplaced); }
  const horizontal = opts.direction !== 'vertical';
  const nodeW = opts.nodeW || 150, nodeH = opts.nodeH || 54, gapX = opts.gapX || 70, gapY = opts.gapY || 14;
  const pos = {};
  const maxPerLayer = Math.max(1, ...byLayer.map((l) => l.length));
  let width, height;
  if (horizontal) {
    width = layerKeys.length * (nodeW + gapX) + 20; height = maxPerLayer * (nodeH + gapY) + 40;
    byLayer.forEach((layer, li) => { const total = layer.length * (nodeH + gapY) - gapY; const y0 = (height - 30 - total) / 2 + 30; layer.forEach((n, i) => { pos[n.id] = { x: 10 + li * (nodeW + gapX), y: y0 + i * (nodeH + gapY) }; }); });
  } else {
    width = maxPerLayer * (nodeW + gapY) + 20; height = layerKeys.length * (nodeH + gapX) + 20;
    byLayer.forEach((layer, li) => { const total = layer.length * (nodeW + gapY) - gapY; const x0 = (width - total) / 2; layer.forEach((n, i) => { pos[n.id] = { x: x0 + i * (nodeW + gapY), y: 30 + li * (nodeH + gapX) }; }); });
  }
  const svg = svgEl('svg', { class: 'graph', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': opts.label || 'Diagram' });
  // layer labels
  layerKeys.forEach((k, li) => { const x = horizontal ? 10 + li * (nodeW + gapX) : 10; const y = horizontal ? 18 : 30 + li * (nodeH + gapX) - 8; svg.append(svgEl('text', { x, y, class: 'layer-label' }, titleCase(k))); });
  const edgeEls = [];
  for (const e of edges) { const a = pos[e.from], b = pos[e.to]; if (!a || !b) continue; let d; if (horizontal) { const x1 = a.x + nodeW, y1 = a.y + nodeH / 2, x2 = b.x, y2 = b.y + nodeH / 2; const c = (x2 - x1) / 2; d = `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`; } else { const x1 = a.x + nodeW / 2, y1 = a.y + nodeH, x2 = b.x + nodeW / 2, y2 = b.y; const c = (y2 - y1) / 2; d = `M${x1},${y1} C${x1},${y1 + c} ${x2},${y2 - c} ${x2},${y2}`; } const p = svgEl('path', { d, class: 'edge', 'data-from': e.from, 'data-to': e.to }); if (e.label) p.append(svgEl('title', null, e.label)); svg.append(p); edgeEls.push({ el: p, e }); }
  for (const n of nodes) { const p = pos[n.id]; if (!p) continue; const g = svgEl('g', { class: 'node' + (n.href ? ' link' : ''), transform: `translate(${p.x},${p.y})` }); g.append(svgEl('rect', { width: nodeW, height: nodeH })); const lines = wrapText(n.label, Math.floor(nodeW / 6.6)); const shown = lines.slice(0, 3); if (lines.length > 3) shown[2] = shown[2].replace(/\s?\S*$/, '…'); shown.forEach((ln, i) => g.append(svgEl('text', { x: nodeW / 2, y: nodeH / 2 + (i - (shown.length - 1) / 2) * 13 + 4, 'text-anchor': 'middle' }, ln))); g.append(svgEl('title', null, n.label + (n.note ? ' — ' + n.note : ''))); g.addEventListener('mouseenter', () => { g.classList.add('hl'); edgeEls.forEach(({ el, e }) => el.classList.toggle('hl', e.from === n.id || e.to === n.id)); }); g.addEventListener('mouseleave', () => { g.classList.remove('hl'); edgeEls.forEach(({ el }) => el.classList.remove('hl')); }); if (n.href) g.addEventListener('click', () => (location.hash = n.href)); if (opts.onNode) g.addEventListener('click', () => opts.onNode(n)); svg.append(g); }
  return h('div', { class: 'graph-wrap' }, svg);
}
function wrapText(s, maxChars) { const words = String(s || '').split(/\s+/); const lines = []; let cur = ''; for (const w of words) { if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) lines.push(cur); return lines; }

/* Heatmap grid: xs (columns), ys (rows), cell(x,y) -> {value, label, tip, onClick} */
function heatmap(xs, ys, cellFn, opts = {}) {
  const maxV = Math.max(1, ...ys.flatMap((y) => xs.map((x) => num((cellFn(x, y) || {}).value))));
  const grid = h('div', { class: 'heat', style: { gridTemplateColumns: 'minmax(120px, auto) repeat(' + xs.length + ', minmax(64px, 1fr))' } });
  grid.append(h('div'));
  xs.forEach((x) => grid.append(h('div', { class: 'hx' }, opts.xLabel ? opts.xLabel(x) : x)));
  ys.forEach((y) => { grid.append(h('div', { class: 'hy' }, opts.yLabel ? opts.yLabel(y) : y)); xs.forEach((x) => { const c = cellFn(x, y) || { value: 0 }; const v = num(c.value); const step = v === 0 ? 0 : clamp(Math.ceil((v / maxV) * 6), 1, 6); const el = h('div', { class: 'cell' + (v === 0 ? ' empty' : ''), style: v ? { background: `var(--seq-${step})`, color: step >= 4 ? '#fff' : 'var(--ink)' } : null, role: 'button', tabindex: 0 }, c.label != null ? c.label : String(v)); if (c.tip) withTip(el, c.tip); if (c.onClick) { el.addEventListener('click', () => c.onClick(el)); el.addEventListener('keydown', (e) => { if (e.key === 'Enter') c.onClick(el); }); } grid.append(el); }); });
  return grid;
}

/* Stacked horizontal bars: rows [{label, segments: [{key, value}], total}] with fixed categorical order for keys */
const SERIES = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];
function stackedBars(rows, keys, opts = {}) {
  const max = opts.composition ? 1 : Math.max(1, ...rows.map((r) => r.total ?? r.segments.reduce((a, s) => a + num(s.value), 0)));
  const colorOf = (k) => `var(${SERIES[Math.min(keys.indexOf(k), 7)] || '--s8'})`;
  const wrap = h('div', { class: 'stack' });
  wrap.append(h('div', { class: 'stack-bars' }, rows.map((r) => { const total = r.total ?? r.segments.reduce((a, s) => a + num(s.value), 0); const track = h('div', { class: 'stack-track', style: { width: opts.composition ? '100%' : (total / max * 100) + '%' } }); for (const s of r.segments) { if (!num(s.value)) continue; const seg = h('div', { class: 'stack-seg', style: { flex: num(s.value) + ' 0 0', background: colorOf(s.key) } }); withTip(seg, () => `<b>${esc(r.label)}</b><br>${esc(titleCase(s.key))}: ${esc(fmtMoney(num(s.value)))}${total ? ' (' + Math.round(num(s.value) / total * 100) + '% of stage)' : ''}${s.note ? '<br>' + esc(s.note) : ''}`); track.append(seg); } return h('div', { class: 'stack-row' }, h('span', { class: 'bar-label', title: r.label }, r.label), h('div', null, track), h('span', { class: 'bar-val num' }, opts.fmt ? opts.fmt(total) : fmtMoney(total))); })));
  wrap.append(h('div', { class: 'legend' }, keys.map((k) => h('span', null, h('i', { class: 'sw', style: { background: colorOf(k) } }), titleCase(k)))));
  return wrap;
}

/* Timeline */
function timeline(events) { const ev = arr(events).filter((e) => e && (e.event || e.date || e.year)); if (!ev.length) return empty(); return h('div', { class: 'timeline' }, ev.map((e) => h('div', { class: 'tl-item' }, h('div', null, h('span', { class: 'tl-date' }, e.date || e.year || ''), e.type ? h('span', { class: 'chip mono tl-type' }, e.type) : null), h('div', null, e.event || e.title || ''), e.source_url ? h('a', { class: 'small', href: e.source_url, target: '_blank', rel: 'noopener' }, shortUrl(e.source_url)) : null))); }

/* Evidence list */
function evidenceList(evidence) { const ev = arr(evidence).filter(Boolean); if (!ev.length) return empty(); return h('div', { class: 'stack' }, ev.map((e) => (isStr(e) ? h('div', { class: 'ev-item' }, e) : sourceLine(e)))); }

/* Contract table with ceiling/obligated discipline */
function contractTable(contracts, opts = {}) {
  const rows = arr(contracts).filter((c) => c && (c.title || c.customer || c.vendor));
  if (!rows.length) return empty('No contract evidence recorded.');
  const cols = [];
  if (opts.showVendor) cols.push({ key: 'vendor', title: 'Vendor' });
  cols.push({ key: 'title', title: 'Contract', render: (c) => h('div', null, c.title || '—', c.contracting_org ? h('span', { class: 'cell-sub' }, c.contracting_org) : null) }, { key: 'customer', title: 'Customer' }, { key: 'vehicle_type', title: 'Vehicle', render: (c) => c.vehicle_type || c.vehicle || '—' }, { key: 'ceiling', title: 'Ceiling', render: (c) => c.ceiling || '—' }, { key: 'obligated', title: 'Obligated / awarded', render: (c) => h('div', null, c.obligated || c.awarded_value || c.funded_amount || '—', c.obligated && c.awarded_value && c.obligated !== c.awarded_value ? h('span', { class: 'cell-sub' }, 'awarded ' + c.awarded_value) : null) }, { key: 'date', title: 'Date', render: (c) => c.date || '—' }, { key: 'prototype_or_production', title: 'Stage', render: (c) => h('div', null, c.prototype_or_production ? chip(c.prototype_or_production, /prod/i.test(c.prototype_or_production) && !/proto/i.test(c.prototype_or_production) ? 'good' : 'outline') : '—', c.prime_or_sub ? h('span', { class: 'cell-sub' }, c.prime_or_sub) : null) }, { key: 'confidence', title: 'Source', render: (c) => h('div', null, c.source_url ? h('a', { href: c.source_url, target: '_blank', rel: 'noopener' }, shortUrl(c.source_url)) : '—', confTag(c.confidence)) });
  return dataTable(rows, cols, { filterable: rows.length > 8, pageSize: 25 });
}

/* Expertise matrix rendering */
const EXP_RANK = { critical: 3, important: 2, optional: 1 };
function expertiseMatrix(m) {
  if (!m || typeof m !== 'object') return empty();
  const groups = Object.entries(m).filter(([, v]) => v && typeof v === 'object');
  if (!groups.length) return empty();
  return h('div', { class: 'grid cols-4' }, groups.map(([g, items]) => h('div', { class: 'stack' }, h('div', { class: 'eyebrow' }, titleCase(g)), h('div', { class: 'chips' }, Object.entries(items).filter(([, r]) => r && !/^n\/?a$/i.test(String(r))).sort((a, b) => (EXP_RANK[String(b[1]).toLowerCase()] || 0) - (EXP_RANK[String(a[1]).toLowerCase()] || 0)).map(([k, r]) => { const lvl = String(r).toLowerCase(); return chip(titleCase(k), lvl.startsWith('crit') ? 'bad' : lvl.startsWith('imp') ? 'amber' : 'outline'); })))));
}
