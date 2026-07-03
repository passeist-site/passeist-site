#!/usr/bin/env python3
"""Extrait l'array PRODUCTS de index.html et l'écrit dans
netlify/functions/products.json. Utilisé par create-checkout-session.js
pour valider les prix côté serveur (anti price-tampering).

À lancer après chaque modification de PRODUCTS dans index.html
(import HD batch, sync auto, modif manuelle prix, etc.)."""
import re, json, os, sys

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

# Build a lightweight lookup: { id: { price, brand, type, size, slug } }
lookup = {}
for p in products:
    pid = p.get('id')
    if not pid: continue
    lookup[str(pid)] = {
        'price': str(p.get('price', '')),
        'brand': p.get('brand', ''),
        'type':  p.get('type', ''),
        'size':  p.get('size', ''),
        'slug':  p.get('slug', ''),
    }

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as f:
    json.dump(lookup, f, ensure_ascii=False, separators=(',', ':'))
print(f'Wrote {len(lookup)} entries to {OUT} ({os.path.getsize(OUT)} bytes)')
