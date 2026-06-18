#!/usr/bin/env python3
"""Import automatique d'une nouvelle pièce depuis Vestiaire vers passeist.com.

Usage : python3 tools/import_vestiaire.py <ID> <URL_VESTIAIRE>

Pipeline complet :
1. Fetch fiche Vestiaire via Playwright + proxy → extrait metadata depuis __NEXT_DATA__
2. Si NON SIGNÉ → run brand_detector.detect_brand_in_desc()
   - Si brand détectée : utiliser cette brand + nettoyer desc + slug/path adaptés
   - Si pas de brand : EXIT 2 (workflow ouvrira une Issue)
3. Télécharger photos Vestiaire CDN via cloudscraper + proxy
4. Process chaque photo : pad square + xl/md/sm webp → écrit dans img/
5. Ajouter entrée PRODUCTS au DÉBUT de l'array (les + récentes en haut)
6. Ajouter à VALIDATED_LOCAL
7. Exit 0 si OK, exit code différent sinon (workflow décide quoi faire)

Codes retour :
  0  succès, à commit
  1  erreur fatale (proxy mort, fiche introuvable, etc.) → fail le workflow
  2  NON SIGNÉ sans brand détectable → ouvrir Issue
  3  pas de photos téléchargeables → ouvrir Issue
  4  produit déjà dans PRODUCTS (skip silently)
"""
import sys, os, re, json, math, time, io
from PIL import Image
import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from brand_detector import is_unsigned, detect_brand_in_desc, clean_desc_after_brand_extraction

# === Configuration ===
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, 'index.html')
OUT_IMG = os.path.join(ROOT, 'img')
# APIFY_API_KEY n'est plus utilisé (fetch via ScrapingBee), gardé pour rétrocompat
APIFY_API_KEY = os.environ.get('APIFY_API_KEY', '').strip()
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

# Mapping brand canonique → slug pour path
BRAND_TO_SLUG = {
    'YOHJI YAMAMOTO': 'yohji-yamamoto',
    "Y'S": 'ys',
    'COMME DES GARÇONS': 'comme-des-garcons',
    'COMME DES GARCONS': 'comme-des-garcons',
    'JUNYA WATANABE': 'junya-watanabe',
    'ISSEY MIYAKE': 'issey-miyake',
    'KENZO': 'kenzo',
    'MATSUDA': 'matsuda',
    'KANSAI YAMAMOTO': 'kansai-yamamoto',
    'HIROKO KOSHINO': 'hiroko-koshino',
    'TAKEO KIKUCHI': 'takeo-kikuchi',
    'KIJIMA TAKAYUKI': 'kijima-takayuki',
    'SACAI': 'sacai',
    'VISVIM': 'visvim',
    'UNDERCOVER': 'undercover',
    'NUMBER (N)INE': 'number-nine',
    'MIHARA YASUHIRO': 'mihara-yasuhiro',
    'NEIGHBORHOOD': 'neighborhood',
    'WHITE MOUNTAINEERING': 'white-mountaineering',
    'NE-NET': 'ne-net',
    '45RPM': '45rpm',
    'MAISON MARGIELA': 'maison-margiela',
    'HELMUT LANG': 'helmut-lang',
    'RAF SIMONS': 'raf-simons',
    'RICK OWENS': 'rick-owens',
    'ANN DEMEULEMEESTER': 'ann-demeulemeester',
    'DRIES VAN NOTEN': 'dries-van-noten',
    'YOSHIKI HISHINUMA': 'yoshiki-hishinuma',
    'ZUCCA': 'zucca',
    'TSUMORI CHISATO': 'tsumori-chisato',
    'BLUE BLUE JAPAN': 'blue-blue-japan',
    'FUMITO GANRYU': 'fumito-ganryu',
    'NOIR KEI NINOMIYA': 'noir-kei-ninomiya',
    'JUNKO KOSHINO': 'junko-koshino',
    'PLANTATION': 'plantation',
    'PORTER BY YOSHIDA KABAN': 'porter-by-yoshida-kaban',
    'REMI RELIEF': 'remi-relief',
    'LIMI FEU': 'limi-feu',
    'FINAL HOME': 'final-home',
    'ASPESI': 'aspesi',
    'NON SIGNÉ': 'non-signe-unsigned',
}


def brand_to_slug(brand_canonical):
    return BRAND_TO_SLUG.get(brand_canonical.upper(), brand_canonical.lower().replace(' ', '-').replace('é', 'e'))


