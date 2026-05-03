#!/usr/bin/env python3
"""Synchro Vestiaire — version ScrapingBee (refactor 2026-05-03).

Architecture simple :
- Playwright + ScrapingBee proxy mode pour le scan profil (pagination JS)
- ScrapingBee API direct (datacenter, 1 credit) pour vérifier chaque item individuellement
- Anti-faux-positifs : circuit breaker à 15, classification stricte (R1)

Plus de cloudscraper, plus de Decodo, plus de cookies CF à warmup. ScrapingBee
gère tout ça en interne. Le seul env var requis : SCRAPINGBEE_API_KEY.
"""
import asyncio, re, json, os, time, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import requests
from playwright.async_api import async_playwright

# === CONFIG ===
SCRAPINGBEE_API_KEY = os.environ.get('SCRAPINGBEE_API_KEY', '').strip()
if not SCRAPINGBEE_API_KEY:
    raise SystemExit('FATAL: SCRAPINGBEE_API_KEY env var manquante.')

print(f'[debug] SCRAPINGBEE_API_KEY len={len(SCRAPINGBEE_API_KEY)} '
      f'first={SCRAPINGBEE_API_KEY[:4]!r} last={SCRAPINGBEE_API_KEY[-4:]!r}')

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
PROFILE_URL = 'https://fr.vestiairecollective.com/profile/30773496/?sortBy=relevance&tab=items-for-sale'
INDEX = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'index.html')

# ScrapingBee proxy config pour Playwright
SB_PROXY = {
    'server': 'http://proxy.scrapingbee.com:8886',
    'username': SCRAPINGBEE_API_KEY,
    'password': 'render_js=False',  # Playwright fait son propre rendering
}

# ScrapingBee API direct pour les fetchs item-par-item
SB_API = 'https://app.scrapingbee.com/api/v1/'


def sb_fetch(url, premium=False):
    """Fetch via ScrapingBee API direct. Retourne (status, resolved_url, html)."""
    params = {'api_key': SCRAPINGBEE_API_KEY, 'url': url}
    if premium:
        params['premium_proxy'] = 'true'
        params['country_code'] = 'fr'
    try:
        r = requests.get(SB_API, params=params, timeout=60)
        resolved = r.headers.get('spb-resolved-url') or url
        return r.status_code, resolved, r.text
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


async def scrape_profile():
    """Scan for-sale (pagination 10 pages) + sold page 1 via Playwright + ScrapingBee proxy."""
    fs_map = {}
    sold_map = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            proxy=SB_PROXY,
            args=['--disable-blink-features=AutomationControlled', '--no-sandbox',
                  '--ignore-certificate-errors'],  # ScrapingBee proxy MITM-style
        )
        context = await browser.new_context(
            user_agent=UA, locale='fr-FR', timezone_id='Europe/Paris',
            viewport={'width': 1280, 'height': 900},
            ignore_https_errors=True,
        )
        # Bloquer images/fonts/media pour économiser les crédits ScrapingBee
        # (chaque requête asset = 1 crédit). On garde HTML + CSS + JS uniquement.
        await context.route('**/*', lambda route: (
            route.abort() if route.request.resource_type in ('image', 'font', 'media')
            else route.continue_()
        ))

        page = await context.new_page()
        resp = await page.goto(PROFILE_URL, timeout=90000, wait_until='domcontentloaded')
        if not resp or resp.status != 200:
            raise Exception(f'goto returned status {resp.status if resp else "?"}')
        await page.wait_for_timeout(5000)
        print(f'  ✓ Page chargée (HTTP {resp.status})')

        # Accept cookies popup
        accepted = await page.evaluate('''() => {
            const btn = Array.from(document.querySelectorAll('button')).find(
                b => /accepter|accept all|accept cookies/i.test(b.textContent)
                  && !/refuser|reject|paramétrer|customize|param/i.test(b.textContent));
            if (btn) { btn.click(); return true; }
            return false;
        }''')
        if accepted: await page.wait_for_timeout(3000)

        # Counters
        counts_text = await page.evaluate('() => document.body.innerText')
        m_fs = re.search(r'(\d+)\s+(?:articles?\s+en\s+vente|items?\s+for\s+sale)', counts_text)
        m_sold = re.search(r'(\d+)\s+(?:vendus|sold)\b', counts_text)
        if not m_fs or not m_sold:
            raise Exception(f'Compteurs introuvables. body[:300]={counts_text[:300]!r}')
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
            for step in range(8):
                await page.evaluate(f'() => window.scrollTo(0, document.documentElement.scrollHeight * {(step+1)/8})')
                await page.wait_for_timeout(500)
            await page.evaluate('() => window.scrollTo(0, document.documentElement.scrollHeight)')
            await page.wait_for_timeout(1500)
            return await page.evaluate('''() => Array.from(document.querySelectorAll('a[href]'))
                .map(a => a.href).filter(u => /-\\d{7,9}\\.shtml?/.test(u))''')

        async def click_page(n):
            await page.evaluate('() => window.scrollTo(0, document.documentElement.scrollHeight)')
            await page.wait_for_timeout(1000)
            return await page.evaluate(f'''() => {{
                const btns = Array.from(document.querySelectorAll('button')).filter(
                    b => /^\\d+$/.test(b.textContent.trim()) && +b.textContent.trim() <= 20
                         && b.getAttribute('aria-current') !== 'page');
                const btn = btns.find(b => b.textContent.trim() === '{n}');
                if (btn) {{ btn.click(); return true; }}
                return false;
            }}''')

        # Scan for-sale
        for page_num in range(1, 15):
            urls = await collect()
            for u in urls:
                m = re.search(r'-(\d{7,9})\.shtml?', u)
                if m: fs_map[m.group(1)] = u
            print(f'  for-sale page {page_num}: {len(fs_map)} cumul')
            if len(fs_map) >= fs_target: break
            clicked = await click_page(page_num + 1)
            if not clicked: break
            await page.wait_for_timeout(3500)

        # Scan sold page 1
        print('  → Scan vendus : page 1 uniquement')
        clicked_vendus = await page.evaluate('''() => {
            const all = Array.from(document.querySelectorAll('div, span, button, a, [role="button"]'));
            const target = all.find(el => {
                const t = (el.textContent || '').trim();
                return /^(Articles vendus|Vendus|Sold items|Sold)$/i.test(t) && t.length < 30;
            });
            if (target) { target.click(); return true; }
            return false;
        }''')
        await page.wait_for_timeout(4000)
        await page.evaluate('''() => {
            const b = Array.from(document.querySelectorAll('button')).find(
                x => x.textContent.trim() === '60' && x.getAttribute('aria-current') !== 'true');
            if (b) b.click();
        }''')
        await page.wait_for_timeout(4000)
        urls = await collect()
        for u in urls:
            m = re.search(r'-(\d{7,9})\.shtml?', u)
            if m: sold_map[m.group(1)] = u
        print(f'    sold page 1: {len(sold_map)} items collectés')

        await browser.close()
    return fs_map, sold_map, fs_target, sold_target


