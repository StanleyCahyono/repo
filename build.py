#!/usr/bin/env python3
"""Assemble data/*.json into a single offline HTML file (index.html).

Usage:  python3 build.py            # reads data/, writes index.html
        python3 build.py --research <dir>   # first copy research JSON from a scratch dir into data/
"""
import json, os, re, sys, glob, shutil, datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, 'data')
SRC = os.path.join(ROOT, 'src')

def load(path, default=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except json.JSONDecodeError as e:
        print(f'!! invalid JSON: {path}: {e}', file=sys.stderr)
        return default

def slug(s):
    return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', str(s).lower()))

def copy_research(src):
    for sub in ('segments', 'buyers', 'companies', 'evidence', 'gaps', 'survivors', 'synthesis'):
        os.makedirs(os.path.join(DATA, sub), exist_ok=True)
        for f in glob.glob(os.path.join(src, sub, '*.json')):
            shutil.copy(f, os.path.join(DATA, sub, os.path.basename(f)))

TRACTION_WORDS = ('strong', 'moderate', 'weak', 'unknown')

def traction_of(c):
    t = str(c.get('traction') or '').lower()
    for w in TRACTION_WORDS:
        if t.startswith(w):
            return w
    # derive from evidence fields
    prod = str(c.get('evidence_prototype_to_production') or '')
    rep = str(c.get('evidence_repeat_procurement') or '')
    ok = lambda s: s and not re.search(r'insufficient|no evidence|none|not found|unknown', s, re.I)
    contracts = c.get('contracts') or []
    prodc = [x for x in contracts if re.search(r'prod', str(x.get('prototype_or_production') or ''), re.I) and not re.search(r'proto', str(x.get('prototype_or_production') or ''), re.I)]
    if (ok(prod) and ok(rep)) or len(prodc) >= 2:
        return 'strong'
    if ok(prod) or ok(rep) or contracts:
        return 'moderate'
    if c.get('operational_deployments') or c.get('exercises_demos'):
        return 'weak'
    return 'unknown'

def build_data():
    d = {}
    d['generated'] = datetime.date.today().isoformat()
    # chain map & segments
    segs = []
    for f in sorted(glob.glob(os.path.join(DATA, 'segments', 'S*.json'))):
        s = load(f)
        if not s: continue
        if s.get('segment_id') == 'S00' or 'chain_steps' in s:
            d['chain'] = s
        else:
            segs.append(s)
    d['segments'] = segs
    # buyers
    d['buyers'] = {}
    for k in ('joint', 'army', 'daf', 'navy', 'space'):
        b = load(os.path.join(DATA, 'buyers', k + '.json'))
        if b: d['buyers'][k] = b
    # companies (merge batches + discovery)
    companies, seen = [], {}
    for f in sorted(glob.glob(os.path.join(DATA, 'companies', 'B*.json'))):
        b = load(f) or {}
        for c in b.get('companies') or []:
            if not c.get('name'): continue
            c['batch_id'] = b.get('batch_id'); c['batch_theme'] = b.get('theme')
            key = slug(c['name'])
            if key in seen: continue
            seen[key] = c; companies.append(c)
    for f in sorted(glob.glob(os.path.join(DATA, 'companies', 'D*-researched.json'))):
        b = load(f) or {}
        for c in b.get('companies') or []:
            if not c.get('name'): continue
            key = slug(c['name'])
            if key in seen: continue
            c['batch_id'] = b.get('batch_id'); c['batch_theme'] = b.get('theme', 'discovered'); c['discovered_via'] = b.get('discovery_id')
            seen[key] = c; companies.append(c)
    for c in companies:
        c['slug'] = slug(c['name'])
        c['traction'] = traction_of(c)
        c['segment_ids'] = sorted({str(x).strip().upper() for x in (c.get('segment_ids') or []) if re.match(r'^S\d\d$', str(x).strip().upper())})
    companies.sort(key=lambda c: c['name'].lower())
    d['companies'] = companies
    d['discovery'] = [load(f) for f in sorted(glob.glob(os.path.join(DATA, 'companies', 'D*-discovery.json'))) if load(f)]
    # evidence
    d['evidence'] = {}
    for f in sorted(glob.glob(os.path.join(DATA, 'evidence', 'E*.json'))):
        e = load(f)
        if e: d['evidence'][e.get('evidence_id') or os.path.basename(f)[:3]] = e
    e07 = d['evidence'].get('E07') or {}
    st = e07.get('structured') or {}
    d['regulatoryMatrix'] = st.get('regulatory_matrix') or st.get('matrix') or []
    d['founderAnalysis'] = st.get('founder_analysis') or st.get('founder_specific_analysis') or None
    # gaps
    d['registry'] = load(os.path.join(DATA, 'gaps', 'registry.json')) or {'gaps': []}
    d['gaps'] = {}
    for g in d['registry'].get('gaps') or []:
        gid = g['id']
        card = load(os.path.join(DATA, 'gaps', gid + '.json'))
        score = load(os.path.join(DATA, 'gaps', gid + '-score.json'))
        verdicts = load(os.path.join(DATA, 'gaps', gid + '-verdicts.json'))
        d['gaps'][gid] = {'card': card, 'score': score, 'verdicts': verdicts or []}
    # survivors
    d['survivors'] = {}
    for f in sorted(glob.glob(os.path.join(DATA, 'survivors', 'G*-tech.json'))):
        t = load(f)
        if not t: continue
        gid = t.get('id') or os.path.basename(f).split('-')[0]
        d['survivors'].setdefault(gid, {})['tech'] = t
    for f in sorted(glob.glob(os.path.join(DATA, 'survivors', 'G*-gtm.json'))):
        g = load(f)
        if not g: continue
        gid = g.get('id') or os.path.basename(f).split('-')[0]
        d['survivors'].setdefault(gid, {})['gtm'] = g
    def rank(gid):
        s = (d['gaps'].get(gid) or {}).get('score') or {}
        v = str(s.get('verdict') or '').lower()
        return (0 if v.startswith('surv') else 1 if v.startswith('border') else 2, -(float(s.get('market_attractiveness') or 0) + float(s.get('founder_fit') or 0)))
    d['survivorsOrder'] = sorted(d['survivors'].keys(), key=rank)
    # syntheses
    for k in ('executive', 'whitespace', 'money_map', 'founder_fit', 'critic'):
        v = load(os.path.join(DATA, 'synthesis', k + '.json'))
        if v: d[{'money_map': 'money', 'founder_fit': 'founderfit'}.get(k, k)] = v
    # mandate
    try:
        d['mandate'] = open(os.path.join(DATA, 'mandate.md'), encoding='utf-8').read()
    except FileNotFoundError:
        d['mandate'] = ''
    # counts
    findings = sum(len(e.get('findings') or []) for e in d['evidence'].values())
    srcs = set()
    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in ('url', 'source_url') and isinstance(v, str) and v.startswith('http'): srcs.add(v)
                else: walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(d)
    d['meta'] = {'generated': d['generated'], 'counts': {'companies': len(companies), 'segments': len(segs), 'findings': findings, 'gaps': len(d['registry'].get('gaps') or []), 'survivors': len(d['survivorsOrder']), 'sources': len(srcs), 'buyers': len(d['buyers']), 'evidence_sweeps': len(d['evidence'])}}
    return d

def build_html(data):
    tpl = open(os.path.join(SRC, 'template.html'), encoding='utf-8').read()
    css = open(os.path.join(SRC, 'app.css'), encoding='utf-8').read()
    js_files = ['js/core.js', 'js/components.js', 'js/views/overview.js', 'js/views/segments.js', 'js/views/buyers.js', 'js/views/companies.js', 'js/views/evidence.js', 'js/views/gaps.js', 'js/views/opportunities.js', 'js/views/method.js']
    js = '\n'.join(open(os.path.join(SRC, f), encoding='utf-8').read() for f in js_files)
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    html = tpl.replace('/*__CSS__*/', css).replace('/*__DATA__*/', 'window.DATA = ' + payload + ';').replace('/*__JS__*/', js)
    return html

if __name__ == '__main__':
    if '--research' in sys.argv:
        copy_research(sys.argv[sys.argv.index('--research') + 1])
    data = build_data()
    with open(os.path.join(DATA, 'data.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    html = build_html(data)
    with open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(html)
    print('index.html:', round(len(html.encode()) / 1e6, 2), 'MB; counts:', data['meta']['counts'])
