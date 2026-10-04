/**
 * Netlify build plugin — generate static product pages
 *
 * Takes index.html as-is (full inline CSS + JS) and produces one page per
 * product at product/[slug]/index.html with:
 *   - Product-specific SEO tags in <head> (title, description, og:*, JSON-LD)
 *   - The detail panel pre-populated and open so Google sees the product content
 *   - <body class="detail-open"> so the layout renders correctly on first paint
 *
 * The SPA's parseInitialRoute() detects /product/[slug] and re-initialises
 * openDetail() after 50ms, so all interactive features work as normal.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ── Replicate slugify() + productSlug() from the SPA ─────────────────────
// Must stay in sync with the live SPA functions (grep: "productSlug = function")

function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function productSlug(p) {
  return [slugify(p.brand), slugify(p.type), p.id].filter(Boolean).join('-');
}

// ── Replicate _vestiaireUrl() from the SPA ─────────────────────────────────

function vestiaireUrl(product, photoNum, w, suffix) {
  return 'https://images.vestiairecollective.com/images/resized/w=' + w +
         ',q=90,f=auto,/produit/' + product.slug + '-' + photoNum + suffix + '.jpg';
}

function productImgUrl(product, i, w, imgReorder, imgSuffix, validatedLocal, publishDir) {
  if (!product.n || product.n === 0) return '';
  const reorder  = imgReorder[product.id];
  const photoNum = reorder ? reorder[i] : (i + 1);
  const suffix   = imgSuffix[product.id] || '_2';
  if (validatedLocal.has(product.id)) {
    const size     = w >= 1200 ? 'xl' : 'md';
    const localRel = 'img/' + product.id + '-' + i + '-' + size + '.webp';
    if (fs.existsSync(path.join(publishDir, localRel))) return '/' + localRel;
  }
  return vestiaireUrl(product, photoNum, w, suffix);
}

// ── getGender() ────────────────────────────────────────────────────────────

function getGender(p) {
  const g = (p.gender || '').toLowerCase();
  if (g === 'h') return 'Homme';
  if (g === 'f') return 'Femme';
  return p.gender || 'Accessoire';
}

// ── HTML attribute escaping ────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Build gallery HTML (mirrors openDetail in the SPA) ────────────────────

function buildGalleryHtml(p, sold, imgReorder, imgSuffix, validatedLocal, publishDir) {
  const numPhotos = sold ? 1 : (p.n || 1);
  const photos = [];
  for (let i = 0; i < numPhotos; i++) {
    photos.push(productImgUrl(p, i, 1600, imgReorder, imgSuffix, validatedLocal, publishDir));
  }

  // Texte alternatif riche (Google Images) : marque, type, couleur, n° de photo
  // « passéist » dans le texte des photos : recherche « passeist » dans Google Images
  const altBase = esc([p.brand, p.type, p.color && colorFR(p.color)].filter(Boolean).join(' ') + ' vintage, passéist');
  const mainHtml = `<img class="main-photo" src="${photos[0]}" data-idx="0" loading="eager" decoding="async" alt="${altBase} — photo 1" onerror="this.style.display='none'">`;

  const thumbsHtml = photos.slice(1).map((src, idx) => {
    const i = idx + 1;
    return `<div class="thumb" data-idx="${i}"><img src="${src}" loading="lazy" decoding="async" alt="${altBase} — photo ${i + 1}" onerror="this.parentElement.remove()"></div>`;
  }).join('');

  return `<div class="main-photo-wrap">${mainHtml}<span class="vendu-badge">VENDU</span></div><div class="thumbs-row">${thumbsHtml}</div>`;
}

// ── Build pre-populated <div class="detail"> ──────────────────────────────

function buildDetailHtml(p, sold, imgReorder, imgSuffix, validatedLocal, publishDir) {
  const galleryHtml    = buildGalleryHtml(p, sold, imgReorder, imgSuffix, validatedLocal, publishDir);
  const hideIfSold     = sold ? ' style="display:none"' : '';
  const sizeText       = p.size && p.size !== '' ? esc(p.size) : 'Taille unique';
  const priceText      = sold ? '' : (p.price + ' €');
  const classes        = 'detail open' + (sold ? ' detail-sold' : '');

  return `<div class="${classes}" id="detail">
  <div class="detail-header">
    <button class="detail-back" id="detail-back-btn" onclick="closeDetail()">← Retour à la boutique</button>
  </div>
  <div class="detail-main">
    <div class="detail-gallery" id="detail-gallery">${galleryHtml}</div>
    <div class="detail-info">
      <div class="detail-brand" id="d-brand">${esc(p.brand)}</div>
      <h1 class="detail-name" id="d-name">${esc(p.type)}</h1>
      <div class="detail-price-row" id="d-price-row">
        <div class="detail-price-wrap" id="d-price-wrap"${sold ? ' style="display:none"' : ''}>
          <svg class="nav-ink nav-ink--price-detail" viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true"><rect x="6" y="6" width="188" height="68" filter="url(#ink-rough-h)"/></svg>
          <span class="detail-price" id="d-price">${priceText}</span>
        </div>
        <div class="detail-price-actions">
          <button class="detail-price-icon" id="d-price-add" type="button" onclick="if(currentProduct) addToCart(currentProduct.id)" aria-label="Ajouter au panier" title="Ajouter au panier">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1.5 12H6.5z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>
          </button>
          <button class="detail-price-icon fav-btn" id="d-price-fav" data-id="${esc(p.id)}" type="button" onclick="toggleFavoriteWithFly(document.getElementById('d-price-fav').dataset.id, event)" aria-label="Ajouter aux favoris" title="Ajouter aux favoris">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 5.5 5.5 5.5 0 0 1 21.5 12C19 16.5 12 21 12 21z"/></svg>
          </button>
        </div>
      </div>
      <div class="detail-attrs">
        <div><div class="attr-label">Taille</div><div class="attr-value" id="d-size">${sizeText}</div></div>
        <div><div class="attr-label">Genre</div><div class="attr-value" id="d-gender">${esc(getGender(p))}</div></div>
        <div><div class="attr-label">État</div><div class="attr-value">Très bon état</div></div>
      </div>
      <p class="detail-intro" id="d-intro" style="display:none"></p>
      <div class="detail-desc" id="d-desc">${esc(p.desc || '')}</div>
      <div class="detail-actions" id="d-actions"${hideIfSold}>
        <button class="btn btn-primary" id="d-cart">Ajouter au panier</button>
        <button class="btn btn-secondary" id="d-contact">Demander un renseignement</button>
      </div>
      <div class="detail-availability" id="d-availability"${hideIfSold}>
        Chaque pièce étant unique et référencée sur plusieurs plateformes, votre commande sera validée après une courte vérification de disponibilité.
      </div>
      <div class="detail-ref" id="d-ref" title="Cliquer pour copier la référence" onclick="copyProductRef(this)">Réf. ${esc(p.id)}</div>
    </div>
  </div>
  <section class="similar-section" id="d-similar" hidden>
    <div class="similar-title">Articles similaires</div>
    <div class="similar-marquee" id="d-similar-marquee">
      <div class="similar-track" id="d-similar-track"></div>
    </div>
  </section>
</div>`;
}

// ── Season + year in French and English ───────────────────────────────────
// Returns { fr: "Automne-Hiver 2003", en: "Fall-Winter 2003" } or null

function seasonYear(desc) {
  if (!desc) return null;
  const text = desc.normalize('NFC').replace(/\s+/g, ' ');

  const seasons = [
    { re: /\b(?:automne[\s\-]*hiver|fall[\s\-]*winter)\b/i,           fr: 'Automne-Hiver', en: 'Fall-Winter' },
    { re: /(?:printemps[\s\-]*[eé]t[eé]|spring[\s\-]*summer)(?![a-zà-ÿ])/i,  fr: 'Printemps-Été', en: 'Spring-Summer' },
    { re: /\bautomne\b/i,    fr: 'Automne',  en: 'Fall'   },
    { re: /\bhiver\b/i,      fr: 'Hiver',    en: 'Winter' },
    { re: /\bprintemps\b/i,  fr: 'Printemps',en: 'Spring' },
    { re: /(?<![a-zà-ÿ])[eé]t[eé](?![a-zà-ÿ])/i, fr: 'Été', en: 'Summer' },
  ];

  // Première année qui date la pièce : on ignore l'historique de la marque
  // (« créée en 1981 », « appelée en 1983 », « depuis 1972 »…). « Années 2000 »
  // ou « années 90 » donnent une décennie.
  const HIST = /(cr[ée]{2}e?|fond[ée]e?|appel[ée]e?|lanc[ée]e?|\bn[ée]e?\b|depuis|devenu|rebaptis|marque|sponsor|tour d)/i;
  let yearMatch = null;
  for (const m of text.matchAll(/\b(19[6-9]\d|20[0-2]\d)\b/g)) {
    const before = text.slice(Math.max(0, m.index - 45), m.index);
    if (/ann[ée]es\s+$/i.test(before)) {
      const dec = m[1].startsWith('19') ? m[1].slice(2) : m[1];
      return { fr: 'Années ' + dec, en: (m[1].startsWith('19') ? m[1].slice(2) : m[1]) + 's' };
    }
    if (HIST.test(before)) continue;
    yearMatch = m; break;
  }
  if (!yearMatch) {
    const d = text.match(/ann[ée]es\s+(\d0)\b/i);
    return d ? { fr: 'Années ' + d[1], en: d[1] + 's' } : null;
  }
  const year = yearMatch[1];

  const pos = yearMatch.index;
  const win = text.slice(Math.max(0, pos - 40), pos + 44);
  for (const s of seasons) {
    if (s.re.test(win)) return { fr: s.fr + ' ' + year, en: s.en + ' ' + year };
  }
  return { fr: year, en: year };
}


// ── Ligne de la maison (Homme Plus, Y's, Pleats Please…) lue dans la
//    description, et « édition » courte ligne + saison pour les cartes, la
//    fiche et les titres Google (comme les boutiques d'archive, Tom) ───────
const LINES = {
  'COMME DES GARÇONS': [
    [/homme plus/, 'Homme Plus'], [/homme deux/, 'Homme Deux'], [/robe de chambre/, 'Robe de Chambre'],
    [/\btricot\b/, 'Tricot'], [/comme comme/, 'Comme Comme'], [/(?:cdg|comme des gar[çc]ons|collection) shirt\b/, 'Shirt'],
    [/(?:comme des gar[çc]ons|collection) noir\b/, 'Noir'], [/black comme/, 'Black'],
    [/(?:comme des gar[çc]ons|collection) homme\b(?! plus| deux)/, 'Homme'],
  ],
  'YOHJI YAMAMOTO': [
    [/y['’]s for men/, "Y's for men"], [/ground y\b/, 'Ground Y'], [/pour homme/, 'Pour Homme'],
    [/\by['’]s\b/, "Y's"], [/\bregulation\b/, 'Regulation'], [/\by-3\b/, 'Y-3'],
  ],
  'ISSEY MIYAKE': [
    [/pleats please/, 'Pleats Please'], [/homme pliss[ée]/, 'Homme Plissé'], [/\bhaat\b/, 'HaaT'],
    [/a-?poc/, 'A-POC'], [/bao ?bao/, 'Bao Bao'], [/\bf[êe]te\b/, 'Fête'],
    [/(?:issey miyake|collection) men\b/, 'Men'], [/(?:\bme issey miyake|collection me\b)/, 'me'],
  ],
  'JUNYA WATANABE': [[/junya watanabe man|collection man\b/, 'Man'], [/\beye\b/, 'eYe']],
};
function lineOf(p) {
  const rules = LINES[String(p.brand || '').toUpperCase()];
  if (!rules) return '';
  const d = String(p.desc || '').toLowerCase();
  for (const [re, label] of rules) if (re.test(d)) return label;
  return '';
}
function shortSeason(sy, en) {
  if (!sy) return '';
  const t = en ? sy.en : sy.fr;
  return t.replace(/^Automne-Hiver /, 'AH ').replace(/^Printemps-Été /, 'PE ')
          .replace(/^Fall-Winter /, 'FW ').replace(/^Spring-Summer /, 'SS ');
}
function editionOf(p, en) {
  return [lineOf(p), shortSeason(seasonYear(p.desc || ''), en)].filter(Boolean).join(' · ');
}

// ── French → English translation tables ───────────────────────────────────

const TYPE_FR_TO_EN = {
  'pantalon': 'Trousers',   'veste': 'Jacket',        'manteau': 'Coat',
  'robe': 'Dress',          'chemise': 'Shirt',        'chemisier': 'Blouse',
  'pull': 'Sweater',        'pullover': 'Sweater',     'cardigan': 'Cardigan',
  'jupe': 'Skirt',          'écharpe': 'Scarf',        'echarpe': 'Scarf',
  'foulard': 'Scarf',       'cravate': 'Tie',          'costume': 'Suit',
  'blazer': 'Blazer',       'short': 'Shorts',         'salopette': 'Overalls',
  'combinaison': 'Jumpsuit','gilet': 'Vest',           'top': 'Top',
  't-shirt': 'T-Shirt',     'tshirt': 'T-Shirt',       'polo': 'Polo',
  'jean': 'Jeans',          'trench': 'Trench coat',   'doudoune': 'Down jacket',
  'parka': 'Parka',         'kimono': 'Kimono',        'tunique': 'Tunic',
  'legging': 'Leggings',    'leggings': 'Leggings',    'collant': 'Tights',
  'chapeau': 'Hat',         'bonnet': 'Beanie',        'casquette': 'Cap',
  'gants': 'Gloves',        'ceinture': 'Belt',        'sac': 'Bag',
  'pochette': 'Clutch',     'blouson': 'Bomber jacket','sweat': 'Sweatshirt',
  'sweatshirt': 'Sweatshirt','débardeur': 'Tank top',  'debardeur': 'Tank top',
  'ensemble': 'Set',        'tailleur': 'Suit',        'imperméable': 'Raincoat',
  'impermeable': 'Raincoat','veston': 'Jacket',        'cape': 'Cape',
  'poncho': 'Poncho',       'châle': 'Shawl',          'chale': 'Shawl',
  'bandeau': 'Headband',    'chapeau cloche': 'Cloche hat',
};

const MATERIAL_FR_TO_EN = {
  'laine': 'Wool',       'coton': 'Cotton',     'lin': 'Linen',
  'soie': 'Silk',        'polyester': 'Polyester','nylon': 'Nylon',
  'cachemire': 'Cashmere','velours': 'Velvet',   'denim': 'Denim',
  'cuir': 'Leather',     'satin': 'Satin',       'viscose': 'Viscose',
  'acrylique': 'Acrylic','mohair': 'Mohair',     'alpaga': 'Alpaca',
  'alpaca': 'Alpaca',    'angora': 'Angora',     'lycra': 'Lycra',
  'organza': 'Organza',  'tweed': 'Tweed',       'jacquard': 'Jacquard',
  'jersey': 'Jersey',    'dentelle': 'Lace',     'fourrure': 'Fur',
  'mesh': 'Mesh',        'tulle': 'Tulle',       'flanelle': 'Flannel',
  'gabardine': 'Gabardine','taffetas': 'Taffeta', 'mousseline': 'Chiffon',
  'élasthanne': 'Elastane','elasthanne': 'Elastane','synthétique': 'Synthetic',
};

function translateType(fr) {
  return TYPE_FR_TO_EN[fr.toLowerCase()] || fr;
}

function translateMaterial(fr) {
  return MATERIAL_FR_TO_EN[fr.toLowerCase()] || fr;
}

// Scan description for a known material (fallback when p.type has no "en X")
function extractMaterialFromDesc(desc) {
  if (!desc) return null;
  const mats = Object.keys(MATERIAL_FR_TO_EN).sort((a, b) => b.length - a.length);
  for (const mat of mats) {
    if (new RegExp('\\b' + mat + '\\b', 'i').test(desc)) {
      return mat.charAt(0).toUpperCase() + mat.slice(1);
    }
  }
  return null;
}

// ── sitemap.xml (static routes + one <url> per in-stock product) ──────────
// FIX 2026-09-27 : sitemap.xml était un fichier statique commité une seule
// fois (avril 2026, cf DEPLOY.md), jamais régénéré. productSlug() a changé
// depuis (p.type reclassé par les imports), donc les 755 URLs du sitemap ne
// correspondaient plus à AUCUNE page réellement générée (0/755 match exact,
// vérifié). Résultat : Google recevait 755 URLs qui retombaient toutes sur
// le fallback SPA (_redirects "/product/* -> /index.html 200"), donc sur du
// contenu dupliqué de la homepage, pendant que les vraies fiches produit
// (avec leur propre <title>/canonical/JSON-LD, cf applyProductSEO ci-dessus)
// n'étaient listées nulle part. En générant le sitemap ici, à chaque build,
// à partir des mêmes `products` et du même productSlug() que les pages
// elles-mêmes, il ne peut plus jamais diverger de ce qui est réellement en ligne.

const STATIC_ROUTES = [
  { loc: 'https://passeist.com/',        changefreq: 'daily',   priority: '1.0' },
  { loc: 'https://passeist.com/shop',    changefreq: 'daily',   priority: '0.95' },
  { loc: 'https://passeist.com/archive', changefreq: 'weekly',  priority: '0.7' },
  { loc: 'https://passeist.com/about',   changefreq: 'monthly', priority: '0.5' },
  { loc: 'https://passeist.com/marques', changefreq: 'weekly',  priority: '0.85' },
  // Une entrée par page marque statique servie via _redirects ("/marques/* -> /marques/:splat.html").
  // Si une marque est ajoutée/retirée dans marques/*.html, mettre à jour cette liste.
  ...[
    'issey-miyake', 'yohji-yamamoto', 'comme-des-garcons', '45rpm', 'junko-koshino',
    'kansai-yamamoto', 'blue-blue-japan', 'zucca', 'kijima-takayuki', 'tsumori-chisato',
    'yoshiki-hishinuma', 'limi-feu', 'junya-watanabe', 'maison-mihara-yasuhiro',
    'fumito-ganryu', 'noir-kei-ninomiya', 'tigre-brocante', 'jun-men', 'final-home',
  ].map(slug => ({ loc: 'https://passeist.com/marques/' + slug, changefreq: 'weekly', priority: '0.7' })),
];

function buildSitemap(products, soldIds, imgReorder, imgSuffix, validatedLocal, publishDir) {
  // Pas de <lastmod> : la date du build n'est pas une vraie date de
  // modification (Google finit par ignorer des dates toujours "aujourd'hui").
  const staticUrls = STATIC_ROUTES.map(r => `  <url>
    <loc>${r.loc}</loc>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`);

  // Uniquement les pièces disponibles : les fiches vendues sont en
  // robots "noindex,nofollow" (cf applyProductSEO), donc pas de raison
  // de les pousser dans le sitemap non plus.
  const productUrls = products
    .filter(p => p.id && !soldIds.has(p.id) && p.sold !== true)
    .map(p => {
      // Plan de site images : jusqu'à 6 photos par pièce, pour que Google
      // Images découvre vite les nouvelles pièces.
      const imgs = [];
      for (let i = 0; i < Math.min(p.n || 0, 6); i++) {
        const u = productImgUrl(p, i, 1600, imgReorder, imgSuffix, validatedLocal, publishDir);
        if (u) imgs.push(u.startsWith('/') ? 'https://passeist.com' + u : u);
      }
      const imgXml = imgs.map(u => `\n    <image:image><image:loc>${xmlesc(u)}</image:loc></image:image>`).join('');
      return `  <url>
    <loc>https://passeist.com/product/${productSlug(p)}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>${imgXml}
  </url>`;
    });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${staticUrls.join('\n')}
${productUrls.join('\n')}
</urlset>
`;
}

// ── Google Merchant Center feed (RSS 2.0 + g: namespace) ──────────────────

// Zones et délais d'expédition : source de vérité = CGV (§6) et
// netlify/functions/create-checkout-session.js (SHIPPING_RATES / EU_COUNTRIES /
// allowed_countries). À garder synchronisé avec ces deux endroits.
const SHIP_HANDLING = { min: 2, max: 5 };               // préparation, jours ouvrés
const SHIP_ZONES = [
  { price: '15.00 EUR', min: 2, max: 3,  countries: ['FR'] },
  { price: '25.00 EUR', min: 5, max: 7,  countries: [
    'AT','BE','BG','HR','CY','CZ','DK','EE','FI','DE','GR','HU','IE','IT','LV','LT',
    'LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','GB','CH','NO'] },
  { price: '55.00 EUR', min: 7, max: 10, countries: ['US','CA','JP','AU','NZ','SG','HK'] },
];
// Retours acceptés (CGV §7) : France métropolitaine + Union européenne, 14 jours,
// frais de renvoi à la charge de l'acheteur.
const RETURN_COUNTRIES = ['FR','AT','BE','BG','HR','CY','CZ','DK','EE','FI','DE','GR',
  'HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'];

// Catégorie produit à partir du type (FR), même logique que getCategory() du SPA.
function productKind(type) {
  const t = String(type || '').toLowerCase();
  // Ordre important : "Echarpe & pochette" est une écharpe, pas un sac.
  if (/étole|etole|foulard|écharpe|echarpe|chèche|cheche|tour de cou/.test(t)) return 'scarf';
  if (/\bsacs?\b|banane|satchel|cabas|pochette|portefeuille|cartable|sacoche|maroquinerie/.test(t)) return 'bag';
  if (/chapeau|bonnet|panama|casquette|\bcap\b|béret|beret/.test(t)) return 'hat';
  if (/ceinture/.test(t)) return 'belt';
  if (/cravate/.test(t)) return 'tie';
  if (/gants?\b|moufles?/.test(t)) return 'gloves';
  if (/bracelet|boucles? d'oreilles|bague|collier|breloque|broche|pendentif|bijou/.test(t)) return 'jewelry';
  if (/botte|boots|basket|ballerine|escarpin|mocassin|derbies|derby|sandale|chaussure|bottine|sneaker|espadrille|tongs?\b/.test(t)) return 'shoes';
  return 'clothing';
}
const GOOGLE_CATEGORY = {
  clothing: 'Apparel & Accessories > Clothing',
  shoes:    'Apparel & Accessories > Shoes',
  bag:      'Apparel & Accessories > Handbags, Wallets & Cases',
  hat:      'Apparel & Accessories > Clothing Accessories > Hats',
  scarf:    'Apparel & Accessories > Clothing Accessories > Scarves & Shawls',
  belt:     'Apparel & Accessories > Clothing Accessories > Belts',
  tie:      'Apparel & Accessories > Clothing Accessories > Neckties',
  gloves:   'Apparel & Accessories > Clothing Accessories > Gloves & Mittens',
  jewelry:  'Apparel & Accessories > Jewelry',
};
const KIND_FR = { clothing: 'Vêtements', shoes: 'Chaussures', bag: 'Sacs', hat: 'Chapeaux',
  scarf: 'Foulards et écharpes', belt: 'Ceintures', tie: 'Cravates', gloves: 'Gants',
  jewelry: 'Bijoux' };

// Taille affichée (FR), alignée sur formatSize() du SPA pour la taille unique.
function sizeFR(size) {
  let s = String(size || '').replace(/\s*International(e|s)?\b\s*/gi, '').trim();
  if (!s || /^(taille\s*unique|one\s*size|tu|os)(\s*fr)?$/i.test(s)) return 'Taille unique';
  return s;
}

