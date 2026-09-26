/* ===================== UX layer: readable text, flip cards, flow diagrams, motion ===================== */

/* ---------- Readable text ---------- */
const ABBREV = ['U.S.C.', 'C.F.R.', 'U.S.', 'U.K.', 'E.U.', 'e.g.', 'i.e.', 'vs.', 'Nos.', 'No.', 'Inc.', 'Ltd.', 'Co.', 'Corp.', 'Jr.', 'Dr.', 'Mr.', 'Ms.', 'St.', 'Gen.', 'Lt.', 'Col.', 'Maj.', 'Capt.', 'Sgt.', 'Adm.', 'Rep.', 'Sen.', 'approx.', 'est.', 'etc.', 'Fig.', 'al.', 'cf.', 'Jan.', 'Feb.', 'Mar.', 'Apr.', 'Jun.', 'Jul.', 'Aug.', 'Sept.', 'Sep.', 'Oct.', 'Nov.', 'Dec.', 'a.m.', 'p.m.', 'Mt.', 'Ft.', 'Vol.', 'Sec.', 'Art.', 'Para.', 'Rev.', 'Pub.', 'L.'];
const DOT = '․';
function protectDots(s) {
  let t = s;
  for (const a of ABBREV) if (t.includes(a)) t = t.split(a).join(a.replace(/\./g, DOT));
  t = t.replace(/\b([A-Z])\.(?=\s)/g, '$1' + DOT);
  return t;
}
const restoreDots = (s) => s.split(DOT).join('.');
function sentences(text) {
  const t = protectDots(String(text || '').replace(/\s+/g, ' ').trim());
  if (!t) return [];
  return t.split(/(?<=[.!?])\s+(?=[A-Z0-9("'“$€£~])/).map(restoreDots).map((s) => s.trim()).filter(Boolean);
}
function firstSentences(text, n = 2, maxLen = 320) {
  const s = sentences(text).slice(0, n).join(' ');
  return s.length > maxLen ? s.slice(0, maxLen).replace(/\s\S*$/, '') + '…' : s;
}
function enumerateItems(text) {
  const t = ' ' + text;
  const re = /\s\((\d{1,2}|[a-h])\)\s/g;
  const marks = [...t.matchAll(re)];
  if (marks.length < 2) return null;
  const first = marks[0][1];
  if (!['1', 'a', 'i'].includes(first)) return null;
  const pre = t.slice(0, marks[0].index).trim();
  const items = marks.map((m, i) => t.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : t.length).trim().replace(/[;,]?\s*(and|or)?\s*$/i, '').trim()).filter(Boolean);
  return { pre, items };
}
const INLINE_RE = /(https?:\/\/[^\s)\]]+)|\(\s*(FACT|INFERENCE|HYPOTHESIS|RECALL)(?:\s*[\/,]\s*((?:HIGH|MEDIUM|LOW)(?:-(?:HIGH|MEDIUM|LOW))?))?\s*\)|\b(FACT|INFERENCE|HYPOTHESIS|RECALL)(?:\s*[\/,]\s*((?:HIGH|MEDIUM|LOW)(?:-(?:HIGH|MEDIUM|LOW))?))?\b|((?:~|≈|about |over |nearly )?[$€£]\s?\d[\d,.]*\s?(?:billion|million|thousand|bn|mn|[BMKk](?![a-z]))?\+?)/g;
function inline(text) {
  const s = String(text ?? '');
  const out = []; let last = 0;
  for (const m of s.matchAll(INLINE_RE)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1]) out.push(h('a', { href: m[1], target: '_blank', rel: 'noopener' }, shortUrl(m[1])));
    else if (m[2] || m[4]) { const kind = (m[2] || m[4]); const conf = m[3] || m[5]; out.push(h('span', { class: 'label inline ' + kind.toLowerCase().replace('recall', 'hypothesis') }, kind + (conf ? ' · ' + conf : ''))); }
    else if (m[6]) out.push(h('strong', { class: 'money' }, m[6]));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
function leadBold(text) {
  const m = String(text).match(/^([^:.;]{3,70}):\s+(.+)$/s);
  if (m && !/^\d{1,2}$/.test(m[1].trim()) && !/https?$/.test(m[1])) return [h('span', { class: 'rt-lead' }, m[1] + ': '), ...inline(m[2])];
  return inline(text);
}
/* Split a very long sentence on top-level semicolons, but only when every part stands on its own. */
function splitLong(x) {
  if (x.length <= 300) return [x];
  const parts = []; let depth = 0, cur = '';
  for (let i = 0; i < x.length; i++) {
    const ch = x[i];
    if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth > 0) depth--;
    if (ch === ';' && depth === 0 && x[i + 1] === ' ') { parts.push(cur.trim()); cur = ''; i++; continue; }
    cur += ch;
  }
  parts.push(cur.trim());
  if (parts.length < 2 || parts.some((p) => p.length < 70 || /^(and|or|but)\b/i.test(p))) return [x];
  return parts.map((p, i) => { let t = i ? p.charAt(0).toUpperCase() + p.slice(1) : p; if (i < parts.length - 1 && !/[.!?)]$/.test(t)) t += '.'; return t; });
}
/* Render long prose as scannable bullets; short text stays a paragraph. */
function rich(text, opts = {}) {
  if (text == null || text === '') return h('span', { class: 'empty' }, '—');
  const s = String(text).replace(/\s+/g, ' ').trim();
  if (INSUFFICIENT.test(s) && s.length < 90) return h('span', { class: 'empty' }, s);
  const limit = opts.limit ?? 3;
  const threshold = opts.threshold ?? 220;
  let pre = '', items;
  const en = enumerateItems(s);
  if (en && en.items.length >= 2) { pre = en.pre; items = en.items; }
  else {
    if (s.length <= threshold) return h('p', { class: 'rt' }, leadBold(s));
    items = sentences(s).flatMap(splitLong);
    if (items.length <= 1) return h('p', { class: 'rt' }, leadBold(s));
  }
  const lis = items.map((x) => h('li', null, leadBold(x)));
  const wrap = h('div', { class: 'rt-block' });
  if (pre) wrap.append(h('p', { class: 'rt-pre' }, leadBold(pre)));
  const ul = h('ul', { class: 'rt-list' }, lis.slice(0, limit));
  wrap.append(ul);
  if (lis.length > limit) {
    const more = lis.slice(limit);
    const label = () => 'Show ' + more.length + ' more point' + (more.length > 1 ? 's' : '');
    const btn = h('button', { class: 'rt-more', type: 'button', 'aria-expanded': 'false' }, label());
    btn.addEventListener('click', (e) => { e.stopPropagation(); const open = btn.getAttribute('aria-expanded') === 'true'; if (!open) { ul.append(...more); btn.textContent = 'Show less'; } else { more.forEach((m) => m.remove()); btn.textContent = label(); } btn.setAttribute('aria-expanded', String(!open)); });
    wrap.append(btn);
  }
  return wrap;
}
/* Drop-in replacement for h('p', null, ...) that makes long single strings readable. */
function P(...args) {
  if (args.length === 1 && (typeof args[0] === 'string' || args[0] == null)) return rich(args[0]);
  return h('p', null, ...args);
}

