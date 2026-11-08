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
from type_from_desc import site_type

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
    'MONITALY': 'monitaly',
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
    'JUN': 'jun',
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


def picture_paths(meta):
    """Chemins des photos tels que Vestiaire les donne dans la fiche, dans
    l'ordre (« produit/73317570-1_2.jpg »). Depuis nov. 2026 les fichiers
    photo portent le numéro de l'annonce (« 73317570-1_2.jpg ») et non plus
    son nom : deviner « produit/<nom>-1.jpg » renvoie 403 pour TOUTES les
    nouvelles pièces (32 imports bloqués le 6/11). Les annonces renommées
    (« Non signé ») étaient déjà dans ce cas."""
    found = []
    def add(pth):
        pth = re.sub(r'^https?://[^/]+/', '', str(pth)).split('?')[0]
        pth = re.sub(r'^images/resized/[^/]*/', '', pth).lstrip('/')
        if not re.search(r'\.(?:jpe?g|png|webp)$', pth, re.I):
            return
        if not pth.startswith('produit/'):
            pth = 'produit/' + pth
        if pth not in found:
            found.append(pth)
    pics = meta.get('pictures') or meta.get('images') or []
    if isinstance(pics, list):
        for x in pics:
            if isinstance(x, dict):
                v = x.get('path') or x.get('url') or x.get('src')
                if v: add(v)
            elif isinstance(x, str):
                add(x)
    if not found:  # secours : n'importe quel chemin « produit/… » dans la fiche
        def walk(x):
            if isinstance(x, dict):
                for v in x.values(): walk(v)
            elif isinstance(x, list):
                for v in x: walk(v)
            elif isinstance(x, str):
                for m in re.finditer(r'(produit/[A-Za-z0-9_\-]+\.(?:jpe?g|png|webp))', x):
                    add(m.group(1))
        walk(meta)
    def num(pth):
        m = re.search(r'-(\d+)(?:_\d+)?\.\w+$', pth)
        return int(m.group(1)) if m else 999
    return sorted(found, key=num)


CDN = 'https://images.vestiairecollective.com/images/resized/w=1600,q=90,f=auto,/'
_DIRECT_BLOCKED = False  # le CDN refuse les serveurs GitHub (403) : on ne réessaie plus en direct


def fetch_photo_bytes(scraper, url):
    """Photo brute. Direct d'abord (gratuit), sinon ScrapingBee : 1 essai
    normal + 1 essai premium, délais courts (synchro de 5 min, pas 20)."""
    global _DIRECT_BLOCKED
    if not _DIRECT_BLOCKED:
        try:
            r = scraper.get(url, timeout=15)
            if r.status_code == 200 and len(r.content) >= 10000:
                return r.content
            if r.status_code == 403:
                _DIRECT_BLOCKED = True
        except Exception:
            pass
    key = os.environ.get('SCRAPINGBEE_API_KEY', '').strip()
    if not key:
        return None
    for premium in (False, True):
        try:
            params = {'api_key': key, 'url': url, 'render_js': 'false', 'country_code': 'fr'}
            if premium: params['premium_proxy'] = 'true'
            r = requests.get('https://app.scrapingbee.com/api/v1/', timeout=30, params=params)
            if r.status_code == 200 and len(r.content) >= 10000:
                return r.content
            print(f'  {url.rsplit("/", 1)[-1]} : scrapingbee{" premium" if premium else ""} HTTP {r.status_code}', file=sys.stderr)
        except Exception as e:
            print(f'  {url.rsplit("/", 1)[-1]} : scrapingbee ERR {e}', file=sys.stderr)
    return None


def save_photo(content, item_id, out_idx):
    """Écrit les 3 versions webp (xl/md/sm) de la photo n° out_idx (0 = photo 1)."""
    im = Image.open(io.BytesIO(content)).convert('RGB')
    for sn, target, q in [('xl', 1600, 95), ('md', 800, 95), ('sm', 400, 92)]:
        out = pad_square(im, target)
        out.save(os.path.join(OUT_IMG, f'{item_id}-{out_idx}-{sn}.webp'), 'WEBP', quality=q, method=6)


