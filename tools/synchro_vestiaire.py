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
    """Fetch fiche produit Vestiaire via curl-cffi (bypass Cloudflare TLS fingerprint).
    Le paramètre premium est conservé pour compatibilité mais ignoré.
    Retourne (status, resolved_url, html)."""
    try:
        from curl_cffi import requests as cf_requests
        r = cf_requests.get(url, impersonate='chrome120',
                            headers={'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
                                     'User-Agent': UA},
                            timeout=30)
        return r.status_code, str(r.url), r.text
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

        page.route('**/*', lambda route: route.abort()
                   if route.request.resource_type in ['image', 'media']
                   else route.continue_())

        print('  -> Navigation vers profil...')
        page.goto(PROFILE_URL, wait_until='load', timeout=120000)
        time.sleep(3)

        # Debug : titre et début de body pour détecter Cloudflare challenge
        try:
            title = page.title()
            print(f'  -> Titre page: {repr(title)}')
        except Exception as e:
            print(f'  -> Titre ERR: {e}')

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
            print(f'  -> Compteurs: {fs_target} for-sale, {sold_target} sold')
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

        # Attendre que les produits soient rendus avant de harvester
        try:
            page.wait_for_selector('a[href*=".shtml"]', timeout=15000)
        except Exception:
            pass

        page.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)')
        time.sleep(1.5)
        cnt = harvest(fs_urls)
        print(f'  -> Page 1: {cnt} items')

        for n in range(2, 16):
            clicked = page.evaluate(f'''(() => {{
                const btns = [...document.querySelectorAll('button')].filter(
                    b => b.textContent.trim() === '{n}'
                );
                if (btns.length > 0) {{ btns[0].click(); return true; }}
                return false;
            }})()''')
            if not clicked:
                print(f'  -> Page {n}: bouton absent, fin')
                break
            time.sleep(3)
            page.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)')
            time.sleep(0.8)
            cnt = harvest(fs_urls)
            print(f'  -> Page {n}: {cnt} items')
            if cnt == 0: break

        # Sold tab : JS evaluate pour passer l'overlay privacy qui bloque les clics Playwright
        clicked_sold = page.evaluate('''(() => {
            const labels = ["Articles vendus", "Vendus", "Sold items", "Sold"];
            const els = [...document.querySelectorAll('div,span,button,a,[role="button"]')];
            const tab = els.find(el => labels.some(l => el.textContent.trim() === l));
            if (tab) { tab.click(); return true; }
            return false;
        })()''')
        if clicked_sold:
            time.sleep(2.5)
            # 60 items/page pour les vendus aussi
            page.evaluate('''(() => {
                const b = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "60");
                if (b) b.click();
            })()''')
            time.sleep(2)
            page.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)')
            time.sleep(1.2)
            cnt = harvest(sd_urls)
            print(f'  -> Sold tab: {cnt} items')
        else:
            print(f'  -> Sold tab: bouton introuvable')

    # Test connectivité proxy avant d'essayer Playwright
    proxy_reachable = False
    if APIFY_API_KEY:
        try:
            test_r = requests.get(
                'http://httpbin.org/ip',
                proxies={'http': f'http://auto:{APIFY_API_KEY}@proxy.apify.com:8000',
                         'https': f'http://auto:{APIFY_API_KEY}@proxy.apify.com:8000'},
                timeout=15, headers={'User-Agent': UA})
            print(f'  -> Proxy test: HTTP {test_r.status_code} — {test_r.text[:80]}')
            proxy_reachable = test_r.status_code == 200
        except Exception as e:
            print(f'  -> Proxy test ERR: {e}')

    proxy_attempts = [('direct (sans proxy)', {})]
    if proxy_reachable:
        proxy_attempts.append(('Apify proxy (auto)', {'proxy': {
            'server': 'http://proxy.apify.com:8000',
            'username': 'auto',
            'password': APIFY_API_KEY,
        }}))

    for label, ctx_extra in proxy_attempts:
        print(f'  -> Tentative {label}...')
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                ctx = browser.new_context(
                    extra_http_headers={'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'},
                    user_agent=UA, viewport={'width': 1920, 'height': 1080},
                    **ctx_extra,
                )
                page = ctx.new_page()
                from playwright_stealth import Stealth
                Stealth().apply_stealth_sync(page)
                _do_scrape(page)
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
    # curl-cffi (bypass Cloudflare TLS fingerprint, sans proxy)
    status, resolved, html = apify_fetch(url)
    if status == 0:
        return 'keep'  # erreur réseau, doute = sécurité (R1)
    if status not in (200, 301, 302):
        return 'keep'  # bloqué ou erreur, doute = sécurité (R1)
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
        with _TPE(max_workers=4) as _ex:
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

    # Détection scan bloqué (IP Cloudflare) = 0 items scannés ET fs_target=0
    scan_blocked = len(fs_map) == 0 and fs_target == 0

    if scan_blocked:
        # Mode fallback : profil inaccessible (IP bloquée par Cloudflare)
        # On vérifie TOUS les items site_available via curl-cffi pour détecter les vendus
        # sans avoir besoin du scan profil (curl-cffi fonctionne sur les fiches individuelles)
        print(f'\n  ⚠ SCAN BLOQUÉ (IP Cloudflare). Mode fallback : vérif individuelle de tous les items...')
        to_verify_fallback = sorted(site_available, key=lambda x: int(x))
        print(f'  → Vérif {len(to_verify_fallback)} items via curl-cffi...')
        fb_deleted = set()
        fb_sold = set()
        with ThreadPoolExecutor(max_workers=4) as ex:
            futs = {ex.submit(verify_item, pid, by_id): pid for pid in to_verify_fallback}
            done_count = [0]
            for f in as_completed(futs):
                pid = futs[f]
                status = f.result()
                done_count[0] += 1
                if status == 'sold':
                    fb_sold.add(pid)
                elif status == 'deleted':
                    fb_deleted.add(pid)
                if done_count[0] % 50 == 0:
                    print(f'    [{done_count[0]}/{len(to_verify_fallback)}] sold={len(fb_sold)} deleted={len(fb_deleted)}')
        print(f'  ✓ Fallback terminé : {len(fb_sold)} vendus, {len(fb_deleted)} supprimés')
        # Circuit breaker
        MAX_BASCULES = 15
        if len(fb_sold) + len(fb_deleted) > MAX_BASCULES:
            print(f'\n  ⚠⚠⚠ CIRCUIT BREAKER : {len(fb_sold)+len(fb_deleted)} > {MAX_BASCULES} → ABORT')
        else:
            for pid in fb_sold:
                if pid not in B: B.append(pid)
            D1.extend(list(fb_deleted))
    elif scan_incomplete:
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
        with ThreadPoolExecutor(max_workers=4) as ex:
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

