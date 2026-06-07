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

  const mainHtml = `<img class="main-photo" src="${photos[0]}" data-idx="0" loading="eager" decoding="async" alt="${esc(p.type)} photo 1" onerror="this.style.display='none'">`;

  const thumbsHtml = photos.slice(1).map((src, idx) => {
    const i = idx + 1;
    return `<div class="thumb" data-idx="${i}"><img src="${src}" loading="lazy" decoding="async" alt="${esc(p.type)} photo ${i + 1}" onerror="this.parentElement.remove()"></div>`;
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
  const text = desc.replace(/\s+/g, ' ');

  const seasons = [
    { re: /\b(?:automne[\s\-]*hiver|fall[\s\-]*winter)\b/i,           fr: 'Automne-Hiver', en: 'Fall-Winter' },
    { re: /\b(?:printemps[\s\-]*[eé]t[eé]|spring[\s\-]*summer)\b/i,  fr: 'Printemps-Été', en: 'Spring-Summer' },
    { re: /\bautomne\b/i,    fr: 'Automne',  en: 'Fall'   },
    { re: /\bhiver\b/i,      fr: 'Hiver',    en: 'Winter' },
    { re: /\bprintemps\b/i,  fr: 'Printemps',en: 'Spring' },
    { re: /\b[eé]t[eé]\b/i, fr: 'Été',      en: 'Summer' },
  ];

  const yearMatch = text.match(/\b(19[6-9]\d|20[0-2]\d)\b/);
  if (!yearMatch) return null;
  const year = yearMatch[1];

  const pos = yearMatch.index;
  const win = text.slice(Math.max(0, pos - 40), pos + 44);
  for (const s of seasons) {
    if (s.re.test(win)) return { fr: s.fr + ' ' + year, en: s.en + ' ' + year };
  }
  return { fr: year, en: year };
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

// ── Google Merchant Center feed (RSS 2.0 + g: namespace) ──────────────────

function xmlesc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildFeed(products, soldIds, imgReorder, imgSuffix, validatedLocal, publishDir) {
  const items = products
    .filter(p => !soldIds.has(p.id) && p.sold !== true) // exclude sold
    .filter(p => validatedLocal.has(p.id))               // only local images (Vestiaire CDN → 403, blocked by Google)
    .map(p => {
    const link  = 'https://passeist.com/product/' + productSlug(p);
    const imgRel = productImgUrl(p, 0, 800, imgReorder, imgSuffix, validatedLocal, publishDir);
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
    const title = xmlesc(p.brand + ' — ' + parts.join(' '));

    const desc  = xmlesc((p.desc || '').replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000) || title);
    const price = (parseFloat(p.price) || 0).toFixed(2) + ' EUR';
    const avail = 'in stock';

    return `    <item>
      <g:id>${xmlesc(p.id)}</g:id>
      <title>${title}</title>
      <description>${desc}</description>
      <link>${xmlesc(link)}</link>${img ? '\n      <g:image_link>' + xmlesc(img) + '</g:image_link>' : ''}
      <g:price>${price}</g:price>
      <g:availability>${avail}</g:availability>
      <g:condition>used</g:condition>
      <g:brand>${xmlesc(p.brand)}</g:brand>
      <g:target_country>FR</g:target_country>
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

// ── Apply product-specific SEO to the full HTML string ────────────────────

function applyProductSEO(html, p, sold, imgReorder, imgSuffix, validatedLocal, publishDir) {
  const url  = 'https://passeist.com/product/' + productSlug(p);
  const img  = productImgUrl(p, 0, 800, imgReorder, imgSuffix, validatedLocal, publishDir);

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
  const title = p.brand + ' — ' + partsFR.join(' ') + ' — passéist';

  // English og:title: BRAND — Material Type Gender Fall-Winter 2003 — passéist
  // Use p.type_en if available (already translated), else fall back to dictionary
  const baseTypeEN = (p.type_en || translateType(baseTypeFR));
  const matEN      = matFR ? translateMaterial(matFR) : null;
  const genderEN   = p.gender === 'h' ? 'Men' : p.gender === 'f' ? 'Women' : null;
  const partsEN    = matEN ? [matEN, baseTypeEN] : [baseTypeEN];
  if (genderEN) partsEN.push(genderEN);
  if (sy)       partsEN.push(sy.en);
  const titleEN = p.brand + ' — ' + partsEN.join(' ') + ' — passéist';

  // Meta description: brand at top, then raw description text
  const descRaw  = (p.desc || '').replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
  const descFull = p.brand + ' — ' + partsFR.join(' ') + (descRaw ? '. ' + descRaw : '');
  const desc     = descFull.slice(0, 160) || ('Pièce vintage japonais ' + p.brand + ' — ' + p.type + '. Archive mode authentifiée par Passéist.');
  const robots = sold ? 'noindex,nofollow' : 'index,follow';

  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type':    'Product',
    name:       p.brand + ' — ' + p.type,
    brand:      { '@type': 'Brand', name: p.brand },
    image:      img,
    description: desc,
    sku:        p.id,
    offers: {
      '@type':        'Offer',
      priceCurrency:  'EUR',
      price:          p.price,
      availability:   sold ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
      url:            url,
      itemCondition:  'https://schema.org/UsedCondition',
      seller:         { '@type': 'Organization', name: 'Passeist' }
    }
  });

  // ── Replace SEO tags (all in <head>) ───────────────────────────────
  html = html.replace(/<title>[\s\S]*?<\/title>/,
    `<title>${esc(title)}</title>`);
  html = html.replace(/<meta\s+name="description"[^>]*>/,
    `<meta name="description" content="${esc(desc)}">`);
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
  if (img) html = html.replace(/<meta\s+property="og:image"[^>]*>/,
    `<meta property="og:image" content="${img}">`);
  html = html.replace(/<meta\s+name="twitter:title"[^>]*>/,
    `<meta name="twitter:title" content="${esc(titleEN)}">`);
  html = html.replace(/<meta\s+name="twitter:description"[^>]*>/,
    `<meta name="twitter:description" content="${esc(desc)}">`);
  if (img) html = html.replace(/<meta\s+name="twitter:image"[^>]*>/,
    `<meta name="twitter:image" content="${img}">`);

  // Replace Store JSON-LD with Product JSON-LD
  html = html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    `<script type="application/ld+json" data-seo="product">${jsonld}</script>`
  );

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

    // ── Generate one page per product ─────────────────────────────────
    const productDir = path.join(publishDir, 'product');
    fs.mkdirSync(productDir, { recursive: true });

    let count = 0;
    for (const p of products) {
      if (!p.id) continue;
      const slug = productSlug(p);
      const sold = soldIds.has(p.id) || p.sold === true;
      const page = applyProductSEO(baseHtml, p, sold, imgReorder, imgSuffix, validatedLocal, publishDir);

      const dir = path.join(productDir, slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), page, 'utf8');
      count++;
    }

    console.log('[generate-product-pages] Generated ' + count + ' product pages');

    // ── Generate Google Merchant Center feed ──────────────────────────
    const feed = buildFeed(products, soldIds, imgReorder, imgSuffix, validatedLocal, publishDir);
    fs.writeFileSync(path.join(publishDir, 'feed.xml'), feed, 'utf8');
    console.log('[generate-product-pages] Generated feed.xml (' + products.length + ' products)');

    utils.status.show({ summary: 'Generated ' + count + ' product pages + feed.xml' });
  }
};