/* ---------- Info tiles ---------- */
function infoGrid(pairs, opts = {}) {
  return h('div', { class: 'info-grid' + (opts.dense ? ' dense' : '') }, pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => h('div', { class: 'info-tile' }, h('div', { class: 'it-label' }, k), h('div', { class: 'it-body' }, v instanceof Node ? v : val(v)))));
}

/* ---------- Flip cards ---------- */
const CAN_HOVER = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
function flipCard({ front, back, href, label, className, height }) {
  const inner = h('div', { class: 'flip-inner' },
    h('div', { class: 'flip-face flip-front' }, front, h('span', { class: 'flip-hint', 'aria-hidden': 'true' }, CAN_HOVER ? 'hover to flip' : 'tap to flip')),
    h('div', { class: 'flip-face flip-back' }, back));
  const card = h('div', { class: 'flip ' + (className || ''), tabindex: 0, role: 'group', 'aria-label': label || '', style: height ? { '--flip-h': height + 'px' } : null }, inner);
  card.addEventListener('click', (e) => {
    if (e.target.closest('a,button')) return;
    if (CAN_HOVER && href) { location.hash = href; return; }
    card.classList.toggle('flipped');
  });
  card.addEventListener('keydown', (e) => { if ((e.key === 'Enter') && href && !e.target.closest('a,button')) { location.hash = href; } if (e.key === ' ' && !e.target.closest('a,button')) { e.preventDefault(); card.classList.toggle('flipped'); } });
  return card;
}

