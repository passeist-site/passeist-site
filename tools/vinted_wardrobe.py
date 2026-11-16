#!/usr/bin/env python3
"""Annonces Vinted de passéist → data/vinted.json (Tom, 2026-11-16).

But : à chaque vente sur le site, donner à Tom le lien direct de l'annonce Vinted de la
pièce, pour la retirer en deux appuis (comme le lien Vestiaire).

Même méthode que la synchro Vestiaire : ScrapingBee ouvre le dressing public Vinted
(member/16032770) dans un vrai navigateur, puis, depuis la page, appelle l'API interne
du dressing (/api/v2/wardrobe/{id}/items) avec les cookies de la session anonyme.
Lecture seule : rien n'est modifié sur Vinted.

Sortie : data/vinted.json = [{id, title, brand, price, size, url, photo}, ...]
L'association pièce du site ↔ annonce Vinted est faite dans tools/export_products.py.
"""
import html as html_lib, json, os, re, sys
import requests

MEMBER = os.environ.get('VINTED_MEMBER', '16032770')
SB_API = 'https://app.scrapingbee.com/api/v1/'
KEY = os.environ.get('SCRAPINGBEE_API_KEY', '')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'vinted.json')

SETUP = (
    "window._it=[];window._e=null;window._d=0;window._tot=0;"
    "window.GO=async function(){try{"
    "for(let p=1;p<=20;p++){"
    f"const r=await fetch('/api/v2/wardrobe/{MEMBER}/items?page='+p+'&per_page=96&order=newest_first',"
    "{headers:{'Accept':'application/json'},credentials:'include'});"
    "if(!r.ok){window._e='HTTP '+r.status+' page='+p;break}"
    "const j=await r.json();const it=j.items||[];"
    "window._tot=(j.pagination&&j.pagination.total_entries)||window._tot;"
    "it.forEach(x=>window._it.push({id:x.id,title:x.title,brand:x.brand||x.brand_title||'',"
    "price:(x.price&&(x.price.amount||x.price))||x.price_numeric||'',size:x.size||x.size_title||'',"
    "url:x.url||('https://www.vinted.fr/items/'+x.id),photo:(x.photo&&(x.photo.url||x.photo.full_size_url))||'',"
    "closed:!!(x.is_closed||x.is_reserved||x.item_closing_action)}));"
    "if(it.length<96)break}"
    "}catch(e){window._e=String(e&&e.message||e)}window._d=1};"
    "window.DUMP=function(){[['_v_it',window._it],['_v_e',{e:window._e,d:window._d,t:window._tot}]]"
    ".forEach(([n,v])=>{const m=document.createElement('meta');m.name=n;m.content=JSON.stringify(v);document.head.appendChild(m)})};"
    "window.CK=function(){const b=[...document.querySelectorAll('button')]"
    ".find(x=>/accepter|accept all|tout accepter/i.test(x.textContent)&&!/refuser|reject|param/i.test(x.textContent));if(b)b.click()};"
)


# ~12 pages lues par appel en 30 s : on en lit au plus MAX_DESC par soir, le reste les soirs suivants
BATCH, MAX_DESC = 24, int(os.environ.get('VINTED_MAX_DESC', '240'))

_ESC = {'n': '\n', 't': ' ', 'r': '', '/': '/'}
def _unescape(v):
    """La description est dans du JSON lui-même échappé dans la page : on décode jusqu'au texte."""
    def rep(m):
        c = m.group(1)
        return chr(int(c[1:], 16)) if c[0] == 'u' and len(c) == 5 else _ESC.get(c, c)
    for _ in range(3):
        if '\\' not in v: break
        v = re.sub(r'\\(u[0-9a-fA-F]{4}|.)', rep, v, flags=re.S)
    return v.strip()


