// Netlify Function — alertes « nouvelles pièces » (Tom, nov. 2026).
//
//   POST {email, lang, brand, cat, gender, website, ms}
//        → enregistre l'alerte (marque et/ou catégorie, genre facultatif)
//   GET  ?action=off&t=<jeton>  → page « Supprimer cette alerte ? » (bouton)
//   POST ?action=off&t=<jeton>  → supprime l'alerte
// Messagerie (en-tête x-admin-key = CHAT_ADMIN_KEY) :
//   GET  ?action=list           → alertes en cours (sans les adresses)
//
// Les alertes sont gardées dans Netlify Blobs (store « passeist-alerts »,
// clés a/<jeton>). L'envoi se fait dans alerts-send.js, chaque heure, pour
// les pièces arrivées depuis le passage précédent. Ces adresses ne sont PAS
// ajoutées à la newsletter : le client n'a demandé que cette alerte.
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const { notifyAdmin } = require('../lib/admin-push');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CATS = ['Accessoires', 'Chaussures', 'Robes', 'Bas', 'Vestes', 'Maille', 'Hauts', 'Autres'];
const MAX_PER_EMAIL = 10;

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
const page = (statusCode, html) => ({
  statusCode,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  body: `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>passéist</title></head>
<body style="margin:0;background:#1C2230;color:#f4f1ec;font-family:-apple-system,Helvetica,Arial,sans-serif;text-align:center;padding:80px 24px">
<div style="font-size:34px;font-weight:200;letter-spacing:-0.03em;margin-bottom:36px">passéist<span style="color:#5a7593">.</span></div>${html}</body></html>`,
});
const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function isAdmin(event) {
  const key = process.env.CHAT_ADMIN_KEY || '';
  const given = (event.headers && event.headers['x-admin-key']) || '';
  if (!key || given.length !== key.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
}

// Adresses Gmail piégées par les robots (points en série), cf. newsletter.js
function suspicious(email) {
  const [local, domain] = email.split('@');
  if (local.includes('..')) return true;
  if (/^(gmail|googlemail)\.com$/.test(domain) && (local.match(/\./g) || []).length >= 3) return true;
  return false;
}

function label(a, lang) {
  const { CAT_EN } = require('../lib/category');
  const en = lang === 'en';
  const parts = [];
  if (a.brand) parts.push(a.brand);
  if (a.cat) parts.push(en ? (CAT_EN[a.cat] || a.cat) : a.cat);
  if (a.gender) parts.push(en ? (a.gender === 'Homme' ? 'Men' : 'Women') : a.gender);
  return parts.join(' · ');
}

exports.handler = async (event) => {
  try { connectLambda(event); } catch (e) { /* contexte Blobs fourni autrement */ }
  const store = getStore('passeist-alerts');
  const q = event.queryStringParameters || {};
  const action = q.action || '';

  // ── Suppression : page avec bouton (les antivirus qui ouvrent tous les
  //    liens des e-mails ne suppriment ainsi rien tout seuls) ──
  if (action === 'off') {
    const t = String(q.t || '').replace(/[^a-f0-9]/g, '').slice(0, 40);
    const a = t ? await store.get('a/' + t, { type: 'json' }) : null;
    const en = a && a.lang === 'en';
    if (!a) return page(200, `<p style="font-size:15px;line-height:1.6">Cette alerte n'existe plus.<br><span style="color:#d4d1cb">This alert no longer exists.</span></p><p><a href="https://passeist.com/shop" style="color:#f4f1ec">passeist.com</a></p>`);
    if (event.httpMethod === 'POST') {
      await store.delete('a/' + t);
      return page(200, `<p style="font-size:15px;line-height:1.6">${en ? 'Alert removed' : 'Alerte supprimée'} : ${esc(label(a, a.lang))}.</p><p><a href="https://passeist.com/shop" style="color:#f4f1ec">passeist.com</a></p>`);
    }
    return page(200, `<p style="font-size:15px;line-height:1.6">${en ? 'Remove this alert?' : 'Supprimer cette alerte ?'}<br><strong>${esc(label(a, a.lang))}</strong></p>
<form method="post" action="/.netlify/functions/alerts?action=off&t=${t}"><button type="submit" style="margin-top:18px;padding:14px 26px;border:0;border-radius:6px;background:#5a7593;color:#f4f1ec;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;cursor:pointer">${en ? 'Remove' : 'Supprimer'}</button></form>`);
  }

  // ── Messagerie : liste des alertes (sans les adresses) ──
  if (action === 'list') {
    if (!isAdmin(event)) return json(401, { error: 'unauthorized' });
    const { blobs } = await store.list({ prefix: 'a/' });
    const counts = {};
    for (const b of blobs) {
      const a = await store.get(b.key, { type: 'json' });
      if (!a) continue;
      const k = label(a, 'fr');
      counts[k] = (counts[k] || 0) + 1;
    }
    return json(200, { total: blobs.length, alerts: Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([k, n]) => ({ label: k, count: n })) });
  }

  // ── Création ──
  if (event.httpMethod !== 'POST') return json(405, { error: 'method' });
  const h = event.headers || {};
  const ip = h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || '?';
  if (!rateOk(ip)) return json(429, { error: 'too many' });
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'json' }); }
  const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  const lang = body.lang === 'en' ? 'en' : 'fr';
  const brand = String(body.brand || '').trim().toUpperCase().slice(0, 80);
  const cat = CATS.includes(body.cat) ? body.cat : '';
  const gender = body.gender === 'Homme' || body.gender === 'Femme' ? body.gender : '';
  if (!EMAIL_RE.test(email)) return json(400, { error: 'email' });
  if (!brand && !cat) return json(400, { error: 'criteria' });
  // Robots : champ piège rempli, envoi en moins de 3 s, adresse piégée → on fait comme si
  if (body.website || Number(body.ms || 0) < 3000 || suspicious(email)) return json(200, { ok: true });

  const emailHash = crypto.createHash('sha256').update(email).digest('hex').slice(0, 16);
  const { blobs } = await store.list({ prefix: 'a/' });
  let mine = 0;
  for (const b of blobs) {
    const a = await store.get(b.key, { type: 'json' });
    if (!a || a.eh !== emailHash) continue;
    if (a.brand === brand && a.cat === cat && a.gender === gender) return json(200, { ok: true, already: true });
    mine++;
  }
  if (mine >= MAX_PER_EMAIL) return json(400, { error: 'max' });

  const token = crypto.randomBytes(16).toString('hex');
  await store.setJSON('a/' + token, { email, eh: emailHash, lang, brand, cat, gender, created: new Date().toISOString() });
  try {
    await notifyAdmin({ title: 'Nouvelle alerte', body: label({ brand, cat, gender }, 'fr'), url: '/messagerie/', tag: 'alert-' + token.slice(0, 8) });
  } catch (e) { /* notification facultative */ }
  return json(200, { ok: true });
};
