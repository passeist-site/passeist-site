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
import re, json, os, time, datetime
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
# Full scan : mercredi + dimanche automatiquement, ou forcé via env var FULL_SCAN=true (workflow_dispatch)
FULL_SCAN = (os.environ.get('FULL_SCAN', 'false').lower() == 'true'
             or datetime.datetime.utcnow().weekday() in (2, 6))  # 2 = mercredi, 6 = dimanche

PROFILE_URL = 'https://fr.vestiairecollective.com/profile/30773496/?sortBy=relevance&tab=items-for-sale'
INDEX = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'index.html')
SB_API = 'https://app.scrapingbee.com/api/v1/'


def sb_fetch(url, premium=False):
    """Fetch via ScrapingBee API direct.
    Retourne (status, resolved_url, html, had_resolved).

    `had_resolved` dit si ScrapingBee a bien renvoye l'entete spb-resolved-url.
    Sans elle, `resolved` retombe sur l'URL d'origine — qui contient toujours
    l'ID produit — et le test "ID disparu de l'URL finale" ne peut plus rien
    detecter. Il faut le savoir pour basculer sur le test HTML.

    country_code=fr TOUJOURS : evite les prix USD/taxes internationales."""
    params = {'api_key': SCRAPINGBEE_API_KEY, 'url': url, 'country_code': 'fr'}
    if premium:
        params['premium_proxy'] = 'true'
    try:
        r = requests.get(SB_API, params=params, timeout=60)
        hdr = r.headers.get('spb-resolved-url')
        return r.status_code, (hdr or url), r.text, bool(hdr)
    except Exception as e:
        return 0, url, f'ERROR: {e}', False


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
    """Scan for-sale + sold via l'API JSON interne de Vestiaire.

    2026-08-23 : abandon total du clic-sur-pagination (H.p/H.pl/H.sw), qui etait
    non deterministe — chaque clic pouvait echouer silencieusement et casser toute
    la chaine suivante (runs successifs : 600, puis 400, puis 60 URLs sans qu'aucun
    code n'ait change).

    Le SPA VC appelle POST https://search.vestiairecollective.com/v1/product/search
    avec filters={"seller.id":[ID],"sold":["0"|"1"]} et pagination={limit,offset}.
    limit max observe = 200. On fait l'appel depuis le contexte de la page (via
    js_scenario evaluate) pour heriter des cookies/session, et on pagine par offset.

    Resultat : 1 seul appel ScrapingBee, 0 clic, 700/700 items (100%).
    """
    print('  -> Scan via API interne VC (POST /v1/product/search, pagination par offset)')

    setup = (
        "window._fs=new Set();window._sd=new Set();window._c={};window._e=null;window._d=0;"
        "window.GO=async function(){try{"
        "const grab=async(sold)=>{"
        "const set=sold==='1'?window._sd:window._fs;let off=0,tot=0;"
        "while(off<3000){"
        "const r=await fetch('https://search.vestiairecollective.com/v1/product/search',{"
        "method:'POST',"
        "headers:{'Accept':'application/json','Content-Type':'application/json','x-usecase':'profileItemsForSale'},"
        "body:JSON.stringify({pagination:{limit:200,offset:off},fields:['link','sold'],"
        "locale:{country:'FR',language:'fr',currency:'EUR',sizeType:'FR'},"
        "filters:{'seller.id':['30773496'],sold:[sold]},mySizes:null,sortBy:'relevance'})});"
        "if(!r.ok){window._e='HTTP '+r.status+' sold='+sold;break}"
        "const j=await r.json();"
        "tot=(j.paginationStats&&j.paginationStats.totalHits)||0;"
        "const it=j.items||[];"
        "it.forEach(x=>{if(x.link)set.add(x.link)});"
        "if(it.length===0)break;"
        "off+=200;if(off>=tot)break}"
        "if(sold==='1')window._c.sd=tot;else window._c.fs=tot};"
        "await grab('0');await grab('1');"
        "}catch(e){window._e=String(e&&e.message||e)}window._d=1};"
        "window.DUMP=function(){"
        "const a=[['_h_fs',[...window._fs]],['_h_sd',[...window._sd]],"
        "['_h_c',window._c],['_h_e',{e:window._e,d:window._d}]];"
        "a.forEach(([n,v])=>{const m=document.createElement('meta');m.name=n;"
        "m.content=JSON.stringify(v);document.head.appendChild(m)})};"
        "window.CK=function(){const b=[...document.querySelectorAll('button')]"
        ".find(x=>/accepter|accept all|accept cookies/i.test(x.textContent)"
        "&&!/refuser|reject|customize|param/i.test(x.textContent));if(b)b.click()};"
    )

    instructions = [
        {"evaluate": setup},
        {"evaluate": "CK()"}, {"wait": 1500},
        {"evaluate": "GO()"},
        # GO() est async : on attend qu'il ait fini (window._d passe a 1).
        # ~6 appels API x ~1s = large marge avec 20s.
        {"wait": 20000},
        {"evaluate": "DUMP()"},
    ]

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
    print(f'  -> SB call API ({len(instructions)} instructions)...')
    rr = requests.get(SB_API, params=params, headers=headers, timeout=180)
    if rr.status_code != 200:
        raise Exception(f'SB call HTTP {rr.status_code}: {rr.text[:300]}')

    import html as html_lib

    def extract_all(name, source):
        results = []
        for m in re.finditer(rf'<meta name="{name}" content="([^"]*)"', source):
            try:
                results.append(json.loads(html_lib.unescape(m.group(1))))
            except Exception:
                pass
        return results

    fs_urls = []
    for arr in extract_all('_h_fs', rr.text):
        fs_urls.extend(arr)
    sd_urls = []
    for arr in extract_all('_h_sd', rr.text):
        sd_urls.extend(arr)
    cs = extract_all('_h_c', rr.text)
    counters = cs[0] if cs else {}
    diag = extract_all('_h_e', rr.text)
    if diag:
        d = diag[0]
        if d.get('e'):
            print(f'  !! Erreur JS pendant le scan API : {d["e"]}')
        if not d.get('d'):
            print('  !! GO() pas termine dans le delai imparti (window._d=0)')

    fs_target = int(counters.get('fs', 0))
    sold_target = int(counters.get('sd', 0))
    print(f'Profil : {fs_target} en vente - {sold_target} vendus')

    def to_map(urls):
        out = {}
        for u in urls:
            m = re.search(r'-(\d{7,9})\.shtml?', u)
            if m:
                # l'API renvoie des liens relatifs -> on reconstruit l'absolu
                full = u if u.startswith('http') else 'https://fr.vestiairecollective.com' + u
                out[m.group(1)] = full
        return out

    fs_map = to_map(fs_urls)
    sold_map = to_map(sd_urls)

    print(f'  - for-sale: {len(fs_map)} URLs')
    print(f'  - sold: {len(sold_map)} URLs')

    return fs_map, sold_map, fs_target, sold_target


