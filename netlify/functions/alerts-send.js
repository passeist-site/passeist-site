// Netlify Function planifiée (chaque heure) — envoie les alertes
// « nouvelles pièces » (cf. alerts.js).
//
// products.json est celui du dernier déploiement : les pièces qui y figurent
// et qui n'étaient pas là au passage précédent (state/seen) sont comparées aux
// alertes ; chaque alerte concernée reçoit UN e-mail avec ses pièces.
// Au tout premier passage, le catalogue entier est noté comme déjà vu (aucun
// envoi). E-mails par Brevo (e-mail transactionnel, pas une campagne).
const { getStore, connectLambda } = require('@netlify/blobs');
const brevo = require('../lib/brevo');
const { categoryOf, CAT_EN } = require('../lib/category');
const PRODUCTS = require('./products.json');

const SITE = 'https://passeist.com';
const FONT = "Inter,'Helvetica Neue',Helvetica,Arial,sans-serif";
const INK = '#1C2230', DIM = '#5b6070', MUTE = '#9a9ca3', LINE = '#e6e4df';
const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Même adresse que la fiche du site (productSlug() dans index.html)
function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
const productUrl = (id, p) => SITE + '/product/' + [slugify(p.brand), slugify(p.type), id].filter(Boolean).join('-');
const genderOf = p => { const g = String(p.gender || '').toLowerCase(); return g === 'h' || g === 'homme' ? 'Homme' : g === 'f' || g === 'femme' ? 'Femme' : ''; };
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

const brandsOf = a => (Array.isArray(a.brands) ? a.brands : (a.brand ? [a.brand] : []));
const catsOf = a => (Array.isArray(a.cats) ? a.cats : (a.cat ? [a.cat] : []));
function matches(a, p) {
  const b = brandsOf(a), c = catsOf(a);
  if (b.length && !b.some(x => norm(x) === norm(p.brand))) return false;
  if (c.length && !c.includes(categoryOf(p.type))) return false;
  // Pièce sans genre (accessoire) : envoyée aux alertes homme comme femme
  if (a.gender && genderOf(p) && genderOf(p) !== a.gender) return false;
  return true;
}

function label(a, en) {
  const parts = [];
  const b = brandsOf(a), c = catsOf(a);
  if (!b.length && !c.length && !a.gender) return en ? 'All new pieces' : 'Toutes les nouvelles pièces';
  if (b.length) parts.push(b.join(', '));
  if (c.length) parts.push(c.map(x => en ? (CAT_EN[x] || x) : x).join(', '));
  if (a.gender) parts.push(en ? (a.gender === 'Homme' ? 'Men' : 'Women') : a.gender);
  return parts.join(' · ');
}

function buildEmail(a, token, items) {
  const en = a.lang === 'en';
  const lab = label(a, en);
  const off = `${SITE}/.netlify/functions/alerts?action=off&t=${token}`;
  const rows = items.map(([id, p]) => {
    const url = productUrl(id, p);
    return `<tr><td style="padding:0 0 34px;" align="center">
      <a href="${url}" style="text-decoration:none;color:${INK};display:block;">
        <img src="${SITE}/img/${id}-0-md.webp" width="300" alt="${esc(p.brand + ' ' + p.type)}" style="display:block;width:300px;max-width:100%;height:auto;border:0;margin:0 auto;">
        <div style="font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${INK};margin-top:18px;">${esc(p.brand)}</div>
        <div style="font-family:${FONT};font-size:16px;font-style:italic;font-weight:300;color:${DIM};margin-top:4px;">${esc(p.label || p.type)}</div>
        <div style="font-family:${FONT};font-size:12px;color:${MUTE};margin-top:6px;">${esc(p.size ? p.size + ' · ' : '')}${esc(p.price)}&nbsp;€</div>
      </a></td></tr>`;
  }).join('');
  const intro = en
    ? (items.length > 1 ? `${items.length} new pieces match your alert` : 'A new piece matches your alert')
    : (items.length > 1 ? `${items.length} nouvelles pièces correspondent à votre alerte` : 'Une nouvelle pièce correspond à votre alerte');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
  <tr><td align="center" style="font-family:${FONT};font-size:48px;font-weight:200;letter-spacing:-0.045em;line-height:1;color:${INK};"><a href="${SITE}/" style="text-decoration:none;color:${INK};">passéist<span style="color:#5a7593;font-weight:400;">.</span></a></td></tr>
  <tr><td align="center" style="padding:34px 0 8px;font-family:${FONT};font-size:15px;font-weight:300;color:${INK};">${intro}</td></tr>
  <tr><td align="center" style="padding:0 0 34px;font-family:${FONT};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${DIM};border-bottom:1px solid ${LINE};">${esc(lab)}</td></tr>
  <tr><td style="height:34px;"></td></tr>
  ${rows}
  <tr><td align="center" style="padding:10px 0 0;border-top:1px solid ${LINE};font-family:${FONT};font-size:11px;line-height:1.7;color:${MUTE};">
    ${en ? 'You receive this email because you created this alert on passeist.com.' : 'Vous recevez cet e-mail car vous avez créé cette alerte sur passeist.com.'}<br>
    <a href="${off}" style="color:${DIM};">${en ? 'Remove this alert' : 'Supprimer cette alerte'}</a> · PASSEIST EURL · Paris
  </td></tr>
</table></td></tr></table></body></html>`;
}

exports.handler = async (event) => {
  try { connectLambda(event); } catch (e) { /* contexte Blobs fourni autrement */ }
  const store = getStore('passeist-alerts');
  const ids = Object.keys(PRODUCTS);   // pièces disponibles (vendues exclues par export_products.py)
  const seenList = await store.get('state/seen', { type: 'json' });
  if (!Array.isArray(seenList)) {
    await store.setJSON('state/seen', ids);
    return { statusCode: 200, body: 'init' };
  }
  const seen = new Set(seenList);
  const fresh = ids.filter(id => !seen.has(id));
  if (!fresh.length) return { statusCode: 200, body: 'nothing new' };
  if (!brevo.enabled()) return { statusCode: 200, body: 'no brevo' };

  const { blobs } = await store.list({ prefix: 'a/' });
  let sent = 0;
  for (const b of blobs) {
    const a = await store.get(b.key, { type: 'json' });
    if (!a || !a.email) continue;
    const items = fresh.map(id => [id, PRODUCTS[id]]).filter(([, p]) => p && matches(a, p));
    if (!items.length) continue;
    const en = a.lang === 'en';
    const lab = label(a, en);
    const subject = items.length > 1
      ? (en ? `${items.length} new pieces · ${lab}` : `${items.length} nouvelles pièces · ${lab}`)
      : (en ? `New piece · ${lab}` : `Nouvelle pièce · ${lab}`);
    try {
      await brevo.sendOne({ to: a.email, subject, html: buildEmail(a, b.key.slice(2), items.slice(0, 12)) });
      sent++;
    } catch (e) { console.error('alerte non envoyée', b.key, e.message); }
  }
  // Pièces notées comme vues, même sans alerte concernée (pas de rattrapage plus tard)
  await store.setJSON('state/seen', ids.concat(seenList.filter(id => !PRODUCTS[id]).slice(-3000)));
  console.log(`alertes : ${fresh.length} nouvelles pièces, ${sent} e-mails`);
  return { statusCode: 200, body: `sent ${sent}` };
};

// Pour les essais en local
exports._buildEmail = buildEmail;
exports._matches = matches;
