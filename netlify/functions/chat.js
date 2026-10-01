// Netlify Function — messagerie en direct de passeist.com (remplace Tawk).
//
// Côté client (public) :
//   POST ?action=send  {conv, text, email?, product?}  → message du visiteur
//   GET  ?action=poll&conv=ID&since=TS                → messages depuis TS
// Côté passéist (en-tête x-admin-key = CHAT_ADMIN_KEY) :
//   GET  ?action=list                                 → conversations
//   GET  ?action=get&conv=ID                          → une conversation
//   POST ?action=reply     {conv, text}               → réponse de passéist
//   POST ?action=subscribe {subscription}             → notifications du téléphone
//   POST ?action=delete    {conv}                     → supprime une conversation
//
// Stockage : Netlify Blobs, store « passeist-chat » (conv/<id>, push/<hash>).
// Notifications : Web Push (clés VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
// L'identifiant de conversation est un jeton aléatoire tiré par le navigateur
// du visiteur : seul lui (et passéist) peut lire la conversation.
const crypto = require('crypto');
const webpush = require('web-push');
const { getStore, connectLambda } = require('@netlify/blobs');
const clientPush = require('../lib/push');

const MAX_TEXT = 1500;
const MAX_MESSAGES = 300;
const CONV_RE = /^[a-z0-9]{16,40}$/i;

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

// Essais de mot de passe ratés (par adresse, mémoire de l'instance) :
// au-delà de 5 en 15 minutes, l'accès est bloqué un moment.
const FAILS = new Map();
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_MAX = 5;
function clientIp(event) {
  const h = event.headers || {};
  return h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || '?';
}
function tooManyFails(ip) {
  const now = Date.now();
  const list = (FAILS.get(ip) || []).filter(t => t > now - FAIL_WINDOW_MS);
  FAILS.set(ip, list);
  return list.length >= FAIL_MAX;
}
function recordFail(ip) {
  const list = FAILS.get(ip) || [];
  list.push(Date.now());
  FAILS.set(ip, list);
  if (FAILS.size > 1000) FAILS.clear();
}

// Messages des visiteurs : au plus 10 par minute et par adresse (anti-spam des
// notifications du téléphone).
const SENDS = new Map();
function sendOk(ip) {
  const now = Date.now();
  const list = (SENDS.get(ip) || []).filter(t => t > now - 60 * 1000);
  if (list.length >= 10) return false;
  list.push(now);
  SENDS.set(ip, list);
  if (SENDS.size > 1000) SENDS.clear();
  return true;
}

function clean(s, max) {
  return String(s || '').replace(/\r/g, '').trim().slice(0, max);
}

async function notifyPhone(store, conv, text) {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return [{ error: 'clés VAPID absentes' }];
  webpush.setVapidDetails('mailto:info@passeist.com', pub, priv);
  const payload = JSON.stringify({
    title: 'passéist · ' + (conv.name || 'nouveau message'),
    body: (conv.product ? conv.product + ' · ' : '') + text.slice(0, 140),
    url: '/messagerie/#' + conv.id,
    tag: conv.id,
  });
  const { blobs } = await store.list({ prefix: 'push/' });
  return Promise.all(blobs.map(async (b) => {
    const sub = await store.get(b.key, { type: 'json' });
    if (!sub) return { error: 'abonnement vide' };
    const host = (() => { try { return new URL(sub.endpoint).host; } catch (e) { return '?'; } })();
    try {
      const r = await webpush.sendNotification(sub, payload, { TTL: 3600, urgency: 'high' });
      return { host, status: (r && r.statusCode) || 201 };
    } catch (err) {
      // Abonnement expiré (téléphone réinitialisé, notifications coupées)
      if (err.statusCode === 404 || err.statusCode === 410) await store.delete(b.key);
      console.error('push :', err.statusCode || err.message, err.body || '');
      return { host, status: err.statusCode || 0, error: String(err.body || err.message).slice(0, 200) };
    }
  }));
}

