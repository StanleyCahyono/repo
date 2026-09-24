/* ===================== Core helpers ===================== */
const D = window.DATA || {};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
function svgEl(tag, attrs, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) { if (v != null && v !== false) el.setAttribute(k, v); }
  for (const c of children.flat(Infinity)) if (c != null) el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isStr = (v) => typeof v === 'string';
const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const nonEmpty = (v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0) && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
const INSUFFICIENT = /public evidence insufficient/i;
const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fmtMoney = (v) => {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return v >= 1e9 ? '$' + (v / 1e9).toFixed(v % 1e9 ? 1 : 0) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'k' : '$' + v;
  return String(v);
};
const num = (v) => (typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, '')) || 0);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* Render a value of unknown shape (string / array / object) into readable nodes */
function val(v, opts = {}) {
  if (v == null || v === '') return h('span', { class: 'empty' }, opts.empty || '—');
  if (typeof v === 'boolean') return h('span', null, v ? 'Yes' : 'No');
  if (typeof v === 'number') return h('span', { class: 'num' }, String(v));
  if (isStr(v)) {
    if (INSUFFICIENT.test(v)) return h('span', { class: 'empty' }, v);
    return h('span', null, linkify(v));
  }
  if (Array.isArray(v)) {
    if (!v.length) return h('span', { class: 'empty' }, opts.empty || '—');
    if (v.every(isStr) && opts.chips) return h('div', { class: 'chips' }, v.map((x) => h('span', { class: 'chip' }, x)));
    return h('ul', null, v.map((x) => h('li', null, val(x, opts))));
  }
  if (typeof v === 'object') {
    // Special-cased small objects
    if (v.source_url && (v.claim || v.title || v.what || v.pain)) return sourceLine(v);
    return h('dl', { class: 'kv nested' }, Object.entries(v).filter(([k]) => k !== 'source_url').map(([k, x]) => [h('dt', null, titleCase(k)), h('dd', null, val(x, opts))]));
  }
  return h('span', null, String(v));
}
function linkify(s) {
  const parts = String(s).split(/(https?:\/\/[^\s)\]]+)/g);
  return parts.map((p, i) => (i % 2 ? h('a', { href: p, target: '_blank', rel: 'noopener' }, shortUrl(p)) : p));
}
const shortUrl = (u) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname.length > 1 ? x.pathname.slice(0, 40) + (x.pathname.length > 40 ? '…' : '') : ''); } catch { return u; } };
function sourceLine(o) {
  const text = o.claim || o.title || o.what || o.pain || o.note || o.event || '';
  return h('div', { class: 'ev-item' },
    h('div', { class: 'ev-head' }, o.form ? h('span', { class: 'ev-form' }, o.form) : null, labelTag(o.label), confTag(o.confidence), o.tier ? h('span', { class: 'tier' }, 'T' + o.tier) : null, o.source_type ? h('span', { class: 'tier' }, o.source_type) : null),
    h('div', null, text),
    o.source_url ? h('a', { href: o.source_url, target: '_blank', rel: 'noopener' }, (o.source_title || shortUrl(o.source_url)) + (o.pub_date ? ' · ' + o.pub_date : '') + (o.event_date && o.event_date !== o.pub_date ? ' (event ' + o.event_date + ')' : '')) : (o.pub_date ? h('span', { class: 'small muted' }, o.pub_date) : null));
}
function labelTag(l) { if (!l) return null; const k = String(l).toLowerCase(); const cls = k.includes('fact') ? 'fact' : k.includes('infer') ? 'inference' : k.includes('hypo') ? 'hypothesis' : ''; return h('span', { class: 'label ' + cls }, l); }
function confTag(c) { if (!c) return null; const k = String(c).toLowerCase(); const cls = k.startsWith('high') ? 'high' : k.startsWith('med') ? 'medium' : k.startsWith('low') ? 'low' : ''; return h('span', { class: 'label ' + cls, title: 'Confidence' }, 'conf ' + c); }
function chip(text, cls = '') { const t = String(text ?? ''); return h('span', { class: 'chip ' + cls + (t.length > 26 ? ' wrap' : '') }, t); }
function chips(list, cls = '') { return h('div', { class: 'chips' }, arr(list).map((x) => chip(x, cls))); }
function kv(pairs) { return h('dl', { class: 'kv' }, pairs.filter(([, v]) => v !== undefined).map(([k, v]) => [h('dt', null, k), h('dd', null, v instanceof Node ? v : val(v))])); }
function card(title, ...body) { return h('section', { class: 'card' }, title ? (isStr(title) ? h('h3', null, title) : title) : null, ...body); }
function fold(title, body, open = false) { const d = h('details', { class: 'fold', open: open || null }, h('summary', null, title), h('div', { class: 'fold-body' })); d.querySelector('.fold-body').append(...arr(body).filter(Boolean)); return d; }
function tabs(defs, initial = 0) {
  const wrap = h('div');
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  const panel = h('div');
  let active = initial;
  const render = () => { panel.innerHTML = ''; const r = defs[active].render(); append(panel, [r]); $$('button', bar).forEach((b, i) => b.classList.toggle('active', i === active)); };
  defs.forEach((d, i) => bar.append(h('button', { role: 'tab', onclick: () => { active = i; render(); } }, d.title)));
  wrap.append(bar, panel);
  render();
  return wrap;
}
function pageHead(eyebrow, title, lede, meta) { return h('div', { class: 'page-head' }, eyebrow ? h('div', { class: 'eyebrow' }, eyebrow) : null, h('h1', null, title), lede ? h('p', { class: 'lede' }, lede) : null, meta ? h('div', { class: 'meta' }, meta) : null); }
function crumbs(list) { return h('div', { class: 'crumbs' }, list.map((c, i) => (i ? h('span', null, c.href ? h('a', { href: c.href }, c.text) : c.text) : h('a', { href: c.href }, c.text)))); }
function empty(msg = 'Public evidence insufficient.') { return h('p', { class: 'empty' }, msg); }
function sourceList(sources) { const s = arr(sources).filter((x) => x && (x.url || x.source_url)); if (!s.length) return null; return fold('Sources (' + s.length + ')', h('ol', { class: 'source-list' }, s.map((x) => h('li', null, h('a', { href: x.url || x.source_url, target: '_blank', rel: 'noopener' }, x.title || shortUrl(x.url || x.source_url)), x.pub_date ? ' · ' + x.pub_date : '', x.tier ? h('span', { class: 'tier' }, ' T' + x.tier) : null)))); }

