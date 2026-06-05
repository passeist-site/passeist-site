/**
 * Netlify Edge Function — product-seo.js
 * Injecte les meta tags SEO (title, description, JSON-LD) dans les pages /product/*
 * sans générer de fichiers statiques. Fonctionne à la volée sur le CDN edge.
 */

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export default async (request, context) => {
  const url = new URL(request.url);

  // Extraire l'ID depuis le slug (/product/brand-type-ID)
  const slug = url.pathname.replace(/^\/product\//, '').replace(/\/$/, '');
  const idMatch = slug.match(/(\d{7,9})$/);
  if (!idMatch) return context.next();
  const id = idMatch[1];

  // Charger les données SEO
  let product = null;
  try {
    const dataUrl = new URL('/data/products-seo.json', url.origin);
    const resp = await fetch(dataUrl.toString());
    if (resp.ok) {
      const products = await resp.json();
      product = products.find(p => p.id === id);
    }
  } catch (e) {
    // En cas d'erreur, servir la page normale
    return context.next();
  }

  // Récupérer la réponse originale (index.html via _redirects)
  const response = await context.next();
  if (!product) return response;

  const html = await response.text();

  // Construction des meta tags
  const typeStr = product.type || '';
  const colorStr = product.color ? ` ${product.color}` : '';
  const sizeStr = product.size ? ` — ${product.size}` : '';
  const title = `${product.brand} — ${typeStr}${colorStr}${sizeStr} — passéist`;
  const descFallback = `${product.brand} ${typeStr}${colorStr}. ${product.price}€. Mode japonaise vintage archive.`;
  const desc = (product.desc || descFallback).slice(0, 160);
  const img = `https://passeist.com/img/${id}-0-xl.webp`;
  const canonical = `https://passeist.com/product/${slug}`;
  const isSold = product.sold;

  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    'name': `${product.brand} ${typeStr}`,
    'brand': { '@type': 'Brand', 'name': product.brand },
    'description': desc,
    'image': img,
    'offers': {
      '@type': 'Offer',
      'price': product.price,
      'priceCurrency': 'EUR',
      'availability': isSold
        ? 'https://schema.org/OutOfStock'
        : 'https://schema.org/InStock',
      'url': canonical,
      'seller': { '@type': 'Organization', 'name': 'passéist' }
    }
  });

  const inject = `
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(desc)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="product">
  <meta property="og:title" content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(desc)}">
  <meta property="og:image" content="${img}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:site_name" content="passéist">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escHtml(title)}">
  <meta name="twitter:image" content="${img}">
  ${isSold ? '<meta name="robots" content="noindex, follow">' : ''}
  <script type="application/ld+json">${jsonld}</script>`;

  // Remplacer les tags génériques + injecter les spécifiques au produit
  let modified = html
    // Supprimer title, description, og:* génériques pour éviter les doublons
    .replace(/<title>[^<]*<\/title>/, '')
    .replace(/<meta\s+name="description"[^>]*>/i, '')
    .replace(/<link\s+rel="canonical"[^>]*>/i, '')
    .replace(/<meta\s+property="og:title"[^>]*>/i, '')
    .replace(/<meta\s+property="og:description"[^>]*>/i, '')
    .replace(/<meta\s+property="og:url"[^>]*>/i, '')
    .replace(/<meta\s+property="og:type"[^>]*>/i, '')
    .replace(/<meta\s+property="og:image"[^>]*>/i, '');
  // Injecter juste après <head> pour être en premier
  modified = modified.replace('<head>', '<head>\n' + inject);

  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.delete('content-length'); // longueur a changé

  return new Response(modified, { status: response.status, headers });
};

export const config = { path: '/product/*' };