exports.handler = async (event) => {
  let store;
  try {
    connectLambda(event);
    store = getStore('passeist-chat');
  } catch (err) {
    console.error('chat store :', err.message);
    return json(503, { error: 'unavailable' });
  }
  const q = event.queryStringParameters || {};
  const action = q.action || '';
  let body = {};
  if (event.httpMethod === 'POST') {
    try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'bad json' }); }
  }

  try {
    // ---------- Visiteur ----------
    if (action === 'send' && event.httpMethod === 'POST') {
      const id = String(body.conv || '');
      const text = clean(body.text, MAX_TEXT);
      if (!CONV_RE.test(id) || !text) return json(400, { error: 'invalid' });
      if (!sendOk(clientIp(event))) return json(429, { error: 'too many messages' });
      const now = Date.now();
      const conv = (await store.get('conv/' + id, { type: 'json' })) || {
        id, createdAt: now, messages: [], name: '', email: '', product: '',
      };
      if (conv.messages.length >= MAX_MESSAGES) return json(429, { error: 'too many messages' });
      // Prénom : jamais une phrase (visiteur qui a tapé sa question dans le
      // champ prénom, par ex. depuis une ancienne version de la page restée ouverte)
      const name = clean(body.name, 60);
      const looksLikeMessage = /[?!.,:]/.test(name) || name.split(/\s+/).length > 3 || name.length > 30;
      if (name && !looksLikeMessage) conv.name = name;
      const email = clean(body.email, 200);
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) conv.email = email;
      const product = clean(body.product, 200);
      if (product) conv.product = product;
      conv.messages.push({ from: 'client', text, at: now });
      conv.updatedAt = now;
      conv.unread = (conv.unread || 0) + 1;
      await store.setJSON('conv/' + id, conv);
      try { await notifyPhone(store, conv, text); } catch (err) { console.error('notify :', err.message); }
      return json(200, { ok: true, at: now });
    }

    if (action === 'poll') {
      const id = String(q.conv || '');
      if (!CONV_RE.test(id)) return json(400, { error: 'invalid' });
      const conv = await store.get('conv/' + id, { type: 'json' });
      const since = Number(q.since) || 0;
      const messages = conv ? conv.messages.filter(m => m.at > since) : [];
      return json(200, { messages });
    }

    // ---------- passéist ----------
    const ip = clientIp(event);
    if (tooManyFails(ip)) return json(429, { error: 'too many attempts' });
    if (!isAdmin(event)) { recordFail(ip); return json(401, { error: 'unauthorized' }); }

    if (action === 'list') {
      const { blobs } = await store.list({ prefix: 'conv/' });
      const convs = (await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })))).filter(Boolean);
      convs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return json(200, {
        convs: convs.slice(0, 100).map(c => {
          const last = c.messages[c.messages.length - 1] || {};
          return { id: c.id, updatedAt: c.updatedAt, name: c.name || '', email: c.email, product: c.product,
                   unread: c.unread || 0, last: String(last.text || '').slice(0, 120), lastFrom: last.from };
        }),
      });
    }

    if (action === 'get') {
      const id = String(q.conv || '');
      if (!CONV_RE.test(id)) return json(400, { error: 'invalid' });
      const conv = await store.get('conv/' + id, { type: 'json' });
      if (!conv) return json(404, { error: 'not found' });
      if (conv.unread) { conv.unread = 0; await store.setJSON('conv/' + id, conv); }
      return json(200, { conv });
    }

    if (action === 'reply' && event.httpMethod === 'POST') {
      const id = String(body.conv || '');
      const text = clean(body.text, MAX_TEXT);
      if (!CONV_RE.test(id) || !text) return json(400, { error: 'invalid' });
      const conv = await store.get('conv/' + id, { type: 'json' });
      if (!conv) return json(404, { error: 'not found' });
      const now = Date.now();
      conv.messages.push({ from: 'passeist', text, at: now });
      conv.updatedAt = now;
      conv.unread = 0;
      await store.setJSON('conv/' + id, conv);
      // Le client a demandé à être prévenu de la réponse : notification
      try {
        if (clientPush.ready()) {
          const ps = getStore(clientPush.STORE);
          const hashes = (await ps.get('byconv/' + id, { type: 'json' })) || [];
          await Promise.all(hashes.map(h => clientPush.send(ps, h, (rec) => ({
            title: rec.lang === 'en' ? 'passéist replied' : 'passéist vous a répondu',
            body: text.slice(0, 140), url: '/?chat=1', tag: 'chat-' + id,
          }))));
        }
      } catch (err) { console.error('push client :', err.message); }
      return json(200, { ok: true, at: now });
    }

    if (action === 'delete' && event.httpMethod === 'POST') {
      const id = String(body.conv || '');
      if (!CONV_RE.test(id)) return json(400, { error: 'invalid' });
      await store.delete('conv/' + id);
      return json(200, { ok: true });
    }

    if (action === 'testpush' && event.httpMethod === 'POST') {
      const results = await notifyPhone(store, { id: 'test' }, 'Test : les notifications fonctionnent.');
      return json(200, { devices: results.length, results });
    }

    if (action === 'subscribe' && event.httpMethod === 'POST') {
      const sub = body.subscription;
      if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) return json(400, { error: 'invalid' });
      const key = 'push/' + crypto.createHash('sha256').update(sub.endpoint).digest('hex').slice(0, 32);
      await store.setJSON(key, sub);
      return json(200, { ok: true });
    }

    return json(400, { error: 'unknown action' });
  } catch (err) {
    console.error('chat :', err.message);
    return json(500, { error: 'server' });
  }
};