// Couleurs harmonisées en français (flux ciblant la France).
const COLOR_FR = {
  black: 'Noir', navy: 'Marine', grey: 'Gris', gray: 'Gris', white: 'Blanc', brown: 'Marron',
  khaki: 'Kaki', blue: 'Bleu', green: 'Vert', yellow: 'Jaune', purple: 'Violet', burgundy: 'Bordeaux',
  red: 'Rouge', pink: 'Rose', silver: 'Argent', gold: 'Or', ecru: 'Écru', multicolour: 'Multicolore',
  multicolor: 'Multicolore', other: 'Autre', beige: 'Beige', camel: 'Camel', orange: 'Orange',
};
function colorFR(c) {
  const k = String(c || '').trim();
  return COLOR_FR[k.toLowerCase()] || k;
}

function xmlesc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildFeed(products, soldIds, imgReorder, imgSuffix, validatedLocal, publishDir) {
  const items = products
    .filter(p => !soldIds.has(p.id) && p.sold !== true) // exclude sold
    .map(p => {
    const link  = 'https://passeist.com/product/' + productSlug(p);
    // Version xl, la même que dans la fiche (Google rattache la photo à la fiche)
    const imgRel = productImgUrl(p, 0, 1600, imgReorder, imgSuffix, validatedLocal, publishDir);
    const img    = imgRel ? (imgRel.startsWith('/') ? 'https://passeist.com' + imgRel : imgRel) : '';

    // Title: same formula as <title> tag minus "— passéist"
    const baseType = p.type.replace(/\s+en\s+.*$/i, '').trim();
    const matInType = p.type.match(/\ben\s+([a-zéèêëàâùûüïîôœæç]+)/i);
    const mat  = matInType
      ? matInType[1].charAt(0).toUpperCase() + matInType[1].slice(1).toLowerCase()
      : extractMaterialFromDesc(p.desc || '');
    const sy       = seasonYear(p.desc || '');
    const gender   = p.gender === 'h' ? 'Homme' : p.gender === 'f' ? 'Femme' : null;
    const parts    = [baseType];
    if (mat)    parts.push(mat);
    if (gender) parts.push(gender);
    if (sy)     parts.push(sy.fr);
    const lineF = lineOf(p);
    const title = xmlesc(p.brand + (lineF ? ' ' + lineF : '') + ' — ' + parts.join(' '));

    const desc        = xmlesc((p.desc || '').replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000) || title);
    const price       = (parseFloat(p.price) || 0).toFixed(2) + ' EUR';
    const genderFeed  = p.gender === 'h' ? 'male' : p.gender === 'f' ? 'female' : 'unisex';
    const color       = xmlesc(colorFR(p.color));
    const kind        = productKind(p.type);
    // Taille obligatoire pour les vêtements et chaussures en France
    const sizeTag     = (kind === 'clothing' || kind === 'shoes')
      ? '\n      <g:size>' + xmlesc(sizeFR(p.size)) + '</g:size>' : '';
    const productType = xmlesc(KIND_FR[kind] + ' > ' + (gender || 'Unisexe') + ' > ' + p.brand);

    // Pas de <g:shipping> dans le flux : la livraison (pays, tarifs, délais) est
    // réglée dans Merchant Center, qui sinon serait écrasé par le flux.

    return `    <item>
      <g:id>${xmlesc(p.id)}</g:id>
      <title>${title}</title>
      <description>${desc}</description>
      <link>${xmlesc(link)}</link>${img ? '\n      <g:image_link>' + xmlesc(img) + '</g:image_link>' : ''}
      <g:price>${price}</g:price>
      <g:availability>in stock</g:availability>
      <g:condition>used</g:condition>
      <g:brand>${xmlesc(p.brand)}</g:brand>
      <g:identifier_exists>no</g:identifier_exists>
      <g:google_product_category>${xmlesc(GOOGLE_CATEGORY[kind])}</g:google_product_category>
      <g:product_type>${productType}</g:product_type>
      <g:gender>${genderFeed}</g:gender>
      <g:age_group>adult</g:age_group>${color ? '\n      <g:color>' + color + '</g:color>' : ''}${sizeTag}
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>passéist — Mode vintage japonaise</title>
    <link>https://passeist.com</link>
    <description>Vêtements vintage japonais archive : Yohji Yamamoto, Comme des Garçons, Issey Miyake</description>
${items}
  </channel>
</rss>`;
}

// ── Pages Auteurs : carrousel "Notre sélection" au format des cartes Boutique ─
// REGLE FIGEE par Tom, voir PHOTOS.md : chaque carte montre la photo 1 de la
// fiche (même fichier, seule la largeur change via srcset), cadre 3:4 blanc,
// contain, coins 6px (styles dans assets/marques.css). Seules les pièces en
// vente sont listées ; le lien ouvre directement la fiche produit.

function normBrand(b) {
  return String(b || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

function brandCardImg(p, imgReorder, imgSuffix, validatedLocal, publishDir) {
  if (!p.n) return { src: '', srcset: '' };
  if (validatedLocal.has(p.id) && fs.existsSync(path.join(publishDir, 'img', p.id + '-0-md.webp'))) {
    const base = '/img/' + p.id + '-0-';
    // sm/md seulement : la version xl est réservée à la fiche (Google Images, PHOTOS.md § 7)
    return { src: base + 'md.webp', srcset: base + 'sm.webp 400w, ' + base + 'md.webp 800w' };
  }
  const reorder = imgReorder[p.id];
  const photoNum = reorder ? reorder[0] : 1;
  const suffix = imgSuffix[p.id] || '_2';
  return {
    src: vestiaireUrl(p, photoNum, 800, suffix),
    srcset: [400, 800, 1600].map(w => vestiaireUrl(p, photoNum, w, suffix) + ' ' + w + 'w').join(', ')
  };
}

function buildBrandCard(p, imgReorder, imgSuffix, validatedLocal, publishDir) {
  const img = brandCardImg(p, imgReorder, imgSuffix, validatedLocal, publishDir);
  const size = sizeFR(p.size);
  const sizeEN = size === 'Taille unique' ? 'One size' : size;
  const gFR = p.gender === 'h' ? 'Homme' : p.gender === 'f' ? 'Femme' : '';
  const gEN = p.gender === 'h' ? 'Men' : p.gender === 'f' ? 'Women' : '';
  const typeEN = p.type_en || p.type;
  return `
        <a class="carousel-card bc-card" href="/product/${esc(productSlug(p))}">
          <div class="bc-img"><img src="${esc(img.src)}" srcset="${esc(img.srcset)}" sizes="200px" alt="${esc(p.brand + ' ' + p.type)}" loading="lazy" decoding="async"></div>
          <div class="bc-body">
            <div class="bc-brand"><span class="bc-brand-name">${esc(p.brand)}</span><span class="bc-price">${esc(p.price)} €</span></div>
            <div class="bc-name"><span class="lang-fr">${esc(p.type)}</span><span class="lang-en">${esc(typeEN)}</span></div>
            <div class="bc-meta"><span class="lang-fr">${esc(size)}${gFR ? ' · ' + gFR : ''}</span><span class="lang-en">${esc(sizeEN)}${gEN ? ' · ' + gEN : ''}</span></div>
          </div>
        </a>`;
}

function buildBrandCarousels(products, soldIds, imgReorder, imgSuffix, validatedLocal, publishDir) {
  const dir = path.join(publishDir, 'marques');
  if (!fs.existsSync(dir)) return 0;
  let updated = 0;
  fs.readdirSync(dir).filter(f => f.endsWith('.html')).forEach(f => {
    const file = path.join(dir, f);
    const html = fs.readFileSync(file, 'utf8');
    const re = /(<div class="carousel"[^>]*>)([\s\S]*?<\/a>\s*)(<\/div>)/;
    const m = html.match(re);
    const brandParam = html.match(/href="\/shop\?brand=([^"&]+)"/);
    if (!m || !brandParam) return;
    const brand = normBrand(decodeURIComponent(brandParam[1]));
    const items = products
      .filter(p => normBrand(p.brand) === brand && !soldIds.has(p.id) && p.sold !== true)
      .slice(0, 24);
    const cards = items.map(p => buildBrandCard(p, imgReorder, imgSuffix, validatedLocal, publishDir)).join('');
    const open = items.length ? '<div class="carousel">' : '<div class="carousel" style="display:none">';
    // Remplacement par fonction : aucun motif "$" des textes produits n'est interprété
    fs.writeFileSync(file, html.replace(re, () => open + cards + '\n      </div>'), 'utf8');
    updated++;
  });
  return updated;
}

// ── SEO : marque lisible, phrase unique par pièce, page Auteur ─────────────

// "COMME DES GARÇONS" -> "Comme des Garçons", "PORTER BY YOSHIDA KABAN" ->
// "Porter by Yoshida Kaban" ; les sigles avec chiffres restent en majuscules.
const SMALL_WORDS = new Set(['des', 'de', 'du', 'by', 'la', 'le', 'les', 'et', 'of', 'the', 'pour']);
function titleCaseBrand(b) {
  return String(b || '').toLowerCase().split(/(\s+)/).map((w, i) => {
    if (/^\s+$/.test(w) || !w) return w;
    if (/\d/.test(w)) return w.toUpperCase();
    if (i > 0 && SMALL_WORDS.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join('');
}

const COLOR_EN = { noir: 'black', marine: 'navy', gris: 'grey', blanc: 'white', marron: 'brown',
  kaki: 'khaki', bleu: 'blue', vert: 'green', jaune: 'yellow', violet: 'purple', bordeaux: 'burgundy',
  rouge: 'red', rose: 'pink', argent: 'silver', or: 'gold', 'écru': 'ecru', multicolore: 'multicolour',
  beige: 'beige', camel: 'camel', orange: 'orange', anthracite: 'charcoal', ivoire: 'ivory', 'métal': 'metal' };

// Phrase d'introduction unique par pièce (FR/EN), générée à partir des données
// (marque, type, saison, matière, couleur, taille, genre). Affichée sur la
// fiche et reprise dans la description Google : du contenu propre à passéist,
// distinct du texte de l'annonce Vestiaire.
function buildIntro(p) {
  const brand = titleCaseBrand(p.brand);
  // "Pull / gilet / sweat" -> "Pull" (types Vestiaire à choix multiples)
  const type = String(p.type || '').split(/\s*\/\s*/)[0].trim();
  const typeLc = type.charAt(0).toLowerCase() + type.slice(1);
  const sy = seasonYear(p.desc || '');
  const matInType = /\ben\s+[a-zéèêëàâùûüïîôœæç]+/i.test(type);
  const mat = matInType ? null : extractMaterialFromDesc(p.desc || '');
  const colFR = p.color ? colorFR(p.color) : '';
  const colOk = colFR && !/^(autre|other)$/i.test(colFR);
  const size = sizeFR(p.size);
  const kind = productKind(p.type);
  const sizeWord = (kind === 'clothing' || kind === 'shoes');
  const gFR = p.gender === 'h' ? 'homme' : p.gender === 'f' ? 'femme' : '';
  const gEN = p.gender === 'h' ? "men's" : p.gender === 'f' ? "women's" : '';

  let fr = `${brand} : ${typeLc} vintage`;
  if (sy) fr += ` de la collection ${sy.fr}`;
  if (mat) fr += `, en ${mat.toLowerCase()}`;
  if (colOk) fr += `, coloris ${colFR.toLowerCase()}`;
  fr += '.';
  if (sizeWord) fr += ` Taille ${size === 'Taille unique' ? 'unique' : size}${gFR ? ', ' + gFR : ''}.`;
  else if (gFR) fr += ` Pour ${gFR}.`;
  fr += ` Pièce d'archive de mode japonaise, sélectionnée et authentifiée par passéist à Paris.`;

  const typeEN = (p.type_en || translateType(type.replace(/\s+en\s+.*$/i, '').trim()) || type);
  const colEN = colOk ? (COLOR_EN[colFR.toLowerCase()] || colFR.toLowerCase()) : '';
  let en = `${brand}: vintage ${gEN ? gEN + ' ' : ''}${String(typeEN).toLowerCase()}`;
  if (sy) en += ` from the ${sy.en} collection`;
  if (mat) en += `, in ${String(translateMaterial(mat) || mat).toLowerCase()}`;
  if (colEN) en += `, ${colEN}`;
  en += '.';
  if (sizeWord) en += size === 'Taille unique' ? ' One size.' : ` Size ${size}.`;
  en += ' Japanese designer archive piece, selected and authenticated by passéist in Paris.';
  return { fr, en };
}

// Page Auteur existante pour la marque ? (marques/<slug>.html)
function brandPageUrl(p, publishDir) {
  const slug = slugify(p.brand);
  return fs.existsSync(path.join(publishDir, 'marques', slug + '.html'))
    ? 'https://passeist.com/marques/' + slug : null;
}

// Coupe proprement un texte à ~max caractères (sur un espace)
function clip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).replace(/[,;:\s]+$/, '') + '…';
}

// ── Apply product-specific SEO to the full HTML string ────────────────────

function applyProductSEO(html, p, sold, imgReorder, imgSuffix, validatedLocal, publishDir) {
  const url  = 'https://passeist.com/product/' + productSlug(p);
  // Version xl : la photo telle qu'affichée dans la fiche (og:image, JSON-LD)
  const img  = productImgUrl(p, 0, 1600, imgReorder, imgSuffix, validatedLocal, publishDir);

  // Extract components
  const baseTypeFR = p.type.replace(/\s+en\s+.*$/i, '').trim();
  const matInType  = p.type.match(/\ben\s+([a-zéèêëàâùûüïîôœæç]+)/i);
  const matFR      = matInType
    ? matInType[1].charAt(0).toUpperCase() + matInType[1].slice(1).toLowerCase()
    : extractMaterialFromDesc(p.desc || '');
  const sy         = seasonYear(p.desc || '');

  // French <title>: BRAND — Type Matière Genre Automne-Hiver 2003 — passéist
  const genderFR = p.gender === 'h' ? 'Homme' : p.gender === 'f' ? 'Femme' : null;
  const partsFR  = [baseTypeFR];
  if (matFR)    partsFR.push(matFR);
  if (genderFR) partsFR.push(genderFR);
  if (sy)       partsFR.push(sy.fr);
  // Titre : les mots que les gens tapent (marque lisible + type + vintage)
  const brandTC = titleCaseBrand(p.brand);
  const line  = lineOf(p);
  const title = brandTC + (line ? ' ' + line : '') + ' ' + p.type + ' vintage' + (sy ? ' ' + sy.fr : '') + ' · passéist';

  // English og:title: BRAND — Material Type Gender Fall-Winter 2003 — passéist
  // Use p.type_en if available (already translated), else fall back to dictionary
  const baseTypeEN = (p.type_en || translateType(baseTypeFR));
  const matEN      = matFR ? translateMaterial(matFR) : null;
  const genderEN   = p.gender === 'h' ? 'Men' : p.gender === 'f' ? 'Women' : null;
  const partsEN    = matEN ? [matEN, baseTypeEN] : [baseTypeEN];
  if (genderEN) partsEN.push(genderEN);
  if (sy)       partsEN.push(sy.en);
  const titleEN = brandTC + (line ? ' ' + line : '') + ' vintage ' + baseTypeEN + (matEN ? ' in ' + matEN.toLowerCase() : '') + (sy ? ' ' + sy.en : '') + ' · passéist';

  // Meta description: brand at top, then raw description text
  const descRaw  = (p.desc || '').replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Description : la phrase unique passéist d'abord (contenu propre au site)
  const intro    = p.intro || buildIntro(p).fr;
  const desc     = clip(intro, 158);
  // Description Google (résultats de recherche seulement, jamais affichée sur
  // le site) : « passéiste » pour que la recherche de ce mot mène à passéist (Tom)
  const DESC_SUF = ' · passéist, boutique passéiste';
  const metaDesc = clip(intro, 158 - DESC_SUF.length) + DESC_SUF;
  const descLong = (intro + (descRaw ? ' ' + descRaw : '')).slice(0, 4900);
  const robots = sold ? 'noindex,nofollow' : 'index,follow';

  // Ensure image URL is absolute for og:image, twitter:image and JSON-LD
  const imgAbs = img ? (img.startsWith('/') ? 'https://passeist.com' + img : img) : '';

  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type':    'Product',
    name:       p.brand + (line ? ' ' + line : '') + ' — ' + p.type,
    brand:      { '@type': 'Brand', name: p.brand },
    image:      imgAbs ? [imgAbs] : undefined,
    description: descLong,
    sku:        p.id,
    color:      p.color ? colorFR(p.color) : undefined,
    size:       sizeFR(p.size),
    offers: {
      '@type':        'Offer',
      priceCurrency:  'EUR',
      price:          p.price,
      availability:   sold ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
      url:            url,
      itemCondition:  'https://schema.org/UsedCondition',
      seller:         { '@type': 'Organization', name: 'Passeist' },
      // Mêmes zones, prix et délais que feed.xml (CGV §6)
      shippingDetails: SHIP_ZONES.map(z => ({
        '@type': 'OfferShippingDetails',
        shippingRate: { '@type': 'MonetaryAmount', value: z.price.split(' ')[0], currency: 'EUR' },
        shippingDestination: z.countries.map(c => ({ '@type': 'DefinedRegion', addressCountry: c })),
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          handlingTime: { '@type': 'QuantitativeValue', minValue: SHIP_HANDLING.min, maxValue: SHIP_HANDLING.max, unitCode: 'DAY' },
          transitTime:  { '@type': 'QuantitativeValue', minValue: z.min, maxValue: z.max, unitCode: 'DAY' }
        }
      })),
      // Politique de retour (CGV §7)
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: RETURN_COUNTRIES,
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: 14,
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility'
      }
    }
  });

  // ── Replace SEO tags (all in <head>) ───────────────────────────────
  html = html.replace(/<title>[\s\S]*?<\/title>/,
    `<title>${esc(title)}</title>`);
  html = html.replace(/<meta\s+name="description"[^>]*>/,
    `<meta name="description" content="${esc(metaDesc)}">`);
  html = html.replace(/<meta\s+name="robots"[^>]*>/,
    `<meta name="robots" content="${robots}">`);
  html = html.replace(/<link\s+rel="canonical"[^>]*>/,
    `<link rel="canonical" href="${url}">`);
  html = html.replace(/<meta\s+property="og:type"[^>]*>/,
    `<meta property="og:type" content="product">`);
  html = html.replace(/<meta\s+property="og:title"[^>]*>/,
    `<meta property="og:title" content="${esc(titleEN)}">`);
  html = html.replace(/<meta\s+property="og:description"[^>]*>/,
    `<meta property="og:description" content="${esc(desc)}">`);
  html = html.replace(/<meta\s+property="og:url"[^>]*>/,
    `<meta property="og:url" content="${url}">`);
  if (imgAbs) html = html.replace(/<meta\s+property="og:image"[^>]*>/,
    `<meta property="og:image" content="${imgAbs}">`);
  html = html.replace(/<meta\s+name="twitter:title"[^>]*>/,
    `<meta name="twitter:title" content="${esc(titleEN)}">`);
  html = html.replace(/<meta\s+name="twitter:description"[^>]*>/,
    `<meta name="twitter:description" content="${esc(desc)}">`);
  if (imgAbs) html = html.replace(/<meta\s+name="twitter:image"[^>]*>/,
    `<meta name="twitter:image" content="${imgAbs}">`);

  // Fil d'Ariane : Accueil > Auteurs > Marque (page Auteur si elle existe,
  // sinon Boutique filtrée) > Pièce
  const brandUrl = brandPageUrl(p, publishDir) || ('https://passeist.com/shop?brand=' + encodeURIComponent(p.brand));
  const crumbs = [{ name: 'passéist', item: 'https://passeist.com/' }];
  if (brandUrl.includes('/marques/')) crumbs.push({ name: 'Auteurs', item: 'https://passeist.com/marques' });
  else crumbs.push({ name: 'Boutique', item: 'https://passeist.com/shop' });
  crumbs.push({ name: brandTC, item: brandUrl });
  crumbs.push({ name: brandTC + ' ' + p.type, item: url });
  const breadcrumb = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.item }))
  });

  // Replace Store JSON-LD with Product JSON-LD (+ fil d'Ariane). data-pid :
  // le SPA ne réécrit pas ces balises à l'arrivée sur la fiche (cf updateSEO).
  html = html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    () => `<script type="application/ld+json" data-seo="product" data-pid="${esc(p.id)}">${jsonld}</script>\n<script type="application/ld+json" data-seo="product" data-pid="${esc(p.id)}">${breadcrumb}</script>`
  );

  // Version anglaise déclarée à Google (même page, ?lang=en)
  html = html.replace(/<link\s+rel="canonical"[^>]*>/, (m) => m +
    `\n<link rel="alternate" hreflang="fr" href="${url}">` +
    `\n<link rel="alternate" hreflang="en" href="${url}?lang=en">` +
    `\n<link rel="alternate" hreflang="x-default" href="${url}">`);

  // ── Pre-populate and open the detail div ───────────────────────────
  const detailStart = html.indexOf('<div class="detail" id="detail">');
  const detailEnd   = html.indexOf('<!-- LIGHTBOX -->');
  if (detailStart !== -1 && detailEnd !== -1) {
    const detailHtml = buildDetailHtml(p, sold, imgReorder, imgSuffix, validatedLocal, publishDir);
    html = html.slice(0, detailStart) + detailHtml + '\n' + html.slice(detailEnd);
  }

  // ── Set body class so layout renders correctly on first paint ──────
  html = html.replace('<body>', '<body class="detail-open">');

  return html;
}

