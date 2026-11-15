// Rattrapage automatique Boxtal (Tom, 2026-11-15), chaque heure : toute commande payée
// en point relais / à domicile qui n'a pas encore de vrai envoi Boxtal (passée en mode
// « à blanc », ou notification Stripe perdue) reçoit son envoi, et Tom son bordereau.
// Seulement les commandes depuis le 15 novembre 2026 (mise en service) : les ventes
// d'avant ont été expédiées à la main, il ne faut pas leur recréer d'étiquette.
const { getStore, connectLambda } = require('@netlify/blobs');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const boxtal = require('../lib/boxtal');
const { shipSession } = require('../lib/boxtal-ship');
const PRODUCTS = require('./products.json');

const SINCE = Date.parse('2026-11-15T00:00:00Z') / 1000;

exports.handler = async (event) => {
  if (!boxtal.enabled() || !boxtal.live()) return { statusCode: 200, body: 'off' };
  try { connectLambda(event); } catch (e) {}
  const store = getStore('passeist-orders');
  const since = Math.max(SINCE, Math.floor(Date.now() / 1000) - 14 * 86400);
  const done = [];
  for await (const s of stripe.checkout.sessions.list({ created: { gte: since }, limit: 100 })) {
    const md = s.metadata || {};
    if (!s.livemode || s.payment_status !== 'paid') continue;
    if (md.ship_mode !== 'relay' && md.ship_mode !== 'home') continue;
    const prev = await store.get('boxtal/' + s.id, { type: 'json' });
    if (prev && prev.id) continue;                           // vrai envoi déjà créé
    if (prev && prev.error && prev.tries >= 3) continue;     // refusé 3 fois : Tom a eu les e-mails d'erreur
    const full = await stripe.checkout.sessions.retrieve(s.id);
    const r = await shipSession({ session: full, store, PRODUCTS, force: true });
    if (r.error) await store.setJSON('boxtal/' + s.id, { error: r.error, tries: ((prev && prev.tries) || 0) + 1, at: new Date().toISOString() });
    done.push(s.id + ' ' + JSON.stringify(r));
  }
  console.log('rattrapage Boxtal :', done.length ? done.join(' | ') : 'rien à faire');
  return { statusCode: 200, body: 'ok' };
};
