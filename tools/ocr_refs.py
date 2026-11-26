"""Lecture des références modèle sur les photos d'étiquettes (Yohji Yamamoto, Issey Miyake).

Usage (import automatique, sync-vestiaire) :
    python tools/ocr_refs.py --ids 73857124,73317570
    → lit les étiquettes des pièces indiquées et ajoute à data/style-refs.json
      celles où UNE seule référence au format de la marque est trouvée.
Usage (lot, machines parallèles) :
    python tools/ocr_refs.py sortie.json PART TOTAL

Les références douteuses (plusieurs codes, format inhabituel) ne sont jamais ajoutées :
elles restent dans data/ocr-refs-raw.json pour relecture.
Saison/année : non déduites (Tom s'en occupe).
"""
import sys, json, glob, re, os, time
import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
REFS = os.path.join(ROOT, 'data', 'style-refs.json')
RAW = os.path.join(ROOT, 'data', 'ocr-refs-raw.json')
BRANDS = ('YOHJI YAMAMOTO', 'ISSEY MIYAKE')

# Issey : ME03FA108, IM51-FJ944, PP92-JK041, MI54FR331 ; Yohji : HC-T32-078, YN-T34-060
ISSEY = re.compile(r'([A-Z]{2}\d{2})-?([A-Z]{2}\d{3})')
YOHJI = re.compile(r'([A-Z]{2})-?([A-Z]\d{2})-?(\d{3})')
OTHER = re.compile(r'^[A-Z]{1,4}-?[A-Z0-9]{1,5}(-[A-Z0-9]{1,5})?$')
_o = None

def ocr(im):
    global _o
    if _o is None: _o = RapidOCR()
    r, _ = _o(np.asarray(im), use_cls=True)
    return [x[1].upper().replace(' ', '') for x in (r or [])]

def codes(txts):
    res = set(); other = set()
    for t in txts:
        t = t.replace('NO.', '').replace('NO,', '')
        for a, b in ISSEY.findall(t): res.add(a + b)
        for a, b, c in YOHJI.findall(t): res.add(f'{a}-{b}-{c}')
        if 5 <= len(t) <= 12 and OTHER.match(t) and re.search(r'\d', t) and re.search(r'[A-Z]', t) and not re.search(r'%|JAPAN|SIZE', t):
            other.add(t)
    return res, other

def scan(pid):
    found = {}; others = {}
    files = sorted(glob.glob(os.path.join(ROOT, 'img', f'{pid}-*-xl.webp')), key=lambda f: int(f.rsplit('/', 1)[-1].split('-')[1]))[1:]
    for f in files:
        im = Image.open(f).convert('RGB')
        small = im.resize((800, 800))
        a = np.asarray(small.convert('L'))
        white = (a > 215).mean()
        patch = 0.02 < white < 0.45 and np.median(a) < 170   # étiquette claire sur fond sombre
        if not patch and not ocr(small): continue
        first = ocr(im)
        if not first: continue
        for ang in (0, 45, 90, 135):
            g = im if ang == 0 else im.rotate(ang, expand=True, fillcolor=(0, 0, 0))
            main, oth = codes(first if ang == 0 else ocr(g))
            for c in main: found.setdefault(c, set()).add(os.path.basename(f))
            for c in oth: others.setdefault(c, set()).add(os.path.basename(f))
    return {'codes': {c: sorted(v) for c, v in found.items()},
            'autres': {c: sorted(v) for c, v in others.items() if c not in found}}

def load(p):
    try: return json.load(open(p))
    except Exception: return {}

if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == '--ids':
        prods = load(os.path.join(ROOT, 'netlify', 'functions', 'products.json'))
        refs, raw = load(REFS), load(RAW)
        ids = [i for i in sys.argv[2].replace(' ', ',').split(',') if i]
        ids = [i for i in ids if (prods.get(i) or {}).get('brand') in BRANDS and i not in refs]
        added = 0
        for pid in ids:
            t0 = time.time(); r = scan(pid); raw[pid] = r
            if len(r['codes']) == 1:
                refs[pid] = next(iter(r['codes'])); added += 1
            print(pid, r['codes'] or r['autres'] or '-', f'{time.time() - t0:.0f} s', flush=True)
        json.dump(dict(sorted(refs.items())), open(REFS, 'w'), indent=0, ensure_ascii=False)
        json.dump(raw, open(RAW, 'w'), ensure_ascii=False, indent=0, sort_keys=True)
        print(f'Références : {added} ajoutée(s) sur {len(ids)} pièce(s) Yohji/Issey')
    else:
        out_path, part, total = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
        prods = load(os.path.join(ROOT, 'netlify', 'functions', 'products.json'))
        ids = [k for k, p in prods.items() if p.get('brand') in BRANDS][part::total]
        res = load(out_path)
        for pid in ids:
            if pid in res: continue
            res[pid] = scan(pid); print(pid, res[pid], flush=True)
            json.dump(res, open(out_path, 'w'), ensure_ascii=False)
