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
from urllib.parse import quote

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


class RateLimited(Exception):
    pass


# Relais d'images du site (netlify/functions/img-proxy.js) : sort par les IP de
# Netlify, utilisé quand le CDN Vestiaire limite le débit de l'IP du runner (429).
PROXY = 'https://passeist.com/.netlify/functions/img-proxy?url='
_use_proxy = False


def _get(scraper, url):
    try:
        r = scraper.get(url, timeout=30)
        return r.status_code, r.content
    except Exception as e:  # réseau
        print(f'  ERR réseau {e}')
        return 0, b''


def fetch(scraper, url):
    """GET direct, ou via le relais du site dès que le CDN renvoie 429/403.
    Pauses si le relais est limité lui aussi. Renvoie (status, content) ;
    lève RateLimited si tout reste bloqué."""
    global _use_proxy
    if not _use_proxy:
        status, content = _get(scraper, url)
        if status not in (0, 403, 429) and status < 500:
            return status, content
        print(f'  CDN {status} : passage par le relais passeist.com', flush=True)
        _use_proxy = True
    purl = PROXY + quote(url, safe='')
    waits = [60, 120, 240]
    for k in range(len(waits) + 1):
        status, content = _get(scraper, purl)
        if status == 502 and b'404' in content:
            return 404, b''  # photo absente chez Vestiaire
        if status not in (0, 403, 429) and status < 500:
            return status, content
        if k == len(waits):
            raise RateLimited(status)
        print(f'  relais {status} : pause {waits[k]} s', flush=True)
        time.sleep(waits[k])


def import_one(scraper, p, reorder, suffix):
    n = int(p.get('n') or 0)
    order = reorder.get(p['id']) or list(range(1, n + 1))
    sfx = suffix.get(p['id'], '_2')
    done = 0
    for i, photo_num in enumerate(order):
        im = None
        statuses = []
        for s in (sfx, ''):  # le site utilise _2 ; import_vestiaire.py sans suffixe
            status, content = fetch(scraper, photo_url(p['slug'], photo_num, s))
            statuses.append(status)
            if status == 200 and len(content) > 10000:
                im = Image.open(io.BytesIO(content)).convert('RGB')
                break
        if im is None:
            print(f'  photo {photo_num} introuvable (HTTP {statuses})')
            return False
        for sn, target, q in SIZES:
            pad_square(im, target).save(os.path.join(OUT_IMG, f"{p['id']}-{i}-{sn}.webp"),
                                        'WEBP', quality=q, method=6)
        done += 1
        time.sleep(1.3)  # le CDN (et le relais : 50 req/min) limitent le débit
    return done == len(order) and done > 0


def mark_validated(ok):
    """Ajoute les ids en tête de VALIDATED_LOCAL dans index.html (sans doublon)."""
    html = open(INDEX, encoding='utf-8').read()
    m = re.search(r'(const VALIDATED_LOCAL = new Set\(\[)(.*?)(\]\);)', html, re.DOTALL)
    existing = re.findall(r'"(\d+)"', m.group(2))
    ids = [i for i in ok if i not in set(existing)] + existing
    inside = '\n  ' + ',\n  '.join(f'"{i}"' for i in ids) + '\n'
    html = html.replace(m.group(0), m.group(1) + inside + m.group(3))
    open(INDEX, 'w', encoding='utf-8').write(html)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0, help='nombre max de pièces (0 = toutes)')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--ids-out', help='écrit les ids rapatriés dans ce fichier')
    ap.add_argument('--mark-only', help='ajoute seulement les ids de ce fichier à VALIDATED_LOCAL')
    args = ap.parse_args()

    if args.mark_only:
        ids = open(args.mark_only).read().split()
        mark_validated(ids)
        print(f'{len(ids)} ids ajoutés à VALIDATED_LOCAL')
        return

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
        try:
            (ok if import_one(scraper, p, reorder, suffix) else fail).append(p['id'])
        except RateLimited as e:
            print(f'CDN toujours bloqué (HTTP {e}) : arrêt, les pièces restantes passeront au prochain lancement')
            break
        time.sleep(3)

    if ok:
        mark_validated(ok)
    if args.ids_out:
        open(args.ids_out, 'w').write('\n'.join(ok) + '\n')
    print(f'\nOK : {len(ok)} pièces rapatriées, {len(fail)} en échec')
    if fail:
        print('Échecs :', ' '.join(fail))
    with open(os.environ.get('GITHUB_OUTPUT', os.devnull), 'a') as f:
        f.write(f'imported={len(ok)}\nfailed={len(fail)}\n')


if __name__ == '__main__':
    main()
