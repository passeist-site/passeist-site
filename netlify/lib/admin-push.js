// Notification sur le téléphone de Tom (appareils abonnés dans la messagerie,
// store « passeist-chat », clés push/…), comme pour les nouveaux messages.
const webpush = require('web-push');
const { getStore } = require('@netlify/blobs');

async function notifyAdmin(payload) {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return 0;
  webpush.setVapidDetails('mailto:info@passeist.com', pub, priv);
  const store = getStore('passeist-chat');
  const { blobs } = await store.list({ prefix: 'push/' });
  let sent = 0;
  for (const b of blobs) {
    const sub = await store.get(b.key, { type: 'json' });
    if (!sub) continue;
    try { await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 86400 }); sent++; }
    catch (err) { if (err.statusCode === 404 || err.statusCode === 410) await store.delete(b.key); }
  }
  return sent;
}

module.exports = { notifyAdmin };