/* ---------- Tooltip ---------- */
const tip = $('#tooltip');
function showTip(e, html) { tip.innerHTML = html; tip.hidden = false; moveTip(e); }
function moveTip(e) { const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8); const y = Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 8); tip.style.left = x + 'px'; tip.style.top = y + 'px'; }
function hideTip() { tip.hidden = true; }
function withTip(el, html) { el.addEventListener('mouseenter', (e) => showTip(e, typeof html === 'function' ? html() : html)); el.addEventListener('mousemove', moveTip); el.addEventListener('mouseleave', hideTip); return el; }

/* ---------- Theme ---------- */
const THEMES = ['system', 'light', 'dark'];
function applyTheme(t) { const root = document.documentElement; if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t); const b = $('#themeBtn'); if (b) b.title = 'Theme: ' + t; }
function initTheme() { let t = 'system'; try { t = localStorage.getItem('c4isr-theme') || 'system'; } catch {} applyTheme(t); $('#themeBtn').addEventListener('click', () => { t = THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]; applyTheme(t); try { localStorage.setItem('c4isr-theme', t); } catch {} }); }

/* ---------- Router ---------- */
const ROUTES = {};
function route(name, fn) { ROUTES[name] = fn; }
function parseHash() { const raw = location.hash.replace(/^#\/?/, ''); const parts = raw.split('/').map(decodeURIComponent); return { view: parts[0] || 'overview', id: parts[1] || '', sub: parts[2] || '' }; }
function navigate() {
  const r = parseHash();
  const fn = ROUTES[r.view] || ROUTES.overview;
  const main = $('#main');
  main.innerHTML = '';
  try { append(main, [fn(r)]); } catch (e) { console.error(e); main.append(h('div', { class: 'card' }, h('h2', null, 'Render error'), h('pre', null, String(e.stack || e)))); }
  $$('#sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.view === r.view));
  $('#sidebar').classList.remove('open');
  window.scrollTo({ top: 0 });
  document.title = (r.id ? (r.id + ' · ') : '') + titleCase(r.view) + ' · C4ISR Startup Landscape';
}
window.addEventListener('hashchange', navigate);

/* ---------- Sidebar ---------- */
function buildSidebar() {
  const counts = D.meta?.counts || {};
  const groups = [
    { title: 'Landscape', items: [['overview', 'Executive landscape'], ['architecture', 'Architecture map'], ['segments', 'Segment deep dives', counts.segments], ['whitespace', 'White-space map']] },
    { title: 'Market', items: [['buyers', 'Government buyers'], ['money', 'Money map'], ['companies', 'Company database', counts.companies], ['evidence', 'Evidence base', counts.findings], ['allied', 'Allied-market lens']] },
    { title: 'Opportunities', items: [['gaps', 'Gap registry', counts.gaps], ['opportunities', 'Surviving opportunities', counts.survivors], ['founderfit', 'Founder fit & matrix'], ['plan', '90-day plans']] },
    { title: 'About', items: [['method', 'Method, rules & audit'], ['mandate', 'Research mandate']] },
  ];
  const nav = $('#sidebar');
  nav.innerHTML = '';
  for (const g of groups) nav.append(h('div', { class: 'group' }, h('div', { class: 'eyebrow group-title' }, g.title), g.items.map(([v, t, c]) => h('a', { href: '#' + v, dataset: { view: v } }, t, c != null ? h('span', { class: 'count' }, String(c)) : null))));
  $('#navToggle').addEventListener('click', () => { const open = nav.classList.toggle('open'); $('#navToggle').setAttribute('aria-expanded', String(open)); });
}

/* ---------- Search ---------- */
let SEARCH_INDEX = null;
function buildSearchIndex() {
  const idx = [];
  for (const c of D.companies || []) idx.push({ kind: 'company', text: c.name + ' ' + (c.aka || '') + ' ' + arr(c.c4isr_products).map((p) => p.name).join(' '), title: c.name, sub: (c.headquarters || '') + (c.founding_year ? ' · ' + c.founding_year : ''), href: '#companies/' + c.slug });
  for (const g of D.registry?.gaps || []) idx.push({ kind: 'gap', text: g.id + ' ' + g.title + ' ' + (g.problem || ''), title: g.id + ' ' + g.title, sub: (D.gaps?.[g.id]?.score?.verdict || ''), href: '#gaps/' + g.id });
  for (const s of D.segments || []) idx.push({ kind: 'segment', text: s.segment_id + ' ' + s.segment_name + ' ' + arr(s.sub_taxonomy).map((x) => x.name).join(' '), title: s.segment_name, sub: s.segment_id, href: '#segments/' + s.segment_id });
  for (const [svc, b] of Object.entries(D.buyers || {})) { for (const o of arr(b.organizations)) idx.push({ kind: 'org', text: o.name + ' ' + (o.acronym || '') + ' ' + (o.portfolio || ''), title: o.name + (o.acronym ? ' (' + o.acronym + ')' : ''), sub: b.service, href: '#buyers/' + svc }); for (const p of arr(b.programs)) idx.push({ kind: 'program', text: p.name + ' ' + (p.description || ''), title: p.name, sub: b.service, href: '#buyers/' + svc + '/programs' }); }
  for (const [eid, e] of Object.entries(D.evidence || {})) for (const f of arr(e.findings)) idx.push({ kind: 'finding', text: f.title + ' ' + (f.detail || '').slice(0, 200), title: f.title, sub: e.name, href: '#evidence/' + eid });
  for (const s of arr(D.chain?.chain_steps)) idx.push({ kind: 'chain step', text: s.step + ' ' + (s.what_happens || ''), title: s.step, sub: 'Information chain', href: '#architecture/' + s.step });
  idx.forEach((x) => (x.lc = x.text.toLowerCase()));
  return idx;
}
function initSearch() {
  const input = $('#searchInput'); const box = $('#searchResults'); let active = -1; let results = [];
  const render = () => { box.innerHTML = ''; if (!results.length) { box.hidden = true; return; } box.hidden = false; results.forEach((r, i) => box.append(h('a', { class: 'sr' + (i === active ? ' active' : ''), href: r.href, onclick: () => { box.hidden = true; input.value = ''; } }, h('span', { class: 'kind' }, r.kind), h('span', null, r.title), h('span', { class: 'sub' }, r.sub)))); };
  input.addEventListener('input', () => { SEARCH_INDEX = SEARCH_INDEX || buildSearchIndex(); const q = input.value.trim().toLowerCase(); active = -1; if (q.length < 2) { results = []; render(); return; } const terms = q.split(/\s+/); results = SEARCH_INDEX.filter((x) => terms.every((t) => x.lc.includes(t))).slice(0, 40); render(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { active = Math.min(active + 1, results.length - 1); render(); e.preventDefault(); } else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); render(); e.preventDefault(); } else if (e.key === 'Enter' && results[active]) { location.hash = results[active].href; box.hidden = true; input.value = ''; } else if (e.key === 'Escape') { box.hidden = true; input.blur(); } });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) box.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); input.focus(); } });
}
