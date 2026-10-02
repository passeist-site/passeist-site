// Netlify Function — inscription à la newsletter « nouvelles pièces ».
//
//   POST {email, lang}  → enregistre l'adresse
// Messagerie de passéist (en-tête x-admin-key = CHAT_ADMIN_KEY) :
//   GET  ?action=stats          → abonnés, pièces en attente d'annonce
//   POST ?action=test {to}      → envoie l'e-mail de nouveautés à cette adresse
//   POST ?action=feature {text} → pièces « À la une » du prochain envoi (liens ou références)
//
// Les adresses sont gardées dans Netlify Blobs (store « passeist-newsletter »,
// clés sub/<empreinte>) et, dès que BREVO_API_KEY est défini, ajoutées à la
// liste Brevo qui envoie les e-mails (cf. newsletter-send.js, qui rattrape
// aussi les inscriptions faites avant la mise en place de Brevo).
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const brevo = require('../lib/brevo');
const { addToBrevo } = brevo;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Limite par adresse IP (mémoire de l'instance) : 5 inscriptions / 10 min
const HITS = new Map();
function rateOk(ip) {
  const now = Date.now();
  const list = (HITS.get(ip) || []).filter(t => t > now - 10 * 60 * 1000);
  if (list.length >= 5) return false;
  list.push(now);
  HITS.set(ip, list);
  if (HITS.size > 1000) HITS.clear();
  return true;
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

function isAdmin(event) {
  const key = process.env.CHAT_ADMIN_KEY || '';
  const given = (event.headers && event.headers['x-admin-key']) || '';
  if (!key || given.length !== key.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
}

// Mots de passe ratés : 5 par 15 min et par adresse, comme la messagerie
const FAILS = new Map();
async function admin(event, action) {
  const h = event.headers || {};
  const ip = h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || '?';
  const now = Date.now();
  const fails = (FAILS.get(ip) || []).filter(t => t > now - 15 * 60 * 1000);
  if (fails.length >= 5) return json(429, { error: 'too many attempts' });
  if (!isAdmin(event)) {
    fails.push(now); FAILS.set(ip, fails); if (FAILS.size > 1000) FAILS.clear();
    return json(401, { error: 'unauthorized' });
  }
  connectLambda(event);
  const store = getStore('passeist-newsletter');
  const send = require('./newsletter-send');
  const PRODUCTS = require('./products.json');
  const seenList = await store.get('state/seen', { type: 'json' });
  const seen = new Set(Array.isArray(seenList) ? seenList : Object.keys(PRODUCTS));
  const fresh = Object.keys(PRODUCTS).filter(id => !seen.has(id));
  const featuredList = async () => {
    const f = await store.get('state/featured', { type: 'json' });
    return (f && Array.isArray(f.ids) ? f.ids : []).filter(id => PRODUCTS[id])
      .map(id => ({ id, label: PRODUCTS[id].brand + ' · ' + PRODUCTS[id].type + ' · ' + PRODUCTS[id].price + ' €' }));
  };
  if (action === 'feature' && event.httpMethod === 'POST') {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) {}
    // Références ou liens produit (…-71642530) : on garde les pièces en vente
    const ids = [...new Set((String(body.text || '').match(/\d{7,}/g) || []))].filter(id => PRODUCTS[id]).slice(0, 12);
    if (ids.length) await store.setJSON('state/featured', { ids, at: new Date().toISOString() });
    else await store.delete('state/featured');
    return json(200, { featured: await featuredList() });
  }
  if (action === 'note' && event.httpMethod === 'POST') {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) {}
    const text = String(body.text || '').trim().slice(0, 600);
    if (text) await store.setJSON('state/note', { text, at: new Date().toISOString() });
    else await store.delete('state/note');
    return json(200, { ok: true });
  }
  if (action === 'approve' && event.httpMethod === 'POST') {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) {}
    if (body.approve) await store.setJSON('state/approved', { date: send._nextSendDate(), at: new Date().toISOString() });
    else await store.delete('state/approved');
    return json(200, { ok: true });
  }
  if (action === 'stats') {
    const { blobs } = await store.list({ prefix: 'sub/' });
    const subs = (await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })))).filter(Boolean);
    subs.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return json(200, {
      brevo: brevo.enabled(), batch: send._BATCH, fresh: fresh.length, composed: send._composed(), featured: await featuredList(),
      nextDate: send._nextSendDate(),
      note: ((await store.get('state/note', { type: 'json' })) || {}).text || '',
      approved: !!((await store.get('state/approved', { type: 'json' })) || {}).date && ((await store.get('state/approved', { type: 'json' })) || {}).date === send._nextSendDate(),
      count: subs.length, pending: subs.filter(x => !x.synced).length,
      subs: subs.slice(0, 200).map(x => ({ email: x.email, lang: x.lang, at: x.at })),
    });
  }
  if (action === 'preview') {
    // Aperçu à l'écran (messagerie) : exactement l'e-mail de dimanche
    const ids = (fresh.length ? fresh : Object.keys(PRODUCTS)).slice(0, 40);
    const featured = await send._featuredItems(store);
    const featIds = new Set(featured.map(f => f.id));
    const groups = await send._groupsFor(ids.filter(id => !featIds.has(id)));
    const note = ((await store.get('state/note', { type: 'json' })) || {}).text || '';
    return json(200, { html: send._buildHtml('fr', groups, ids.length, featured, note).replace('{{ unsubscribe }}', '#') });
  }
  if (action === 'test' && event.httpMethod === 'POST') {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) {}
    const to = String(body.to || '').trim();
    if (!EMAIL_RE.test(to)) return json(400, { error: 'adresse invalide' });
    if (!brevo.enabled()) return json(400, { error: 'clé Brevo absente' });
    // Les nouveautés en attente, ou à défaut les dernières pièces du catalogue
    const ids = (fresh.length ? fresh : Object.keys(PRODUCTS)).slice(0, 40);
    const featured = await send._featuredItems(store);
    const featIds = new Set(featured.map(f => f.id));
    const groups = await send._groupsFor(ids.filter(id => !featIds.has(id)));
    const html = send._buildHtml('fr', groups, ids.length, featured, ((await store.get('state/note', { type: 'json' })) || {}).text || '').replace('{{ unsubscribe }}', 'https://passeist.com/');
    try {
      await brevo.sendOne({ to, subject: '[Test] ' + (send._composed() && send._edition().subject ? send._edition().subject.fr : 'Cette semaine chez passéist'), html });
    } catch (err) {
      console.error('test newsletter :', err.message);
      return json(502, { error: err.message.slice(0, 200) });
    }
    return json(200, { ok: true, pieces: ids.length });
  }
  return json(400, { error: 'unknown action' });
}

exports.handler = async (event) => {
  const action = (event.queryStringParameters || {}).action;
  if (action) {
    try { return await admin(event, action); }
    catch (err) { console.error('newsletter admin :', err.message); return json(500, { error: 'server' }); }
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'method' });
  const h = event.headers || {};
  const ip = h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || '?';
  if (!rateOk(ip)) return json(429, { error: 'too many' });
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'bad json' }); }
  const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  const lang = body.lang === 'en' ? 'en' : 'fr';
  if (!EMAIL_RE.test(email)) return json(400, { error: 'invalid' });

  try {
    connectLambda(event);
    const store = getStore('passeist-newsletter');
    const key = 'sub/' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 32);
    const sub = { email, lang, at: new Date().toISOString(), synced: false };
    try { sub.synced = await addToBrevo(email, lang); } catch (err) { console.error('brevo :', err.message); }
    await store.setJSON(key, sub);
    return json(200, { ok: true });
  } catch (err) {
    console.error('newsletter :', err.message);
    return json(500, { error: 'server' });
  }
};
