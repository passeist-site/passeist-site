#!/usr/bin/env python3
"""Synchro Vestiaire — test manuel. Scan profil + 5 croisements + rapport.
NE TOUCHE À RIEN sur le site ni sur Netlify. Rapport seulement."""
import asyncio, re, json, math, time, os, random
import cloudscraper
from playwright.async_api import async_playwright

# Decodo Residential Pay-As-You-Go : pool gate.decodo.com:10001-10010
# IMPORTANT: ce compte ne supporte PAS le format `user-session-XXX` (407 Proxy Auth).
# On utilise l'auth plain et on cycle sur les ports si un endpoint échoue.
DECODO_ENDPOINTS = [
    ('gate.decodo.com', 10001),
    ('gate.decodo.com', 10002),
    ('gate.decodo.com', 10003),
    ('gate.decodo.com', 10004),
    ('gate.decodo.com', 10005),
    ('gate.decodo.com', 10006),
    ('gate.decodo.com', 10007),
    ('gate.decodo.com', 10008),
    ('gate.decodo.com', 10009),
    ('gate.decodo.com', 10010),
]
DECODO_USER_RAW = os.environ.get('DECODO_USER', '').strip()
DECODO_PASS = os.environ.get('DECODO_PASS', '').strip()
if not DECODO_USER_RAW or not DECODO_PASS:
    raise SystemExit('FATAL: DECODO_USER / DECODO_PASS env vars manquantes. '
                     'Définis-les en local (export DECODO_USER=... DECODO_PASS=...) '
                     'ou via les secrets GitHub Actions du repo passeist-site.')

# DEBUG : affiche les longueurs (et premier/dernier caractère du user) pour debug
# d'éventuels caractères parasites dans les secrets GitHub
print(f'[debug] DECODO_USER len={len(DECODO_USER_RAW)} '
      f'first={DECODO_USER_RAW[:2]!r} last={DECODO_USER_RAW[-2:]!r}')
print(f'[debug] DECODO_PASS len={len(DECODO_PASS)}')

def make_proxy(host, port, session_id=None):
    """Construit la config proxy. session_id IGNORÉ : ce compte Decodo
    ne supporte pas le format user-session-XXX (renvoie 407 Proxy Auth)."""
    return {
        'server': f'http://{host}:{port}',
        'username': DECODO_USER_RAW,
        'password': DECODO_PASS,
    }

PROXY = make_proxy(*DECODO_ENDPOINTS[0])  # legacy compat
# UA HARMONISÉ entre cloudscraper + Playwright. Si différent → Cloudflare invalide
# le cf_clearance et on se reprend un challenge sur l'XHR.
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'


def cloudflare_warmup(host, port):
    """Visite la page profile via cloudscraper pour résoudre le challenge JS
    Cloudflare et récupérer les cookies (__cf_bm, etc.) qu'on injectera dans Playwright.
    Sans cette étape, Playwright headless se prend un 403 immédiat sur Vestiaire."""
    proxy_url = f'http://{DECODO_USER_RAW}:{DECODO_PASS}@{host}:{port}'
    proxies = {'http': proxy_url, 'https': proxy_url}
    scraper = cloudscraper.create_scraper(browser={'custom': UA})
    r = scraper.get(PROFILE_URL, proxies=proxies, timeout=60)
    if r.status_code != 200:
        raise Exception(f'cloudscraper warmup failed: HTTP {r.status_code}')
    cookies = []
    for ck in scraper.cookies:
        cookies.append({
            'name': ck.name, 'value': ck.value,
            'domain': ck.domain or '.vestiairecollective.com',
            'path': ck.path or '/',
        })
    return cookies
PROFILE_URL = 'https://fr.vestiairecollective.com/profile/30773496/?sortBy=relevance&tab=items-for-sale'
INDEX = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'index.html')


def load_site():
    with open(INDEX) as f: html = f.read()
    # PRODUCTS
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
    raw = html[arr_start:arr_end]
    # Python json is strict — strip trailing commas before ] and }
    raw = re.sub(r',\s*(\]|\})', r'\1', raw)
    products = json.loads(raw)
    # SOLD_IDS
    m = re.search(r'const SOLD_IDS = new Set\(\[(.*?)\]\);', html, re.DOTALL)
    sold_ids = set(re.findall(r'"(\d+)"', m.group(1)))
    # Filter Vinted (>=10 digit IDs)
    vestiaire_products = [p for p in products if len(str(p['id'])) < 10]
    site_all = {p['id'] for p in vestiaire_products}
    site_sold = sold_ids & site_all
    site_available = site_all - site_sold
    def stem(slug, pid): return slug.rsplit('-' + pid, 1)[0] if ('-' + pid) in slug else slug
    sold_stems = {stem(p['slug'], p['id']) for p in vestiaire_products if p['id'] in site_sold}
    all_stems = {stem(p['slug'], p['id']) for p in vestiaire_products}
    # Build ID → product mapping for reporting
    by_id = {p['id']: p for p in vestiaire_products}
    return site_all, site_sold, site_available, sold_stems, all_stems, by_id


