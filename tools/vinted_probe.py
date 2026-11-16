"""Essai temporaire : Vinted donne-t-il la description d'une annonce ? (lecture seule)"""
import json, os, re, html, requests
KEY = os.environ['SCRAPINGBEE_API_KEY']
ids = [x['id'] for x in json.load(open('data/vinted.json'))[:4]]
JS = ("window._r=[];window.GO=async function(){for(const id of " + json.dumps(ids) + "){for(const u of ['/api/v2/items/'+id+'/details','/api/v2/items/'+id,'/items/'+id]){"
      "try{const r=await fetch(u,{credentials:'include',headers:{'Accept':u.startsWith('/api')?'application/json':'text/html'}});const t=await r.text();"
      "let d='';try{const j=JSON.parse(t);const it=j.item||j;d=(it.description||'').slice(0,160)}catch(e){const m=t.match(/\"description\":\"([^\"]{0,160})/);d=m?'HTML:'+m[1]:''}"
      "window._r.push({u,s:r.status,n:t.length,d})}catch(e){window._r.push({u,e:String(e)})}}}};"
      "window.DUMP=function(){const m=document.createElement('meta');m.name='_p';m.content=JSON.stringify(window._r);document.head.appendChild(m)};")
sc = {'instructions': [{'evaluate': JS}, {'evaluate': 'GO()'}, {'wait': 15000}, {'evaluate': 'DUMP()'}]}
r = requests.get('https://app.scrapingbee.com/api/v1/', params={'api_key': KEY, 'url': 'https://www.vinted.fr/member/16032770',
    'premium_proxy': 'true', 'country_code': 'fr', 'render_js': 'true', 'js_scenario': json.dumps(sc)}, timeout=180)
print('HTTP', r.status_code)
m = re.search(r'<meta name="_p" content="([^"]*)"', r.text)
for x in json.loads(html.unescape(m.group(1))) if m else []: print(x)