def verify_item(pid, by_id):
    """Hit la fiche produit via ScrapingBee API direct (1 credit) et classe.
    Retourne 'deleted' / 'sold' / 'keep'."""
    prod = by_id.get(pid)
    if not prod or not prod.get('path'):
        return 'keep'
    path = prod['path']
    # Garde-fou : path doit pointer vers une fiche produit (.shtml), pas une catégorie.
    # Sinon on serait sur la page catégorie, l'ID n'apparaîtrait pas, et on classerait
    # à tort en DELETED.
    if not path.endswith('.shtml'):
        return 'keep'
    url = f'https://fr.vestiairecollective.com{path if path.startswith("/") else "/" + path}'
    # 1ère tentative : datacenter (1 credit)
    status, resolved, html = sb_fetch(url, premium=False)
    if status == 0:
        return 'keep'  # erreur réseau, doute = sécurité
    # Si bloqué (403, 429, 5xx) → retry avec premium proxy (25 credits)
    if status not in (200, 301, 302):
        status, resolved, html = sb_fetch(url, premium=True)
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


async def main():
    print('=== Chargement du site ===')
    site_all, site_sold, site_available, sold_stems, all_stems, by_id = load_site()
    print(f'Site : {len(site_all)} produits Vestiaire · {len(site_sold)} sold · {len(site_available)} available')

    print('\n=== Scan profil Vestiaire (Playwright + ScrapingBee proxy) ===')
    fs_map, sold_map, fs_target, sold_target = await scrape_profile()
    print(f'Vestiaire : {len(fs_map)} for-sale · {len(sold_map)} vendus')

    def slug_stem(url):
        m = re.search(r'/([^/]+)-(\d{7,9})\.shtml?', url)
        return m.group(1) if m else None

    vc_fs_ids = set(fs_map.keys())
    vc_sold_ids = set(sold_map.keys())
    vc_all = vc_fs_ids | vc_sold_ids

    A = list(vc_fs_ids & site_sold)
    B = list((vc_sold_ids - vc_fs_ids) & site_available)
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
        # === Vérif systématique : tous les items site_available ===
        # Cas couverts en une seule boucle : phantoms (URL VC mais article supprimé/vendu)
        # ET articles absents de fs_map (vrais D1).
        to_verify = sorted(site_available, key=lambda x: int(x))
        print(f'\n  → Vérif parallèle de {len(to_verify)} items site_available (12 workers)...')
        deleted_set = set()
        sold_set = set()
        progress = [0]
        lock = threading.Lock()

        def worker(pid):
            return pid, verify_item(pid, by_id)

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
    asyncio.run(main())