async def scrape_profile():
    """Scan both for-sale and sold tabs via profile, with pagination.
    Boucle sur plusieurs ports Decodo + sticky session si timeout."""
    fs_map = {}   # id → url (for-sale)
    sold_map = {}  # id → url (sold)
    async with async_playwright() as p:
        last_err = None
        endpoints = list(DECODO_ENDPOINTS)  # copie

        for ep_idx, (host, port) in enumerate(endpoints):
            proxy_cfg = make_proxy(host, port)
            print(f'\n=== Tentative {ep_idx+1}/{len(endpoints)} : {host}:{port} ===')

            try:
                # 1) cloudscraper passe le challenge Cloudflare → cookies cf_clearance
                print(f'  cloudscraper warmup...')
                cf_cookies = cloudflare_warmup(host, port)
                print(f'  ✓ cookies CF récupérés: {[c["name"] for c in cf_cookies]}')

                # 2) Playwright avec ces cookies + même UA + même proxy → pas de challenge
                browser = await p.chromium.launch(
                    headless=True,
                    proxy=proxy_cfg,
                    args=['--disable-blink-features=AutomationControlled', '--no-sandbox'],
                )
                context = await browser.new_context(
                    user_agent=UA, locale='fr-FR', timezone_id='Europe/Paris',
                    viewport={'width': 1280, 'height': 900},
                )
                await context.add_cookies(cf_cookies)
                page = await context.new_page()

                resp = await page.goto(PROFILE_URL, timeout=60000, wait_until='domcontentloaded')
                if not resp or resp.status != 200:
                    raise Exception(f'goto returned status {resp.status if resp else "?"}')
                await page.wait_for_timeout(5000)
                last_err = None
                print(f'  ✓ Page chargée via {host}:{port} (HTTP {resp.status})')
                break  # Succès → sortir de la boucle
            except Exception as e:
                last_err = e
                print(f'  ✗ {host}:{port} failed: {type(e).__name__}: {str(e)[:200]}')
                try: await browser.close()
                except: pass
                if ep_idx < len(endpoints) - 1:
                    await asyncio.sleep(3)
                    continue
        if last_err:
            raise last_err

        # === ACCEPTER LES COOKIES (sinon popup bloque tout le scan) ===
        accepted = await page.evaluate('''() => {
            const btn = Array.from(document.querySelectorAll('button')).find(
                b => /accepter|accept all|accept cookies/i.test(b.textContent)
                  && !/refuser|reject|paramétrer|customize|param/i.test(b.textContent));
            if (btn) { btn.click(); return true; }
            return false;
        }''')
        print(f'  cookies accept: {accepted}')
        if accepted: await page.wait_for_timeout(3000)

        # Get counts from the profile header (FR ou EN — l'IP Decodo peut redirect sur US)
        counts_text = await page.evaluate('() => document.body.innerText')
        # FR: "X articles en vente" / "X vendus"  |  EN: "X items for sale" / "X sold"
        m_fs = re.search(r'(\d+)\s+(?:articles?\s+en\s+vente|items?\s+for\s+sale)', counts_text)
        m_sold = re.search(r'(\d+)\s+(?:vendus|sold)\b', counts_text)
        if not m_fs or not m_sold:
            raise Exception(f'Compteurs introuvables. body[:400]={counts_text[:400]!r}')
        fs_target = int(m_fs.group(1))
        sold_target = int(m_sold.group(1))
        print(f'Profil : {fs_target} en vente · {sold_target} vendus')

        # Set 60/page
        await page.evaluate('''() => {
            const b = Array.from(document.querySelectorAll('button')).find(
                x => x.textContent.trim() === '60' && x.getAttribute('aria-current') !== 'true');
            if (b) b.click();
        }''')
        await page.wait_for_timeout(4000)

        async def collect():
            # Multi-scroll progressif pour déclencher TOUT le lazy load
            for step in range(8):
                await page.evaluate(f'() => window.scrollTo(0, document.documentElement.scrollHeight * {(step+1)/8})')
                await page.wait_for_timeout(600)
            # Final scroll + attente pour finaliser
            await page.evaluate('() => window.scrollTo(0, document.documentElement.scrollHeight)')
            await page.wait_for_timeout(2000)
            urls = await page.evaluate('''() => Array.from(document.querySelectorAll('a[href]'))
                .map(a => a.href).filter(u => /-\\d{7,9}\\.shtml?/.test(u))''')
            return urls

        async def click_page(n):
            # Scroll bottom et attend AVANT de chercher la pagination
            await page.evaluate('() => window.scrollTo(0, document.documentElement.scrollHeight)')
            await page.wait_for_timeout(1500)
            clicked = await page.evaluate(f'''() => {{
                const btns = Array.from(document.querySelectorAll('button')).filter(
                    b => /^\\d+$/.test(b.textContent.trim()) && +b.textContent.trim() <= 20
                         && b.getAttribute('aria-current') !== 'page');
                const btn = btns.find(b => b.textContent.trim() === '{n}');
                if (btn) {{ btn.click(); return true; }}
                return false;
            }}''')
            return clicked

        # Scan for-sale pages
        for page_num in range(1, 15):
            urls = await collect()
            for u in urls:
                m = re.search(r'-(\d{7,9})\.shtml?', u)
                if m: fs_map[m.group(1)] = u
            print(f'  for-sale page {page_num}: {len(fs_map)} cumul')
            if len(fs_map) >= fs_target: break
            clicked = await click_page(page_num + 1)
            if not clicked: break
            await page.wait_for_timeout(4000)

        # === SCAN VENDUS — page 1 uniquement ===
        # Optimisation Tom 26/04 : les nouvelles ventes arrivent chronologiquement,
        # page 1 (60 derniers vendus) suffit pour détecter B (nouvelles ventes à basculer).
        # Vestiaire limite l'affichage public des vendus → pas la peine de chercher plus.
        # CONSÉQUENCE : D1 sera flaggé "incertain" puisqu'on n'a pas tous les sold.
        print('  → Scan vendus : page 1 uniquement (suffit pour B, D1 à vérifier manuellement)')
        # Cliquer l'onglet vendus (FR "Articles vendus"/"Vendus" ou EN "Sold items"/"Sold")
        clicked_vendus = await page.evaluate('''() => {
            const all = Array.from(document.querySelectorAll('div, span, button, a, [role="button"]'));
            const target = all.find(el => {
                const t = (el.textContent || '').trim();
                return /^(Articles vendus|Vendus|Sold items|Sold)$/i.test(t) && t.length < 30;
            });
            if (target) { target.click(); return true; }
            return false;
        }''')
        print(f'    clic vendus: {clicked_vendus}')
        await page.wait_for_timeout(5000)
        # Set 60/page
        await page.evaluate('''() => {
            const b = Array.from(document.querySelectorAll('button')).find(
                x => x.textContent.trim() === '60' && x.getAttribute('aria-current') !== 'true');
            if (b) b.click();
        }''')
        await page.wait_for_timeout(5000)
        # Collecte page 1 (avec scroll progressif pour lazy load)
        urls = await collect()
        for u in urls:
            m = re.search(r'-(\d{7,9})\.shtml?', u)
            if m: sold_map[m.group(1)] = u
        print(f'    sold page 1: {len(sold_map)} items collectés')

        await browser.close()

    # IMPORTANT : NE PAS retirer de fs_map les items présents dans sold_map.
    # Vestiaire peut afficher le MÊME ID dans les deux onglets quand un item
    # a été vendu puis relisté avec son ancien ID (cas du Tee shirt Y's noir
    # 63549408). Si on retirait, l'item tomberait à tort en D1.
    return fs_map, sold_map, fs_target, sold_target


