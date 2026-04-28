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

const ALLOWED_HOSTS = new Set([
  'images.vestiairecollective.com',
  'fr-vintage.vestiairecollective.com',
  'us.vestiairecollective.com',
]);

exports.handler = async (event) => {
  const targetUrl = event.queryStringParameters && event.queryStringParameters.url;
  if (!targetUrl) {
    return { statusCode: 400, body: 'Missing ?url= parameter' };
  }
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid URL' };
  }
  if (parsed.protocol !== 'https:') {
    return { statusCode: 400, body: 'Only https URLs allowed' };
  }
  if (!ALLOWED_HOSTS.has(parsed.host)) {
    return { statusCode: 403, body: 'Host not in allowlist' };
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
      return { statusCode: 502, body: 'Upstream returned ' + response.status };
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return { statusCode: 502, body: 'Upstream not an image' };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Limite 5 MB pour éviter les abus
    if (buffer.length > 5 * 1024 * 1024) {
      return { statusCode: 413, body: 'Image too large' };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
        'Access-Control-Allow-Origin': '*',
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error('img-proxy error:', err.message);
    return { statusCode: 502, body: 'Fetch failed: ' + err.message };
  }
};
