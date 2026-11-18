// Messagerie, « Suivi des ventes » (Tom, 2026-11-18) : les dernières ventes Stripe et l'état de
// leur colis (Boxtal : dernier état reçu ; envoi à la main : numéro et lien de suivi). Accès réservé.
const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getStore, connectLambda } = require('@netlify/blobs');

const json = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
function isAdmin(event) {
  const key = process.env.CHAT_ADMIN_KEY || '';
  const given = (event.headers && event.headers['x-admin-key']) || '';
  if (!key || given.length !== key.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
}
const TRACK = {
  mondial: n => 'https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=' + encodeURIComponent(n),
  colissimo: n => 'https://www.laposte.fr/outils/suivre-vos-envois?code=' + encodeURIComponent(n),
  poste: n => 'https://www.laposte.fr/outils/suivre-vos-envois?code=' + encodeURIComponent(n),
  chrono: n => 'https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=' + encodeURIComponent(n),
  ups: n => 'https://www.ups.com/track?tracknum=' + encodeURIComponent(n),
  dhl: n => 'https://www.dhl.com/fr-fr/home/suivi.html?tracking-id=' + encodeURIComponent(n),
};
const trackUrl = (carrier, n) => { const k = Object.keys(TRACK).find(k => String(carrier || '').toLowerCase().includes(k)); return k && n ? TRACK[k](n) : ''; };

// État Boxtal → étape lisible
function step(st) {
  const s = (String(st.status || '') + ' ' + String(st.label || '')).toUpperCase();
  if (/DELIVERED|LIVR|DISTRIBU|REMIS/.test(s)) return { key: 'delivered', text: 'Livré' };
  if (/PICKUP|RELAY|RELAIS|AVAILABLE|DISPONIBLE|RETRAIT/.test(s)) return { key: 'pickup', text: 'Au point relais' };
  if (/RETURN|RETOUR|FAIL|ECHEC|ÉCHEC|INCIDENT|ANOMAL|LOST|PERDU/.test(s)) return { key: 'problem', text: 'Problème' };
  if (/OUT_FOR|EN COURS DE LIVRAISON|TOURN/.test(s)) return { key: 'out', text: 'En livraison' };
  if (/TRANSIT|SHIPPED|EXPEDI|ACHEMIN|PRIS EN CHARGE|DEPOSIT|DÉPOS/.test(s)) return { key: 'transit', text: 'En route' };
  if (/ANNOUNCED|PENDING|CREATED|ANNONC|PREPAR/.test(s)) return { key: 'label', text: 'Bordereau créé' };
  return { key: 'transit', text: st.label || st.status || 'Suivi reçu' };
}

let REFS = {}; try { REFS = require('./refs.json'); } catch (e) {}
const VC = 'https://fr.vestiairecollective.com';
function delist(ids) {
  return ids.map(id => {
    const r = REFS[id] || {};
    const q = new URLSearchParams({ search_text: ((r.b || '') + ' ' + String(r.t || '').replace(/\s+en\s+.*$/i, '')).trim().toLowerCase() });
    return { id, label: [r.b, r.t].filter(Boolean).join(' · ') || id,
      vestiaire: r.vc ? VC + (r.vc.startsWith('/') ? r.vc : '/' + r.vc) : '',
      vinted: r.vt ? 'https://www.vinted.fr/items/' + r.vt : 'https://www.vinted.fr/catalog?' + q.toString(), vintedExact: !!r.vt };
  });
}

exports.handler = async (event) => {
  if (!isAdmin(event)) return json(401, { error: 'unauthorized' });
  try { connectLambda(event); } catch (e) {}
  const store = getStore('passeist-orders');
  const q = event.queryStringParameters || {};

  // Pièce citée dans une discussion : photo et fiche
  if (q.piece) {
    const id = String(q.piece).replace(/\D/g, '');
    const r = REFS[id];
    if (!r) return json(404, { error: 'pièce inconnue' });
    return json(200, { id, title: [r.b, r.t].filter(Boolean).join(' · '), img: '/img/' + id + '-0-md.webp', url: '/product/' + (r.s || id) });
  }
  // « Annonces retirées » cochées par Tom
  if (event.httpMethod === 'POST') {
    let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (e) {}
    if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(String(b.session || ''))) return json(400, { error: 'session' });
    if (b.done) await store.setJSON('delisted/' + b.session, { at: new Date().toISOString() });
    else await store.delete('delisted/' + b.session);
    return json(200, { ok: true });
  }

  const r = await stripe.checkout.sessions.list({ limit: 60, expand: ['data.payment_intent'] });
  const all = r.data.filter(s => s.payment_status === 'paid' && s.livemode);
  const paid = all.slice(0, 25);
  // Chiffres du mois (heure de Paris approximée par l'UTC du serveur)
  const now = new Date(); const m0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000;
  const p0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1) / 1000;
  const sum = arr => arr.reduce((t, s) => t + (s.amount_total || 0) / 100, 0);
  const month = all.filter(s => s.created >= m0), prev = all.filter(s => s.created >= p0 && s.created < m0);
  const stats = { month: { total: sum(month), count: month.length }, prev: { total: sum(prev), count: prev.length, partial: all.length >= 60 } };
  const out = await Promise.all(paid.map(async s => {
    const pi = s.payment_intent && typeof s.payment_intent === 'object' ? s.payment_intent : {};
    const sd = s.shipping_details || (s.collected_information || {}).shipping_details || {};
    const a = sd.address || (s.customer_details || {}).address || {};
    const md = s.metadata || {};
    const what = String(pi.description || '').split(' · ')[0];
    let st = null, bx = null;
    try { bx = await store.get('boxtal/' + s.id, { type: 'json' }); } catch (e) {}
    if (bx && bx.id) { try { st = await store.get('boxtal-status/' + bx.id, { type: 'json' }); } catch (e) {} }
    const ship = pi.shipping || {};
    let state;
    if (st) state = { ...step(st), at: st.at };
    else if (ship.tracking_number) state = { key: 'transit', text: 'Expédié' };
    else if (bx && bx.id) state = { key: 'label', text: 'Bordereau créé' };
    else if (bx && bx.pending) state = { key: 'todo', text: 'Bordereau à créer' };
    else state = { key: 'todo', text: 'À expédier' };
    const number = (st && st.number) || ship.tracking_number || '';
    const carrier = (st && st.carrier) || ship.carrier || '';
    const ids = (md.passeist_ids || '').split(',').filter(Boolean);
    let delisted = null; try { delisted = await store.get('delisted/' + s.id, { type: 'json' }); } catch (e) {}
    const boxtal = require('../lib/boxtal');
    const canLabel = boxtal.enabled() && boxtal.shippable(s) && !(bx && bx.id) && !ship.tracking_number;
    return {
      id: s.id, email: (s.customer_details || {}).email || '',
      link: canLabel ? require('../lib/boxtal-ship').validateUrl(s.id) : '',
      delist: delist(ids), delisted: !!delisted,
      at: s.created * 1000, name: (s.customer_details || {}).name || sd.name || '', what,
      where: md.ship_mode === 'relay' ? 'Point relais' + (md.relay_name ? ' ' + md.relay_name : '') : [a.city, a.country].filter(Boolean).join(', '),
      amount: (s.amount_total || 0) / 100, state, carrier, number,
      url: (st && st.url) || trackUrl(carrier, number),
    };
  }));
  return json(200, { orders: out, stats });
};
