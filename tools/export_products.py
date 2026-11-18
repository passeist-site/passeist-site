#!/usr/bin/env python3
"""Extrait l'array PRODUCTS de index.html et l'écrit dans
netlify/functions/products.json. Utilisé par create-checkout-session.js
pour valider les prix côté serveur (anti price-tampering).

À lancer après chaque modification de PRODUCTS dans index.html
(import HD batch, sync auto, modif manuelle prix, etc.)."""
import re, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from designation import designation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, 'index.html')
OUT = os.path.join(ROOT, 'netlify', 'functions', 'products.json')

src = open(INDEX).read()

# Parser robuste par comptage de brackets — fonctionne quelle que soit la mise
# en forme de l'array (compact ou multi-lignes).
start_kw = 'const PRODUCTS = ['
start = src.find(start_kw)
if start < 0:
    print('ERROR: PRODUCTS array not found in index.html', file=sys.stderr)
    sys.exit(1)
arr_start = src.index('[', start)
depth = 0; in_str = False; esc = False; i = arr_start
while i < len(src):
    c = src[i]
    if esc:   esc = False; i += 1; continue
    if c == '\\': esc = True; i += 1; continue
    if c == '"': in_str = not in_str; i += 1; continue
    if not in_str:
        if c == '[': depth += 1
        elif c == ']':
            depth -= 1
            if depth == 0: arr_end = i + 1; break
    i += 1

raw = re.sub(r',\s*(\]|\})', r'\1', src[arr_start:arr_end])
products = json.loads(raw)
print(f'Found {len(products)} products')

# Pièces vendues (SOLD_IDS) : exclues, pour que le paiement les refuse même
# depuis un onglet resté ouvert avant la vente.
m = re.search(r'const SOLD_IDS = new Set\(\[([\s\S]*?)\]\);', src)
sold = set(re.findall(r'"(\d+)"', m.group(1))) if m else set()

# Build a lightweight lookup: { id: { price, brand, type, size, slug } }
lookup = {}
for p in products:
    pid = p.get('id')
    if not pid or str(pid) in sold: continue
    lookup[str(pid)] = {
        'price': str(p.get('price', '')),
        'brand': p.get('brand', ''),
        'type':  p.get('type', ''),
        'size':  p.get('size', ''),
        'slug':  p.get('slug', ''),
    }
    # Genre (h / f) : alertes « nouvelles pièces » (netlify/functions/alerts-send.js)
    if p.get('gender'): lookup[str(pid)]['gender'] = p.get('gender')
    # Annonce Vestiaire : lien « retirer l'annonce » envoyé à Tom à chaque vente
    if p.get('path'): lookup[str(pid)]['vc'] = p.get('path')
    # Nom anglais : paiement et e-mails des clients anglophones
    if p.get('type_en'): lookup[str(pid)]['type_en'] = p.get('type_en')
    # Désignation précise + saison / année (newsletter, e-mails)
    label, season, year = designation(p)
    if label != p.get('type', ''): lookup[str(pid)]['label'] = label
    if season: lookup[str(pid)]['season'] = season
    if year: lookup[str(pid)]['year'] = year

