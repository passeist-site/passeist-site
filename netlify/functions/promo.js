// Netlify Function — codes de réduction à usage unique (messagerie de passéist).
//   POST (en-tête x-admin-key = CHAT_ADMIN_KEY) → { code }
// Chaque appel crée dans Stripe un code unique (10 %, une seule utilisation,
// valable 6 mois), à envoyer au client dont la pièce n'était plus disponible.
// Un code commun finirait par circuler (Tom).
const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const COUPON_ID = 'passeist-10-indispo';
const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body),
});

function isAdmin(event) {
  const key = process.env.CHAT_ADMIN_KEY || '';
  const given = (event.headers && event.headers['x-admin-key']) || '';
  if (!key || given.length !== key.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
}
const FAILS = new Map();

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method' });
  const h = event.headers || {};
  const ip = h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || '?';
  const now = Date.now();
  const fails = (FAILS.get(ip) || []).filter(t => t > now - 15 * 60 * 1000);
  if (fails.length >= 5) return json(429, { error: 'too many attempts' });
  if (!isAdmin(event)) { fails.push(now); FAILS.set(ip, fails); return json(401, { error: 'unauthorized' }); }
  try {
    // Le coupon (10 %, une fois) est créé au premier usage
    try { await stripe.coupons.retrieve(COUPON_ID); }
    catch (e) { await stripe.coupons.create({ id: COUPON_ID, percent_off: 10, duration: 'once', name: 'Pièce indisponible (10 %)' }); }
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const rnd = Array.from(crypto.randomBytes(6), b => alphabet[b % alphabet.length]).join('');
    const promo = await stripe.promotionCodes.create({
      coupon: COUPON_ID,
      code: 'PASSEIST' + rnd,   // lettres et chiffres uniquement (règle Stripe)
      max_redemptions: 1,
      expires_at: Math.floor(now / 1000) + 183 * 24 * 3600,
      metadata: { origine: 'piece indisponible' },
    });
    return json(200, { code: promo.code, expires: promo.expires_at });
  } catch (err) {
    console.error('promo :', err.message);
    return json(500, { error: err.message.slice(0, 200) });
  }
};
