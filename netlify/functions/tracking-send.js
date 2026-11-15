// Messagerie, « Envoyer un suivi » (Tom, 2026-11-15) : pour une commande expédiée à la main,
// envoie au client son numéro et son lien de suivi, et l'enregistre sur le paiement Stripe.
// Commande retrouvée par sa référence (cs_live_…, P-XXXXXXXX de l'e-mail de confirmation)
// ou par l'e-mail du client (sa dernière commande payée). Accès réservé (x-admin-key).
const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const brevo = require('../lib/brevo');

const json = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const esc = t => String(t || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
function isAdmin(event) {
  const key = process.env.CHAT_ADMIN_KEY || '';
  const given = (event.headers && event.headers['x-admin-key']) || '';
  if (!key || given.length !== key.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
}
// Lien de suivi selon le transporteur
const CARRIERS = {
  mondialrelay: { label: 'Mondial Relay', url: n => 'https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=' + encodeURIComponent(n) },
  colissimo: { label: 'Colissimo', url: n => 'https://www.laposte.fr/outils/suivre-vos-envois?code=' + encodeURIComponent(n) },
  chronopost: { label: 'Chronopost', url: n => 'https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=' + encodeURIComponent(n) },
  ups: { label: 'UPS', url: n => 'https://www.ups.com/track?tracknum=' + encodeURIComponent(n) },
  dhl: { label: 'DHL', url: n => 'https://www.dhl.com/fr-fr/home/suivi.html?tracking-id=' + encodeURIComponent(n) },
};

async function findSession(q) {
  q = String(q || '').trim();
  const cs = q.match(/cs_(live|test)_[A-Za-z0-9]+/);
  if (cs) return stripe.checkout.sessions.retrieve(cs[0]);
  const list = [];
  if (/@/.test(q)) {
    const r = await stripe.checkout.sessions.list({ customer_details: { email: q.toLowerCase() }, limit: 20 });
    list.push(...r.data);
  } else {
    // Référence P-XXXXXXXX de l'e-mail de confirmation = 8 derniers caractères de la session
    const ref = q.replace(/^P-/i, '').toLowerCase();
    if (ref.length < 6) return null;
    for await (const s of stripe.checkout.sessions.list({ limit: 100 })) {
      if (s.id.toLowerCase().endsWith(ref)) { list.push(s); break; }
      if (list.length || (Date.now() / 1000 - s.created) > 90 * 86400) break;
    }
  }
  return list.filter(s => s.payment_status === 'paid').sort((a, b) => b.created - a.created)[0] || null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method' });
  if (!isAdmin(event)) return json(401, { error: 'unauthorized' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (e) {}
  const number = String(b.number || '').trim().replace(/\s+/g, '');
  const carrier = CARRIERS[b.carrier] || null;
  if (!/^[A-Za-z0-9-]{6,40}$/.test(number)) return json(400, { error: 'numéro de suivi invalide' });
  if (!carrier) return json(400, { error: 'transporteur inconnu' });
  let ses;
  try { ses = await findSession(b.order); } catch (e) { return json(400, { error: 'Stripe : ' + String(e.message).slice(0, 120) }); }
  if (!ses) return json(404, { error: 'commande introuvable (référence cs_live_…, P-XXXXXXXX ou e-mail du client)' });
  const cd = ses.customer_details || {};
  if (!cd.email) return json(400, { error: 'pas d’e-mail client sur cette commande' });
  const ref = 'P-' + ses.id.slice(-8).toUpperCase();
  const who = { name: cd.name || '', email: cd.email, ref, date: new Date(ses.created * 1000).toISOString().slice(0, 10) };
  if (!b.confirm) return json(200, { preview: true, ...who });   // 1er appui : on montre à qui ça part
  const url = carrier.url(number);
  const en = String(ses.locale || '').startsWith('en');
  const first = String(cd.name || '').trim().split(/\s+/)[0] || '';
  await brevo.sendOne({ to: cd.email, subject: en ? 'Your passéist order is on its way' : 'Votre commande passéist est en route',
    html: (en ? `Hello${first ? ' ' + esc(first) : ''},<br><br>Your order ${ref} has been shipped with ${carrier.label}. Follow it here: `
              : `Bonjour${first ? ' ' + esc(first) : ''},<br><br>Votre commande ${ref} est partie par ${carrier.label}. Vous pouvez la suivre ici : `)
      + `<a href="${esc(url)}">${esc(number)}</a><br><br>passéist` });
  // Numéro de suivi sur le paiement Stripe
  try {
    const sd = ses.shipping_details || (ses.collected_information || {}).shipping_details || {};
    const a = sd.address || cd.address || {};
    if (ses.payment_intent) await stripe.paymentIntents.update(ses.payment_intent, { shipping: {
      name: sd.name || cd.name || 'Client', phone: cd.phone || undefined,
      address: { line1: a.line1 || '', line2: a.line2 || undefined, city: a.city || '', postal_code: a.postal_code || '', country: a.country || 'FR' },
      carrier: carrier.label, tracking_number: number } });
  } catch (e) { console.error('suivi Stripe :', e.message); }
  return json(200, { ok: true, ...who, carrier: carrier.label });
};
