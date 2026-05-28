#!/usr/bin/env python3
"""Synchro Vestiaire — version Apify proxy + Playwright (migration 2026-05-28).

Architecture :
- Playwright + Apify proxy résidentiel pour le scan profil (navigation JS native)
- Apify proxy direct pour vérifier chaque item (requests simple)
- Anti-faux-positifs : circuit breaker à 15, classification stricte (R1)

Seul env var requis : APIFY_API_KEY.
"""
import re, json, os, time, datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import requests

# === CONFIG ===
APIFY_API_KEY = os.environ.get('APIFY_API_KEY', '').strip()
if not APIFY_API_KEY:
    raise SystemExit('FATAL: APIFY_API_KEY env var manquante.')

print(f'[debug] APIFY_API_KEY len={len(APIFY_API_KEY)} '
      f'first={APIFY_API_KEY[:8]!r}...')

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
# Full scan : dimanche automatiquement, ou forcé via env var FULL_SCAN=true (workflow_dispatch)
FULL_SCAN = (os.environ.get('FULL_SCAN', 'false').lower() == 'true'
             or datetime.datetime.utcnow().weekday() == 6)  # 6 = dimanche

PROFILE_URL = 'https://fr.vestiairecollective.com/profile/30773496/?sortBy=relevance&tab=items-for-sale'
INDEX = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'index.html')


def apify_fetch(url, premium=False):
    """Fetch via Apify proxy. Retourne (status, resolved_url, html).
    premium=False → tentative directe sans proxy (gratuit).
    premium=True  → proxy résidentiel Apify (bypass Cloudflare)."""
    headers = {'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'}
    if not premium:
        try:
            r = requests.get(url, headers=headers, timeout=30)
            return r.status_code, r.url, r.text
        except Exception as e:
            return 0, url, f'ERROR: {e}'
    else:
        proxy_url = f'http://groups-RESIDENTIAL,country-FR:{APIFY_API_KEY}@proxy.apify.com:8000'
        proxies = {'http': proxy_url, 'https': proxy_url}
        try:
            r = requests.get(url, proxies=proxies, headers=headers, timeout=60)
            return r.status_code, r.url, r.text
        except Exception as e:
            return 0, url, f'ERROR: {e}'


def load_site():
    with open(INDEX) as f: html = f.read()
    start = html.find('const PRODUCTS = [')
    arr_start = html.find('[', start)
    depth = 0; in_str = False; esc = False; i = arr_start
    while i < len(html):
        c = html[i]
        if esc: esc = False; i += 1; continue
        if c == '\\': esc = True; i += 1; continue
        if c == '"': in_str = not in_str; i += 1; continue
        if not in_str:
            if c == '[': depth += 1
            elif c == ']':
                depth -= 1
                if depth == 0: arr_end = i + 1; break
        i += 1
    raw = re.sub(r',\s*(\]|\})', r'\1', html[arr_start:arr_end])
    products = json.loads(raw)
    m = re.search(r'const SOLD_IDS = new Set\(\[(.*?)\]\);', html, re.DOTALL)
    sold_ids = set(re.findall(r'"(\d+)"', m.group(1)))
    vestiaire_products = [p for p in products if len(str(p['id'])) < 10]
    site_all = {p['id'] for p in vestiaire_products}
    site_sold = sold_ids & site_all
    site_available = site_all - site_sold
    def stem(slug, pid): return slug.rsplit('-' + pid, 1)[0] if ('-' + pid) in slug else slug
    sold_stems = {stem(p['slug'], p['id']) for p in vestiaire_products if p['id'] in site_sold}
    all_stems = {stem(p['slug'], p['id']) for p in vestiaire_products}
    by_id = {p['id']: p for p in vestiaire_products}
    return site_all, site_sold, site_available, sold_stems, all_stems, by_id


