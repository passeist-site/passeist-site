#!/usr/bin/env python3
"""Rapatrie sur passeist.com les photos des pièces encore affichées depuis le
CDN Vestiaire (pièces absentes de VALIDATED_LOCAL).

Pourquoi : les images servies par images.vestiairecollective.com comptent pour
Vestiaire dans Google Images, pas pour passeist.com.

Pour chaque pièce en vente sans photos locales :
  - télécharge chaque photo depuis le CDN Vestiaire (w=1600), dans l'ordre
    d'affichage du site (IMG_REORDER / IMG_SUFFIX respectés) ;
  - écrit img/<id>-<i>-{xl,md,sm}.webp (1600 / 800 / 400, pad carré blanc, même
    traitement que tools/import_vestiaire.py : aucun recadrage, cf PHOTOS.md) ;
  - ajoute l'id à VALIDATED_LOCAL dans index.html si toutes les photos sont OK.

Usage : python tools/import_missing_photos.py [--limit N] [--dry-run]
Lancé par .github/workflows/import-missing-photos.yml (déclenchement manuel).
"""
import sys, os, re, json, io, time, argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_vestiaire import make_scraper, pad_square, INDEX, OUT_IMG  # noqa: E402
from PIL import Image  # noqa: E402

SIZES = [('xl', 1600, 95), ('md', 800, 95), ('sm', 400, 92)]


def load_state(html):
    m = re.search(r'const PRODUCTS = \[([\s\S]*?)\];\s*\n', html)
    products = json.loads('[' + m.group(1) + ']')
    sold = set(re.findall(r'"(\d+)"', re.search(r'const SOLD_IDS = new Set\(\[([\s\S]*?)\]\)', html).group(1)))
    local = set(re.findall(r'"(\d+)"', re.search(r'const VALIDATED_LOCAL = new Set\(\[([\s\S]*?)\]\)', html).group(1)))
    mr = re.search(r'const IMG_REORDER = (\{[\s\S]*?\});', html)
    try:
        reorder = json.loads(mr.group(1)) if mr else {}
    except ValueError:
        reorder = {}
    suffix = {}
    ms = re.search(r'const IMG_SUFFIX = \{([\s\S]*?)\};', html)
    if ms:
        for k, v in re.findall(r"'(\d+)'\s*:\s*'([^']*)'", ms.group(1)):
            suffix[k] = v
    return products, sold, local, reorder, suffix


def photo_url(slug, photo_num, suffix):
    return (f'https://images.vestiairecollective.com/images/resized/w=1600,q=90,f=auto,'
            f'/produit/{slug}-{photo_num}{suffix}.jpg')


def import_one(scraper, p, reorder, suffix):
    n = int(p.get('n') or 0)
    order = reorder.get(p['id']) or list(range(1, n + 1))
    sfx = suffix.get(p['id'], '_2')
    done = 0
    for i, photo_num in enumerate(order):
        im = None
        for s in (sfx, ''):  # le site utilise _2 ; import_vestiaire.py sans suffixe
            try:
                r = scraper.get(photo_url(p['slug'], photo_num, s), timeout=30)
                if r.status_code == 200 and len(r.content) > 10000:
                    im = Image.open(io.BytesIO(r.content)).convert('RGB')
                    break
            except Exception as e:  # réseau : on tente l'autre variante
                print(f'  photo {photo_num}{s} ERR {e}')
        if im is None:
            print(f'  photo {photo_num} introuvable')
            return False
        for sn, target, q in SIZES:
            pad_square(im, target).save(os.path.join(OUT_IMG, f"{p['id']}-{i}-{sn}.webp"),
                                        'WEBP', quality=q, method=6)
        done += 1
        time.sleep(0.3)
    return done == len(order) and done > 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0, help='nombre max de pièces (0 = toutes)')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    html = open(INDEX, encoding='utf-8').read()
    products, sold, local, reorder, suffix = load_state(html)
    todo = [p for p in products
            if p.get('id') and p['id'] not in local and p['id'] not in sold
            and p.get('sold') is not True and int(p.get('n') or 0) > 0 and p.get('slug')]
    if args.limit:
        todo = todo[:args.limit]
    print(f'{len(todo)} pièces en vente sans photos locales')
    if args.dry_run:
        for p in todo:
            print(' ', p['id'], p['brand'], p['type'])
        return

    os.makedirs(OUT_IMG, exist_ok=True)
    scraper = make_scraper()
    ok, fail = [], []
    for k, p in enumerate(todo, 1):
        print(f"[{k}/{len(todo)}] {p['id']} {p['brand']} {p['type']}", flush=True)
        (ok if import_one(scraper, p, reorder, suffix) else fail).append(p['id'])

    if ok:
        m = re.search(r'(const VALIDATED_LOCAL = new Set\(\[)(.*?)(\]\);)', html, re.DOTALL)
        existing = re.findall(r'"(\d+)"', m.group(2))
        ids = ok + [i for i in existing if i not in set(ok)]
        inside = '\n  ' + ',\n  '.join(f'"{i}"' for i in ids) + '\n'
        html = html.replace(m.group(0), m.group(1) + inside + m.group(3))
        open(INDEX, 'w', encoding='utf-8').write(html)
    print(f'\nOK : {len(ok)} pièces rapatriées, {len(fail)} en échec')
    if fail:
        print('Échecs :', ' '.join(fail))
    with open(os.environ.get('GITHUB_OUTPUT', os.devnull), 'a') as f:
        f.write(f'imported={len(ok)}\nfailed={len(fail)}\n')


if __name__ == '__main__':
    main()
