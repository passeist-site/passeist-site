#!/usr/bin/env python3
"""fix_prices.py — Vérifie et corrige les prix de produits disponibles.

Usage : python3 tools/fix_prices.py [--dry-run] [--last N] [--all]

  --last N   Vérifie les N derniers articles importés (défaut : 30)
             Les articles sont triés du plus récent au plus ancien dans PRODUCTS.
  --all      Vérifie tous les produits disponibles (coûteux en crédits SB)
  --dry-run  Affiche les corrections sans écrire index.html

Pour chaque produit :
1. Fetch la fiche Vestiaire via ScrapingBee (country_code=fr, render_js=false)
2. Extrait pricingBreakdown.sellerPrice.cents depuis __NEXT_DATA__
3. Recalcule le prix : ceil(sellerPrice * 0.88 / 10) * 10
4. Si différent du prix actuel → corrige dans index.html

Coût : 1 crédit ScrapingBee par produit (datacenter, no JS).
Exit 0 si OK, exit 1 si erreur fatale.
"""
import sys, os, re, json, math, time, argparse
import requests

ROOT  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, 'index.html')
SB_API = 'https://app.scrapingbee.com/api/v1/'

SCRAPINGBEE_API_KEY = os.environ.get('SCRAPINGBEE_API_KEY', '').strip()
if not SCRAPINGBEE_API_KEY:
    raise SystemExit('FATAL: SCRAPINGBEE_API_KEY env var manquante.')


def load_products():
    with open(INDEX) as f:
        html = f.read()
    start = html.find('const PRODUCTS = [')
    arr_start = html.find('[', start)
    depth = 0; in_str = False; esc_chr = False; i = arr_start
    while i < len(html):
        c = html[i]
        if esc_chr: esc_chr = False; i += 1; continue
        if c == '\\': esc_chr = True; i += 1; continue
        if c == '"': in_str = not in_str; i += 1; continue
        if not in_str:
            if c == '[': depth += 1
            elif c == ']':
                depth -= 1
                if depth == 0: arr_end = i + 1; break
        i += 1
    raw = re.sub(r',\s*(\]|\})', r'\1', html[arr_start:arr_end])
    products = json.loads(raw)
    m = re.search(r'const SOLD_IDS = new Set\(\[(.*?)\]\)', html, re.DOTALL)
    sold_ids = set(re.findall(r'"(\d+)"', m.group(1))) if m else set()
    return html, products, sold_ids


def calc_price(seller_cents):
    """Prix passeist = prix "pour vous" VC arrondi à la dizaine supérieure.
    seller_cents = pricingBreakdown.sellerPrice.cents = prix affiché "pour vous"
    sur la fiche VC (sans frais acheteur VC).
    Ex : 220€ → 220€, 223€ → 230€."""
    euros = seller_cents / 100
    return int(math.ceil(euros / 10) * 10)


def fetch_seller_price(path, product_id):
    """Fetch le prix vendeur depuis __NEXT_DATA__ via ScrapingBee.
    CRITIQUE : filtre par product_id pour éviter de lire le prix
    d'un autre article (recommandations, etc.) dans le tableau queries.
    Retourne seller_cents ou None si échec."""
    url = 'https://fr.vestiairecollective.com' + path
    pid_str = str(product_id)
    try:
        r = requests.get(SB_API, params={
            'api_key': SCRAPINGBEE_API_KEY,
            'url': url,
            'render_js': 'false',
            'country_code': 'fr',
        }, timeout=60)
        if r.status_code != 200:
            print(f'    SB HTTP {r.status_code}', file=sys.stderr)
            return None
        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', r.text, re.DOTALL)
        if not m:
            return None
        jd = json.loads(m.group(1))
        queries = jd.get('props', {}).get('pageProps', {}).get('dehydratedState', {}).get('queries', [])
        for q in queries:
            d = q.get('state', {}).get('data')
            if not isinstance(d, dict):
                continue
            # FILTRE : seulement le produit correspondant à l'ID
            if str(d.get('id', '')) != pid_str:
                continue
            breakdown = d.get('pricingBreakdown') or {}
            seller_cents = (breakdown.get('sellerPrice') or {}).get('cents', 0)
            if seller_cents:
                return seller_cents
        return None
    except Exception as e:
        print(f'    ERR: {e}', file=sys.stderr)
        return None