def scrape_profile():
    """Scan for-sale + sold via Playwright.

    2 tentatives : direct d'abord (sans proxy), puis Apify proxy residentiel.
    Timeout 120s par tentative. Pages 1->15 for-sale + onglet Vendus.
    """
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

    fs_urls = set()
    sd_urls = set()
    fs_target = 0
    sold_target = 0

    def _do_scrape(page):
        nonlocal fs_target, sold_target

        page.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined})")
        page.route('**/*', lambda route: route.abort()
                   if route.request.resource_type in ['image', 'media']
                   else route.continue_())

        print('  -> Navigation vers profil...')
        page.goto(PROFILE_URL, wait_until='load', timeout=120000)
        time.sleep(2)

        try:
            for txt in ['Accepter', 'Accept all', 'Accept cookies', 'Tout accepter']:
                btns = page.locator(f'button:has-text("{txt}")')
                if btns.count() > 0 and btns.first.is_visible(timeout=2000):
                    btns.first.click(); time.sleep(1.5); break
        except Exception:
            pass

        try:
            body = page.inner_text('body', timeout=5000)
            m = re.search(r'(\d[\d\s\xa0 ]*)\s+(?:articles?\s+en\s+vente|items?\s+for\s+sale)', body)
            if m: fs_target = int(re.sub(r'[\s\xa0 ]', '', m.group(1)))
            m = re.search(r'(\d[\d\s\xa0 ]*)\s+(?:vendus|sold)\b', body)
            if m: sold_target = int(re.sub(r'[\s\xa0 ]', '', m.group(1)))
        except Exception as e:
            print(f'  -> compteurs ERR: {e}')

        try:
            page.locator('button:has-text("60")').first.click(timeout=5000)
            time.sleep(2.5)
        except Exception:
            pass

        def harvest(target_set):
            links = page.eval_on_selector_all('a[href]', 'els => els.map(a => a.href)')
            cnt = 0
            for u in links:
                if re.search(r'-\d{7,9}\.shtml', u):
                    target_set.add(u); cnt += 1
            return cnt

        page.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)')
        time.sleep(0.8)
        cnt = harvest(fs_urls)
        print(f'  -> Page 1: {cnt} items')

        for n in range(2, 16):
            try:
                btn = page.locator('button').filter(has_text=re.compile(f'^{n}$')).first
                btn.click(timeout=5000)
                time.sleep(2)
                page.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)')
                time.sleep(0.8)
                cnt = harvest(fs_urls)
                print(f'  -> Page {n}: {cnt} items')
                if cnt == 0: break
            except Exception as e:
                print(f'  -> Page {n}: {e}, fin'); break

        try:
            sold_tab = page.locator('div,span,button,a,[role="button"]').filter(
                has_text=re.compile(r'^(Articles vendus|Vendus|Sold items|Sold)$', re.IGNORECASE)
            ).first
            sold_tab.click(timeout=5000); time.sleep(2.5)
            try:
                page.locator('button:has-text("60")').first.click(timeout=5000); time.sleep(2.5)
            except Exception: pass
            page.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)')
            time.sleep(1.2)
            cnt = harvest(sd_urls)
            print(f'  -> Sold tab: {cnt} items')
        except Exception as e:
            print(f'  -> Sold tab ERR: {e}')

    for label, ctx_extra in [
        ('direct (sans proxy)', {}),
        ('Apify proxy residentiel', {'proxy': {
            'server': 'http://proxy.apify.com:8000',
            'username': 'groups-RESIDENTIAL,country-FR',
            'password': APIFY_API_KEY,
        }}),
    ]:
        print(f'  -> Tentative {label}...')
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                ctx = browser.new_context(
                    extra_http_headers={'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'},
                    user_agent=UA, viewport={'width': 1920, 'height': 1080},
                    **ctx_extra,
                )
                _do_scrape(ctx.new_page())
                browser.close()
            if fs_urls:
                print(f'  OK {label}'); break
            else:
                print(f'  -> {label}: 0 items, retry...')
                fs_urls.clear(); sd_urls.clear(); fs_target = 0; sold_target = 0
        except (PWTimeout, Exception) as e:
            print(f'  -> {label}: {type(e).__name__}, retry...')
            fs_urls.clear(); sd_urls.clear(); fs_target = 0; sold_target = 0

    fs_map = {}
    for u in fs_urls:
        m = re.search(r'-(\d{7,9})\.shtml?', u)
        if m: fs_map[m.group(1)] = u
    sold_map = {}
    for u in sd_urls:
        m = re.search(r'-(\d{7,9})\.shtml?', u)
        if m: sold_map[m.group(1)] = u

    print(f'Profil : {fs_target} en vente · {sold_target} vendus')
    print(f'  for-sale: {len(fs_map)} URLs')
    print(f'  sold page 1: {len(sold_map)} URLs')

    return fs_map, sold_map, fs_target, sold_target

