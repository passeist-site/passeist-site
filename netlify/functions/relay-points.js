// Points relais proches (Mondial Relay + Chronopost, via Boxtal) pour le panier (Tom, 2026-11-12)
// GET /.netlify/functions/relay-points?cp=75011&city=Paris&number=5&street=rue%20Jules%20Vall%C3%A8s
// 503 { error: 'not_configured' } tant que les clés Boxtal ne sont pas dans Netlify : le panier
// masque alors le choix « Point relais » et garde la livraison à domicile.
const boxtal = require('../lib/boxtal');
const { getStore, connectLambda } = require('@netlify/blobs');
const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://passeist.com', 'Cache-Control': 'public, max-age=600' };
exports.handler = async (event) => {
  if (!boxtal.enabled()) return { statusCode: 503, headers: H, body: JSON.stringify({ error: 'not_configured' }) };
  const q = event.queryStringParameters || {};
  if (q.ping) {
    // Abonnements Boxtal (bordereau prêt, suivi) créés automatiquement la première fois
    try {
      connectLambda(event);
      const store = getStore('passeist-orders');
      if (process.env.BOXTAL_WEBHOOK_SECRET && !(await store.get('boxtal-subs-v1'))) {
        const url = (process.env.URL || 'https://passeist.com') + '/.netlify/functions/boxtal-webhook';
        const have = ((await boxtal.subscriptions()).content || []).filter(x => x.callbackUrl === url).map(x => x.eventType);
        for (const t of ['DOCUMENT_CREATED', 'TRACKING_CHANGED']) if (!have.includes(t)) await boxtal.subscribe(t, url, process.env.BOXTAL_WEBHOOK_SECRET);
        await store.setJSON('boxtal-subs-v1', { at: new Date().toISOString(), url });
        console.log('✓ Abonnements Boxtal créés :', url);
      }
    } catch (e) { console.error('Abonnements Boxtal :', e.message); }
    return { statusCode: 200, headers: { ...H, 'Cache-Control': 'no-store' }, body: JSON.stringify({ ok: true }) };
  }
  const cp = String(q.cp || '').replace(/\s/g, '');
  if (!/^\d{5}$/.test(cp)) return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'cp' }) };
  try {
    // Adresse complète si donnée (points les plus proches de chez soi), sinon le code postal seul
    const points = await boxtal.searchRelays({ postalCode: cp, city: String(q.city || '').slice(0, 60), street: String(q.street || '').slice(0, 120), number: String(q.number || '').slice(0, 10) });
    return { statusCode: 200, headers: H, body: JSON.stringify({ points }) };
  } catch (e) {
    console.error('relay-points :', e.message);
    return { statusCode: 502, headers: { ...H, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'boxtal' }) };
  }
};