def update_price_in_html(html, product_id, old_price_str, new_price_str):
    """Remplace "price": "OLD" par "price": "NEW" pour ce produit."""
    # Cherche l'objet du produit et remplace son price
    # Pattern : cherche l'id puis le price dans le même objet
    pattern = r'("id":\s*"' + re.escape(product_id) + r'".*?"price":\s*")' + re.escape(old_price_str) + r'"'
    replacement = r'\g<1>' + new_price_str + '"'
    new_html, n = re.subn(pattern, replacement, html, count=1, flags=re.DOTALL)
    if n == 0:
        # Essai inverse (price avant id dans l'objet)
        pattern2 = r'("price":\s*")' + re.escape(old_price_str) + r'"(.*?"id":\s*"' + re.escape(product_id) + r'")'
        replacement2 = r'\g<1>' + new_price_str + r'"\g<2>'
        new_html, n = re.subn(pattern2, replacement2, html, count=1, flags=re.DOTALL)
    return new_html, n > 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='Ne pas écrire index.html')
    parser.add_argument('--last', type=int, default=30,
                        help='Vérifier les N derniers articles importés (défaut: 30)')
    parser.add_argument('--all', action='store_true',
                        help='Vérifier tous les produits (ignore --last)')
    args = parser.parse_args()

    html, products, sold_ids = load_products()
    # PRODUCTS est trié du plus récent au plus ancien (insertion en tête)
    available = [p for p in products
                 if p['id'] not in sold_ids
                 and len(str(p['id'])) < 10
                 and p.get('path', '').endswith('.shtml')]

    if not args.all:
        available = available[:args.last]

    scope = 'tous les produits' if args.all else f'les {args.last} derniers importés'
    print(f'Produits à vérifier ({scope}) : {len(available)}')
    if args.dry_run:
        print('MODE DRY-RUN — aucune écriture')

    changes = []
    errors  = []
    skipped = 0

    for i, p in enumerate(available, 1):
        pid   = p['id']
        brand = p['brand']
        ptype = p['type']
        path  = p['path']
        cur   = str(p.get('price', ''))

        print(f'[{i}/{len(available)}] {pid} {brand} {ptype}  actuel={cur}€ ...', end=' ', flush=True)

        seller_cents = fetch_seller_price(path, pid)

        if seller_cents is None:
            print(f'SKIP (fetch fail)')
            errors.append({'id': pid, 'reason': 'fetch fail'})
            time.sleep(1)
            continue

        new_price = calc_price(seller_cents)
        new_str   = str(new_price)

        if new_str == cur:
            print(f'OK ({new_price}€)')
            skipped += 1
        else:
            seller_eur = seller_cents / 100
            print(f'CORRECTION {cur}€ → {new_price}€  (VC seller={seller_eur}€)')
            changes.append({
                'id': pid, 'brand': brand, 'type': ptype,
                'old': cur, 'new': new_str,
                'seller_eur': seller_eur,
            })
            if not args.dry_run:
                html, ok = update_price_in_html(html, pid, cur, new_str)
                if not ok:
                    print(f'  ⚠ update_price_in_html FAILED pour {pid}', file=sys.stderr)

        time.sleep(0.5)  # rate limit léger

    # Résumé
    print(f'\n{"="*60}')
    print(f'Résultat : {len(changes)} corrections, {skipped} inchangés, {len(errors)} erreurs')
    if changes:
        print('\nCorrections :')
        for c in changes:
            print(f'  {c["id"]} {c["brand"]} {c["type"]}  {c["old"]}€ → {c["new"]}€  (VC={c["seller_eur"]}€)')
    if errors:
        print(f'\nÉchecs ({len(errors)}) :')
        for e in errors:
            print(f'  {e["id"]} : {e["reason"]}')

    if changes and not args.dry_run:
        with open(INDEX, 'w') as f:
            f.write(html)
        print(f'\n✅ index.html mis à jour ({len(changes)} prix corrigés)')
    elif changes and args.dry_run:
        print(f'\n(dry-run : index.html non modifié)')
    else:
        print('\nAucune correction nécessaire.')

    sys.exit(0)


if __name__ == '__main__':
    main()