# Annonce Vinted de chaque pièce (Tom, 2026-11-16) : data/vinted.json est lu par
# tools/vinted_wardrobe.py dans la synchro ; association prudente dans tools/vinted_match.py.
# Sans lien sûr, Tom garde le bouton « Mon dressing Vinted ».
VT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'vinted.json')
try: vinted = json.load(open(VT))
except Exception: vinted = []
# Registre data/vinted-links.json (Tom, 2026-11-16) : numéro du site → numéro de l'annonce Vinted,
# comme le numéro Vestiaire. Une fois trouvé, il n'est jamais recalculé ; seules les pièces pas
# encore reliées sont cherchées, chaque soir (dont les nouveautés du site).
VL = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'vinted-links.json')
try: vlinks = json.load(open(VL))
except Exception: vlinks = {}
if vinted:
    from vinted_match import match
    live = {str(v.get('id')) for v in vinted}
    # Le registre se vérifie lui-même : un lien dont la description ou les mesures ne correspondent
    # pas (ex. annonces d'une même marque au long texte commun) est retiré puis recalculé.
    from vinted_match import dsim, nums
    vdesc = {str(v.get('id')): v.get('desc') or '' for v in vinted}
    pdesc = {str(p.get('id')): p.get('desc') or '' for p in products}
    dropped = 0
    for pid, vid in list(vlinks.items()):
        a, b = pdesc.get(pid, ''), vdesc.get(str(vid), '')
        if not a or not b or len(b) >= 1490: continue
        ds = dsim(a, b); pn = nums(a)
        nr = len(pn & nums(b)) / len(pn) if len(pn) >= 3 else 1.0
        if ds is not None and (ds < 0.8 or nr < 0.7):
            del vlinks[pid]; dropped += 1
    if dropped: print(f'Vinted : {dropped} lien(s) du registre retiré(s) (description ou mesures différentes)')
    known = {pid for pid, vid in vlinks.items() if str(vid) in live}   # annonce toujours en ligne
    # Toutes les pièces, vendues comprises : leur annonce Vinted est justement à retirer après la vente
    every = {}
    for p in products:
        pid = str(p.get('id') or '')
        if not pid: continue
        if pid in lookup: every[pid] = lookup[pid]; continue
        lab, sea, yr = designation(p)
        every[pid] = {'brand': p.get('brand', ''), 'type': p.get('type', ''), 'price': str(p.get('price', '')), 'label': lab, 'season': sea or '', 'year': yr or ''}
    new, sure = match(every, {str(p.get('id')): p for p in products}, vinted,
                skip_ids=known, used_vinted={str(vlinks[k]) for k in known})
    # Gravé dans le registre seulement si la description le confirme ; sinon lien du soir
    for pid in sure: vlinks[pid] = new[pid].rsplit('/', 1)[-1]
    for pid, url in new.items():
        if pid not in sure and pid in lookup: lookup[pid]['vt'] = url
    print(f'Vinted : registre {len(vlinks)} (+{len(sure)} confirmées par la description), '
          f'{len(new) - len(sure)} reliée(s) par le titre ; {len(vinted)} annonces')
    with open(VL, 'w') as f: json.dump(dict(sorted(vlinks.items())), f, separators=(',', ':'))
    live_ok = live
else:
    live_ok = None   # annonces non lues ce soir : on garde le registre tel quel
for pid, vid in vlinks.items():
    if pid in lookup and (live_ok is None or str(vid) in live_ok):
        lookup[pid]['vt'] = f'https://www.vinted.fr/items/{vid}'

# Date de mise en ligne de chaque pièce (étiquette « nouveau » 7 jours, Tom 2026-11-12) :
# data/first-seen.json garde la première date où l'identifiant est apparu ; les nouvelles
# pièces reçoivent la date du jour (UTC). Jamais réécrit pour une pièce déjà connue.
import datetime
FS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'first-seen.json')
try: seen = json.load(open(FS))
except Exception: seen = {}
today = datetime.datetime.utcnow().strftime('%Y-%m-%d')
# Registre absent ou vide (ex. checkout partiel de la synchro) : ne jamais dater tout le
# catalogue du jour, sinon tout passe « nouveau ». On date tout en ancien.
if len(seen) < 50:
    print('first-seen : registre absent ou vide, toutes les pièces datées 2026-01-01')
    today = '2026-01-01'
added = 0
for p in products:
    pid = str(p.get('id') or '')
    if pid and pid not in seen: seen[pid] = today; added += 1
os.makedirs(os.path.dirname(FS), exist_ok=True)
with open(FS, 'w') as f: json.dump(dict(sorted(seen.items())), f, separators=(',', ':'))
if added: print(f'first-seen : {added} nouvelle(s) pièce(s) datée(s) {today}')

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as f:
    json.dump(lookup, f, ensure_ascii=False, separators=(',', ':'))

# Références de TOUTES les pièces, vendues comprises (messagerie : retirer les annonces après une
# vente, photo de la pièce dans une discussion). Tom, 2026-11-18.
REFS = os.path.join(ROOT, 'netlify', 'functions', 'refs.json')
refs = {}
for p in products:
    pid = str(p.get('id') or '')
    if not pid: continue
    r = {'b': p.get('brand', ''), 't': p.get('type', '')}
    if p.get('path'): r['vc'] = p['path']
    if p.get('slug'): r['s'] = p['slug']
    if pid in vlinks: r['vt'] = str(vlinks[pid])
    refs[pid] = r
with open(REFS, 'w') as f:
    json.dump(refs, f, ensure_ascii=False, separators=(',', ':'))
print(f'refs.json : {len(refs)} pièces ({os.path.getsize(REFS) // 1024} Ko)')
print(f'Wrote {len(lookup)} entries to {OUT} ({os.path.getsize(OUT)} bytes)')
