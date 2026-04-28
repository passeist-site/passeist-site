// Netlify Function — proxy d'image pour bypasser les blocages anti-hotlink.
// Utilisé pour servir à Stripe Checkout les photos produits qui sont
// hébergées sur le CDN Vestiaire (qui retourne 403 sur les requêtes externes).
//
// Usage : /.netlify/functions/img-proxy?url=https%3A%2F%2Fimages.vestiairecollective.com%2F...
//
// Sécurité :
// - whitelist des hosts autorisés (pas de SSRF arbitraire)
// - timeout court
// - cache 24h pour limiter les hits sur Vestiaire
// - rate limit en mémoire (50 req/min/IP) pour éviter le DDoS bandwidth abuse
// - CORS restreint à passeist.com (pas de hotlinking par d'autres sites)

const ALLOWED_HOSTS = new Set([
  'images.vestiairecollective.com',
  'fr-vintage.vestiairecollective.com',
  'us.vestiairecollective.com',
]);

const ALLOWED_ORIGINS = new Set([
  'https://passeist.com',
  'https://www.passeist.com',
]);

// === Rate limiter en mémoire (par-instance Lambda) ===
// Note : chaque instance Netlify Lambda a sa propre mémoire. En cas de scale,
// la limite réelle = 50 req/min × nb d'instances. Suffisant pour stopper un
// abuseur unique. Pour bloquer un attaquant distribué, utiliser un service
// externe (Upstash Redis, Cloudflare WAF…).
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 50;
const _rateBuckets = new Map(); // ip → [timestamps...]

function rateLimitOk(ip) {
  if (!ip) return true; // pas d'IP → on laisse passer (n'arrive jamais sur Netlify)
  const now = Date.now();
  let bucket = _rateBuckets.get(ip);
  if (!bucket) {
    bucket = [];
    _rateBuckets.set(ip, bucket);
  }
  // Purge les anciens timestamps hors fenêtre
  while (bucket.length && bucket[0] < now - RATE_WINDOW_MS) bucket.shift();
  if (bucket.length >= RATE_MAX) return false;
  bucket.push(now);
  // Garbage collect basique : si la map dépasse 1000 IPs, on purge les entrées vides
  if (_rateBuckets.size > 1000) {
    for (const [k, v] of _rateBuckets) {
      while (v.length && v[0] < now - RATE_WINDOW_MS) v.shift();
      if (v.length === 0) _rateBuckets.delete(k);
    }
  }
  return true;
}

function getClientIp(event) {
  // Netlify : x-nf-client-connection-ip (vraie IP côté CDN), sinon x-forwarded-for
  const h = event.headers || {};
  return h['x-nf-client-connection-ip']
      || (h['x-forwarded-for'] || '').split(',')[0].trim()
      || null;
}

function corsOriginFor(event) {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  // Si origin est passeist.com (ou www) → on renvoie le même
  // Sinon → on ne renvoie PAS de header CORS (le navigateur bloque le cross-origin lui-même)
  // Stripe (qui fetch côté serveur, pas via navigateur) ignore CORS de toute façon
  return ALLOWED_ORIGINS.has(origin) ? origin : '';
}

exports.handler = async (event) => {
  const corsOrigin = corsOriginFor(event);
  const corsHeaders = corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {};

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: { ...corsHeaders, 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
      body: '',
    };
  }

  // Rate limit par IP
  const ip = getClientIp(event);
  if (!rateLimitOk(ip)) {
    return {
      statusCode: 429,
      headers: { ...corsHeaders, 'Retry-After': '60' },
      body: 'Too many requests',
    };
  }

  const targetUrl = event.queryStringParameters && event.queryStringParameters.url;
  if (!targetUrl) {
    return { statusCode: 400, headers: corsHeaders, body: 'Missing ?url= parameter' };
  }
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders, body: 'Invalid URL' };
  }
  if (parsed.protocol !== 'https:') {
    return { statusCode: 400, headers: corsHeaders, body: 'Only https URLs allowed' };
  }
  if (!ALLOWED_HOSTS.has(parsed.host)) {
    return { statusCode: 403, headers: corsHeaders, body: 'Host not in allowlist' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PasseistImgProxy/1.0)',
        'Accept': 'image/jpeg,image/png,image/webp,image/*,*/*;q=0.8',
        // Pas de Referer pour éviter le blocage anti-hotlink
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { statusCode: 502, headers: corsHeaders, body: 'Upstream returned ' + response.status };
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return { statusCode: 502, headers: corsHeaders, body: 'Upstream not an image' };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Limite 5 MB pour éviter les abus
    if (buffer.length > 5 * 1024 * 1024) {
      return { statusCode: 413, headers: corsHeaders, body: 'Image too large' };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
        ...corsHeaders,
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error('img-proxy error:', err.message);
    return { statusCode: 502, headers: corsHeaders, body: 'Fetch failed: ' + err.message };
  }
};