/* ---------- Flow diagram (HTML boxes + SVG connectors) ---------- */
let FLOW_SEQ = 0;
const LAYER_VARS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];
function flowDiagram(nodes, edges, opts = {}) {
  const uid = 'fl' + (++FLOW_SEQ);
  const layerOf = opts.layerOf || ((n) => n.layer);
  const present = new Set(nodes.map(layerOf));
  let layers = (opts.layers || []).filter((k) => present.has(k));
  layers = layers.concat([...present].filter((k) => !layers.includes(k)));
  const labelOf = opts.layerLabel || ((k) => titleCase(k || 'other'));
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const E = arr(edges).filter((e) => byId[e.from] && byId[e.to]);
  const wrap = h('div', { class: 'flow' });
  const scroller = h('div', { class: 'flow-scroll' });
  const stage = h('div', { class: 'flow-stage' });
  const svg = svgEl('svg', { class: 'flow-edges', 'aria-hidden': 'true' });
  const defs = svgEl('defs');
  defs.append(svgEl('marker', { id: uid + '-a', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svgEl('path', { d: 'M0,0 L10,5 L0,10 z', class: 'flow-arrow' })));
  defs.append(svgEl('marker', { id: uid + '-h', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svgEl('path', { d: 'M0,0 L10,5 L0,10 z', class: 'flow-arrow hl' })));
  svg.append(defs);
  stage.append(svg);
  const nodeEls = {};
  layers.forEach((k, li) => {
    const color = `var(${LAYER_VARS[li % LAYER_VARS.length]})`;
    const row = h('div', { class: 'flow-row', style: { '--c': color } }, h('div', { class: 'flow-row-head' }, h('i'), h('span', null, labelOf(k))));
    const box = h('div', { class: 'flow-nodes' });
    nodes.filter((n) => layerOf(n) === k).forEach((n) => {
      const el = h('button', { class: 'flow-node', type: 'button', dataset: { id: n.id } }, h('span', { class: 'flow-node-label' }, n.label || n.id));
      el.addEventListener('click', () => { state.sel = state.sel === n.id ? null : n.id; apply(); renderPanel(); });
      el.addEventListener('mouseenter', () => { state.hov = n.id; apply(); });
      el.addEventListener('mouseleave', () => { state.hov = null; apply(); });
      el.addEventListener('focus', () => { state.hov = n.id; apply(); });
      el.addEventListener('blur', () => { state.hov = null; apply(); });
      nodeEls[n.id] = el; box.append(el);
    });
    row.append(box); stage.append(row);
  });
  scroller.append(stage);
  const panel = h('div', { class: 'flow-panel', 'aria-live': 'polite' });
  wrap.append(scroller, panel);
  const state = { sel: null, hov: null };
  const paths = [];
  function draw() {
    const sr = stage.getBoundingClientRect();
    if (!sr.width || !stage.isConnected) return;
    paths.forEach((p) => p.el.remove()); paths.length = 0;
    const W = stage.scrollWidth, H = stage.scrollHeight;
    svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const rect = (id) => { const r = nodeEls[id].getBoundingClientRect(); return { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height }; };
    const outCount = {}, outIdx = {}, inCount = {}, inIdx = {};
    E.forEach((e) => { outCount[e.from] = (outCount[e.from] || 0) + 1; inCount[e.to] = (inCount[e.to] || 0) + 1; });
    const spread = (i, n, w) => (n <= 1 ? w / 2 : w * (0.2 + (0.6 * i) / (n - 1)));
    E.slice().sort((a, b) => rect(a.to).x - rect(b.to).x).forEach((e) => {
      const a = rect(e.from), b = rect(e.to);
      const oi = (outIdx[e.from] = (outIdx[e.from] ?? -1) + 1), ii = (inIdx[e.to] = (inIdx[e.to] ?? -1) + 1);
      const x1 = a.x + spread(oi, outCount[e.from], a.w), x2 = b.x + spread(ii, inCount[e.to], b.w);
      let d;
      if (b.y > a.y + a.h - 2) { const y1 = a.y + a.h, y2 = b.y - 1, c = Math.max(18, (y2 - y1) / 2); d = `M${x1},${y1} C${x1},${y1 + c} ${x2},${y2 - c} ${x2},${y2}`; }
      else if (b.y + b.h < a.y + 2) { const y1 = a.y, y2 = b.y + b.h + 1, c = Math.max(18, (y1 - y2) / 2); d = `M${x1},${y1} C${x1},${y1 - c} ${x2},${y2 + c} ${x2},${y2}`; }
      else { const y1 = a.y + a.h, y2 = b.y + b.h + 1; d = `M${x1},${y1} C${x1},${y1 + 26} ${x2},${y2 + 26} ${x2},${y2}`; }
      const p = svgEl('path', { d, class: 'flow-edge', 'marker-end': `url(#${uid}-a)` });
      if (e.label) p.append(svgEl('title', null, e.label));
      svg.append(p); paths.push({ el: p, e });
    });
    apply();
  }
  function apply() {
    const act = state.hov || state.sel;
    const linked = new Set(act ? [act] : []);
    if (act) E.forEach((e) => { if (e.from === act) linked.add(e.to); if (e.to === act) linked.add(e.from); });
    Object.entries(nodeEls).forEach(([id, el]) => { el.classList.toggle('active', id === act || id === state.sel); el.classList.toggle('dim', !!act && !linked.has(id)); });
    paths.forEach(({ el, e }) => { const on = !!act && (e.from === act || e.to === act); el.classList.toggle('hl', on); el.classList.toggle('dim', !!act && !on); el.setAttribute('marker-end', `url(#${uid}-${on ? 'h' : 'a'})`); });
  }
  function renderPanel() {
    panel.innerHTML = '';
    if (!state.sel) { panel.append(h('div', { class: 'fp-hint' }, h('b', null, nodes.length + ' boxes, ' + E.length + ' connections. '), 'Hover a box to trace its links; click it to list what it receives and sends.')); return; }
    const n = byId[state.sel];
    const ins = E.filter((e) => e.to === n.id), outs = E.filter((e) => e.from === n.id);
    const item = (e, otherId) => h('li', null, h('button', { class: 'fp-node', type: 'button', onclick: () => { state.sel = otherId; apply(); renderPanel(); } }, byId[otherId].label || otherId), e.label ? h('span', { class: 'fp-proto' }, e.label) : null);
    panel.append(h('div', { class: 'fp-head' }, h('span', { class: 'eyebrow' }, labelOf(layerOf(n))), h('h4', null, n.label || n.id), h('button', { class: 'btn small', type: 'button', onclick: () => { state.sel = null; apply(); renderPanel(); } }, 'Clear')),
      n.note ? rich(n.note) : null,
      h('div', { class: 'fp-cols' },
        h('div', null, h('div', { class: 'eyebrow' }, 'Receives from (' + ins.length + ')'), ins.length ? h('ul', { class: 'fp-list' }, ins.map((e) => item(e, e.from))) : h('p', { class: 'small muted' }, 'Nothing upstream in this diagram.')),
        h('div', null, h('div', { class: 'eyebrow' }, 'Sends to (' + outs.length + ')'), outs.length ? h('ul', { class: 'fp-list' }, outs.map((e) => item(e, e.to))) : h('p', { class: 'small muted' }, 'Nothing downstream in this diagram.'))));
  }
  renderPanel();
  if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(() => requestAnimationFrame(draw)); ro.observe(stage); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => requestAnimationFrame(draw));
  requestAnimationFrame(() => requestAnimationFrame(draw));
  return wrap;
}
function layeredGraph(nodes, edges, opts = {}) { return flowDiagram(nodes, edges, opts); }

/* ---------- Chain pipeline (user -> requirement -> program -> contracting -> budget -> vehicle -> vendors) ---------- */
function chainLegend() { return h('div', { class: 'pipe-legend' }, h('span', null, h('span', { class: 'pipe-n' }, '1'), ' confirmed step'), h('span', { class: 'pipe-step weak', style: { display: 'inline', padding: 0 } }, h('span', { class: 'pipe-n' }, '2')), h('span', null, ' dashed = not confirmed; a startup is most likely to get stuck here')); }
const CHAIN_STEPS = [['user', 'User'], ['requirement_owner', 'Requirement owner'], ['program_office', 'Program office'], ['contracting_office', 'Contracting office'], ['budget_line', 'Budget line'], ['contract_vehicle', 'Vehicle'], ['current_vendors', 'Current vendors']];
function chainPipeline(c) {
  return h('article', { class: 'pipe' },
    h('div', { class: 'pipe-head' }, h('h4', null, c.problem_area || '—'), c.confidence ? confTag(c.confidence) : null),
    h('ol', { class: 'pipe-steps' }, CHAIN_STEPS.map(([k, label], i) => { const v = c[k]; const unverified = !v || /not confirmed|unverified|insufficient|unknown/i.test(isStr(v) ? v : ''); return h('li', { class: 'pipe-step' + (unverified ? ' weak' : ''), title: unverified ? 'Not confirmed by public evidence' : null }, h('div', { class: 'pipe-label' }, h('span', { class: 'pipe-n' }, String(i + 1)), label), h('div', { class: 'pipe-val' }, Array.isArray(v) ? h('div', { class: 'chips' }, v.map((x) => { const cc = typeof findCompany === 'function' ? findCompany(x) : null; return cc ? h('a', { class: 'chip accent wrap', href: '#companies/' + cc.slug }, x) : chip(x, 'wrap'); })) : v ? rich(v, { limit: 2, threshold: 160 }) : h('span', { class: 'empty' }, 'Not identified'))); })));
}

/* ---------- Icons (inline, stroke) ---------- */
const ICON_PATHS = {
  overview: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  architecture: 'M12 3v4M12 17v4M5 12H3M21 12h-2M7 7l-1.5-1.5M17 7l1.5-1.5M7 17l-1.5 1.5M17 17l1.5 1.5M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z',
  segments: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  whitespace: 'M3 3h5v5H3zM10 3h4v5h-4zM16 3h5v5h-5zM3 10h5v4H3zM16 10h5v4h-5zM3 16h5v5H3zM10 16h4v5h-4zM16 16h5v5h-5z',
  buyers: 'M3 21h18M5 21V10M19 21V10M9 21V10M15 21V10M3 10l9-6 9 6z',
  money: 'M3 7h18v10H3zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM6 10v4M18 10v4',
  companies: 'M4 21V5l8-2v18M12 7l8 2v12M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2M2 21h20',
  evidence: 'M14 3H6v18h12V7zM14 3v4h4M9 12h6M9 16h4M16.5 17.5L19 20',
  allied: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  gaps: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10zM12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2z',
  opportunities: 'M4 20l6-6 4 4 6-8M14 10h6v6',
  founderfit: 'M9 7a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM17 8a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5zM3 20c0-3 3-5 6-5s6 2 6 5M14 19c.5-2 2-3.5 4-3.5s3 1 3.5 3',
  plan: 'M4 5h16v16H4zM4 9h16M8 3v4M16 3v4M8 14l2.5 2.5L16 11',
  method: 'M9 3h6M10 3v6L5 19a1 1 0 0 0 1 1.5h12a1 1 0 0 0 1-1.5L14 9V3M7.5 15h9',
  mandate: 'M6 3h12v18H6zM9 7h6M9 11h6M9 15h4',
};
function icon(name, size = 16) {
  const d = ICON_PATHS[name]; if (!d) return null;
  return svgEl('svg', { class: 'ico', width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, svgEl('path', { d }));
}

/* ---------- Post-render enhancers: count-up numbers, scroll reveal ---------- */
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function countUp(el) {
  const to = parseFloat(el.dataset.count); if (!isFinite(to)) return;
  const dec = (String(el.dataset.count).split('.')[1] || '').length;
  if (REDUCED) { el.textContent = to.toFixed(dec); return; }
  const t0 = performance.now(), dur = 900;
  const step = (t) => { const p = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - p, 3); el.textContent = (to * e).toFixed(dec); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
let REVEAL_IO = null;
function enhance(root) {
  $$('[data-count]', root).forEach(countUp);
  if (REDUCED || typeof IntersectionObserver !== 'function') return;
  if (!REVEAL_IO) REVEAL_IO = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.remove('will-reveal'); en.target.classList.add('revealed'); REVEAL_IO.unobserve(en.target); } }), { rootMargin: '0px 0px -40px 0px' });
  const vh = window.innerHeight;
  $$('.page > *', root).forEach((el) => { if (el.getBoundingClientRect().top > vh) { el.classList.add('will-reveal'); REVEAL_IO.observe(el); } });
}
