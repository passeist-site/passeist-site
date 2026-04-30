#!/usr/bin/env python3
"""Synchro Vestiaire — test manuel. Scan profil + 5 croisements + rapport.
NE TOUCHE À RIEN sur le site ni sur Netlify. Rapport seulement."""
import asyncio, re, json, math, time, os, random
from playwright.async_api import async_playwright

# Decodo : si Vestiaire bloque les IPs FR, on bascule sur d'autres pays
# Format: (host, port) — les ports sont rotating, chaque request = nouvelle IP
DECODO_ENDPOINTS = [
    ('fr.decodo.com', 40007),       # France residential
    ('us.decodo.com', 10001),       # US residential
    ('gb.decodo.com', 30001),       # Royaume-Uni residential
    ('de.decodo.com', 20001),       # Allemagne residential
    ('gate.decodo.com', 7000),      # World rotating (mix)
    ('fr.decodo.com', 40001),       # France retry (autre pool)
]
DECODO_USER_RAW = os.environ.get('DECODO_USER', '')
DECODO_PASS = os.environ.get('DECODO_PASS', '')
if not DECODO_USER_RAW or not DECODO_PASS:
    raise SystemExit('FATAL: DECODO_USER / DECODO_PASS env vars manquantes. '
                     'Définis-les en local (export DECODO_USER=... DECODO_PASS=...) '
                     'ou via les secrets GitHub Actions du repo passeist-site.')

def make_proxy(host, port, session_id=None):
    """Construit la config proxy avec sticky session optionnelle (stabilité IP)."""
    user = DECODO_USER_RAW
    if session_id:
        user = f'{DECODO_USER_RAW}-session-{session_id}'
    return {
        'server': f'http://{host}:{port}',
        'username': user,
        'password': DECODO_PASS,
    }

PROXY = make_proxy(*DECODO_ENDPOINTS[0])  # legacy compat
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
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
            session_id = random.randint(100000, 999999)  # sticky session
            proxy_cfg = make_proxy(host, port, session_id=session_id)
            print(f'\n=== Tentative {ep_idx+1}/{len(endpoints)} : {host}:{port} (session {session_id}) ===')

            browser = await p.chromium.launch(headless=True, proxy=proxy_cfg)
            context = await browser.new_context(user_agent=UA, locale='fr-FR',
                viewport={'width': 1280, 'height': 900})

            # OPTIMISATION : bloque images/fonts/css/media → 80% moins de trafic via proxy
            # Évite les timeouts en chargeant uniquement le HTML/JS essentiel
            await context.route('**/*', lambda route: (
                route.abort() if route.request.resource_type in ('image', 'font', 'media', 'stylesheet')
                else route.continue_()
            ))

            page = await context.new_page()
            try:
                await page.goto(PROFILE_URL, timeout=120000, wait_until='domcontentloaded')
                await page.wait_for_selector('body', timeout=30000)
                await page.wait_for_timeout(4000)
                last_err = None
                print(f'  ✓ Page chargée via {host}:{port}')
                break  # Succès → sortir de la boucle
            except Exception as e:
                last_err = e
                print(f'  ✗ {host}:{port} failed: {type(e).__name__}: {str(e)[:120]}')
                await browser.close()
                if ep_idx < len(endpoints) - 1:
                    await asyncio.sleep(3)
                    continue
        if last_err:
            raise last_err

        # === ACCEPTER LES COOKIES (sinon popup bloque tout le scan) ===
        accepted = await page.evaluate('''() => {
            const btn = Array.from(document.querySelectorAll('button')).find(
                b => /accepter/i.test(b.textContent) && !/refuser|paramétrer|param/i.test(b.textContent));
            if (btn) { btn.click(); return true; }
            return false;
        }''')
        print(f'  cookies accept: {accepted}')
        if accepted: await page.wait_for_timeout(3000)

        # Get counts from the profile header
        counts_text = await page.evaluate('() => document.body.innerText')
        fs_target = int(re.search(r'(\d+)\s+articles?\s+en\s+vente', counts_text).group(1))
        sold_target = int(re.search(r'(\d+)\s+vendus', counts_text).group(1))
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
        # Cliquer le DIV "Articles vendus"
        clicked_vendus = await page.evaluate('''() => {
            const all = Array.from(document.querySelectorAll('div, span, button, a, [role="button"]'));
            const target = all.find(el => {
                const t = (el.textContent || '').trim();
                return /^Articles vendus$|^Vendus$/i.test(t) && t.length < 30;
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
    D1 = [pid for pid in site_available if pid not in vc_all]
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
