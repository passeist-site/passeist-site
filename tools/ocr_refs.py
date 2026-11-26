import sys, json, glob, re, os, time
import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR
# Lecture des références article sur les photos d'étiquettes (Yohji, Issey). Essai temporaire.
# Usage : python tools/ocr_refs.py sortie.json PART TOTAL
out_path, part, total = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
_all = json.load(open('netlify/functions/products.json'))
ids = [k for k, p in _all.items() if p.get('brand') in ('YOHJI YAMAMOTO', 'ISSEY MIYAKE')][part::total]
o = RapidOCR()
ISSEY = re.compile(r'([A-Z]{2}\d{2}[A-Z]{2}\d{3})')
YOHJI = re.compile(r'([A-Z]{2})-?([A-Z]\d{2})-?(\d{3})')
LABELWORDS = re.compile(r'MADE|JAPAN|JAPON|%|株式会社|COTTON|WOOL|LAINE|POLYESTER|ヨウジ|イッセイ|SIZE|[A-Z]{2}-?[A-Z]\d{2}|[A-Z]{2}\d{2}[A-Z]{2}')
def ocr(im):
    r, _ = o(np.asarray(im), use_cls=True)
    return [x[1].upper().replace(' ', '') for x in (r or [])]
OTHER = re.compile(r'^[A-Z]{1,4}-?[A-Z0-9]{1,5}(-[A-Z0-9]{1,5})?$')
def codes(txts):
    res = set(); other = set()
    for t in txts:
        for m in ISSEY.findall(t): res.add(m)
        for a, b, c in YOHJI.findall(t): res.add(f'{a}-{b}-{c}')
        if 5 <= len(t) <= 12 and OTHER.match(t) and re.search(r'\d', t) and re.search(r'[A-Z]', t) and not re.search(r'%|JAPAN|SIZE', t):
            other.add(t)
    return res, other
res = json.load(open(out_path)) if os.path.exists(out_path) else {}
for pid in ids:
    if pid in res: continue
    t0 = time.time(); found = {}; others = {}
    files = sorted(glob.glob(f'img/{pid}-*-xl.webp'), key=lambda f: int(f.split('-')[1]))[1:]
    for f in files:
        im = Image.open(f).convert('RGB')
        small = im.resize((800, 800))
        # Présélection : du texte lisible, OU une étiquette claire sur un fond plus sombre
        a = np.asarray(small.convert('L'))
        white = (a > 215).mean()
        patch = 0.02 < white < 0.45 and np.median(a) < 170
        if not patch:
            t = ocr(small)
            if not t: continue
        first = ocr(im)
        if not first: continue
        for a in (0, 45, 90, 135):
            g = im.rotate(a, expand=True, fillcolor=(0, 0, 0)) if a else im
            main, oth = codes(first if a == 0 else ocr(g))
            for c in main: found.setdefault(c, set()).add(os.path.basename(f))
            for c in oth: others.setdefault(c, set()).add(os.path.basename(f))
    res[pid] = {'codes': {c: sorted(v) for c, v in found.items()}, 'autres': {c: sorted(v) for c, v in others.items() if c not in found}}
    print(pid, res[pid], round(time.time() - t0, 1), 's', flush=True)
    json.dump(res, open(out_path, 'w'), ensure_ascii=False)