def fetch_descs(ids):
    """Lit la description de chaque annonce depuis sa page (12 à la fois), renvoie {id: texte}."""
    js = ("window._ds={};window.GO=async function(){const ids=" + json.dumps([str(i) for i in ids]) + ";"
          "const one=async id=>{try{const t=await (await fetch('/items/'+id,{credentials:'include'})).text();"
          r"const m=t.match(/\"description\":\"((?:[^\"\\]|\\.){20,4000}?)\"/);"
          "window._ds[id]=m?m[1]:''}catch(e){window._ds[id]=''}};"
          "for(let i=0;i<ids.length;i+=12)await Promise.all(ids.slice(i,i+12).map(one));window._dd=1};"
          "window.DUMP=function(){const m=document.createElement('meta');m.name='_v_ds';m.content=JSON.stringify(window._ds);document.head.appendChild(m)};")
    sc = {'instructions': [{'evaluate': js}, {'evaluate': 'GO()'}, {'wait': 30000}, {'evaluate': 'DUMP()'}]}
    try:
        r = requests.get(SB_API, params={'api_key': KEY, 'url': f'https://www.vinted.fr/member/{MEMBER}',
            'premium_proxy': 'true', 'country_code': 'fr', 'render_js': 'true',
            'js_scenario': json.dumps(sc, separators=(',', ':'))}, timeout=180)
        m = re.search(r'<meta name="_v_ds" content="([^"]*)"', r.text)
        raw = json.loads(html_lib.unescape(m.group(1))) if m else {}
    except Exception as e:
        print('  descriptions : erreur', e); return {}
    return {k: _unescape(v)[:1500] for k, v in raw.items() if v}


def main():
    if not KEY:
        print('SCRAPINGBEE_API_KEY absente : rien à faire'); return 0
    scenario = {'instructions': [
        {'evaluate': SETUP}, {'evaluate': 'CK()'}, {'wait': 1500},
        {'evaluate': 'GO()'}, {'wait': 15000}, {'evaluate': 'DUMP()'}]}
    params = {
        'api_key': KEY, 'url': f'https://www.vinted.fr/member/{MEMBER}',
        'premium_proxy': 'true', 'country_code': 'fr', 'render_js': 'true',
        'js_scenario': json.dumps(scenario, separators=(',', ':')), 'block_resources': 'false',
    }
    r = requests.get(SB_API, params=params, headers={'Spb-Accept-Language': 'fr-FR,fr;q=0.9'}, timeout=180)
    if r.status_code != 200:
        print(f'ScrapingBee HTTP {r.status_code} : {r.text[:300]}'); return 1

    def meta(name):
        m = re.search(rf'<meta name="{name}" content="([^"]*)"', r.text)
        return json.loads(html_lib.unescape(m.group(1))) if m else None

    items, diag = meta('_v_it') or [], meta('_v_e') or {}
    print(f"Vinted : {len(items)} annonces lues (total annoncé {diag.get('t')}) ; erreur : {diag.get('e')} ; terminé : {diag.get('d')}")
    if not items:
        print('Aucune annonce lue : data/vinted.json inchangé'); return 1
    items = [x for x in items if not x.get('closed')]
    # Descriptions (Tom, 2026-11-16) : comparées à celles du site pour relier chaque pièce à son
    # annonce. Lues une seule fois par annonce, puis gardées dans data/vinted.json.
    try: prev = {str(x['id']): x.get('desc') for x in json.load(open(OUT)) if x.get('desc')}
    except Exception: prev = {}
    for x in items:
        if str(x['id']) in prev: x['desc'] = prev[str(x['id'])]
    todo = [x for x in items if not x.get('desc')]
    print(f'Descriptions : {len(items) - len(todo)} déjà connues, {len(todo)} à lire')
    for b in range(0, min(len(todo), MAX_DESC), BATCH):
        got = fetch_descs([x['id'] for x in todo[b:b + BATCH]])
        for x in todo[b:b + BATCH]:
            if got.get(str(x['id'])): x['desc'] = got[str(x['id'])]
        print(f'  lot {b // BATCH + 1} : {sum(1 for v in got.values() if v)}/{len(todo[b:b + BATCH])} descriptions')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(sorted(items, key=lambda x: str(x['id'])), f, ensure_ascii=False, indent=0)
    print(f'{len(items)} annonces en vente → {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
