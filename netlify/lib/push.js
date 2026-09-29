// Notifications (Web Push) envoyées aux clients du site : réponse dans le chat
// et nouveautés de la semaine. Mêmes clés VAPID que la messagerie de passéist.
// Abonnements dans Netlify Blobs, store « passeist-push-clients » :
//   client/<hash>   { sub, news, lang, convs: [...], at }
//   byconv/<conv>   [hash, ...]  (qui prévenir quand passéist répond)
const crypto = require('crypto');
const webpush = require('web-push');

const STORE = 'passeist-push-clients';
const hashOf = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32);

function ready() {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails('mailto:info@passeist.com', pub, priv);
  return true;
}

// Envoie une notification ; supprime l'abonnement s'il n'existe plus.
async function send(store, hash, payload) {
  const rec = await store.get('client/' + hash, { type: 'json' });
  if (!rec || !rec.sub) return false;
  if (typeof payload === 'function') payload = payload(rec);   // selon la langue du client
  try {
    await webpush.sendNotification(rec.sub, JSON.stringify(payload), { TTL: 86400 });
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) await store.delete('client/' + hash);
    else console.error('push client :', err.statusCode || err.message);
    return false;
  }
}

module.exports = { STORE, hashOf, ready, send };
