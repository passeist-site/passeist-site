// Bouton « Bordereau Boxtal » de la messagerie (Tom, 2026-11-15) : crée l'envoi Boxtal
// d'une commande déjà payée (référence Stripe cs_live_…), par ex. passée en mode à blanc.
// Accès réservé (en-tête x-admin-key = CHAT_ADMIN_KEY). Exige BOXTAL_LIVE=1.
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const boxtal = require('../lib/boxtal');
const { shipSession } = require('../lib/boxtal-ship');
const PRODUCTS = require('./products.json');

const json = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
function isAdmin(event) {
  const key = process.env.CHAT_ADMIN_KEY || '';
  const given = (event.headers && event.headers['x-admin-key']) || '';
  if (!key || given.length !== key.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method' });
  if (!isAdmin(event)) return json(401, { error: 'unauthorized' });
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}
  const id = String(body.session || '').trim().match(/cs_(live|test)_[A-Za-z0-9]+/);
  if (!id) return json(400, { error: 'référence de commande introuvable (cs_live_…)' });
  if (!boxtal.enabled()) return json(400, { error: 'clés Boxtal absentes' });
  if (!boxtal.live()) return json(400, { error: 'mode réel pas activé (BOXTAL_LIVE=1 sur Netlify)' });
  let session;
  try { session = await stripe.checkout.sessions.retrieve(id[0]); }
  catch (e) { return json(400, { error: 'commande Stripe introuvable : ' + String(e.message).slice(0, 120) }); }
  if (session.payment_status !== 'paid') return json(400, { error: 'commande non payée' });
  const md = session.metadata || {};
  if (md.ship_mode !== 'relay' && md.ship_mode !== 'home') return json(400, { error: 'commande sans livraison relais ou domicile' });
  try { connectLambda(event); } catch (e) {}
  const r = await shipSession({ session, store: getStore('passeist-orders'), PRODUCTS, force: true });
  if (r.error) return json(502, { error: 'Boxtal : ' + r.error });
  if (r.already) return json(200, { ok: true, already: true, id: r.id });
  return json(200, { ok: true, id: r.id, status: r.status });
};
