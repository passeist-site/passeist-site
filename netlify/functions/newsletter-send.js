// Netlify Function planifiée (tous les jours, cf. netlify.toml) — newsletter
// « nouvelles pièces » : dès que 20 pièces nouvelles sont en vente depuis le
// dernier envoi, un e-mail part aux abonnés avec ces pièces classées par maison.
//
// État dans Netlify Blobs (store « passeist-newsletter ») :
//   state/seen   ids déjà annoncés (au premier passage : tout le catalogue
//                actuel, pour ne pas envoyer 700 pièces d'un coup)
//   sub/<hash>   abonnés (cf. newsletter.js) ; ceux inscrits avant la mise en
//                place de Brevo y sont ajoutés ici.
const { getStore, connectLambda } = require('@netlify/blobs');
const brevo = require('../lib/brevo');
const PRODUCTS = require('./products.json'); // pièces en vente (vendues exclues)

const SITE = 'https://passeist.com';
const BATCH = Number(process.env.NEWSLETTER_BATCH || 20);

function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const title = (s) => String(s || '').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, m => m.toUpperCase());

// Photo 1 de la fiche, si elle est hébergée sur passeist.com
async function photoFor(id) {
  const url = `${SITE}/img/${id}-0-md.webp`;
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok ? url : '';
  } catch (e) { return ''; }
}

