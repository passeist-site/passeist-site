/* Version blanche (essai Tom, 2026-11-09). Retour au bleu nuit pour tous le soir
   même (Tom) : la version blanche n'est plus active que sur demande, avec
   ?theme=blanc (mémorisé dans ce navigateur) ; ?theme=sombre revient au bleu nuit.
   Fond de page = blanc exact des photos Vestiaire. On inverse les couleurs dans
   les feuilles de style (bleu nuit ↔ blanc, crème ↔ bleu nuit), puis on ajoute
   les réglages propres au blanc. À charger dans <head>, APRÈS les feuilles de style. */
(function () {
  try {
    var q = new URLSearchParams(location.search).get('theme');
    if (q === 'blanc') localStorage.setItem('passeist_theme', 'blanc');
    if (q === 'sombre') localStorage.removeItem('passeist_theme');
    if (localStorage.getItem('passeist_theme') !== 'blanc') return;
  } catch (e) { return; /* stockage indisponible : bleu nuit */ }
  function swap(t) {
    return t
      .replace(/#f4f1ec/gi, '@@C@@').replace(/244,\s*241,\s*236/g, '@@CR@@')
      .replace(/#1c2230/gi, '#ffffff').replace(/28,\s*34,\s*48/g, '255,255,255')
      .replace(/#131826|#262d3c|#313847/gi, '#f3f3f1')
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
    ':root{--bg:#ffffff;--bg-deep:#f4f4f2;--bg-soft:#f6f6f4;--bg-highlight:#ececea;--ink:' + N + ';--text:' + N + ';--text-dim:#3b4152;--text-mute:#7a7e88;--text-ghost:#b4b6bb;--line:rgba(28,34,48,.14);--line-strong:rgba(28,34,48,.35);--line-ghost:rgba(28,34,48,.06)}' +
    'html,body{background:#fff!important;color:' + N + '}' +
    '.product-brand .brand-name,.hbs-headliners a,.product-price,#detail .detail-price{color:' + N + '!important}' +
    '.product-img,.hero-marquee-card{box-shadow:none!important}' +
    '#detail .detail-gallery .thumb.is-active{border-color:' + N + '!important}' +
    /* En-tête : un trait fin au lieu de l'ombre, qui salissait le haut des photos */
    '.topbar{box-shadow:none!important;border-bottom:1px solid rgba(28,34,48,.08)!important}' +
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
    '.similar-section,.recent-section{background:#f5f5f3!important}' +
    /* Boutons (Explorer, Tout voir) : bleu nuit d'avant, pas le bleu du point (Tom) */
    '.hero-cta,.hbs-cta{background:' + N + '!important;color:' + C + '!important;box-shadow:0 10px 22px -10px rgba(28,34,48,.45)!important}' +
    '.hero-cta *,.hbs-cta *{color:' + C + '!important}' +
    '.hero-cta:hover,.hbs-cta:hover{background:#2c3446!important}' +
    /* Grille boutique mobile : sans cadre autour des photos, 10 px entre colonnes
       collait les textes (prix de gauche contre la marque de droite). 24 px (Tom, 2026-11-09) */
    '@media (max-width:900px){.grid{column-gap:24px!important}}' +
    /* Barre panier en bas des fiches : ombre légère sur fond blanc */
    '.buy-bar{box-shadow:0 -6px 18px -10px rgba(28,34,48,.25)!important}' +
    /* Bandeau cookies en bleu nuit, comme le pied de page */
    '.cookie-banner-card{background:' + N + '!important;color:' + C + '!important;border:0!important;box-shadow:0 12px 30px rgba(28,34,48,.25)!important}' +
    '.cookie-banner-card *{color:' + C + '!important}' +
    '.cookie-banner-actions button{background:transparent!important;border:1px solid rgba(244,241,236,.35)!important}' +
    '.cookie-banner-actions button:last-child,.cookie-banner-actions button:last-child *{background:' + C + '!important;color:' + N + '!important;border-color:' + C + '!important}';
  document.head.appendChild(extra);
  document.documentElement.classList.add('theme-blanc');
  var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', '#ffffff');
})();