def pad_square(im, target):
    w, h = im.size
    if h >= w: nh = target; nw = max(1, int(w * target / h))
    else: nw = target; nh = max(1, int(h * target / w))
    scaled = im.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('RGB', (target, target), (255, 255, 255))
    canvas.paste(scaled, ((target - nw) // 2, (target - nh) // 2))
    return canvas


def make_scraper():
    """Session pour photos CDN (Vestiaire images servis sans Cloudflare)."""
    s = requests.Session()
    s.headers.update({
        'User-Agent': UA,
        'Referer': 'https://fr.vestiairecollective.com/',
    })
    return s


def process_photo(scraper, item_id, photo_idx, vestiaire_slug):
    """Télécharge la photo {photo_idx} (1-indexed) depuis Vestiaire CDN
    et écrit 3 versions webp pad square : item_id-{idx-1}-xl/md/sm.webp.
    Le CDN images.vestiairecollective.com n'a pas Cloudflare → fetch direct."""
    url = f'https://images.vestiairecollective.com/images/resized/w=1600,q=90,f=auto,/produit/{vestiaire_slug}-{photo_idx}.jpg'
    try:
        r = scraper.get(url, timeout=30)
        if r.status_code != 200 or len(r.content) < 10000: return False
        im = Image.open(io.BytesIO(r.content)).convert('RGB')
        for sn, target, q in [('xl', 1600, 95), ('md', 800, 95), ('sm', 400, 92)]:
            out = pad_square(im, target)
            out.save(os.path.join(OUT_IMG, f'{item_id}-{photo_idx-1}-{sn}.webp'),
                     'WEBP', quality=q, method=6)
        return True
    except Exception as e:
        print(f'  photo {photo_idx} ERR: {e}', file=sys.stderr)
        return False


def fetch_meta(url):
    """Fetch fiche Vestiaire → __NEXT_DATA__.
    Accept-Language: fr-FR force la version française sinon Vestiaire
    renvoie EN (type='Top' au lieu de 'Haut').

    Stratégie 2 passes (SANS proxy — même approche que scrape_profile) :
    1. requests direct (rapide, pas de browser).
    2. Si Cloudflare challenge → Playwright + stealth sans proxy
       (même technique qui fait fonctionner le scan profil)."""

    def _extract(html_text, label):
        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html_text, re.DOTALL)
        if not m:
            print(f'fetch_meta [{label}] : __NEXT_DATA__ introuvable', file=sys.stderr)
            return None
        try:
            jd = json.loads(m.group(1))
            queries = jd.get('props', {}).get('pageProps', {}).get('dehydratedState', {}).get('queries', [])
            for q in queries:
                d = q.get('state', {}).get('data')
                if isinstance(d, dict) and d.get('id') and d.get('brand'):
                    return d
        except Exception as e:
            print(f'fetch_meta [{label}] parse ERR: {e}', file=sys.stderr)
        return None

    headers = {
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }

    # Passe 1 : ScrapingBee (bypass Cloudflare fiable, si API key dispo)
    sb_key = os.environ.get('SCRAPINGBEE_API_KEY', '').strip()
    if sb_key:
        try:
            r = requests.get('https://app.scrapingbee.com/api/v1/',
                             params={'api_key': sb_key, 'url': url, 'render_js': 'false',
                                     'country_code': 'fr'},  # force prix EU (évite conversion USD+taxes)
                             timeout=60)
            if r.status_code == 200:
                result = _extract(r.text, 'pass1-scrapingbee')
                if result:
                    return result
                print(f'fetch_meta [pass1-scrapingbee] : 200 mais __NEXT_DATA__ absent', file=sys.stderr)
            else:
                print(f'fetch_meta [pass1-scrapingbee] : HTTP {r.status_code}', file=sys.stderr)
        except Exception as e:
            print(f'fetch_meta [pass1-scrapingbee] ERR: {e}', file=sys.stderr)

    # Passe 2 : curl-cffi (imite fingerprint TLS Chrome → bypass Cloudflare sans proxy)
    try:
        from curl_cffi import requests as cf_requests
        r = cf_requests.get(url, impersonate='chrome120', headers=headers, timeout=30)
        if r.status_code == 200:
            result = _extract(r.text, 'pass2-curl-cffi')
            if result:
                return result
            print(f'fetch_meta [pass2-curl-cffi] : 200 mais __NEXT_DATA__ absent', file=sys.stderr)
        else:
            print(f'fetch_meta [pass2-curl-cffi] : HTTP {r.status_code}', file=sys.stderr)
    except Exception as e:
        print(f'fetch_meta [pass2-curl-cffi] ERR: {e}', file=sys.stderr)

    # Passe 3 : Playwright + stealth direct
    print(f'  → Passes 1+2 échouées, retry avec Playwright pour {url}', file=sys.stderr)
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                extra_http_headers={'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'},
                user_agent=UA,
                viewport={'width': 1920, 'height': 1080},
            )
            page = context.new_page()
            from playwright_stealth import Stealth
            Stealth().apply_stealth_sync(page)
            page.route('**/*', lambda route: route.abort()
                       if route.request.resource_type in ['image', 'font', 'media']
                       else route.continue_())
            page.goto(url, wait_until='domcontentloaded', timeout=60000)
            # Debug : voir si on a la vraie page ou un challenge
            try:
                title = page.title()
                print(f'  → Titre: {repr(title)}', file=sys.stderr)
            except Exception:
                pass
            content = page.content()
            browser.close()
        return _extract(content, 'pass2-playwright')
    except Exception as e:
        print(f'fetch_meta [pass2-playwright] ERR: {e}', file=sys.stderr)

    return None