def verify_item(pid, by_id):
    """Hit la fiche produit via Apify proxy et classe.
    Retourne 'deleted' / 'sold' / 'keep'."""
    prod = by_id.get(pid)
    if not prod or not prod.get('path'):
        return 'keep'
    path = prod['path']
    # Garde-fou : path doit pointer vers une fiche produit (.shtml), pas une catégorie.
    # Si path = catégorie seule (= bug historique import_vestiaire.py 2026-05-04),
    # on reconstruit la fiche complète via {path}/{slug}.shtml.
    if not path.endswith('.shtml'):
        slug = prod.get('slug', '')
        if not slug:
            return 'keep'
        path = f"/{path.strip('/')}/{slug}.shtml"
    url = f'https://fr.vestiairecollective.com{path if path.startswith("/") else "/" + path}'
    # 1ère tentative : datacenter (1 credit)
    status, resolved, html = apify_fetch(url, premium=False)
    if status == 0:
        return 'keep'  # erreur réseau, doute = sécurité
    # Si bloqué (403, 429, 5xx) → retry avec premium proxy (25 credits)
    if status not in (200, 301, 302):
        status, resolved, html = apify_fetch(url, premium=True)
        if status not in (200, 301, 302):
            return 'keep'
    # Article supprimé : ID disparu de l'URL finale (redirect catégorie)
    if pid not in resolved:
        return 'deleted'
    # Article vendu : JSON-LD availability OutOfStock
    m = re.search(r'"availability"\s*:\s*"([^"]+)"', html)
    avail = m.group(1) if m else None
    if avail == 'OutOfStock':
        return 'sold'
    # InStock ou indéterminé → on garde actif (R1: doute = sécurité)
    return 'keep'


