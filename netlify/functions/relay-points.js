// Points relais proches (Mondial Relay + Chronopost, via Boxtal) pour le panier (Tom, 2026-11-12)
// GET /.netlify/functions/relay-points?cp=75011&city=Paris
// 503 { error: 'not_configured' } tant que les clés Boxtal ne sont pas dans Netlify : le panier
// masque alors le choix « Point relais » et garde la livraison à domicile.
const boxtal = require('../lib/boxtal');
const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://passeist.com', 'Cache-Control': 'public, max-age=600' };
exports.handler = async (event) => {
  if (!boxtal.enabled()) return { statusCode: 503, headers: H, body: JSON.stringify({ error: 'not_configured' }) };
  const q = event.queryStringParameters || {};
  if (q.ping) return { statusCode: 200, headers: H, body: JSON.stringify({ ok: true }) };
  const cp = String(q.cp || '').replace(/\s/g, '');
  if (!/^\d{5}$/.test(cp)) return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'cp' }) };
  try {
    const points = await boxtal.searchRelays({ postalCode: cp, city: String(q.city || '').slice(0, 60) });
    return { statusCode: 200, headers: H, body: JSON.stringify({ points }) };
  } catch (e) {
    console.error('relay-points :', e.message);
    return { statusCode: 502, headers: { ...H, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'boxtal' }) };
  }
};
