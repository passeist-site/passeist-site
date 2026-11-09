/* Version claire (Tom, 2026-11-09 au soir) : fond gris très clair #eeeeee et
   pièces qui « flottent » (le blanc des photos prend la teinte de la page grâce à
   mix-blend-mode: multiply, sans détourage). Une seule version pour tous. Si ça
   ne va pas, on repasse au bleu nuit : retirer <script src="/assets/theme.js">.
   On inverse les couleurs des feuilles de style (bleu nuit → gris clair, crème →
   bleu nuit), puis on ajoute les réglages propres au clair. À charger dans <head>,
   APRÈS les feuilles de style. */
(function () {
  function swap(t) {
    return t
      .replace(/#f4f1ec/gi, '@@C@@').replace(/244,\s*241,\s*236/g, '@@CR@@')
      .replace(/#1c2230/gi, '#eeeeee').replace(/28,\s*34,\s*48/g, '238,238,238')
      .replace(/#131826|#262d3c|#313847/gi, '#e6e6e6')
      .replace(/#f2eee8/gi, '#3b4152').replace(/#d4d1cb/gi, '#7a7e88').replace(/#d6d2cc/gi, '#3b4152').replace(/#a8a6a1/gi, '#7a7e88')
      .replace(/@@C@@/g, '#1C2230').replace(/@@CR@@/g, '28,34,48');
  }
  var sheets = Array.prototype.slice.call(document.styleSheets);
  sheets.forEach(function (sh) {
    var node = sh.ownerNode, css = '';
    if (!node) return;
    if (node.tagName === 'STYLE') { node.textContent = swap(node.textContent); return; }
    try { css = Array.prototype.map.call(sh.cssRules, function (r) { return r.cssText; }).join('\n'); }
    catch (e) { return; }   // feuille d'un autre site (polices) : rien à inverser
    var st = document.createElement('style');
    st.textContent = swap(css);
    node.parentNode.insertBefore(st, node.nextSibling);
    sh.disabled = true;
  });
  var N = '#1C2230', C = '#f4f1ec';
  var extra = document.createElement('style');
  extra.id = 'theme-blanc';
  extra.textContent =
    ':root{--bg:#eeeeee;--bg-deep:#e6e6e6;--bg-soft:#ebebeb;--bg-highlight:#e2e2e2;--ink:' + N + ';--text:' + N + ';--text-dim:#3b4152;--text-mute:#7a7e88;--text-ghost:#b4b6bb;--line:rgba(28,34,48,.14);--line-strong:rgba(28,34,48,.35);--line-ghost:rgba(28,34,48,.06)}' +
    'html,body{background:#eeeeee!important;color:' + N + '}' +
    /* Pièces qui flottent : le fond blanc des photos prend le gris de la page */
    '.product-img,.product-img::before{background:#eeeeee!important}.product-img img{mix-blend-mode:multiply}' +
    '.hero-marquee-card{background:#eeeeee!important}.hero-marquee-card img{mix-blend-mode:multiply}' +
    '#detail .detail-gallery .main-photo-wrap{background:#eeeeee!important}' +
    '#detail .detail-gallery .main-photo,#detail .detail-gallery .ribbon-ghost{background:transparent!important;mix-blend-mode:multiply}' +
    '#detail .detail-gallery .thumb{background:#eeeeee!important}#detail .detail-gallery .thumb img{mix-blend-mode:multiply}' +
    '.product-brand .brand-name,.hbs-headliners a,.product-price,#detail .detail-price{color:' + N + '!important}' +
    '.product-img,.hero-marquee-card{box-shadow:none!important}' +
    '#detail .detail-gallery .thumb.is-active{border-color:' + N + '!important}' +
    /* En-tête : un trait fin au lieu de l'ombre, qui salissait le haut des photos */
    /* En-tête gardé en bleu nuit (Tom) : la page claire est tenue en haut et en bas
       par notre bleu (en-tête / newsletter + pied de page). */
    '.topbar{background:' + N + '!important;box-shadow:0 10px 24px -14px rgba(0,0,0,.45)!important;border-bottom:0!important}' +
    '.topbar::after{background:linear-gradient(90deg,transparent 10%,rgba(244,241,236,.12) 28%,rgba(244,241,236,.55) 50%,rgba(244,241,236,.12) 72%,transparent 90%)!important}' +
    '.topbar .logo,.topbar-icon,.nav-toggle{color:' + C + '!important}.topbar-icon svg{stroke:' + C + '!important}' +
    '.nav-toggle span,.nav-toggle span::before,.nav-toggle span::after{background:' + C + '!important}' +
    '.topbar-icon .cart-count{color:' + N + '!important}' +
    /* Notre bleu en bas de page : newsletter et pied de page en bleu nuit (relief, Tom) */
    '.nl{background:' + N + '!important;margin:0!important;padding-top:56px!important;padding-bottom:56px!important}' +
    '.nl .nl-card{background:transparent!important;box-shadow:none!important;border:0!important}' +
    '.nl,.nl .nl-title,.nl .nl-txt,.nl .nl-legal,.nl .nl-done,.nl a{color:' + C + '!important}' +
    '.nl .nl-legal,.nl .nl-txt{opacity:.75}' +
    '.nl .nl-form input{background:rgba(244,241,236,.08)!important;border:1px solid rgba(244,241,236,.28)!important;color:' + C + '!important}' +
    '.nl .nl-form input::placeholder{color:rgba(244,241,236,.55)!important}' +
    '.nl .nl-form button{background:' + C + '!important;color:' + N + '!important;box-shadow:none!important}' +
    '.footer{background:' + N + '!important;color:rgba(244,241,236,.65)!important;border-top:1px solid rgba(244,241,236,.12)!important}' +
    '.footer a,.footer span{color:rgba(244,241,236,.8)!important}' +
    /* Bandes gris très clair pour donner du relief aux sections secondaires */
    '.similar-section,.recent-section{background:#e6e6e6!important}' +
    /* Carrousels sous les fiches : les pièces flottent aussi sur la bande grise */
    '.similar-section .product-img,.recent-section .product-img,.similar-section .product-img::before,.recent-section .product-img::before{background:#e6e6e6!important;box-shadow:none!important}.similar-section .product-img img,.recent-section .product-img img{background:transparent!important;mix-blend-mode:multiply}' +
    /* Boutons (Explorer, Tout voir) : bleu nuit d'avant, pas le bleu du point (Tom) */
    '.hero-cta,.hbs-cta{background:' + N + '!important;color:' + C + '!important;box-shadow:0 10px 22px -10px rgba(28,34,48,.45)!important}' +
    '.hero-cta *,.hbs-cta *{color:' + C + '!important}' +
    '.hero-cta:hover,.hbs-cta:hover{background:#2c3446!important}' +
    /* Grille boutique mobile : sans cadre autour des photos, 10 px entre colonnes
       collait les textes (prix de gauche contre la marque de droite). 24 px (Tom, 2026-11-09) */
    '@media (max-width:900px){.grid{column-gap:24px!important;row-gap:72px!important;margin-top:0!important}.grid .product-body{padding-top:2px!important}}' +
    /* Sans cadre, le texte doit coller à SA photo : texte à 2 px sous la photo, 72 px
       entre deux rangées ; et moins de vide entre « Créer votre alerte » et la grille (Tom). */
    /* Barre panier en bas des fiches : ombre légère sur fond blanc */
    '.buy-bar{box-shadow:0 -6px 18px -10px rgba(28,34,48,.25)!important}' +
    /* Bandeau cookies en bleu nuit, comme le pied de page */
    '.cookie-banner-card{background:' + N + '!important;color:' + C + '!important;border:0!important;box-shadow:0 12px 30px rgba(28,34,48,.25)!important}' +
    '.cookie-banner-card *{color:' + C + '!important}' +
    '.cookie-banner-actions button{background:transparent!important;border:1px solid rgba(244,241,236,.35)!important}' +
    '.cookie-banner-actions button:last-child,.cookie-banner-actions button:last-child *{background:' + C + '!important;color:' + N + '!important;border-color:' + C + '!important}';
  document.head.appendChild(extra);
  document.documentElement.classList.add('theme-blanc');
  var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', N);
})();
