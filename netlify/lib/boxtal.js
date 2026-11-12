// Boxtal API v3 : points relais, commande d'envoi, étiquettes, suivi (Tom, 2026-11-12)
//
// Variables d'environnement Netlify (aucune valeur dans le dépôt, qui est public) :
//   BOXTAL_ACCESS_KEY / BOXTAL_SECRET_KEY  clés de l'application API v3 (espace développeurs Boxtal)
//   BOXTAL_SANDBOX=1        utiliser l'environnement de test api.boxtal.build
//   BOXTAL_LIVE=1           créer de vrais envois ; sinon mode « à blanc » : Tom reçoit par e-mail
//                           ce qui aurait été commandé, rien n'est commandé chez Boxtal
//   BOXTAL_SENDER           expéditeur, JSON :
//                           {"firstName","lastName","email","phone":"+33…","street","number","city","postalCode"}
//   BOXTAL_DROPOFF_MONR     code du point relais Mondial Relay où Tom dépose ses colis
//   BOXTAL_DROPOFF_CHRP     idem pour Chronopost (si dépôt en relais)
//   BOXTAL_OFFER_MONR       offre relais Mondial Relay (défaut MONR-CpourToi)
//   BOXTAL_OFFER_CHRP       offre relais Chronopost (défaut CHRP-Chrono2ShopDirect, à vérifier)
//   BOXTAL_OFFER_HOME       offre domicile (défaut POFR-ColissimoAccess)
//   BOXTAL_WEBHOOK_SECRET   secret des notifications Boxtal (étiquette créée, suivi)
//   ORDER_NOTIFY_EMAIL      où envoyer les bordereaux (défaut info@passeist.com)

const BASE = process.env.BOXTAL_SANDBOX === '1' ? 'https://api.boxtal.build' : 'https://api.boxtal.com';

function enabled() { return !!(process.env.BOXTAL_ACCESS_KEY && process.env.BOXTAL_SECRET_KEY); }
function live() { return process.env.BOXTAL_LIVE === '1'; }

// Réseaux relais proposés au client et offre Boxtal correspondante
const NETWORKS = {
  MONR: { label: 'Mondial Relay', offer: () => process.env.BOXTAL_OFFER_MONR || 'MONR-CpourToi', dropoff: () => process.env.BOXTAL_DROPOFF_MONR || '' },
  CHRP: { label: 'Chronopost', offer: () => process.env.BOXTAL_OFFER_CHRP || 'CHRP-Chrono2ShopDirect', dropoff: () => process.env.BOXTAL_DROPOFF_CHRP || '' },
};
const homeOffer = () => process.env.BOXTAL_OFFER_HOME || 'POFR-ColissimoAccess';

let token = null; // { value, exp } gardé entre deux appels d'une même fonction
async function auth() {
  if (token && token.exp > Date.now() + 60000) return token.value;
  const basic = Buffer.from(process.env.BOXTAL_ACCESS_KEY + ':' + process.env.BOXTAL_SECRET_KEY).toString('base64');
  const r = await fetch(BASE + '/iam/account-app/token', { method: 'POST', headers: { Authorization: 'Basic ' + basic, Accept: 'application/json' } });
  if (!r.ok) throw new Error('Boxtal token ' + r.status + ' ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  token = { value: j.accessToken, exp: Date.now() + (j.expiresIn || 600) * 1000 };
  return token.value;
}

async function call(path, method = 'GET', body, query) {
  const url = new URL(BASE + path);
  if (query) Object.entries(query).forEach(([k, v]) => {
    if (v === undefined || v === '') return;
    (Array.isArray(v) ? v : [v]).forEach(x => url.searchParams.append(k, x));
  });
  const r = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + (await auth()), Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let j; try { j = txt ? JSON.parse(txt) : {}; } catch (e) { j = { raw: txt }; }
  if (!r.ok) { const err = new Error('Boxtal ' + method + ' ' + path + ' ' + r.status + ' ' + txt.slice(0, 500)); err.status = r.status; err.body = j; throw err; }
  return j;
}

// Points relais proches d'un code postal (France), Mondial Relay et Chronopost
async function searchRelays({ postalCode, city, street, number, networks }) {
  const nets = (networks && networks.length ? networks : Object.keys(NETWORKS)).filter(n => NETWORKS[n]);
  const j = await call('/shipping/v3.1/parcel-point', 'GET', null, { countryIsoCode: 'FR', postalCode, city, street, number, searchNetworks: nets });
  return (j.content || []).map(x => {
    const p = x.parcelPoint || x.parcelpoint || {}; const l = p.location || {};
    return {
      code: p.code, name: p.name, network: p.network, networkLabel: (NETWORKS[p.network] || {}).label || p.network,
      street: [l.number, l.street].filter(Boolean).join(' '), postalCode: l.postalCode, city: l.city,
      distance: x.distanceFromSearchLocation, openingDays: p.openingDays || null,
    };
  }).filter(p => p.code && (p.status === undefined || p.status !== 'UNAVAILABLE')).slice(0, 12);
}

// Poids déclaré (Tom) : petite pièce 499 g, grosse pièce 999 g (manteaux, vestes épaisses, chaussures, sacs)
const HEAVY = /manteau|parka|trench|caban|doudoune|blouson|veste|chaussure|botte|bottine|sneaker|basket|mocassin|derby|sandale|escarpin|sac|cabas|valise/i;
function weightKg(types) { return Math.round(types.reduce((g, t) => g + (HEAVY.test(t || '') ? 999 : 499), 0)) / 1000; }

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/);
  return { firstName: parts.slice(0, -1).join(' ') || parts[0] || 'Client', lastName: parts.length > 1 ? parts[parts.length - 1] : (parts[0] || 'Client') };
}