def verify_item(pid, by_id):
    """Hit la fiche produit via ScrapingBee API direct (1 credit) et classe.
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

    def is_deleted(pid, resolved, html, had_resolved):
        """Une fiche VC vivante contient TOUJOURS son propre ID, dans l'URL
        finale et dans le HTML. Supprimee, VC redirige vers la categorie :
        l'ID disparait des deux.

        Garde-fou : on n'accepte le verdict que si le HTML ressemble vraiment
        a une page VC (sinon une page captcha/blocage vide ferait basculer
        a tort tout le catalogue)."""
        looks_like_vc = 'vestiairecollective' in html.lower()
        if not looks_like_vc:
            return False
        if pid not in html:
            return True
        if had_resolved and pid not in resolved:
            return True
        return False

    # 1ere tentative : datacenter (1 credit)
    status, resolved, html, had_res = sb_fetch(url, premium=False)
    if status == 0:
        return 'keep'  # erreur reseau, doute = securite

    # 404 : VC redirige les fiches supprimees vers la page categorie, qui
    # renvoie parfois 404. L'ancien code traitait ce cas comme "bloque" et
    # retournait 'keep' -> les suppressions passaient sous le radar.
    if status == 404:
        return 'deleted' if is_deleted(pid, resolved, html, had_res) else 'keep'

    # Si bloque (403, 429, 5xx) -> retry avec premium proxy (25 credits)
    if status not in (200, 301, 302):
        status, resolved, html, had_res = sb_fetch(url, premium=True)
        if status == 404:
            return 'deleted' if is_deleted(pid, resolved, html, had_res) else 'keep'
        if status not in (200, 301, 302):
            return 'keep'

    # Article supprime : ID disparu de l'URL finale et/ou du HTML
    if is_deleted(pid, resolved, html, had_res):
        return 'deleted'
    # Article vendu : JSON-LD availability OutOfStock
    m = re.search(r'"availability"\s*:\s*"([^"]+)"', html)
    avail = m.group(1) if m else None
    if avail and 'OutOfStock' in avail:  # schema.org URL ou valeur courte
        return 'sold'
    # InStock ou indetermine -> on garde actif (R1: doute = securite)
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

    # Fallback si scan bloqué (0 items + fs_target=0) : vérif tous items via ScrapingBee
    scan_blocked = len(fs_map) == 0 and fs_target == 0
    if scan_blocked:
        print(f'\n  ⚠ SCAN BLOQUÉ. Fallback : vérif individuelle {len(site_available)} items...')
        fb_sold, fb_deleted = set(), set()
        with ThreadPoolExecutor(max_workers=4) as ex:
            futs = {ex.submit(verify_item, pid, by_id): pid for pid in sorted(site_available, key=lambda x: int(x))}
            done = [0]
            for f in as_completed(futs):
                pid, status = futs[f], f.result()
                done[0] += 1
                if status == 'sold': fb_sold.add(pid)
                elif status == 'deleted': fb_deleted.add(pid)
                if done[0] % 50 == 0:
                    print(f'    [{done[0]}/{len(site_available)}] sold={len(fb_sold)} deleted={len(fb_deleted)}')
        print(f'  ✓ Fallback : {len(fb_sold)} vendus, {len(fb_deleted)} supprimés')
        if len(fb_sold) + len(fb_deleted) > 50:
            print(f'  ⚠⚠⚠ CIRCUIT BREAKER fallback → ABORT')
        else:
            for pid in fb_sold:
                if pid not in B: B.append(pid)
            for pid in fb_deleted:
                if pid not in B: B.append(pid)
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