function buildHtml(lang, groups, total) {
  const en = lang === 'en';
  const head = en ? `${total} new pieces` : `${total} nouvelles pièces`;
  const intro = en
    ? 'Just arrived at passéist, by designer. Each piece is unique.'
    : 'Tout juste arrivées chez passéist, classées par maison. Chaque pièce est unique.';
  const cta = en ? 'See all new pieces' : 'Voir toutes les nouveautés';
  const unsub = en ? 'Unsubscribe' : 'Se désinscrire';
  const why = en
    ? 'You receive this email because you subscribed to new pieces on passeist.com.'
    : 'Vous recevez cet e-mail car vous vous êtes inscrit aux nouvelles pièces sur passeist.com.';
  const track = (u) => u + (u.includes('?') ? '&' : '?') + 'utm_source=newsletter&utm_medium=email';

  const sections = groups.map(({ brand, items }) => {
    const cells = items.map(p => `
      <td width="50%" valign="top" style="padding:8px;">
        <a href="${track(p.url)}" style="text-decoration:none;color:#f4f1ec;">
          ${p.img ? `<img src="${p.img}" width="260" alt="${esc(p.type)}" style="display:block;width:100%;max-width:260px;height:auto;border-radius:6px;background:#ffffff;">` : ''}
          <div style="font-size:14px;font-style:italic;margin-top:8px;">${esc(p.type)}</div>
          <div style="font-size:12px;color:#a8a6a1;margin-top:2px;">${esc(p.size)}${p.size ? ' · ' : ''}${esc(p.price)}&nbsp;€</div>
        </a>
      </td>`);
    const rows = [];
    for (let i = 0; i < cells.length; i += 2) rows.push(`<tr>${cells[i]}${cells[i + 1] || '<td width="50%"></td>'}</tr>`);
    return `
      <tr><td style="padding:28px 8px 4px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#f4f1ec;font-weight:600;">
        ${esc(title(brand))} <span style="color:#a8a6a1;font-weight:400;">· ${items.length}</span>
      </td></tr>
      <tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows.join('')}</table></td></tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>${esc(head)}</title></head>
<body style="margin:0;padding:0;background:#1C2230;font-family:Helvetica,Arial,sans-serif;color:#f4f1ec;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#1C2230;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;padding:24px 12px;">
  <tr><td align="center" style="padding:12px 8px 4px;font-size:34px;letter-spacing:-1px;color:#f4f1ec;">
    <a href="${track(SITE + '/')}" style="color:#f4f1ec;text-decoration:none;">passéist<span style="color:#5a7593;">.</span></a>
  </td></tr>
  <tr><td align="center" style="padding:18px 8px 4px;font-size:22px;color:#f4f1ec;">${esc(head)}</td></tr>
  <tr><td align="center" style="padding:4px 16px 8px;font-size:14px;line-height:1.6;color:#d6d2cc;">${esc(intro)}</td></tr>
  ${sections}
  <tr><td align="center" style="padding:32px 8px 8px;">
    <a href="${track(SITE + '/shop')}" style="display:inline-block;background:#f4f1ec;color:#1C2230;text-decoration:none;font-size:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;padding:15px 26px;border-radius:6px;">${cta}</a>
  </td></tr>
  <tr><td align="center" style="padding:32px 16px 8px;font-size:11px;line-height:1.6;color:#a8a6a1;">
    ${why}<br><a href="{{ unsubscribe }}" style="color:#d6d2cc;">${unsub}</a> · passéist, Paris
  </td></tr>
</table></td></tr></table></body></html>`;
}

exports.handler = async (event) => {
  try { connectLambda(event); } catch (e) { /* contexte Blobs fourni autrement */ }
  const store = getStore('passeist-newsletter');

  // 1. Abonnés inscrits avant Brevo : on les ajoute maintenant
  if (brevo.enabled()) {
    const { blobs } = await store.list({ prefix: 'sub/' });
    for (const b of blobs) {
      const sub = await store.get(b.key, { type: 'json' });
      if (!sub || sub.synced) continue;
      try {
        if (await brevo.addToBrevo(sub.email, sub.lang)) await store.setJSON(b.key, { ...sub, synced: true });
      } catch (err) { console.error('brevo abonné :', err.message); }
    }
  }

  // 2. Pièces nouvelles depuis le dernier envoi
  const ids = Object.keys(PRODUCTS);
  const seenList = await store.get('state/seen', { type: 'json' });
  if (!Array.isArray(seenList)) {
    await store.setJSON('state/seen', ids);
    console.log(`newsletter : premier passage, ${ids.length} pièces marquées comme déjà annoncées`);
    return { statusCode: 200, body: 'init' };
  }
  const seen = new Set(seenList);
  const fresh = ids.filter(id => !seen.has(id));
  console.log(`newsletter : ${fresh.length} nouvelles pièces (envoi à partir de ${BATCH})`);
  if (fresh.length < BATCH) return { statusCode: 200, body: 'waiting' };
  if (!brevo.enabled()) {
    console.log('newsletter : BREVO_API_KEY absent, rien n\'est envoyé');
    return { statusCode: 200, body: 'no brevo' };
  }

  // 3. Regroupement par maison (la plus fournie en premier)
  const items = await Promise.all(fresh.map(async id => {
    const p = PRODUCTS[id];
    return {
      id, brand: p.brand || 'Autres', type: p.type, size: p.size, price: p.price,
      url: `${SITE}/product/${[slugify(p.brand), slugify(p.type), id].filter(Boolean).join('-')}`,
      img: await photoFor(id),
    };
  }));
  const byBrand = new Map();
  items.forEach(it => { if (!byBrand.has(it.brand)) byBrand.set(it.brand, []); byBrand.get(it.brand).push(it); });
  const groups = [...byBrand].map(([brand, list]) => ({ brand, items: list }))
    .sort((a, b) => b.items.length - a.items.length || a.brand.localeCompare(b.brand));

  // 4. Envoi (français, puis autres langues si la liste existe)
  const date = new Date().toISOString().slice(0, 10);
  const top = groups.slice(0, 3).map(g => title(g.brand)).join(', ');
  await brevo.sendCampaign({
    lang: 'fr', name: `Nouveautés ${date} (FR)`,
    subject: `${fresh.length} nouvelles pièces : ${top}…`,
    html: buildHtml('fr', groups, fresh.length),
  });
  if (brevo.listFor('en') && brevo.listFor('en') !== brevo.listFor('fr')) {
    await brevo.sendCampaign({
      lang: 'en', name: `New pieces ${date} (EN)`,
      subject: `${fresh.length} new pieces: ${top}…`,
      html: buildHtml('en', groups, fresh.length),
    });
  }
  await store.setJSON('state/seen', ids.concat(seenList.filter(id => !PRODUCTS[id])));
  console.log(`newsletter : envoyée (${fresh.length} pièces, ${groups.length} maisons)`);
  return { statusCode: 200, body: 'sent' };
};

// Aperçu local : node netlify/functions/newsletter-send.js > apercu.html
exports._buildHtml = buildHtml;