def process_photo(scraper, item_id, photo_idx, vestiaire_slug, path=None, out_idx=None):
    """Télécharge la photo {photo_idx} (1-indexed) et écrit ses 3 versions.
    path : chemin donné par la fiche (prioritaire sur le nom deviné)."""
    url = CDN + path if path else f'{CDN}produit/{vestiaire_slug}-{photo_idx}.jpg'
    try:
        content = fetch_photo_bytes(scraper, url)
        if not content:
            return False
        save_photo(content, item_id, photo_idx - 1 if out_idx is None else out_idx)
        return True
    except Exception as e:
        print(f'  photo {photo_idx} ERR: {e}', file=sys.stderr)
        return False


def fetch_meta(url, expected_id=None):
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
                if not isinstance(d, dict):
                    continue
                # FILTRE CRITIQUE : seulement l'article attendu
                # (évite de lire le prix d'un article recommandé en bas de page)
                if expected_id and str(d.get('id', '')) != str(expected_id):
                    continue
                if not (d.get('id') and d.get('brand')):
                    continue
                # VÉRIFICATION DEVISE : rejette prix USD/autre (IP US)
                breakdown = d.get('pricingBreakdown') or {}
                seller = breakdown.get('sellerPrice') or {}
                curr = seller.get('currency') or {}
                curr_code = curr.get('code', 'EUR') if isinstance(curr, dict) else str(curr)
                if curr_code and curr_code != 'EUR':
                    print(f'fetch_meta [{label}] : devise {curr_code} ≠ EUR — rejeté', file=sys.stderr)
                    continue
                return d
        except Exception as e:
            print(f'fetch_meta [{label}] parse ERR: {e}', file=sys.stderr)
        return None

    headers = {
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }

    sb_key = os.environ.get('SCRAPINGBEE_API_KEY', '').strip()

    if sb_key:
        # ── RÈGLE ABSOLUE : quand SCRAPINGBEE_API_KEY est défini (GitHub Actions),
        # on NE tombe JAMAIS sur curl-cffi ou Playwright.
        # Les serveurs GitHub Actions sont aux USA → prix USD+taxes si fetch direct.
        # Si ScrapingBee échoue → EXIT 1 plutôt que risquer un prix erroné.
        # ──────────────────────────────────────────────────────────────────────────

        # Passe 1 : datacenter + country_code=fr  (~1 crédit)
        # Passe 1b : premium_proxy + country_code=fr (~10 crédits, si Cloudflare bloque)
        for premium in (False, True):
            label = 'scrapingbee-premium' if premium else 'scrapingbee'
            try:
                params = {
                    'api_key': sb_key, 'url': url,
                    'render_js': 'false',
                    'country_code': 'fr',   # CRITIQUE : force prix EUR
                }
                if premium:
                    params['premium_proxy'] = 'true'
                r = requests.get('https://app.scrapingbee.com/api/v1/', params=params, timeout=60)
                if r.status_code == 200:
                    r.encoding = 'utf-8'  # sinon accents abîmés (« annÃ©es », 6/11)
                    result = _extract(r.text, label)
                    if result:
                        return result
                    print(f'fetch_meta [{label}] : 200 mais __NEXT_DATA__ absent', file=sys.stderr)
                else:
                    print(f'fetch_meta [{label}] : HTTP {r.status_code}', file=sys.stderr)
            except Exception as e:
                print(f'fetch_meta [{label}] ERR: {e}', file=sys.stderr)

        # Les deux passes ScrapingBee ont échoué → stopper l'import.
        # NE PAS tomber sur curl-cffi : prix potentiellement faux (IP US).
        print(
            f'FATAL: ScrapingBee indisponible (quota épuisé ou erreur réseau).\n'
            f'Import annulé pour {url} — mieux vaut rater un import que mettre un prix erroné.',
            file=sys.stderr
        )
        sys.exit(1)

    # ── Pas de SCRAPINGBEE_API_KEY → mode développement local uniquement ────────
    # ATTENTION : les passes ci-dessous utilisent l'IP locale (non-FR possible).
    # Ne jamais utiliser en production / GitHub Actions.
    print('⚠ SCRAPINGBEE_API_KEY absent → fetch direct (usage local uniquement, prix peut être non-EUR)',
          file=sys.stderr)

    # Passe 2 : curl-cffi (imite TLS Chrome, bypass Cloudflare)
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

    # Passe 3 : Playwright + stealth
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
            try:
                print(f'  → Titre Playwright: {repr(page.title())}', file=sys.stderr)
            except Exception:
                pass
            content = page.content()
            browser.close()
        return _extract(content, 'pass3-playwright')
    except Exception as e:
        print(f'fetch_meta [pass3-playwright] ERR: {e}', file=sys.stderr)

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


