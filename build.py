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

# Editorial segment classification for company records whose research agent left segment_ids empty
# or used an inconsistent numbering (the taxonomy names were not in that agent's prompt).
SEGMENT_OVERRIDES = {
    'anduril-industries': ['S01', 'S02', 'S03', 'S06', 'S13'], 'palantir-technologies': ['S01', 'S02', 'S04', 'S14'],
    'scale-ai': ['S01', 'S04', 'S06'], 'shield-ai': ['S03', 'S13'], 'skydio': ['S03', 'S13'], 'govini': ['S02', 'S14'], 'c3-ai': ['S04', 'S14'],
    'onebrief-inc': ['S01'], 'onebrief': ['S01'], 'vannevar-labs-inc': ['S03', 'S04', 'S12'], 'vannevar-labs': ['S03', 'S04', 'S12'],
    'rebellion-defense-inc': ['S01', 'S09', 'S10'], 'rebellion-defense': ['S01', 'S09', 'S10'], 'primer-technologies-inc': ['S04'], 'primer-ai': ['S04'],
    'immersive-wisdom-inc': ['S01', 'S07'], 'immersive-wisdom': ['S01', 'S07'], 'ask-sage-inc': ['S04', 'S09'], 'ask-sage': ['S04', 'S09'],
    'edgerunner-ai-inc': ['S04', 'S06'], 'edgerunner-ai': ['S04', 'S06'],
    'synthetaic-inc': ['S04'], 'synthetaic': ['S04'], 'edgybees': ['S04', 'S07'], 'reveal-technology-inc': ['S04', 'S06', 'S07'], 'reveal-technology': ['S04', 'S06', 'S07'],
    'danti': ['S04', 'S07'], 'blackshark-ai-gmbh': ['S04', 'S07'], 'blackshark-ai': ['S04', 'S07'], 'ursa-space-systems-inc': ['S03', 'S04'], 'ursa-space-systems': ['S03', 'S04'],
    'cognitive-space-inc': ['S03', 'S04'], 'cognitive-space': ['S03', 'S04'],
    'auterion': ['S06', 'S13'], 'aerovironment-tomahawk-robotics-kinesis': ['S01', 'S13'], 'applied-intuition-defense-incl-episci': ['S13'],
    'tangram-flex': ['S02', 'S13'], 'saronic': ['S03', 'S13'], 'bigbear-ai': ['S01', 'S06', 'S14'], 'accelint-formerly-hypergiant': ['S01', 'S13'],
}

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
    def norm_posture(v):
        t = str(v or '').lower()
        if 'defense' in t or 'defence' in t: return 'defense-native'
        if 'dual' in t: return 'dual-use'
        if 'commercial' in t: return 'commercial'
        return ''
    def first_money(t):
        t = str(t or '')
        if re.search(r'insufficient|not disclosed|undisclosed', t, re.I) and '$' not in t: return 'Undisclosed'
        m = re.search(r'(?:~|≈|c\.\s?|about\s|approx\.?\s|at least\s|>)?[$€£]\s?[\d.,]+\s?(?:billion|million|bn|mn|B|M|K|k)?\+?', t)
        if m: return m.group(0).replace('  ', ' ').strip()
        if re.search(r'public', t, re.I): return 'Public company'
        return t[:24]
    def first_num(t):
        t = str(t or '')
        m = re.search(r'(?:~|≈|>|about\s|approx\.?\s)?\d[\d,]*\s?(?:\+|-\d[\d,]*|–\d[\d,]*)?', t)
        return m.group(0).strip() if m else (t[:16] if t else '')
    def short_hq(v):
        t = str(v or '').strip()
        t = re.split(r'\s*[\(;]|\s+-\s+|\s+\u2014\s+', t)[0]
        return t[:48]
    for c in companies:
        c['slug'] = slug(c['name'])
        c['market_posture_note'] = c.get('market_posture') or ''
        c['market_posture'] = norm_posture(c.get('market_posture'))
        c['headquarters_short'] = short_hq(c.get('headquarters'))
        c['funding_short'] = first_money(c.get('total_disclosed_funding_usd'))
        c['employees_short'] = first_num(c.get('employee_count_approx'))
        c['traction'] = traction_of(c)
        ids = {str(x).strip().upper() for x in (c.get('segment_ids') or []) if re.match(r'^S\d\d$', str(x).strip().upper())}
        if c['slug'] in SEGMENT_OVERRIDES:
            ids = set(SEGMENT_OVERRIDES[c['slug']]); c['segment_ids_note'] = 'editorial classification'
        c['segment_ids'] = sorted(ids)
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