async def main():
    print('=== Chargement du site ===')
    site_all, site_sold, site_available, sold_stems, all_stems, by_id = load_site()
    print(f'Site : {len(site_all)} produits Vestiaire · {len(site_sold)} sold · {len(site_available)} available')

    print('\n=== Scan profil Vestiaire (proxy Decodo) ===')
    fs_map, sold_map, fs_target, sold_target = await scrape_profile()
    print(f'Vestiaire : {len(fs_map)} for-sale · {len(sold_map)} vendus')

    def slug_stem(url):
        m = re.search(r'/([^/]+)-(\d{7,9})\.shtml?', url)
        return m.group(1) if m else None

    # === 5 croisements ===
    vc_fs_ids = set(fs_map.keys())
    vc_sold_ids = set(sold_map.keys())
    vc_all = vc_fs_ids | vc_sold_ids

    A = list(vc_fs_ids & site_sold)
    # B = vendus sur VC ET dispo sur site, MAIS PAS aussi en for-sale (double-affichage)
    # Cf TASKS.md règle 25/04 : un item peut apparaitre dans les 2 onglets s'il a été
    # vendu puis relisté avec son ancien ID. On ne le considère vendu QUE s'il n'est PAS
    # actuellement actif en for-sale.
    B = list((vc_sold_ids - vc_fs_ids) & site_available)
    # C: Vestiaire for-sale with NEW id + stem in sold_stems
    C = []
    for vid, url in fs_map.items():
        if vid in site_all: continue
        s = slug_stem(url)
        if s and s in sold_stems:
            C.append({'id': vid, 'url': url, 'stem': s})
    # D1: site available non-Vinted absent Vestiaire
    D1_raw = [pid for pid in site_available if pid not in vc_all]

    # === VÉRIFICATION INDIVIDUELLE DES D1 (anti-faux-positif) ===
    # Notre scan SOLD est limité à la page 1 → un article vendu il y a longtemps
    # serait faussement classé D1. On hit chaque D1 candidat sur sa fiche produit
    # et on classe via JSON-LD availability :
    #   - HTTP redirect vers catégorie OU 404 → vraiment supprimé (D1 confirmé)
    #   - JSON-LD "OutOfStock"               → vendu (déplacé vers B)
    #   - JSON-LD "InStock"                  → actif, faux positif (skip)
    D1 = []  # vraiment supprimés
    B_extra = []  # vendus oubliés par le scan sold (à fusionner avec B)
    if D1_raw:
        print(f'\n  → Vérification individuelle des {len(D1_raw)} D1 candidats...')
        proxy_url = f'http://{DECODO_USER_RAW}:{DECODO_PASS}@gate.decodo.com:10001'
        proxies = {'http': proxy_url, 'https': proxy_url}
        verifier = cloudscraper.create_scraper(browser={'custom': UA})
        # warmup pour cookies CF
        try: verifier.get('https://fr.vestiairecollective.com/profile/30773496/', proxies=proxies, timeout=60)
        except: pass
        for pid in D1_raw:
            prod = by_id.get(pid)
            if not prod or not prod.get('path'):
                D1.append(pid)  # par défaut on bascule
                continue
            url = f'https://fr.vestiairecollective.com{prod["path"]}'
            try:
                r = verifier.get(url, proxies=proxies, timeout=30, allow_redirects=True)
                # Article supprimé : redirection vers catégorie (l'ID disparaît de l'URL finale)
                if pid not in r.url:
                    D1.append(pid)
                    print(f'    {pid}: → SUPPRIMÉ (redirige vers {r.url[:60]}...)')
                    continue
                if r.status_code != 200:
                    D1.append(pid)
                    print(f'    {pid}: → SUPPRIMÉ (HTTP {r.status_code})')
                    continue
                m = re.search(r'"availability"\s*:\s*"([^"]+)"', r.text)
                avail = m.group(1) if m else None
                if avail == 'OutOfStock':
                    B_extra.append(pid)
                    print(f'    {pid}: → VENDU (re-classé en B)')
                elif avail == 'InStock':
                    print(f'    {pid}: → ACTIF, faux positif (skip)')
                else:
                    D1.append(pid)
                    print(f'    {pid}: → indéterminé (availability={avail}), traité comme D1')
            except Exception as e:
                D1.append(pid)
                print(f'    {pid}: → erreur vérif ({type(e).__name__}), traité comme D1')

    # Fusionne B_extra avec B (en évitant doublons)
    for pid in B_extra:
        if pid not in B: B.append(pid)

    # === VÉRIFICATION SYSTÉMATIQUE — VERSION SÉCURISÉE (post-incident 2026-05-01) ===
    # Règles strictes pour éviter les faux positifs catastrophiques :
    #
    # 1. CONCURRENCE LIMITÉE : 3 workers max (au lieu de 12) pour pas se faire
    #    rate-limit par Cloudflare. 0.3s pacing entre requêtes par worker.
    #
    # 2. CLASSIFICATION STRICTE :
    #    - DELETED ssi : HTTP 200 ET ID disparu de l'URL finale (= redirect catégorie)
    #    - SOLD ssi    : HTTP 200 ET JSON-LD "availability":"OutOfStock"
    #    - Tout le reste (403, 429, 5xx, timeout, error réseau, JSON-LD absent…)
    #      → ON GARDE ACTIF (on skip, jamais on bascule). Le doute profite à l'item.
    #
    # 3. CIRCUIT BREAKER : si > MAX_BASCULES_PER_RUN items détectés → ABORT,
    #    on annule TOUTES les bascules de la passe et on ouvre une Issue.
    #
    # 4. CONFIRMATION PASS : chaque item flaggé deleted/sold est re-vérifié
    #    une 2ème fois avant inclusion finale (anti-glitch transitoire).

    MAX_BASCULES_PER_RUN = 15  # Au-delà → catastrophe en cours, on annule tout
    WORKERS = 3
    PACING_SEC = 0.3

    to_check_systematic = sorted(set(fs_map.keys()) & site_available, key=lambda x: int(x))
    if to_check_systematic:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        import threading, time as _time

        print(f'\n  → Vérif parallèle SÉCURISÉE de {len(to_check_systematic)} items ({WORKERS} workers, pacing {PACING_SEC}s)...')

        proxy_url = f'http://{DECODO_USER_RAW}:{DECODO_PASS}@gate.decodo.com:10001'
        proxies = {'http': proxy_url, 'https': proxy_url}
        verifier = cloudscraper.create_scraper(browser={'custom': UA})
        try: verifier.get('https://fr.vestiairecollective.com/profile/30773496/', proxies=proxies, timeout=60)
        except: pass

        deleted_candidates = []  # détectés comme supprimés (à re-vérifier)
        sold_candidates = []     # détectés comme vendus (à re-vérifier)
        http_errors = 0          # tracking pour debug
        lock = threading.Lock()
        progress = [0]
        last_request_time = [0.0]
        pacing_lock = threading.Lock()

        def fetch_with_pacing(url):
            """Limite le rythme global : pas plus d'1 requête / PACING_SEC."""
            with pacing_lock:
                elapsed = _time.time() - last_request_time[0]
                if elapsed < PACING_SEC:
                    _time.sleep(PACING_SEC - elapsed)
                last_request_time[0] = _time.time()
            return verifier.get(url, proxies=proxies, timeout=20, allow_redirects=True)

        def verify_one(pid):
            """Retourne ('deleted', pid) / ('sold', pid) / ('keep', pid) / ('skip', pid)
            où 'keep' = on garde actif (par défaut sécurisé en cas de doute)."""
            if pid in B or pid in D1: return ('skip', pid)
            prod = by_id.get(pid)
            if not prod or not prod.get('path'): return ('skip', pid)
            url = f'https://fr.vestiairecollective.com{prod["path"]}'
            try:
                r = fetch_with_pacing(url)
            except Exception:
                return ('keep', pid)  # erreur réseau → on garde actif

            # Erreur HTTP (403, 429, 5xx) → CRUCIAL : on garde actif, jamais deleted
            if r.status_code != 200:
                return ('keep', pid)

            # 200 mais URL ne contient plus l'ID = vraie redirection catégorie = supprimé
            if pid not in r.url:
                return ('deleted', pid)

            # 200 + JSON-LD OutOfStock = vendu confirmé
            m_av = re.search(r'"availability"\s*:\s*"([^"]+)"', r.text)
            avail = m_av.group(1) if m_av else None
            if avail == 'OutOfStock':
                return ('sold', pid)

            # 200 + InStock OU JSON-LD absent → on garde actif (doute = sécurité)
            return ('keep', pid)

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futures = {ex.submit(verify_one, pid): pid for pid in to_check_systematic}
            for fut in as_completed(futures):
                status, pid = fut.result()
                with lock:
                    progress[0] += 1
                    if status == 'deleted':
                        deleted_candidates.append(pid)
                    elif status == 'sold':
                        sold_candidates.append(pid)
                    if progress[0] % 100 == 0:
                        print(f'    [{progress[0]}/{len(to_check_systematic)}] supprimés candidats={len(deleted_candidates)}, vendus candidats={len(sold_candidates)}')

        total_candidates = len(deleted_candidates) + len(sold_candidates)
        print(f'    1ère passe : {len(deleted_candidates)} supprimés candidats, {len(sold_candidates)} vendus candidats')

        # === CIRCUIT BREAKER ===
        if total_candidates > MAX_BASCULES_PER_RUN:
            print(f'\n  ⚠⚠⚠ CIRCUIT BREAKER DÉCLENCHÉ : {total_candidates} > {MAX_BASCULES_PER_RUN} items ⚠⚠⚠')
            print(f'    Ce volume est anormal — probable rate-limit Cloudflare.')
            print(f'    AUCUNE bascule appliquée pour cette passe. Vérification manuelle requise.')
            # On ne touche pas à B et D1 → 0 bascule de cette vérif systématique
        elif total_candidates > 0:
            # === CONFIRMATION PASS : re-vérification individuelle des candidats ===
            print(f'\n  → Confirmation pass : re-vérification des {total_candidates} candidats...')
            _time.sleep(2)  # petite pause avant la 2ème passe

            confirmed_deleted = []
            confirmed_sold = []
            for pid in deleted_candidates + sold_candidates:
                try:
                    prod = by_id.get(pid)
                    url = f'https://fr.vestiairecollective.com{prod["path"]}'
                    r = fetch_with_pacing(url)
                    if r.status_code != 200:
                        print(f'    {pid}: 2ème passe HTTP {r.status_code} → on skip (doute)')
                        continue
                    if pid not in r.url:
                        confirmed_deleted.append(pid)
                        continue
                    m_av = re.search(r'"availability"\s*:\s*"([^"]+)"', r.text)
                    if m_av and m_av.group(1) == 'OutOfStock':
                        confirmed_sold.append(pid)
                except Exception as e:
                    print(f'    {pid}: 2ème passe erreur ({type(e).__name__}) → on skip')

            for pid in confirmed_deleted:
                if pid not in D1: D1.append(pid)
            for pid in confirmed_sold:
                if pid not in B: B.append(pid)

            print(f'    ✓ confirmés : {len(confirmed_deleted)} supprimés, {len(confirmed_sold)} vendus')
            if confirmed_deleted: print(f'      supprimés: {confirmed_deleted}')
            if confirmed_sold:    print(f'      vendus:    {confirmed_sold}')
        else:
            print(f'    ✓ rien à reclasser')
    # E: TOUS les nouveaux IDs Vestiaire qui ne sont PAS déjà dans PRODUCTS
    # (peu importe si leur stem ressemble à du sold ou du available — tout nouveau doit être importé)
    # On exclut ceux déjà dans C pour éviter les doublons
    c_ids = {c['id'] for c in C}
    E = []
    for vid, url in fs_map.items():
        if vid in site_all: continue
        if vid in c_ids: continue
        s = slug_stem(url)
        # Règle TASKS.md : flagger les NON SIGNÉ pour brand detection à l'import
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
            print(f'    {pid}  {p.get("brand","")}  {p.get("type","")}  {p.get("price","")}€')
    if C:
        print('  C items:')
        for c in C[:10]:
            print(f'    new_id={c["id"]}  stem={c["stem"]}')
            print(f'      {c["url"]}')
    if D1:
        print('  D1 items:')
        for pid in D1[:10]:
            p = by_id.get(pid, {})
            print(f'    {pid}  {p.get("brand","")}  {p.get("type","")}  {p.get("price","")}€')
    if E:
        print('  E items (NEW):')
        for e in E[:10]:
            tag = '  ⚠ NON SIGNÉ → brand detection requise' if e.get('unsigned') else ''
            print(f'    new_id={e["id"]}  stem={e["stem"]}{tag}')
            print(f'      {e["url"]}')

    # Write report to disk — utilise SYNC_REPORT_DIR si défini (GitHub Actions),
    # sinon /sessions/.../sync_reports/ pour les runs Cowork
    REPORT_DIR = os.environ.get('SYNC_REPORT_DIR', '/sessions/sharp-vibrant-turing/sync_reports')
    os.makedirs(REPORT_DIR, exist_ok=True)
    report_path = os.path.join(REPORT_DIR, f'sync_{int(time.time())}.json')
    with open(report_path, 'w') as f:
        json.dump({
            'timestamp': time.time(),
            'site_stats': {'all': len(site_all), 'sold': len(site_sold), 'available': len(site_available)},
            'vc_stats': {'for_sale': len(fs_map), 'sold': len(sold_map), 'target_fs': fs_target, 'target_sold': sold_target},
            'A': A, 'B': B, 'C': C, 'D1': D1, 'E': E,
        }, f, ensure_ascii=False, indent=2, default=str)
    print(f'\nRapport enregistré → {report_path}')


asyncio.run(main())
