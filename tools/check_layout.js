// Vérification de la mise en page (Tom, 2026-11-18 : « vérifier la mise en page en permanence dès
// qu'on fait un changement »). À lancer avant de présenter toute modification visuelle :
//   python3 -m http.server 8765 &   puis   node tools/check_layout.js [http://localhost:8765]
// Écrans : accueil, boutique, fiche, panier, chat (départ et discussion) ; FR et EN ;
// 360, 393, 430 et 1440 px. Signale : débordement horizontal, éléments cliquables qui se
// chevauchent, texte coupé dans un bouton, blocs centrés décalés, erreurs JavaScript.
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8765';
const WIDTHS = [[360, 740, true], [393, 852, true], [430, 932, true], [1440, 900, false]];

const SCREENS = {
  accueil: async p => {},
  boutique: async p => { await p.evaluate(() => goPage('shop')); },
  fiche: async p => { await p.evaluate(() => { const x = PRODUCTS.find(q => !isSold(q)); openDetail(x.id); }); },
  panier: async p => { await p.evaluate(() => { const x = PRODUCTS.find(q => !isSold(q)); addToCart(x.id); if (!document.getElementById('cart-panel').classList.contains('open')) toggleCart(); }); },
  'chat départ': async p => { await p.evaluate(() => { localStorage.removeItem('passeist_chat_name'); localStorage.removeItem('passeist_chat_email'); openChat(); }); },
  'chat discussion': async p => { await p.evaluate(() => { localStorage.setItem('passeist_chat_name', 'Julie'); localStorage.setItem('passeist_chat_email', 'julie@example.com'); openChat(); }); },
};

function audit() {
  const W = innerWidth, out = [];
  const vis = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.bottom > 0 && r.top < innerHeight; };
  const name = el => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''))
    + (el.innerText ? ' « ' + el.innerText.trim().replace(/\s+/g, ' ').slice(0, 28) + ' »' : '');
  // 1. débordement horizontal de la page
  const sw = document.scrollingElement.scrollWidth;
  if (sw > W + 1) out.push('page plus large que l\'écran : ' + sw + ' px pour ' + W);
  // 2. éléments cliquables qui se chevauchent (dans la même couche visible)
  const top = (r) => document.elementFromPoint(Math.min(W - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
  const ctl = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea')]
    .filter(vis).filter(el => { const t = top(el.getBoundingClientRect()); return t && (t === el || el.contains(t) || t.contains(el)); });
  for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) {
    const a = ctl[i], b = ctl[j]; if (a.contains(b) || b.contains(a)) continue;
    // ligne par ligne (un lien qui passe à la ligne a plusieurs morceaux)
    const ra = [...a.getClientRects()], rb = [...b.getClientRects()];
    const hit = ra.some(r => rb.some(s => (Math.min(r.right, s.right) - Math.max(r.left, s.left)) > 4 && (Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top)) > 4));
    if (hit) out.push('chevauchement : ' + name(a) + ' / ' + name(b));
  }
  // 3. éléments visibles qui sortent de l'écran par la droite ou la gauche
  for (const el of document.querySelectorAll('button, input, select, textarea, h1, h2, h3, p, .btn')) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.right > W + 1 || r.left < -1) { const cs = getComputedStyle(el.parentElement || el); if (!/auto|scroll|hidden/.test(cs.overflowX)) out.push('dépasse de l\'écran : ' + name(el)); }
  }
  // 4. texte coupé dans un bouton
  for (const el of document.querySelectorAll('button, .btn')) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);   // coupé = caché par overflow (une pastille qui dépasse exprès n'est pas coupée)
    if (/hidden|clip/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis') out.push('texte coupé : ' + name(el));
  }
  // 5. formulaires et blocs centrés (text-align:center) : marges gauche/droite équilibrées dans leur cadre
  for (const el of document.querySelectorAll('form, .chat-start, .hero-cta, .hbs-cta')) {
    if (!vis(el) || !el.parentElement) continue;
    const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect(), cs = getComputedStyle(el.parentElement);
    const pl = p.left + parseFloat(cs.paddingLeft), pr = p.right - parseFloat(cs.paddingRight);
    const g = r.left - pl, d = pr - r.right;
    if (getComputedStyle(el).textAlign === 'center' && Math.abs(g - d) > 6 && r.width < pr - pl - 2) out.push('pas centré (' + Math.round(g) + ' / ' + Math.round(d) + ' px) : ' + name(el));
  }
  return [...new Set(out)];
}

(async () => {
  const b = await chromium.launch(); let total = 0;
  for (const lang of ['fr', 'en']) for (const [w, h, mobile] of WIDTHS) {
    const c = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
    await c.addInitScript(l => { try { localStorage.setItem('passeist_lang', l); localStorage.setItem('passeist_cookie_consent', 'rejected'); localStorage.setItem('passeist_country', 'FR'); } catch (e) {} }, lang);
    await c.route('**/.netlify/functions/chat**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"messages":[],"ok":true}' }));
    await c.route('**/.netlify/functions/relay-points*', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
    for (const [nm, go] of Object.entries(SCREENS)) {
      const p = await c.newPage(); const errs = [];
      p.on('pageerror', e => errs.push(e.message));
      await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(400);
      try { await go(p); } catch (e) { errs.push('ouverture : ' + e.message); }
      await p.waitForTimeout(700);
      const pb = (await p.evaluate(audit)).concat(errs.map(e => 'erreur JS : ' + e));
      if (pb.length) { total += pb.length; console.log(`✗ ${nm} · ${lang} · ${w}px\n   - ` + pb.join('\n   - ')); }
      await p.close();
    }
    await c.close();
  }
  await b.close();
  console.log(total ? `\n${total} problème(s) de mise en page` : 'Mise en page : aucun problème détecté (6 écrans × 2 langues × 4 largeurs)');
  process.exit(total ? 1 : 0);
})();