def extract_path_from_url(vestiaire_url):
    """Extrait le path COMPLET Vestiaire depuis l'URL (avec slug + .shtml).
    Ex: https://fr.vestiairecollective.com/accessoires-homme/chapeaux/non-signe/sac-non-signe-66730081.shtml
        → '/accessoires-homme/chapeaux/non-signe/sac-non-signe-66730081.shtml'

    Note historique : avant 2026-05-07 cette fonction renvoyait seulement la
    catégorie (sans slug ni .shtml). verify_item() de la sync skippait alors
    silencieusement TOUS les articles importés récemment (path !.shtml = keep).
    Bug détecté quand des articles vendus sur Vestiaire ne basculaient pas en
    SOLD sur le site malgré le bon fonctionnement apparent de la sync."""
    m = re.search(r'vestiairecollective\.com(/.+?\.shtml?)', vestiaire_url)
    return m.group(1) if m else ''


def extract_slug_from_url(vestiaire_url):
    m = re.search(r'/([^/]+)\.shtml?', vestiaire_url)
    return m.group(1) if m else ''


def main():
    if len(sys.argv) < 3:
        print('Usage: import_vestiaire.py <ID> <URL>', file=sys.stderr)
        sys.exit(1)
    item_id = sys.argv[1]
    url = sys.argv[2]

    # Vérifie si déjà importé
    with open(INDEX) as f: html = f.read()
    if f'"id": "{item_id}"' in html:
        print(f'{item_id}: déjà dans PRODUCTS, skip')
        sys.exit(4)

    # Fetch metadata
    print(f'Fetch fiche Vestiaire : {url}')
    meta = fetch_meta(url)
    if not meta:
        print(f'{item_id}: pas de metadata (fiche introuvable ou proxy fail)', file=sys.stderr)
        sys.exit(1)

    vc_brand = (meta.get('brand') or {}).get('name', '')
    ptype = (meta.get('name') or '').strip()
    size = (meta.get('size') or {}).get('size', '')
    # Retire "International" et variantes (suffixe Vestiaire inutile, cf TASKS.md 26/04)
    import re as _re
    size = _re.sub(r'\s*International(e|s)?\b\s*', '', size, flags=_re.IGNORECASE).strip()
    color = (meta.get('color') or {}).get('name', '')
    # Prix : utilise pricingBreakdown.sellerPrice (prix vendeur sans frais acheteur VC)
    # puis -12% arrondi AU SUPÉRIEUR au 5€ le plus proche (se terminant par 0 ou 5)
    breakdown = meta.get('pricingBreakdown') or {}
    seller_cents = (breakdown.get('sellerPrice') or {}).get('cents', 0)
    if not seller_cents:
        seller_cents = (meta.get('price') or {}).get('cents', 0)
    price_euros = seller_cents / 100
    new_price = int(math.ceil((price_euros * 0.88) / 10) * 10)
    if new_price > 1500:
        print(f"  WARNING: new_price={new_price}€ anormal (prix brut={price_euros}€)")
        new_price = int(round(price_euros))
    desc = (meta.get('originalDescription') or meta.get('description') or '').strip()
    gender_raw = (meta.get('gender') or {}).get('name', '').lower() if isinstance(meta.get('gender'), dict) else ''
    gender = 'h' if 'homme' in gender_raw or 'men' in gender_raw else 'f' if 'femme' in gender_raw or 'women' in gender_raw else 'h'

    print(f'  brand VC : {vc_brand}')
    print(f'  type     : {ptype}')
    print(f'  prix     : {price_euros}€ → site {new_price}€')

    # === Brand detection (NON SIGNÉ) ===
    final_brand = vc_brand.upper()
    if is_unsigned(vc_brand):
        detected, pattern, ctx = detect_brand_in_desc(desc)
        if detected:
            print(f'  ⚠ NON SIGNÉ → brand détectée dans desc: {detected} (pattern: {pattern})')
            final_brand = detected
            desc = clean_desc_after_brand_extraction(desc, detected)
        else:
            print(f'  ⚠ NON SIGNÉ + aucune brand détectée → EXIT 2 (Issue à ouvrir)')
            sys.exit(2)

    # Slug + path : remplace non-signe-unsigned par le slug brand détecté si applicable
    vestiaire_slug = extract_slug_from_url(url)
    vestiaire_path = extract_path_from_url(url)
    new_brand_slug = brand_to_slug(final_brand)
    site_slug = vestiaire_slug.replace('non-signe-unsigned', new_brand_slug)
    site_path = vestiaire_path.replace('non-signe-unsigned', new_brand_slug)

    print(f'  slug site: {site_slug}')
    print(f'  path site: {site_path}')

    # === Download photos ===
    print('  photos:')
    os.makedirs(OUT_IMG, exist_ok=True)
    scraper = make_scraper()
    good = 0
    for idx in range(1, 41):  # max 40 photos (règle définitive Tom 2026-05-04)
        if process_photo(scraper, item_id, idx, vestiaire_slug):
            good += 1
            print(f'    photo {idx}: OK')
        else:
            print(f'    photo {idx}: skip')
            break
        time.sleep(0.3)

    if good == 0:
        print(f'{item_id}: aucune photo téléchargeable → EXIT 3', file=sys.stderr)
        sys.exit(3)

    # === Traduction FR → EN automatique (Google Translate via deep-translator) ===
    # Si deep-translator dispo, traduit type/desc/size en EN. Sinon laisse vide
    # (sera traduit en batch plus tard via translate_descs.py / translate_types_sizes.py).
    type_en, desc_en, size_en = '', '', ''
    try:
        from deep_translator import GoogleTranslator
        tr = GoogleTranslator(source='fr', target='en')
        if ptype:
            try: type_en = tr.translate(ptype) or ''
            except: pass
        if desc:
            try: desc_en = tr.translate(desc) or ''
            except: pass
        # Size : pas la peine de traduire les tokens courts (ils restent identiques en EN)
        # Mais on remplace "Taille unique" → "One size"
        if size:
            if 'taille unique' in size.lower():
                size_en = re.sub(r'taille unique', 'One size', size, flags=re.IGNORECASE)
            else:
                size_en = size  # XS/S/M/L/XL/XXL/numériques sont identiques EN
        print(f'  traduction EN : type_en={type_en[:40]}... desc_en={desc_en[:40]}...')
    except ImportError:
        print('  ⚠ deep-translator pas installé, type_en/desc_en restent vides')

    # === Build PRODUCTS entry ===
    new_entry = {
        'id': item_id,
        'brand': final_brand,
        'type': ptype,
        'size': size,
        'price': str(new_price),
        'gender': gender,
        'color': color,
        'path': site_path,
        'slug': site_slug,
        'n': good,
        'desc': desc,
        'desc_en': desc_en,
        'type_en': type_en,
        'size_en': size_en,
    }

    # Insère au début de PRODUCTS (pour qu'il soit listé en premier)
    start = html.find('const PRODUCTS = [')
    arr_start = html.find('[', start)
    insert_pos = arr_start + 1
    new_str = '\n  ' + json.dumps(new_entry, ensure_ascii=False) + ','
    html = html[:insert_pos] + new_str + html[insert_pos:]

    # Add à VALIDATED_LOCAL (préfixe à la liste)
    m2 = re.search(r'(const VALIDATED_LOCAL = new Set\(\[)(.*?)(\]\);)', html, re.DOTALL)
    if m2 and f'"{item_id}"' not in m2.group(2):
        ids = re.findall(r'"(\d+)"', m2.group(2))
        ids.insert(0, item_id)
        inside = '\n  ' + ',\n  '.join(f'"{i}"' for i in ids) + '\n'
        html = html.replace(m2.group(0), m2.group(1) + inside + m2.group(3))

    with open(INDEX, 'w') as f: f.write(html)
    print(f'\n✓ {item_id} importé : brand={final_brand}, {good} photos, prix={new_price}€')
    sys.exit(0)


if __name__ == '__main__':
    main()