// Corps de la commande Boxtal à partir d'une session Stripe payée
function buildOrder({ session, types, valueEur }) {
  const md = session.metadata || {};
  const sender = JSON.parse(process.env.BOXTAL_SENDER || '{}');
  const ship = session.shipping_details || session.collected_information?.shipping_details || {};
  const cust = session.customer_details || {};
  const addr = ship.address || cust.address || {};
  const nm = splitName(ship.name || cust.name);
  const mode = md.ship_mode;
  const net = NETWORKS[md.relay_network] || NETWORKS.MONR;
  const shipment = {
    externalId: session.id,
    packages: [{ type: 'PARCEL', externalId: session.id, value: { value: Math.max(1, Math.round(valueEur)), currency: 'EUR' },
      weight: weightKg(types), length: 35, width: 25, height: 8, content: { id: 'content:v1:40110', description: 'Vêtements' } }],
    fromAddress: { type: 'BUSINESS', contact: { firstName: sender.firstName, lastName: sender.lastName, email: sender.email, phone: sender.phone, company: 'passéist' },
      location: { number: sender.number, street: sender.street, city: sender.city, postalCode: sender.postalCode, countryIsoCode: 'FR' } },
    toAddress: { type: 'RESIDENTIAL', contact: { firstName: nm.firstName, lastName: nm.lastName, email: cust.email || '', phone: cust.phone || sender.phone },
      location: { street: [addr.line1, addr.line2].filter(Boolean).join(', '), city: addr.city, postalCode: addr.postal_code, countryIsoCode: addr.country || 'FR' } },
  };
  let offer = homeOffer();
  if (mode === 'relay') {
    offer = net.offer();
    shipment.pickupPointCode = md.relay_code;
    if (net.dropoff()) shipment.dropOffPointCode = net.dropoff();
  }
  return { shippingOfferCode: offer, labelType: 'PDF_A4', insured: false, shipment };
}

async function createOrder(body) { return call('/shipping/v3.1/shipping-order', 'POST', body); }
async function documents(id) { return call(`/shipping/v3.1/shipping-order/${encodeURIComponent(id)}/shipping-document`); }
async function subscriptions() { return call('/shipping/v3.1/subscription'); }
async function subscribe(eventType, callbackUrl, webhookSecret) { return call('/shipping/v3.1/subscription', 'POST', { eventType, callbackUrl, webhookSecret }); }

// Signature des notifications Boxtal : HMAC-SHA256 du corps brut, en hexadécimal (en-tête x-bxt-signature)
function verify(rawBody, signature) {
  const crypto = require('crypto');
  const secret = process.env.BOXTAL_WEBHOOK_SECRET || '';
  if (!secret || !signature) return false;
  const exp = crypto.createHmac('sha256', secret).update(rawBody).digest();
  let got; try { got = Buffer.from(String(signature).trim(), 'hex'); } catch (e) { return false; }
  return got.length === exp.length && crypto.timingSafeEqual(got, exp);
}

module.exports = { enabled, live, NETWORKS, searchRelays, weightKg, buildOrder, createOrder, documents, subscriptions, subscribe, verify, BASE };
