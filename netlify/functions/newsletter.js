// Netlify Function — inscription à la newsletter « nouvelles pièces ».
//
//   POST {email, lang}  → enregistre l'adresse
//
// Les adresses sont gardées dans Netlify Blobs (store « passeist-newsletter »,
// clés sub/<empreinte>) et, dès que BREVO_API_KEY est défini, ajoutées à la
// liste Brevo qui envoie les e-mails (cf. newsletter-send.js, qui rattrape
// aussi les inscriptions faites avant la mise en place de Brevo).
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const { addToBrevo } = require('../lib/brevo');

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

exports.handler = async (event) => {
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
