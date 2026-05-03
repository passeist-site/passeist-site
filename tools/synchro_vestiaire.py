#!/usr/bin/env python3
"""Synchro Vestiaire — version ScrapingBee API + js_scenario (refactor 2026-05-03).

Architecture :
- ScrapingBee API + js_scenario pour le scan profil (1 appel = ~75 crédits)
- ScrapingBee API direct (datacenter, 1 credit) pour vérifier chaque item
- Anti-faux-positifs : circuit breaker à 15, classification stricte (R1)

Plus de Playwright, plus de Decodo, plus de cookies CF à warmup. ScrapingBee
gère tout en interne. Seul env var requis : SCRAPINGBEE_API_KEY.

Coût ~1000 crédits/run × 3 runs/jour × 30 jours = 90K/mois (plan 49$ = 250K).
"""
import re, json, os, time
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import requests

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


def scrape_profile():
    """Scan for-sale + sold via ScrapingBee API + js_scenario compacté.
    Toutes les helpers déclarées dans window.H, instructions ultra-courtes
    pour rester sous les 8KB de la URL GET ScrapingBee."""
    print('  → Scan via ScrapingBee js_scenario (for-sale 10 pages + sold page 1)')

    # Setup unique : définit window.H avec toutes les helpers
    setup = (
        "window._fs=new Set();window._sd=new Set();window._c={};"
        "window.H={"
        # Accept cookies
        "ck:()=>{const b=[...document.querySelectorAll('button')].find(x=>/accepter|accept all|accept cookies/i.test(x.textContent)&&!/refuser|reject|paramétrer|customize|param/i.test(x.textContent));if(b)b.click()},"
        # Read counters
        "co:()=>{const t=document.body.innerText;const fs=t.match(/(\\d+)\\s+(?:articles?\\s+en\\s+vente|items?\\s+for\\s+sale)/);const sd=t.match(/(\\d+)\\s+(?:vendus|sold)\\b/);window._c.fs=fs?parseInt(fs[1]):0;window._c.sd=sd?parseInt(sd[1]):0},"
        # Click 60/page
        "s60:()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='60'&&x.getAttribute('aria-current')!=='true');if(b)b.click()},"
        # Click page N
        "p:n=>{const bs=[...document.querySelectorAll('button')].filter(b=>/^\\d+$/.test(b.textContent.trim())&&+b.textContent.trim()<=20&&b.getAttribute('aria-current')!=='page');const b=bs.find(x=>x.textContent.trim()===String(n));if(b)b.click()},"
        # Scroll bottom
        "sc:()=>window.scrollTo(0,document.documentElement.scrollHeight),"
        # Harvest into target Set
        "hf:()=>[...document.querySelectorAll('a[href]')].map(a=>a.href).filter(u=>/-\\d{7,9}\\.shtml/.test(u)).forEach(u=>window._fs.add(u)),"
        "hs:()=>[...document.querySelectorAll('a[href]')].map(a=>a.href).filter(u=>/-\\d{7,9}\\.shtml/.test(u)).forEach(u=>window._sd.add(u)),"
        # Switch to Sold tab
        "sw:()=>{const t=[...document.querySelectorAll('div,span,button,a,[role=\"button\"]')].find(e=>{const x=(e.textContent||'').trim();return /^(Articles vendus|Vendus|Sold items|Sold)$/i.test(x)&&x.length<30});if(t)t.click()},"
        # Final: dump URLs + counters as meta tags
        "dump:()=>{const a=[['_h_fs',[...window._fs]],['_h_sd',[...window._sd]],['_h_c',window._c]];a.forEach(([n,v])=>{const m=document.createElement('meta');m.name=n;m.content=JSON.stringify(v);document.head.appendChild(m)})}"
        "}"
    )

    def call_sb(instructions, label):
        """Single call ScrapingBee with given instructions, returns html."""
        js_scenario = {"instructions": instructions}
        params = {
            'api_key': SCRAPINGBEE_API_KEY,
            'url': PROFILE_URL,
            'premium_proxy': 'true', 'country_code': 'fr',
            'render_js': 'true',
            'js_scenario': json.dumps(js_scenario, separators=(',', ':')),
            'forward_headers': 'true',
            'block_resources': 'false',
        }
        headers = {'Spb-Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'}
        print(f'  → SB call "{label}" ({len(instructions)} instructions)...')
        rr = requests.get(SB_API, params=params, headers=headers, timeout=180)
        if rr.status_code != 200:
            raise Exception(f'SB call "{label}" HTTP {rr.status_code}: {rr.text[:300]}')
        return rr.text

    # Call 1 : init + counters + pages 1-5
    inst_1 = [
        {"evaluate": setup},
        {"evaluate": "H.ck()"}, {"wait": 1500},
        {"evaluate": "H.co()"},
        {"evaluate": "H.s60()"}, {"wait": 2500},
    ]
    for n in range(1, 6):
        if n > 1: inst_1 += [{"evaluate": f"H.p({n})"}, {"wait": 2000}]
        inst_1 += [{"evaluate": "H.sc()"}, {"wait": 800}, {"evaluate": "H.hf()"}]
    inst_1 += [{"evaluate": "H.dump()"}]
    html1 = call_sb(inst_1, 'pages 1-5')

    # Call 2 : pages 6-10 + sold
    # On reload depuis la page 1 puis on saute à la page 6 directement
    inst_2 = [
        {"evaluate": setup},
        {"evaluate": "H.ck()"}, {"wait": 1500},
        {"evaluate": "H.s60()"}, {"wait": 2500},
    ]
    # Click pages 2,3,4,5,6 to reach page 6, then continue to 10
    for n in range(2, 11):
        inst_2 += [{"evaluate": f"H.p({n})"}, {"wait": 1500}]
        if n >= 6:
            inst_2 += [{"evaluate": "H.sc()"}, {"wait": 800}, {"evaluate": "H.hf()"}]
    # Switch to sold + harvest
    inst_2 += [
        {"evaluate": "H.sw()"}, {"wait": 2500},
        {"evaluate": "H.s60()"}, {"wait": 2500},
        {"evaluate": "H.sc()"}, {"wait": 1200},
        {"evaluate": "H.hs()"},
        {"evaluate": "H.dump()"},
    ]
    html2 = call_sb(inst_2, 'pages 6-10 + sold')
    r = type('FakeR', (), {'text': html1 + html2, 'status_code': 200})()
    # Parse les meta tags injectés (présents dans html1 + html2)
    import html as html_lib
    def extract_all(name, source):
        results = []
        for m in re.finditer(rf'<meta name="{name}" content="([^"]*)"', source):
            try: results.append(json.loads(html_lib.unescape(m.group(1))))
            except: pass
        return results

    # html1 contient _h_fs (pages 1-5), _h_c (counters)
    # html2 contient _h_fs (pages 6-10), _h_sd (sold)
    fs_urls = []
    for arr in extract_all('_h_fs', r.text):
        fs_urls.extend(arr)
    sd_urls = []
    for arr in extract_all('_h_sd', r.text):
        sd_urls.extend(arr)
    cs = extract_all('_h_c', r.text)
    counters = cs[0] if cs else {}

    fs_target = int(counters.get('fs', 0))
    sold_target = int(counters.get('sd', 0))
    print(f'Profil : {fs_target} en vente · {sold_target} vendus')

    fs_map = {}
    for u in fs_urls:
        m = re.search(r'-(\d{7,9})\.shtml?', u)
        if m: fs_map[m.group(1)] = u
    sold_map = {}
    for u in sd_urls:
        m = re.search(r'-(\d{7,9})\.shtml?', u)
        if m: sold_map[m.group(1)] = u

    print(f'  ✓ for-sale: {len(fs_map)} URLs')
    print(f'  ✓ sold page 1: {len(sold_map)} URLs')

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


def main():
    print('=== Chargement du site ===')
    site_all, site_sold, site_available, sold_stems, all_stems, by_id = load_site()
    print(f'Site : {len(site_all)} produits Vestiaire · {len(site_sold)} sold · {len(site_available)} available')

    print('\n=== Scan profil Vestiaire (ScrapingBee API + js_scenario) ===')
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
    main()
