// Netlify Function — abonnement des clients aux notifications du site.
//   GET  ?action=key                                   → clé publique VAPID
//   POST ?action=subscribe   {subscription, news, conv, lang}
//        news : nouveautés de la semaine ; conv : prévenir de la réponse de passéist
//   POST ?action=unsubscribe {endpoint}
const { getStore, connectLambda } = require('@netlify/blobs');
const push = require('../lib/push');

const CONV_RE = /^[a-z0-9]{16,40}$/i;
const HITS = new Map();
function rateOk(ip) {
  const now = Date.now();
  const list = (HITS.get(ip) || []).filter(t => t > now - 10 * 60 * 1000);
  if (list.length >= 10) return false;
  list.push(now); HITS.set(ip, list);
  if (HITS.size > 1000) HITS.clear();
  return true;
}
const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body),
});

exports.handler = async (event) => {
  const action = (event.queryStringParameters || {}).action || '';
  if (action === 'key') return json(200, { key: process.env.VAPID_PUBLIC_KEY || '' });
  if (event.httpMethod !== 'POST') return json(405, { error: 'method' });
  const h = event.headers || {};
  const ip = h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || '?';
  if (!rateOk(ip)) return json(429, { error: 'too many' });
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'bad json' }); }
  try {
    connectLambda(event);
    const store = getStore(push.STORE);
    if (action === 'subscribe') {
      const sub = body.subscription;
      if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys) return json(400, { error: 'invalid' });
      const hash = push.hashOf(sub.endpoint);
      const rec = (await store.get('client/' + hash, { type: 'json' })) || { convs: [], news: false };
      rec.sub = { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh || ''), auth: String(sub.keys.auth || '') } };
      rec.lang = body.lang === 'en' ? 'en' : 'fr';
      rec.at = new Date().toISOString();
      if (body.news === true) rec.news = true;
      const conv = String(body.conv || '');
      if (CONV_RE.test(conv) && !rec.convs.includes(conv)) {
        rec.convs = rec.convs.concat(conv).slice(-10);
        const list = (await store.get('byconv/' + conv, { type: 'json' })) || [];
        if (!list.includes(hash)) await store.setJSON('byconv/' + conv, list.concat(hash).slice(-5));
      }
      await store.setJSON('client/' + hash, rec);
      return json(200, { ok: true });
    }
    if (action === 'unsubscribe') {
      const hash = push.hashOf(body.endpoint || '');
      const rec = await store.get('client/' + hash, { type: 'json' });
      if (rec) { rec.news = false; await store.setJSON('client/' + hash, rec); }
      return json(200, { ok: true });
    }
    return json(400, { error: 'unknown action' });
  } catch (err) {
    console.error('push :', err.message);
    return json(500, { error: 'server' });
  }
};