// ── Plugin entry point ─────────────────────────────────────────────────────

module.exports = {
  onPostBuild: async ({ constants, utils }) => {
    const publishDir = constants.PUBLISH_DIR;
    const indexPath  = path.join(publishDir, 'index.html');

    if (!fs.existsSync(indexPath)) {
      return utils.build.failBuild('index.html not found in ' + publishDir);
    }

    const baseHtml = fs.readFileSync(indexPath, 'utf8');

    // ── Extract PRODUCTS ──────────────────────────────────────────────
    const prodMatch = baseHtml.match(/const PRODUCTS = \[([\s\S]*?)\];\s*\n/);
    if (!prodMatch) return utils.build.failBuild('PRODUCTS array not found in index.html');
    let products;
    try { products = JSON.parse('[' + prodMatch[1] + ']'); }
    catch (e) { return utils.build.failBuild('PRODUCTS parse error: ' + e.message); }

    // ── Extract SOLD_IDS ──────────────────────────────────────────────
    const soldMatch = baseHtml.match(/const SOLD_IDS = new Set\(\[([\s\S]*?)\]\)/);
    const soldIds   = new Set();
    if (soldMatch) {
      soldMatch[1].split('\n').forEach(l => {
        const m = l.match(/"([^"]+)"/); if (m) soldIds.add(m[1]);
      });
    }

    // ── Extract IMG_REORDER + IMG_SUFFIX via vm (single quotes + comments) ──
    const imgReorder = {};
    const imgSuffix  = {};
    try {
      const reorderMatch = baseHtml.match(/const IMG_REORDER = (\{[\s\S]*?\});/);
      const suffixMatch  = baseHtml.match(/const IMG_SUFFIX = (\{[\s\S]*?\});/);
      const snippet =
        (reorderMatch ? 'const IMG_REORDER = ' + reorderMatch[1] + ';\n' : 'const IMG_REORDER = {};\n') +
        (suffixMatch  ? 'const IMG_SUFFIX  = ' + suffixMatch[1]  + ';\n' : 'const IMG_SUFFIX  = {};\n');
      const ctx = vm.createContext({});
      vm.runInContext(snippet, ctx);
      Object.assign(imgReorder, ctx.IMG_REORDER || {});
      Object.assign(imgSuffix,  ctx.IMG_SUFFIX  || {});
    } catch (e) {
      console.warn('[generate-product-pages] IMG_REORDER/SUFFIX warning:', e.message);
    }

    // ── Extract VALIDATED_LOCAL ───────────────────────────────────────
    const vlMatch       = baseHtml.match(/const VALIDATED_LOCAL = new Set\(\[([\s\S]*?)\]\)/);
    const validatedLocal = new Set();
    if (vlMatch) {
      vlMatch[1].split('\n').forEach(l => {
        const m = l.match(/"([^"]+)"/); if (m) validatedLocal.add(m[1]);
      });
    }

    // ── Apply IMG_REORDER to product.n (mirrors line 4491 in index.html) ─
    Object.keys(imgReorder).forEach(id => {
      const p = products.find(x => x.id === id);
      if (p) p.n = imgReorder[id].length;
    });

    // ── Photos hébergées sur passeist.com : n = photos réellement présentes ─
    // Une annonce Vestiaire peut annoncer 15 photos alors que les dernières
    // n'existent pas (l'import garde la pièce). Sans ce comptage, la galerie
    // demandait des images introuvables (requêtes inutiles, vignettes vides).
    let trimmed = 0;
    products.forEach(p => {
      if (!p.id || !p.n || !validatedLocal.has(String(p.id)) || imgReorder[p.id]) return;
      let k = 0;
      while (k < p.n && fs.existsSync(path.join(publishDir, 'img', p.id + '-' + k + '-xl.webp'))) k++;
      if (k > 0 && k < p.n) { p.n = k; trimmed++; }
    });
    if (trimmed) console.log('[generate-product-pages] Photos : n ajusté pour ' + trimmed + ' pièces (photos absentes en fin de galerie)');

    // ── Phrase unique par pièce (FR/EN), ajoutée au catalogue ─────────
    products.forEach(p => { const it = buildIntro(p); p.intro = it.fr; p.intro_en = it.en; });
    products.forEach(p => { const e = editionOf(p, false); if (e) { p.edition = e; p.edition_en = editionOf(p, true); } });

    // ── Catalogue externalisé : les 1 300 produits (1,6 Mo) sortent des
    //    pages HTML dans un fichier JS versionné, téléchargé une seule fois
    //    et mis en cache pour tout le site (pages 7x plus légères).
    //    index.html du dépôt reste la source (imports, sync, webhook). ──
    // Le champ « path » (adresse de la fiche chez Vestiaire) ne sert pas au
    // site : Google le lisait comme un lien et tombait sur 723 pages 404.
    const catalogueJs = 'window.__PRODUCTS__=' + JSON.stringify(products.map(({ path: _vc, ...rest }) => rest)) + ';';
    const catHash = require('crypto').createHash('md5').update(catalogueJs).digest('hex').slice(0, 10);
    const catRel = 'data/catalogue.' + catHash + '.js';
    fs.mkdirSync(path.join(publishDir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(publishDir, catRel), catalogueJs, 'utf8');
    const scriptOpen = baseHtml.lastIndexOf('<script>', prodMatch.index);
    let slimHtml = baseHtml;
    if (scriptOpen !== -1) {
      slimHtml = baseHtml.slice(0, scriptOpen) + '<script src="/' + catRel + '"></script>\n' + baseHtml.slice(scriptOpen);
      slimHtml = slimHtml.replace(prodMatch[0], () => 'const PRODUCTS = window.__PRODUCTS__ || [];\n');
    }
    // Accueil : versions FR/EN déclarées (uniquement sur l'accueil ; les
    // fiches produits ont les leurs, cf applyProductSEO)
    const homeHtml = slimHtml.replace(/<link\s+rel="canonical"[^>]*>/, (m) => m +
      '\n<link rel="alternate" hreflang="fr" href="https://passeist.com/">' +
      '\n<link rel="alternate" hreflang="en" href="https://passeist.com/?lang=en">' +
      '\n<link rel="alternate" hreflang="x-default" href="https://passeist.com/">');
    fs.writeFileSync(indexPath, homeHtml, 'utf8');

    // ── Pages Boutique, Vendu, À propos… : leur propre HTML (titre, description,
    //    canonique), au lieu de celui de l'accueil que Google prenait pour un
    //    doublon (« explorée, non indexée »). Le site reste la même appli. ──
    const ROUTES = {
      shop:    ['Boutique · mode japonaise vintage (Yohji Yamamoto, Comme des Garçons, Issey Miyake) · passéist',
                'Toutes les pièces disponibles : vêtements vintage et archive de créateurs japonais, authentifiés à Paris.'],
      archive: ['Pièces vendues · archive de mode japonaise · passéist',
                'Les pièces déjà vendues par passéist : Yohji Yamamoto, Comme des Garçons, Issey Miyake et autres créateurs japonais.'],
      about:   ['À propos · passéist, mode d\'auteur japonaise à Paris',
                'passéist : curation de vêtements vintage de créateurs japonais, sélectionnés et authentifiés à Paris.'],
      contact: ['Contact · passéist', 'Une question sur une pièce, une taille, une commande ? Contactez passéist.'],
      cgv:     ['Conditions générales de vente · passéist', 'Conditions générales de vente de passeist.com.'],
      privacy: ['Confidentialité · passéist', 'Politique de confidentialité et cookies de passeist.com.'],
    };
    const escA = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    for (const [route, [title, desc]] of Object.entries(ROUTES)) {
      const url = 'https://passeist.com/' + route;
      const html = slimHtml
        .replace(/<title>[\s\S]*?<\/title>/, '<title>' + escA(title) + '</title>')
        .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + escA(desc) + '">')
        .replace(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + url + '">')
        .replace(/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + url + '">')
        .replace(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + escA(title) + '">')
        .replace(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + escA(desc) + '">');
      fs.writeFileSync(path.join(publishDir, route + '.html'), html, 'utf8');
    }

    // ── _redirects : pages ci-dessus + anciennes adresses Vestiaire (301 vers
    //    la fiche passéist), avant la règle 404 finale. ──
    const redirPath = path.join(publishDir, '_redirects');
    if (fs.existsSync(redirPath)) {
      let redir = fs.readFileSync(redirPath, 'utf8');
      for (const route of Object.keys(ROUTES)) {
        redir = redir.replace(new RegExp('^/' + route + '(\\s+)/index\\.html(\\s+)200$', 'm'), '/' + route + '$1/' + route + '.html$2200');
      }
      const seen = new Set();
      const vc = products
        .filter(p => p.id && typeof p.path === 'string' && /^\/[^\s]+\.shtml$/.test(p.path))
        .map(p => p.path + '  /product/' + productSlug(p) + '  301')
        .filter(l => { const k = l.split(' ')[0]; if (seen.has(k)) return false; seen.add(k); return true; });
      const block = '# Anciennes adresses Vestiaire lues par Google dans le catalogue → fiche passéist\n' + vc.join('\n') + '\n';
      redir = redir.replace(/^\/\*\s+\/404\.html\s+404\s*$/m, (m) => block + m);
      fs.writeFileSync(redirPath, redir, 'utf8');
      console.log('[generate-product-pages] _redirects : ' + Object.keys(ROUTES).length + ' pages, ' + vc.length + ' adresses Vestiaire redirigées');
    }
    console.log('[generate-product-pages] Catalogue externalisé : /' + catRel + ' (' + Math.round(catalogueJs.length / 1024) + ' Ko), index.html ' + Math.round(baseHtml.length / 1024) + ' -> ' + Math.round(slimHtml.length / 1024) + ' Ko');

    // ── Generate one page per product ─────────────────────────────────
    const productDir = path.join(publishDir, 'product');
    fs.mkdirSync(productDir, { recursive: true });

    let count = 0;
    for (const p of products) {
      if (!p.id) continue;
      const slug = productSlug(p);
      const sold = soldIds.has(p.id) || p.sold === true;
      const page = applyProductSEO(slimHtml, p, sold, imgReorder, imgSuffix, validatedLocal, publishDir);

      // product/<slug>.html (et non product/<slug>/index.html) : Netlify sert
      // /product/<slug> tel quel, sans rediriger vers la version avec « / »
      // final, qui contredisait la canonique (Google tournait en rond).
      fs.writeFileSync(path.join(productDir, slug + '.html'), page, 'utf8');
      count++;
    }

    console.log('[generate-product-pages] Generated ' + count + ' product pages');

    // ── Generate Google Merchant Center feed ──────────────────────────
    const feed = buildFeed(products, soldIds, imgReorder, imgSuffix, validatedLocal, publishDir);
    fs.writeFileSync(path.join(publishDir, 'feed.xml'), feed, 'utf8');
    console.log('[generate-product-pages] Generated feed.xml (' + products.length + ' products)');

    // ── Generate sitemap.xml (replaces the old static, never-updated file) ─
    const sitemap = buildSitemap(products, soldIds, imgReorder, imgSuffix, validatedLocal, publishDir);
    fs.writeFileSync(path.join(publishDir, 'sitemap.xml'), sitemap, 'utf8');
    const sitemapCount = (sitemap.match(/<loc>/g) || []).length;
    console.log('[generate-product-pages] Generated sitemap.xml (' + sitemapCount + ' urls)');

    // ── Pages Auteurs : carrousel "Notre sélection" régénéré à chaque build ─
    const brandPages = buildBrandCarousels(products, soldIds, imgReorder, imgSuffix, validatedLocal, publishDir);
    console.log('[generate-product-pages] Updated brand carousels (' + brandPages + ' pages)');

    utils.status.show({ summary: 'Generated ' + count + ' product pages + feed.xml + sitemap.xml' });
  }
};