def main():
    print('=== Chargement du site ===')
    site_all, site_sold, site_available, sold_stems, all_stems, by_id = load_site()
    print(f'Site : {len(site_all)} produits Vestiaire · {len(site_sold)} sold · {len(site_available)} available')

    print('\n=== Scan profil Vestiaire (Playwright + Apify proxy) ===')
    fs_map, sold_map, fs_target, sold_target = scrape_profile()
    print(f'Vestiaire : {len(fs_map)} for-sale · {len(sold_map)} vendus')

    def slug_stem(url):
        m = re.search(r'/([^/]+)-(\d{7,9})\.shtml?', url)
        return m.group(1) if m else None

    vc_fs_ids = set(fs_map.keys())
    vc_sold_ids = set(sold_map.keys())
    vc_all = vc_fs_ids | vc_sold_ids

    A = list(vc_fs_ids & site_sold)
    # B brut = items vus dans onglet "Vendus" Vestiaire ET dispo sur site.
    # ATTENTION : Vestiaire montre parfois des items InStock dans l'onglet Vendus
    # (bug UI / cache). Sans vérif individuelle, on bascule à tort.
    # → On VÉRIFIE chaque candidat B via JSON-LD avant de l'inclure (post-incident
    # 2026-05-03 où 7 articles InStock ont été basculés à tort).
    B_raw = list((vc_sold_ids - vc_fs_ids) & site_available)
    B = []  # B vérifié via JSON-LD availability=OutOfStock
    if B_raw:
        print(f'\n  → Vérification individuelle des {len(B_raw)} candidats B (anti-faux-positif)...')
        from concurrent.futures import ThreadPoolExecutor as _TPE, as_completed as _ac
        with _TPE(max_workers=8) as _ex:
            _futs = {_ex.submit(verify_item, pid, by_id): pid for pid in B_raw}
            for _f in _ac(_futs):
                _pid, _status = _futs[_f], _f.result()
                if _status == 'sold':
                    B.append(_pid)
                else:
                    print(f'    ⚠ {_pid} : faux positif B ({_status}), skip')
        print(f'    ✓ {len(B)}/{len(B_raw)} confirmés vendus')

    C = []
    for vid, url in fs_map.items():
        if vid in site_all: continue
        s = slug_stem(url)
        if s and s in sold_stems:
            C.append({'id': vid, 'url': url, 'stem': s})

    # === Garde-fou scan incomplet (R: si pagination cassée, skip vérif) ===
    SCAN_THRESHOLD = 0.9
    scan_ratio = len(fs_map) / fs_target if fs_target else 0
    scan_incomplete = scan_ratio < SCAN_THRESHOLD

    D1 = []
    B_extra = []

    if scan_incomplete:
        print(f'\n  ⚠ SCAN INCOMPLET : {len(fs_map)}/{fs_target} URLs ({scan_ratio:.0%}). Vérif SKIPPED.')
    else:
        if FULL_SCAN:
            # Scan complet : vérifie tous les items actifs (dimanche + workflow_dispatch manuel)
            to_verify = sorted(site_available, key=lambda x: int(x))
            print(f'\n  → SCAN COMPLET ({len(to_verify)} items actifs) — dimanche ou forcé manuel...')
        else:
            # Scan ciblé : uniquement les D1 candidates (absents du scan VC)
            # Les items dans vc_fs_ids sont définitivement actifs → inutile de les vérifier
            to_verify = sorted(site_available - vc_fs_ids - vc_sold_ids, key=lambda x: int(x))
            print(f'\n  → Vérif D1 ciblée : {len(to_verify)} items absents du scan VC...')
        deleted_set = set()
        sold_set = set()
        progress = [0]
        lock = threading.Lock()

        def worker(pid):
            status = verify_item(pid, by_id)
            # Cross-check anti-faux-positif (R0bis) : si l'article est dans l'onglet
            # "En vente" de Vestiaire (vc_fs_ids), il NE PEUT PAS être vendu, peu
            # importe ce que dit le JSON-LD. Vestiaire propage parfois OutOfStock
            # entre annonces liées (relistage du même produit physique).
            # Incident 2026-05-07 : 66739013 (Issey Miyake pull, relistage actif)
            # avait JSON-LD OutOfStock alors que l'annonce était bien active sur VC.
            if status == 'sold' and pid in vc_fs_ids:
                return pid, 'keep'
            # Symétrique pour 'deleted' : si l'article est dans for-sale, il existe.
            if status == 'deleted' and pid in vc_fs_ids:
                return pid, 'keep'
            return pid, status

        false_positives = [0]
        with ThreadPoolExecutor(max_workers=12) as ex:
            futures = {ex.submit(worker, pid): pid for pid in to_verify}
            for fut in as_completed(futures):
                pid, status = fut.result()
                with lock:
                    progress[0] += 1
                    if status == 'deleted':
                        deleted_set.add(pid)
                    elif status == 'sold':
                        sold_set.add(pid)
                    if progress[0] % 100 == 0:
                        print(f'    [{progress[0]}/{len(to_verify)}] supprimés={len(deleted_set)}, vendus={len(sold_set)}')

        print(f'    ✓ Vérif terminée : {len(deleted_set)} supprimés, {len(sold_set)} vendus')

        # === CIRCUIT BREAKER (R2) ===
        MAX_BASCULES = 15
        total = len(deleted_set) + len(sold_set)
        if total > MAX_BASCULES:
            print(f'\n  ⚠⚠⚠ CIRCUIT BREAKER : {total} > {MAX_BASCULES} → AUCUNE bascule appliquée.')
        else:
            D1 = list(deleted_set)
            B_extra = list(sold_set)

    for pid in B_extra:
        if pid not in B: B.append(pid)

    # E: nouvelles pièces (in fs_map but not in site_all)
    c_ids = {c['id'] for c in C}
    E = []
    for vid, url in fs_map.items():
        if vid in site_all: continue
        if vid in c_ids: continue
        s = slug_stem(url)
        unsigned_flag = ('non-signe-unsigned' in url) or ('non-signe' in url)
        E.append({'id': vid, 'url': url, 'stem': s, 'unsigned': unsigned_flag})

    print(f'\n=== Résultats ===')
    print(f'A (relistings même ID)        : {len(A)}')
    print(f'B (vendus sur VC, dispo site) : {len(B)}')
    print(f'C (relistings nouvel ID)      : {len(C)}')
    print(f'D1 (absents VC, site dispo)   : {len(D1)}')
    print(f'E (nouvelles pièces)          : {len(E)}')

    if A: print(f'  A IDs: {A[:5]}')
    if B:
        print('  B items:')
        for pid in B[:10]:
            p = by_id.get(pid, {})
            print(f'    {pid}  {p.get("brand","?")}  {p.get("type","?")}  {p.get("price","?")}€')
    if C:
        print('  C items:')
        for c in C[:5]: print(f'    {c["id"]}  {c["url"][:80]}')
    if D1:
        print('  D1 items:')
        for pid in D1[:10]:
            p = by_id.get(pid, {})
            print(f'    {pid}  {p.get("brand","?")}  {p.get("type","?")}  {p.get("price","?")}€')
    if E:
        print('  E items:')
        for e in E[:5]: print(f'    {e["id"]}  {e["url"][:80]}')

    # Sauvegarde rapport
    out_dir = os.environ.get('SYNC_REPORT_DIR', '/tmp/sync_reports')
    os.makedirs(out_dir, exist_ok=True)
    rep_path = os.path.join(out_dir, f'sync_{int(time.time())}.json')
    with open(rep_path, 'w') as f:
        json.dump({
            'timestamp': time.time(),
            'site_stats': {'all': len(site_all), 'sold': len(site_sold), 'available': len(site_available)},
            'vc_stats': {'for_sale': len(fs_map), 'sold': len(sold_map),
                         'target_fs': fs_target, 'target_sold': sold_target},
            'A': A, 'B': B, 'C': C, 'D1': D1, 'E': E,
        }, f, indent=2, ensure_ascii=False)
    print(f'\nRapport enregistré → {rep_path}')


if __name__ == '__main__':
    main()