# Vestiaire force en théorie le français via Accept-Language (cf fetch_meta),
# mais le champ "name" d'une fiche est du texte libre saisi par le vendeur :
# certaines fiches (surtout récentes) sont titrées en anglais même récupérées
# en contexte FR. Bug trouvé le 27/09/2026 (audit passeist.com) : le pipeline
# traduisait alors ce texte anglais FR→EN sans le savoir, produisant un
# charabia utilisé tel quel comme champ 'type'/'desc' FRANÇAIS du site.
# Détection légère (sans dépendance supplémentaire) : présence d'accents ou de
# mots-clés mode français = FR quasi certain ; sinon, mots-clés mode anglais
# non ambigus = probablement déjà EN.
_FR_HINT_WORDS = {
    'veste', 'manteau', 'pull', 'pullover', 'chemise', 'pantalon', 'jupe', 'robe',
    'gilet', 'blouson', 'ensemble', 'tailleur', 'écharpe', 'chapeau', 'sac',
    'chaussures', 'bottes', 'baskets', 'maille', 'laine', 'coton', 'cuir',
    'débardeur', 'haut', 'gants', 'ceinture', 'cravate', 'avec', 'pour', 'et',
    'de', 'du', 'des', 'le', 'la', 'les', 'un', 'une', 'sans',
}
_EN_HINT_WORDS = {
    'jacket', 'coat', 'sweater', 'shirt', 'pants', 'trousers', 'skirt', 'dress',
    'vest', 'blouse', 'cardigan', 'jeans', 'shorts', 'scarf', 'hat', 'bag',
    'shoes', 'boots', 'sneakers', 'knit', 'wool', 'cotton', 'leather', 'denim',
    'trench', 'parka', 'hoodie', 'sweatshirt', 'tank', 'gloves', 'belt', 'tie',
    'with', 'and', 'the', 'for', 'puffer', 'jumper', 'harem', 'tunic', 'mules', 'trainers',
    'lace', 'ups', 'satchel', 'cap', 'jumpsuit', 'backpack', 'socks',
}


# Secours quand Google Translate échoue : types Vestiaire anglais courants.
_TYPE_EN_FR = [
    ('lace ups', 'Derbies'), ('trainers', 'Baskets'), ('boots', 'Bottes'), ('mules', 'Mules'),
    ('gloves', 'Gants'), ('puffer', 'Doudoune'), ('jumpsuit', 'Combinaison'), ('tunic', 'Tunique'),
    ('jumper', 'Pull'), ('backpack', 'Sac à dos'), ('socks', 'Chaussettes'), ('cap', 'Casquette'),
    ('mid-length skirt', 'Jupe mi-longue'), ('mid-length dress', 'Robe mi-longue'),
    ('maxi dress', 'Robe longue'), ('mini dress', 'Mini robe'), ('mini skirt', 'Mini jupe'),
    ('belt bag', 'Sac banane'), ('small bag', 'Petite maroquinerie'), ('short vest', 'Blouson'),
    ('cardi coat', 'Veste longue'), ('t-shirt', 'T-shirt'), ('tie', 'Cravate'), ('trousers', 'Pantalon'),
    ('pants', 'Pantalon'), ('jeans', 'Jean'), ('jacket', 'Veste'), ('vest', 'Veste'),
    ('coat', 'Manteau'), ('sweater', 'Pull'), ('pull', 'Pull'), ('knitwear', 'Pull'),
    ('sweatshirt', 'Sweat'), ('hoodie', 'Sweat à capuche'), ('shirt', 'Chemise'),
    ('blouse', 'Blouse'), ('top', 'Haut'), ('skirt', 'Jupe'), ('dress', 'Robe'),
    ('shorts', 'Short'), ('harem', 'Sarouel'), ('satchel', 'Sac besace'), ('bag', 'Sac'),
    ('scarf', 'Écharpe'), ('hat', 'Chapeau'), ('belt', 'Ceinture'), ('cardigan', 'Cardigan'),
]
_MAT_EN_FR = {'wool': 'laine', 'silk': 'soie', 'leather': 'cuir', 'cotton': 'coton',
              'linen': 'lin', 'denim': 'denim', 'cashmere': 'cachemire'}


