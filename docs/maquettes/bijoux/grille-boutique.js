const {chromium}=require('playwright');const path=require('path');
const D=path.join(__dirname,'bijoux');
const P=[
 {id:'90000002',brand:'GUCCI',type:'Bracelet maillons clou',price:'—',img:'b2.jpg',meta:'925 · ITALIE · ANNÉES 70'},
 {id:'90000001',brand:'ATELIER FRANÇAIS',type:'Bracelet turquoises',price:'—',img:'b1.jpg',meta:'MINERVE · ART NOUVEAU'},
 {id:'90000003',brand:'NON SIGNÉ',type:'Bracelet sculpté',price:'—',img:'b3.jpg',meta:'ARGENT MASSIF · ANNÉES 70'},
 {id:'90000004',brand:'NON SIGNÉ',type:'Bague cristal',price:'—',img:'b4.jpg',meta:'925 · T. 54'},
 {id:'90000005',brand:'NON SIGNÉ',type:'Anneau, épingle, porte-clés',price:'—',img:'b5.jpg',meta:'925 · LOT DE 3'},
];
(async()=>{const b=await chromium.launch();
for (const [w,h,n] of [[393,852,'m'],[1440,900,'d']]){const c=await b.newContext({viewport:{width:w,height:h},locale:'fr-FR',deviceScaleFactor:n==='m'?2:1});const p=await c.newPage();
await p.addInitScript(()=>{try{localStorage.setItem('passeist_cookie_consent','denied');localStorage.setItem('passeist_consent','denied')}catch(e){}});
await p.route(/\/img\/9000000\d-/,r=>{const id=r.request().url().match(/9000000\d/)[0];const f=P.find(x=>x.id===id).img;r.fulfill({path:path.join(D,f),contentType:'image/jpeg'})});
await p.goto('http://localhost:8765/',{waitUntil:'domcontentloaded'});await p.waitForTimeout(2500);
await p.evaluate((P)=>{
  PRODUCTS.splice(0,PRODUCTS.length,...P.map(x=>({id:x.id,brand:x.brand,type:x.type,size:'',price:x.price,gender:'u',color:'Silver',n:1,desc:''})));
  P.forEach(x=>VALIDATED_LOCAL.add(x.id));
  document.querySelectorAll('.cookie-banner,#cookie-banner,[class*=cookie]').forEach(e=>e.remove());
  goPage('shop');
},P);
await p.waitForTimeout(2000);
await p.evaluate((P)=>{
  // Menu : « Argent » après « Boutique », actif
  document.querySelectorAll('a[data-page="shop"]').forEach(a=>{const x=a.cloneNode(true);x.removeAttribute('data-page');const sp=x.querySelector('span');if(sp)sp.textContent='Argent';else x.textContent='Argent';a.after(x);a.classList.remove('active');x.classList.add('active');});
  document.querySelectorAll('.product-card').forEach(card=>{const id=(card.getAttribute('href')||'').match(/9000000\d/)||[(card.querySelector('[data-id]')||{}).dataset?.id];const it=P.find(x=>x.id===(id&&id[0]));if(!it)return;const s=card.querySelector('.product-size');if(s)s.textContent=it.meta;});
  const h=[...document.querySelectorAll('h1,h2,.shop-count,.shop-title')].find(e=>/pièces/.test(e.textContent));if(h)h.textContent='Argent ancien';
  document.querySelectorAll('.cookie-banner,#cookie-banner,[class*=cookie]').forEach(e=>e.remove());
  const R=[[/^Genre$/i,'Type'],[/^Tous genres \(5\)$/,'Tous types (5)'],[/^Auteur$/i,'Orfèvre'],[/^Tous les auteurs \(5\)$/,'Tous les orfèvres (5)'],[/^Catégorie$/i,'Poinçon'],[/^Toutes catégories \(5\)$/,'Tous poinçons (5)'],[/^Couleur$/i,'Époque'],[/^Toutes couleurs \(5\)$/,'Toutes époques (5)']];
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let t;while(t=w.nextNode()){const v=t.nodeValue.trim();for(const [re,nv] of R){if(re.test(v)){t.nodeValue=t.nodeValue.replace(v,nv);break;}}}
  document.querySelectorAll('select option').forEach(o=>{for(const [re,nv] of R){if(re.test(o.textContent.trim()))o.textContent=nv;}});
},P);
await p.evaluate(async()=>{document.querySelectorAll('img').forEach(i=>{i.loading='eager';});for(let y=0;y<document.body.scrollHeight;y+=400){scrollTo(0,y);await new Promise(r=>setTimeout(r,120));}scrollTo(0,0);document.querySelectorAll('.product-img').forEach(e=>e.classList.remove('loading'));});
await p.waitForTimeout(1500);
const H=await p.evaluate(()=>document.documentElement.scrollHeight);await p.setViewportSize({width:w,height:H});await p.waitForTimeout(2500);
console.log(n,await p.evaluate(()=>[...document.querySelectorAll('.product-img-primary')].map(i=>i.naturalWidth+'/'+getComputedStyle(i).opacity)));
await p.screenshot({path:'bj-real-'+n+'.png'});
await c.close()}
await b.close()})()
