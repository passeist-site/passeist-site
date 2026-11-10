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
    /* Barre de filtres (mobile) : barre transparente, on voit défiler les pièces
       autour ; seuls les boutons sont opaques (Tom). */
    '@media (max-width:900px){.filter-bar{background:transparent!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;box-shadow:none!important}' +
    '.filter-bar.searching .filter-search-inline{background:#f7f7f7!important}' +
    /* Liquid Glass (Tom) : boutons de filtres et barre panier en verre dépoli, les pièces passent floues derrière */
    '.filter-mobile-toggle,.filter-search-btn{background:rgba(250,250,250,.86)!important;-webkit-backdrop-filter:blur(20px) saturate(160%)!important;backdrop-filter:blur(20px) saturate(160%)!important;border:1px solid rgba(255,255,255,.7)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.95),inset 0 -1px 0 rgba(28,34,48,.06),0 8px 22px -8px rgba(28,34,48,.28)!important}' +
    '.buy-bar{background:rgba(238,238,238,.55)!important;-webkit-backdrop-filter:blur(18px) saturate(160%)!important;backdrop-filter:blur(18px) saturate(160%)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 -8px 24px -12px rgba(28,34,48,.3)!important}.buy-bar::before{display:none!important}' +
    '.buy-bar-icon,.buy-bar .buy-bar-icon.fav-btn{background:rgba(255,255,255,.5)!important;box-shadow:inset 0 1px 0 #fff,0 4px 10px -4px rgba(28,34,48,.25)!important}}' +
    /* Menu mobile en bleu nuit vitré, comme l'en-tête (Tom) */
    '@media (max-width:900px){.mobile-nav{background:linear-gradient(90deg,rgba(28,34,48,.96) 0%,rgba(28,34,48,.86) 55%,rgba(28,34,48,.7) 100%)!important;border-right:0!important}' +
    '.mobile-nav,.mobile-nav a,.mobile-nav button,.mobile-nav .mobile-nav-sub,.mobile-nav span{color:' + C + '!important}' +
    '.mobile-nav svg{stroke:' + C + '!important}.mobile-nav-foot{border-top-color:rgba(244,241,236,.22)!important}' +
    '.mobile-nav .mobile-nav-lang{border-color:rgba(244,241,236,.35)!important}}' +
    /* « Parcourir la boutique » (favoris vides) : même bouton bleu nuit qu'Explorer (Tom) */
    '.empty-state .btn{background:' + N + '!important;color:' + C + '!important;border-color:' + N + '!important;box-shadow:0 10px 22px -10px rgba(28,34,48,.45)!important}' +
    /* Panneau des filtres et panier : bleu nuit vitré comme le menu, textes crème (Tom) */
    '.filter-sheet{background:linear-gradient(0deg,rgba(28,34,48,.97) 0%,rgba(28,34,48,.9) 55%,rgba(28,34,48,.8) 100%)!important}' +
    '.cart-panel{background:linear-gradient(270deg,rgba(28,34,48,.97) 0%,rgba(28,34,48,.88) 55%,rgba(28,34,48,.74) 100%)!important}' +
    '.filter-sheet,.filter-sheet *,.cart-panel,.cart-panel *{color:' + C + '!important;border-color:rgba(244,241,236,.25)!important}' +
    '.filter-sheet svg,.cart-panel svg{stroke:' + C + '!important}' +
    '.filter-sheet input::placeholder{color:rgba(244,241,236,.55)!important}.filter-sheet .filter-label{color:rgba(244,241,236,.6)!important}' +
    '.filter-sheet select,.filter-sheet input,.filter-sheet .filter-select{background:rgba(244,241,236,.07)!important}.filter-sheet option{color:' + N + '!important}' +
    '.filter-sheet .filter-sheet-apply,.cart-panel .btn-primary,.cart-panel .cart-checkout{background:' + C + '!important;color:' + N + '!important}.filter-sheet .filter-sheet-apply *,.cart-panel .btn-primary *{color:' + N + '!important}' +
    '.cart-panel .cart-close,.cart-panel [class*=close]{background:rgba(244,241,236,.1)!important}' +
    /* Fenêtre de discussion : bleu nuit vitré comme le panier et les filtres (Tom) */
    '#chat-overlay .chat-box{background:linear-gradient(160deg,rgba(40,48,66,.96) 0%,rgba(28,34,48,.92) 100%)!important}' +
    '#chat-overlay .chat-box,#chat-overlay .chat-title,#chat-overlay .chat-who,#chat-overlay .chat-start-txt,#chat-overlay .checkout-close,#chat-overlay .chat-msg.note{color:' + C + '!important}' +
    '#chat-overlay .chat-who,#chat-overlay .chat-msg.note{opacity:.65}' +
    '#chat-overlay .chat-msg.client{background:' + C + '!important;color:' + N + '!important}' +
    '#chat-overlay .chat-msg.passeist{background:#5a7593!important;color:' + C + '!important}' +
    '#chat-overlay input,#chat-overlay textarea{background:rgba(244,241,236,.08)!important;color:' + C + '!important;border-color:rgba(244,241,236,.25)!important}' +
    '#chat-overlay input::placeholder,#chat-overlay textarea::placeholder{color:rgba(244,241,236,.5)!important}' +
    '#chat-overlay button[type=submit]{background:' + C + '!important;color:' + N + '!important}#chat-overlay button[type=submit] svg{stroke:' + N + '!important;fill:' + N + '!important}' +
    '#chat-overlay .checkout-close{background:rgba(244,241,236,.1)!important}' +
    /* Boutons « Ajouter au panier » : pas de reflet blanc en haut (trop marqué sur le bleu nuit), survol bleu nuit plus clair (Tom) */
    '.detail-actions .btn-primary,.buy-bar-cta{box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 12px 24px -10px rgba(28,34,48,.45)!important}' +
    '.detail-actions .btn-primary:hover{background:#2c3446!important;border-color:#2c3446!important;color:' + C + '!important}' +
    /* Pages auteurs : rouleau « Notre sélection » comme les rouleaux des fiches
       (pièces qui flottent sur le gris, prix sans étiquette), bouton bleu nuit (Tom) */
    '.bc-img{background:#eeeeee!important;box-shadow:none!important}.bc-img img{mix-blend-mode:multiply}' +
    '.bc-brand,.bc-brand-name{color:' + N + '!important;font-weight:800!important}' +
    '.bc-price{background:none!important;clip-path:none!important;padding:0!important;color:' + N + '!important;font-size:12px!important;font-weight:800!important}' +
    '.bc-name{color:#3b4152!important}.bc-meta{color:#7a7e88!important;border-top-color:rgba(28,34,48,.14)!important}' +
    '.cta-shop a{background:' + N + '!important;color:' + C + '!important;box-shadow:0 10px 22px -10px rgba(28,34,48,.45)!important}' +
    '.cta-shop a *,.cta-shop a::after{color:' + C + '!important}.cta-shop a:hover{background:#2c3446!important}' +
    /* Points photo 1 / photo 2 des cartes : point actif bleu du logo, l'autre gris (Tom) */
    '.card-dots i{background:rgba(28,34,48,.22)!important}.card-dots i:first-child,.product-img.show-2 .card-dots i:last-child{background:#5a7593!important}.product-img.show-2 .card-dots i:first-child{background:rgba(28,34,48,.22)!important}' +
    /* Ordinateur : au survol, la photo 1 s'efface pendant que la photo 2 apparaît.
       Avec multiply, la photo 2 se mélangeait à la photo 1 (superposition, Tom). */
    '@media (hover:hover) and (pointer:fine){.product-img .product-img-primary{transition:opacity .6s cubic-bezier(.22,1,.36,1)}.product-card:hover .product-img-primary{opacity:0!important}}' +
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
    /* Menu ordinateur (Accueil, Boutique, Auteurs…) : crème sur l'en-tête bleu nuit, sinon invisible */
    '.topbar .lang-toggle{border-color:rgba(244,241,236,.35)!important}' +
    '.top-nav a,.top-nav a > span,.top-nav a.active > span,.topbar .lang-switch,.topbar .lang-switch *,.topbar .lang-toggle,.topbar .lang-toggle *{color:' + C + '!important}' +
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
