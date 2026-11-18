// Notifications Boxtal (Tom, 2026-11-12)
//   DOCUMENT_CREATED → bordereau envoyé par e-mail à Tom (ORDER_NOTIFY_EMAIL)
//   TRACKING_CHANGED → lien de suivi envoyé une fois au client, et numéro de suivi
//                      enregistré sur le paiement Stripe (Paiements → la commande → Livraison)
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
      // Dernier état du colis, à chaque mise à jour (messagerie « Suivi des ventes », Tom 2026-11-18)
      try {
        const evs = t.events || t.trackingEvents || t.history || [];
        const lastEv = Array.isArray(evs) && evs.length ? evs[evs.length - 1] : {};
        await store.setJSON('boxtal-status/' + ev.shippingOrderId, {
          status: String(t.status || t.packageStatus || (ev.payload && ev.payload.status) || lastEv.status || lastEv.code || ''),
          label: String(t.statusLabel || t.label || lastEv.label || lastEv.description || ''),
          number: t.trackingNumber || '', url: t.packageTrackingUrl || '', carrier: t.carrierName || t.carrier || '',
          at: new Date().toISOString(), raw: JSON.stringify(t).slice(0, 1500) });
      } catch (e) { console.error('état colis :', e.message); }
      if (t.packageTrackingUrl && !(await done('boxtal-track/' + ev.shippingOrderId))) {
        const info = await store.get('boxtal-order/' + ev.shippingOrderId, { type: 'json' });
        // Numéro de suivi sur le paiement Stripe (visible dans le tableau de bord, et sur le reçu)
        if (info && info.session && process.env.STRIPE_SECRET_KEY) {
          try {
            const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
            const ses = await stripe.checkout.sessions.retrieve(info.session);
            const sd = ses.shipping_details || (ses.collected_information || {}).shipping_details || {};
            const cd = ses.customer_details || {};
            const a = sd.address || cd.address || {};
            if (ses.payment_intent) await stripe.paymentIntents.update(ses.payment_intent, { shipping: {
              name: sd.name || cd.name || 'Client', phone: cd.phone || undefined,
              address: { line1: a.line1 || '', line2: a.line2 || undefined, city: a.city || '', postal_code: a.postal_code || '', country: a.country || 'FR' },
              carrier: t.carrierName || t.carrier || 'Boxtal', tracking_number: t.trackingNumber || '' } });
          } catch (e) { console.error('suivi Stripe :', e.message); }
        }
        if (info && info.session && process.env.STRIPE_SECRET_KEY) {
          const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
          const ses = await stripe.checkout.sessions.retrieve(info.session);
          if ((ses.customer_details || {}).email) await require('../lib/ship-email').sendShipEmail({ stripe, session: ses,
            carrier: t.carrierName || t.carrier || 'Mondial Relay', number: t.trackingNumber || '', url: t.packageTrackingUrl });
        }
      }
    }
  } catch (e) { console.error('boxtal-webhook :', e.message); return { statusCode: 500, body: 'err' }; }
  return { statusCode: 200, body: 'ok' };
};
