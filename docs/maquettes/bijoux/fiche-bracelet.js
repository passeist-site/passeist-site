const {chromium}=require('playwright');const path=require('path');const fs=require('fs');
const D=path.join(__dirname,'bijoux','turq');
const DESC=`Bracelet en argent massif, fabriqué au Japon dans les années 50 pour l'exportation vers l'Europe.

Quatre cabochons ovales de turquoise naturelle, chacun serti dans un cadre de feuillages ciselés à la main. Entre eux, des maillons carrés ornés d'une fleur de lotus en relief. Un travail d'orfèvre très fin, typique des ateliers japonais d'après-guerre qui produisaient pour les voyageurs et les boutiques européennes.

Poinçon « SILVER » et marque d'atelier en caractères japonais sur le fermoir.

Belle patine d'origine dans les creux du décor, qui fait ressortir les ciselures. Fermoir à glissière en bon état de fonctionnement.

Longueur : à compléter
Largeur : à compléter
Poids : à compléter`;
(async()=>{const b=await chromium.launch();
for (const [w,h,n,dpr] of [[393,852,'m',2],[1440,900,'d',1]]){
const c=await b.newContext({viewport:{width:w,height:h},locale:'fr-FR',deviceScaleFactor:dpr});const p=await c.newPage();
await p.addInitScript(()=>{try{localStorage.setItem('passeist_cookie_consent','denied')}catch(e){}});
const B={'90000001':'b2.jpg','90000002':'b3.jpg','90000003':'b4.jpg','90000004':'b5.jpg'};
await p.route(/\/img\/9000000[1-4]-/,r=>{const id=r.request().url().match(/9000000[1-4]/)[0];r.fulfill({path:path.join(__dirname,'bijoux',B[id]),contentType:'image/jpeg'})});
await p.route(/\/img\/90000009-(\d+)-/,r=>{const i=r.request().url().match(/90000009-(\d+)-/)[1];r.fulfill({path:path.join(D,i+'.jpg'),contentType:'image/jpeg'})});
await p.goto('http://localhost:8765/',{waitUntil:'domcontentloaded'});await p.waitForTimeout(2500);
await p.evaluate((DESC)=>{
  PRODUCTS.splice(0,PRODUCTS.length,
    {id:'90000001',brand:'GUCCI',type:'Bracelet maillons clou',size:'',price:'—',gender:'f',color:'Silver',n:1,desc:''},
    {id:'90000002',brand:'NON SIGNÉ',type:'Bracelet sculpté',size:'',price:'—',gender:'f',color:'Silver',n:1,desc:''},
    {id:'90000003',brand:'NON SIGNÉ',type:'Bague cristal',size:'',price:'—',gender:'f',color:'Silver',n:1,desc:''},
    {id:'90000004',brand:'NON SIGNÉ',type:'Anneau, épingle, porte-clés',size:'',price:'—',gender:'f',color:'Silver',n:1,desc:''});
  ['90000001','90000002','90000003','90000004'].forEach(i=>VALIDATED_LOCAL.add(i));
  PRODUCTS.unshift({id:'90000009',brand:'ARGENT JAPONAIS',type:'Bracelet turquoises',size:'',price:'—',gender:'f',color:'Silver',n:6,desc:DESC});
  VALIDATED_LOCAL.add('90000009');
  document.querySelectorAll('[class*=cookie]').forEach(e=>e.remove());
  openDetail('90000009');
},DESC);
await p.waitForTimeout(3000);
await p.addStyleTag({content:'#detail-gallery img,#detail-gallery .main-photo{object-fit:contain!important;scale:1!important;transform:none!important}#detail-gallery *{overflow:visible!important}'});
await p.evaluate(async()=>{
  document.querySelectorAll('[class*=cookie]').forEach(e=>e.remove());
  const at=document.querySelector('.detail-attrs');
  if(at) at.innerHTML='<div><div class="attr-label">Poinçon</div><div class="attr-value">Silver · Japon</div></div><div><div class="attr-label">Pierres</div><div class="attr-value">4 turquoises</div></div><div><div class="attr-label">Époque</div><div class="attr-value">Années 50</div></div>';
  const ed=document.getElementById('d-edition'); if(ed) ed.textContent='Argent massif · Japon, années 50';
  const imgs=[...document.querySelectorAll('#detail-gallery img, #d-similar img')];
  await Promise.all(imgs.map(i=>{i.loading='eager';return i.complete?0:new Promise(r=>{i.onload=r;i.onerror=r;})}));
  for (const img of imgs) {
    if(!img.naturalWidth) continue;
    const cv=document.createElement('canvas');cv.width=img.naturalWidth;cv.height=img.naturalHeight;const x=cv.getContext('2d');x.drawImage(img,0,0);
    const d=x.getImageData(0,0,cv.width,cv.height),q=d.data;
    for(let i=0;i<q.length;i+=4){const m=Math.min(q[i],q[i+1],q[i+2]);q[i+3]=Math.round(Math.max(0,Math.min(1,(246-m)/26))*255);}
    // Bijou coupé par le cadre (gros plan) : pas d'ombre, sinon la coupe devient une arête
    const W=cv.width,H=cv.height;let edge=0,tot=0;
    for(let k=0;k<W;k+=4){for(const yy of [1,H-2]){tot++;if(q[(yy*W+k)*4+3]>128)edge++;}}
    for(let k=0;k<H;k+=4){for(const xx of [1,W-2]){tot++;if(q[(k*W+xx)*4+3]>128)edge++;}}
    if(edge/tot>0.01) continue;
    x.putImageData(d,0,0);img.srcset='';img.src=cv.toDataURL('image/png');
    img.style.cssText+=';mix-blend-mode:normal!important;filter:drop-shadow(0 16px 16px rgba(28,34,48,.22)) drop-shadow(0 3px 3px rgba(28,34,48,.18))!important';
  }
});
await p.waitForTimeout(1500);
const sc=await p.evaluate(()=>{const d=document.getElementById('detail');const s=getComputedStyle(d);return {h:d.scrollHeight,ov:s.overflowY,ch:d.clientHeight,doc:document.documentElement.scrollHeight}});console.log(n,sc);
const scroller = sc.ov==='auto'||sc.ov==='scroll' ? 'd' : 'w';
let k=0;
for(let y=0;y<(scroller==='d'?sc.h:sc.doc)-50 && k<7;y+=h-120,k++){
  await p.evaluate(([y,s])=>{if(s==='d')document.getElementById('detail').scrollTop=y;else scrollTo(0,y)},[y,scroller]);await p.waitForTimeout(700);
  await p.screenshot({path:`turq3-${n}-${k}.png`});
}
await c.close()}
await b.close()})()
