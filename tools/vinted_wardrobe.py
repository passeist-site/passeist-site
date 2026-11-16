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
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(sorted(items, key=lambda x: str(x['id'])), f, ensure_ascii=False, indent=0)
    print(f'{len(items)} annonces en vente → {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