def _type_en_to_fr(t):
    low = t.strip().lower()
    mat = next((fr for en, fr in _MAT_EN_FR.items() if re.search(rf'\b{en}\b', low)), '')
    for en, fr in _TYPE_EN_FR:
        if re.search(rf'\b{re.escape(en)}\b', low):
            return fr + (f' en {mat}' if mat else '')
    return t


def _looks_already_english(text):
    t = (text or '').strip().lower()
    # « T-shirt » / « tee shirt » se disent aussi en français : sinon « T-shirt »
    # devenait « Tee shirt » puis « Chemise » (6/11)
    t = re.sub(r't-shirts?|tee[- ]?shirts?', ' ', t).strip()
    if not t:
        return False
    if any(c in t for c in 'àâäéèêëîïôöùûüçœ'):
        return False  # accent = FR quasi certain
    tokens = re.findall(r"[a-z]+", t)
    if not tokens:
        return False
    fr_hits = sum(1 for w in tokens if w in _FR_HINT_WORDS)
    en_hits = sum(1 for w in tokens if w in _EN_HINT_WORDS)
    return en_hits > 0 and en_hits >= fr_hits


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
    meta = fetch_meta(url, expected_id=item_id)
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
    # Prix : prix "pour vous" affiché sur la fiche VC (sellerPrice.cents),
    # arrondi à la DIZAINE SUPÉRIEURE. Ex: 220€→220€, 223€→230€.
    # ×0.88 = décote Passeist −12% vs prix VC, arrondi à la dizaine supérieure.
    breakdown = meta.get('pricingBreakdown') or {}
    # Prix passeist = ceil(sellerEarning / 10) × 10
    # sellerEarning = ce que le vendeur reçoit sur VC (après commission VC)
    # Ex: sellerPrice=110€ → sellerEarning=95€ → passeist=100€
    earning_cents = (breakdown.get('sellerEarning') or {}).get('cents', 0)
    if not earning_cents:
        # Fallback: sellerPrice × 0.88 si sellerEarning absent
        sp = (breakdown.get('sellerPrice') or {}).get('cents', 0) or (meta.get('price') or {}).get('cents', 0)
        earning_cents = int(sp * 0.88)
    price_euros = earning_cents / 100
    new_price = int(math.ceil(price_euros / 10) * 10)
    if new_price > 1500:
        print(f"  WARNING: new_price={new_price}€ anormal (sellerEarning={price_euros}€)")
        new_price = int(round(price_euros / 10) * 10)
    desc = (meta.get('originalDescription') or meta.get('description') or '').strip()
    gender_raw = (meta.get('gender') or {}).get('name', '').lower() if isinstance(meta.get('gender'), dict) else ''
    # Tester « femme/women » AVANT « homme/men » : "women" contient "men"
    # (bug corrigé le 2026-09-28 : toutes les pièces femme étaient importées en 'h').
    if 'femme' in gender_raw or 'women' in gender_raw:
        gender = 'f'
    elif 'homme' in gender_raw or 'men' in gender_raw:
        gender = 'h'
    else:
        gender = ''  # déduit plus bas de la catégorie Vestiaire (chemin de l'URL)

    print(f'  brand VC : {vc_brand}')
    print(f'  type     : {ptype}')
    print(f'  prix     : {price_euros}€ → site {new_price}€')

    # === Brand detection ===
    final_brand = vc_brand.upper()
    # Lignes Yohji vendues sous leur propre nom sur Vestiaire : rangées sous
    # YOHJI YAMAMOTO sur le site (la ligne est lue dans la description)
    if final_brand.replace('’', "'") in ("Y'S", 'Y S', 'GROUND Y', "Y'S FOR MEN"):
        final_brand = 'YOHJI YAMAMOTO'
    # Même maison sous deux noms chez Vestiaire : un seul nom sur le site
    if final_brand == 'MIHARA YASUHIRO':
        final_brand = 'MAISON MIHARA YASUHIRO'
    # Marques données par Tom pour des annonces « Non signé » dont la
    # description ne dit pas la marque
    BRAND_OVERRIDES = {'72606166': '45RPM', '68563799': 'X-LARGE'}
    if str(item_id) in BRAND_OVERRIDES:
        final_brand = BRAND_OVERRIDES[str(item_id)]
        print(f'  marque donnée par Tom : {final_brand}')
    elif is_unsigned(vc_brand):
        # Marques déjà présentes sur le site (« Marque … » en tête de desc)
        try:
            site_brands = set(re.findall(r'"brand":\s*"([^"]+)"', open(INDEX, encoding='utf-8').read()))
        except Exception:
            site_brands = set()
        detected, pattern, ctx = detect_brand_in_desc(desc, site_brands)
        if detected:
            print(f'  ⚠ NON SIGNÉ → brand détectée dans desc: {detected} (pattern: {pattern})')
            final_brand = detected
            desc = clean_desc_after_brand_extraction(desc, detected)
        else:
            # Règle Tom (nov. 2026) : rien ne reste sur Vestiaire sans être sur le
            # site. Sans marque lisible, la pièce est importée en « NON SIGNÉ ».
            first = next((l.strip() for l in desc.split('\n') if l.strip()), '')
            print(f'  ⚠ NON SIGNÉ + aucune brand détectée (1ère ligne : {first[:80]!r}) → importée en NON SIGNÉ')
            final_brand = 'NON SIGNÉ'
    else:
        # Même pour les produits "signés" sur VC : si la description révèle
        # une vraie marque différente (pattern connu, pas juste 1ère ligne),
        # on l'utilise à la place. Ex : VC dit "Yohji Yamamoto" mais desc dit
        # "JUN a été fondé en 1958 par Tadashi Sasaki."
        detected_s, pattern_s, ctx_s = detect_brand_in_desc(desc)
        if detected_s and pattern_s != 'FIRST_LINE' and detected_s.upper() != final_brand.upper():
            print(f'  ⚠ OVERRIDE brand VC "{vc_brand}" → "{detected_s}" (détectée dans desc, pattern: {pattern_s!r})')
            final_brand = detected_s
            desc = clean_desc_after_brand_extraction(desc, detected_s)

    # Slug + path : remplace non-signe-unsigned par le slug brand détecté si applicable
    vestiaire_slug = extract_slug_from_url(url)
    vestiaire_path = extract_path_from_url(url)
    if not gender:
        vp = vestiaire_path.lower()
        gender = 'f' if ('-femme/' in vp or '/women-' in vp) else 'h'
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
    paths = picture_paths(meta)
    if paths:
        print(f'  {len(paths)} photos dans la fiche Vestiaire (ex. {paths[0]})')
    if paths:
        # 5 photos téléchargées à la fois (via ScrapingBee depuis que le CDN
        # refuse GitHub : une à une, une synchro durait 20 min et plus)
        from concurrent.futures import ThreadPoolExecutor
        paths = paths[:40]  # max 40 photos (règle définitive Tom 2026-05-04)
        with ThreadPoolExecutor(max_workers=5) as ex:
            contents = list(ex.map(lambda pth: fetch_photo_bytes(scraper, CDN + pth), paths))
        for idx, content in enumerate(contents, 1):
            if not content:
                print(f'    photo {idx}: ÉCHEC, photo suivante', file=sys.stderr)
                continue
            try:
                save_photo(content, item_id, good)  # numérotées sans trou
                good += 1
                print(f'    photo {idx}: OK')
            except Exception as e:
                print(f'    photo {idx}: ERR {e}', file=sys.stderr)
    else:
        for idx in range(1, 41):
            if process_photo(scraper, item_id, idx, vestiaire_slug):
                good += 1
                print(f'    photo {idx}: OK')
            else:
                print(f'    photo {idx}: skip')
                break
            time.sleep(0.3)
    if paths and good < len(paths):
        print(f'  ⚠ {good} photos sur {len(paths)}', file=sys.stderr)

    if good == 0:
        # Diagnostic : où la fiche range-t-elle ses photos ?
        keys = [k for k in meta.keys() if re.search(r'pic|image|photo|media', k, re.I)]
        print(f'  clés photo de la fiche : {keys} ; extrait : {str({k: meta[k] for k in keys})[:600]}', file=sys.stderr)
        print(f'{item_id}: aucune photo téléchargeable → EXIT 3', file=sys.stderr)
        sys.exit(3)

    # === Type de pièce ===
    # Type anglais chez Vestiaire (« Wool pull », « Harem »…) → français tout de
    # suite, même si Google Translate n'est pas là (37 pièces en anglais, nov. 2026)
    if ptype and _looks_already_english(ptype):
        fr = _type_en_to_fr(ptype)
        if fr != ptype:
            print(f'  type anglais "{ptype}" → "{fr}"')
            ptype = fr
    # Règle Tom (nov. 2026) : la catégorie du site se base sur SA description,
    # pas sur la catégorie Vestiaire (qui range les tops en « Blouse », les
    # gilets en « Sweat »…). Le type Vestiaire n'est gardé que s'il est dans le
    # même rayon que la pièce décrite, ou si la description ne la nomme pas.
    new = site_type(ptype, desc)
    if new != ptype:
        print(f'  type "{ptype}" → "{new}" (lu dans la description)')
        ptype = new

    # === Traduction FR → EN automatique (Google Translate via deep-translator) ===
    # Si deep-translator dispo, traduit type/desc/size en EN. Sinon laisse vide
    # (sera traduit en batch plus tard via translate_descs.py / translate_types_sizes.py).
    # Google refuse les serveurs GitHub depuis mi-octobre 2026 : tools/translate.py
    # passe par ScrapingBee quand l'appel direct est refusé.
    from translate import translate as _tr, translate_type as _tr_type
    type_en, desc_en, size_en = '', '', ''
    if ptype:
        if _looks_already_english(ptype):
            print(f'  ⚠ type déjà en anglais ("{ptype}") → dictionnaire')
            type_en = ptype
            ptype = _type_en_to_fr(ptype)
        else:
            type_en = _tr_type(ptype)
    if desc:
        if _looks_already_english(desc):
            print('  ⚠ description déjà en anglais → EN→FR')
            desc_en = desc
            desc = _tr(desc, 'en', 'fr') or desc
        else:
            desc_en = _tr(desc)
    # Size : pas la peine de traduire les tokens courts (ils restent identiques en EN)
    # Mais on remplace "Taille unique" → "One size"
    if size:
        if 'taille unique' in size.lower():
            size_en = re.sub(r'taille unique', 'One size', size, flags=re.IGNORECASE)
        else:
            size_en = size  # XS/S/M/L/XL/XXL/numériques sont identiques EN
    print(f'  traduction EN : type_en={type_en[:40]!r} desc_en={desc_en[:60]!r}')
    if desc and not desc_en:
        print('  ⚠ traduction EN échouée : rattrapée en fin de synchro (translate.py --fill)', file=sys.stderr)

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

