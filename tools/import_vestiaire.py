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
import sys, os, re, json, asyncio, math, time, io
from PIL import Image
from playwright.async_api import async_playwright
import cloudscraper

# Ajout du dossier tools/ au path pour importer brand_detector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from brand_detector import is_unsigned, detect_brand_in_desc, clean_desc_after_brand_extraction

# === Configuration ===
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, 'index.html')
OUT_IMG = os.path.join(ROOT, 'img')
PROXY_USER = os.environ.get('DECODO_USER', '')
PROXY_PASS = os.environ.get('DECODO_PASS', '')
PROXY_HOST = os.environ.get('DECODO_HOST', 'fr.decodo.com:40005')
PROXY = {'server': f'http://{PROXY_HOST}', 'username': PROXY_USER, 'password': PROXY_PASS}
PROXY_URL = f'http://{PROXY_USER}:{PROXY_PASS}@{PROXY_HOST}'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

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
    s = cloudscraper.create_scraper(browser={'browser': 'chrome', 'platform': 'darwin'})
    s.proxies = {'http': PROXY_URL, 'https': PROXY_URL}
    s.headers.update({'Referer': 'https://fr.vestiairecollective.com/'})
    return s


def process_photo(scraper, item_id, photo_idx, vestiaire_slug):
    """Télécharge la photo {photo_idx} (1-indexed) depuis Vestiaire CDN
    et écrit 3 versions webp pad square : item_id-{idx-1}-xl/md/sm.webp
    Retourne True si OK."""
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


async def fetch_meta(url):
    """Fetch fiche Vestiaire via Playwright. Retourne dict metadata ou None."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, proxy=PROXY)
        ctx = await browser.new_context(user_agent=UA, locale='fr-FR',
                                         viewport={'width': 1280, 'height': 900})
        page = await ctx.new_page()
        try:
            await page.goto(url, timeout=60000, wait_until='domcontentloaded')
            await page.wait_for_timeout(3500)
            data = await page.evaluate('() => document.getElementById("__NEXT_DATA__")?.textContent')
            await browser.close()
            if not data: return None
            jd = json.loads(data)
            queries = jd.get('props', {}).get('pageProps', {}).get('dehydratedState', {}).get('queries', [])
            for q in queries:
                d = q.get('state', {}).get('data')
                if isinstance(d, dict) and d.get('id') and d.get('brand'):
                    return d
        except Exception as e:
            print(f'fetch_meta ERR: {e}', file=sys.stderr)
            await browser.close()
    return None


def extract_path_from_url(vestiaire_url):
    """Extrait le category-path Vestiaire depuis l'URL.
    Ex: https://fr.vestiairecollective.com/accessoires-homme/chapeaux-bonnets/non-signe-unsigned/...shtml
        → 'accessoires-homme/chapeaux-bonnets/non-signe-unsigned'"""
    m = re.search(r'vestiairecollective\.com/(.*?)/[^/]+\.shtml?', vestiaire_url)
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
    meta = asyncio.run(fetch_meta(url))
    if not meta:
        print(f'{item_id}: pas de metadata (fiche introuvable ou proxy fail)', file=sys.stderr)
        sys.exit(1)

    vc_brand = (meta.get('brand') or {}).get('name', '')
    ptype = (meta.get('name') or '').strip()
    size = (meta.get('size') or {}).get('size', '')
    color = (meta.get('color') or {}).get('name', '')
    price_cents = (meta.get('price') or {}).get('cents', 0)
    price_euros = price_cents // 100
    new_price = int(math.floor((price_euros * 0.88) / 10) * 10)
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
    for idx in range(1, 16):  # max 15 photos
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
