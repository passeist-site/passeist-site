// Notifications Boxtal (Tom, 2026-11-12)
//   DOCUMENT_CREATED → bordereau envoyé par e-mail à Tom (ORDER_NOTIFY_EMAIL)
//   TRACKING_CHANGED → lien de suivi envoyé une fois au client
// Signature vérifiée (x-bxt-signature, HMAC-SHA256 avec BOXTAL_WEBHOOK_SECRET).
// Abonnement : POST /.netlify/functions/boxtal-webhook?setup=1 avec l'en-tête x-admin-key (CHAT_ADMIN_KEY).
const { getStore, connectLambda } = require('@netlify/blobs');
const boxtal = require('../lib/boxtal');
const brevo = require('../lib/brevo');
const esc = t => String(t || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');

  // Création des deux abonnements (une seule fois, par Tom ou Claude)
  if ((event.queryStringParameters || {}).setup === '1') {
    const key = process.env.CHAT_ADMIN_KEY || '';
    if (!key || event.headers['x-admin-key'] !== key) return { statusCode: 401, body: 'admin' };
    if (!boxtal.enabled() || !process.env.BOXTAL_WEBHOOK_SECRET) return { statusCode: 503, body: 'BOXTAL_ACCESS_KEY / BOXTAL_SECRET_KEY / BOXTAL_WEBHOOK_SECRET manquants' };
    const url = (process.env.URL || 'https://passeist.com') + '/.netlify/functions/boxtal-webhook';
    const have = ((await boxtal.subscriptions()).content || []).filter(s => s.callbackUrl === url).map(s => s.eventType);
    const made = [];
    for (const t of ['DOCUMENT_CREATED', 'TRACKING_CHANGED']) if (!have.includes(t)) { await boxtal.subscribe(t, url, process.env.BOXTAL_WEBHOOK_SECRET); made.push(t); }
    return { statusCode: 200, body: JSON.stringify({ url, existing: have, created: made }) };
  }

  if (!boxtal.verify(raw, event.headers['x-bxt-signature'])) return { statusCode: 401, body: 'signature' };
  let ev; try { ev = JSON.parse(raw); } catch (e) { return { statusCode: 400, body: 'json' }; }
  connectLambda(event);
  const store = getStore('passeist-orders');
  const done = async k => { if (await store.get(k)) return true; await store.setJSON(k, { at: new Date().toISOString() }); return false; };

  try {
    if (ev.type === 'DOCUMENT_CREATED') {
      if (await done('boxtal-doc/' + ev.id)) return { statusCode: 200, body: 'dup' };
      const docs = (ev.payload && ev.payload.documents) || [];
      const links = docs.map(d => `<a href="${esc(d.url)}">${esc(d.type)} (${esc(d.format)})</a>`).join('<br>');
      await brevo.sendOne({ to: process.env.ORDER_NOTIFY_EMAIL || 'info@passeist.com', subject: 'Bordereau prêt — ' + (ev.shipmentExternalId || ev.shippingOrderId),
        html: `Le bordereau de la commande ${esc(ev.shipmentExternalId)} est prêt :<br>${links}<br><br>À imprimer, coller sur le colis et déposer.` });
    } else if (ev.type === 'TRACKING_CHANGED') {
      const t = ((ev.payload && ev.payload.trackings) || [])[0] || {};
      if (t.packageTrackingUrl && !(await done('boxtal-track/' + ev.shippingOrderId))) {
        const info = await store.get('boxtal-order/' + ev.shippingOrderId, { type: 'json' });
        if (info && info.email) {
          const en = info.lang === 'en';
          await brevo.sendOne({ to: info.email, subject: en ? 'Your passéist order is on its way' : 'Votre commande passéist est en route',
            html: (en ? 'Hello,<br><br>Your parcel has been shipped. Follow it here: ' : 'Bonjour,<br><br>Votre colis est parti. Vous pouvez le suivre ici : ')
              + `<a href="${esc(t.packageTrackingUrl)}">${esc(t.trackingNumber || (en ? 'tracking' : 'suivi'))}</a><br><br>passéist` });
        }
      }
    }
  } catch (e) { console.error('boxtal-webhook :', e.message); return { statusCode: 500, body: 'err' }; }
  return { statusCode: 200, body: 'ok' };
};
