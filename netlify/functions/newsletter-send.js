// Netlify Function planifiée (chaque dimanche, cf. netlify.toml), seulement
// si Tom l'a validée dans la messagerie (aperçu envoyé le samedi par
// newsletter-preview.js) — newsletter
// « Les nouveautés du dimanche » : les pièces arrivées depuis le dernier envoi,
// classées par maison. S'il y en a moins de 8, on attend le dimanche suivant.
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
// Profils passéist sur les plateformes (bas de la newsletter)
const VESTIAIRE_URL = 'https://fr.vestiairecollective.com/profile/30773496/';
const VINTED_URL = process.env.VINTED_URL || '';
// Date (AAAA-MM-JJ, heure de Paris) du prochain envoi : aujourd'hui si on est
// dimanche avant 17 h, sinon le dimanche suivant. Sert à la validation par Tom.
function nextSendDate(now = new Date()) {
  const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const d = new Date(paris);
  const day = d.getDay();
  let add = (7 - day) % 7;
  if (day === 0 && paris.getHours() >= 18) add = 7;
  d.setDate(d.getDate() + add);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const BATCH = Number(process.env.NEWSLETTER_MIN || 8);   // minimum de pièces pour envoyer

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

async function itemFor(id) {
  const p = PRODUCTS[id];
  return {
    id, brand: p.brand || 'Autres', type: p.type, size: p.size, price: p.price,
    url: `${SITE}/product/${[slugify(p.brand), slugify(p.type), id].filter(Boolean).join('-')}`,
    img: await photoFor(id),
  };
}

// Sélection de Tom (« À la une », choisie dans la messagerie) : pièces encore en vente
async function featuredItems(store) {
  const f = await store.get('state/featured', { type: 'json' });
  const ids = (f && Array.isArray(f.ids) ? f.ids : []).filter(id => PRODUCTS[id]);
  return Promise.all(ids.map(itemFor));
}

// Pièces regroupées par maison, la plus fournie en premier
async function groupsFor(ids) {
  const items = await Promise.all(ids.map(itemFor));
  const byBrand = new Map();
  items.forEach(it => { if (!byBrand.has(it.brand)) byBrand.set(it.brand, []); byBrand.get(it.brand).push(it); });
  return [...byBrand].map(([brand, list]) => ({ brand, items: list }))
    .sort((a, b) => b.items.length - a.items.length || a.brand.localeCompare(b.brand));
}

function buildHtml(lang, groups, total, featured) {
  const en = lang === 'en';
  const head = en ? 'This week at passéist' : 'Cette semaine chez passéist';
  const intro = en
    ? 'A selection of our new arrivals this week. Each piece is unique.'
    : 'Une sélection de nos nouveautés de la semaine. Chaque pièce est unique.';
  const cta = en ? 'See all new pieces' : 'Voir toutes les nouveautés';
  const why = en
    ? 'You receive this email because you subscribed to new pieces on passeist.com.'
    : 'Vous recevez cet e-mail car vous vous êtes inscrit aux nouvelles pièces sur passeist.com.';
  const track = (u) => u + (u.includes('?') ? '&' : '?') + 'utm_source=newsletter&utm_medium=email';

  const pick = (featured || []).map(p => `
      <tr><td style="padding:10px 8px 18px;">
        <a href="${track(p.url)}" style="text-decoration:none;color:#f4f1ec;">
          ${p.img ? `<img src="${p.img}" width="560" alt="${esc(p.type)}" style="display:block;width:100%;max-width:560px;height:auto;border-radius:6px;background:#ffffff;">` : ''}
          <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:600;margin-top:12px;">${esc(title(p.brand))}</div>
          <div style="font-size:16px;font-style:italic;margin-top:4px;">${esc(p.type)}</div>
          <div style="font-size:13px;color:#a8a6a1;margin-top:3px;">${esc(p.size)}${p.size ? ' · ' : ''}${esc(p.price)}&nbsp;€</div>
        </a>
      </td></tr>`).join('');
  const pickBlock = pick ? `
      <tr><td style="padding:30px 8px 6px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#f4f1ec;font-weight:600;">${en ? 'Our favourites' : 'Nos coups de cœur'}</td></tr>
      ${pick}` : '';

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
  ${pickBlock}
  ${sections}
  <tr><td align="center" style="padding:32px 8px 8px;">
    <a href="${track(SITE + '/shop')}" style="display:inline-block;background:#f4f1ec;color:#1C2230;text-decoration:none;font-size:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;padding:15px 26px;border-radius:6px;">${cta}</a>
  </td></tr>
  <tr><td style="padding:36px 8px 0;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#262D3C;border-radius:12px;"><tr><td style="padding:20px 20px 18px;">
      <div style="font-size:15px;color:#f4f1ec;margin-bottom:6px;">${en ? 'passéist, like an app on your phone' : 'passéist, comme une app sur votre téléphone'}</div>
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:4px;">${en
        ? '<tr><td valign="top" style="padding:4px 10px 4px 0;"><div style="width:22px;height:22px;border-radius:11px;background:#f4f1ec;color:#1C2230;font-size:12px;font-weight:700;line-height:22px;text-align:center;">1</div></td><td style="padding:4px 0;font-size:13px;line-height:1.5;color:#d6d2cc;">On iPhone, open <b>passeist.com</b> in Safari.</td></tr><tr><td valign="top" style="padding:4px 10px 4px 0;"><div style="width:22px;height:22px;border-radius:11px;background:#f4f1ec;color:#1C2230;font-size:12px;font-weight:700;line-height:22px;text-align:center;">2</div></td><td style="padding:4px 0;font-size:13px;line-height:1.5;color:#d6d2cc;">Tap <b>Share</b> (the square with an arrow, sometimes in the <b>•••</b> menu).</td></tr><tr><td valign="top" style="padding:4px 10px 4px 0;"><div style="width:22px;height:22px;border-radius:11px;background:#f4f1ec;color:#1C2230;font-size:12px;font-weight:700;line-height:22px;text-align:center;">3</div></td><td style="padding:4px 0;font-size:13px;line-height:1.5;color:#d6d2cc;">Choose <b>Add to Home Screen</b>, then <b>Add</b>.</td></tr>'
        : '<tr><td valign="top" style="padding:4px 10px 4px 0;"><div style="width:22px;height:22px;border-radius:11px;background:#f4f1ec;color:#1C2230;font-size:12px;font-weight:700;line-height:22px;text-align:center;">1</div></td><td style="padding:4px 0;font-size:13px;line-height:1.5;color:#d6d2cc;">Sur iPhone, ouvrez <b>passeist.com</b> dans Safari.</td></tr><tr><td valign="top" style="padding:4px 10px 4px 0;"><div style="width:22px;height:22px;border-radius:11px;background:#f4f1ec;color:#1C2230;font-size:12px;font-weight:700;line-height:22px;text-align:center;">2</div></td><td style="padding:4px 0;font-size:13px;line-height:1.5;color:#d6d2cc;">Touchez <b>Partager</b> (le carré avec une flèche, parfois dans le menu <b>•••</b>).</td></tr><tr><td valign="top" style="padding:4px 10px 4px 0;"><div style="width:22px;height:22px;border-radius:11px;background:#f4f1ec;color:#1C2230;font-size:12px;font-weight:700;line-height:22px;text-align:center;">3</div></td><td style="padding:4px 0;font-size:13px;line-height:1.5;color:#d6d2cc;">Choisissez <b>Sur l\'écran d\'accueil</b>, puis <b>Ajouter</b>.</td></tr>'}</table>
      <div style="font-size:12px;line-height:1.5;color:#a8a6a1;margin-top:8px;">${en ? 'On Android: menu <b>⋮</b>, then <b>Install app</b>.' : 'Sur Android : menu <b>⋮</b>, puis <b>Installer l\'application</b>.'}</div>
      <div style="margin-top:12px;"><a href="${track(SITE + '/?app=1')}" style="color:#f4f1ec;font-size:13px;">${en ? 'Show me how →' : 'Voir comment faire →'}</a></div>
    </td></tr></table>
  </td></tr>
  <tr><td align="center" style="padding:26px 16px 0;font-size:13px;line-height:1.6;color:#d6d2cc;">
    ${en ? 'Also find us on your favourite platform:' : 'Retrouvez-nous aussi sur votre plateforme préférée :'}<br>
    <div style="padding-top:12px;">
      <a href="${VESTIAIRE_URL}" style="display:inline-block;margin:0 4px 8px;"><img src="${SITE}/img/badge-vestiaire.png" width="200" height="47" alt="Vestiaire Collective" style="display:block;border:0;"></a>
      <a href="${VINTED_URL || 'https://www.vinted.fr/'}" style="display:inline-block;margin:0 4px 8px;"><img src="${SITE}/img/badge-vinted.png" width="200" height="47" alt="Vinted" style="display:block;border:0;"></a>
    </div>
  </td></tr>
  <tr><td align="center" style="padding:32px 16px 8px;font-size:11px;line-height:1.6;color:#a8a6a1;">
    ${why}<br>${en
      ? 'We never want to clutter your inbox or bother you: to unsubscribe, <a href="{{ unsubscribe }}" style="color:#d6d2cc;">click here</a>.'
      : 'Nous ne voulons surtout pas encombrer votre boîte mail ni vous déranger : pour vous désabonner, <a href="{{ unsubscribe }}" style="color:#d6d2cc;">cliquez ici</a>.'}<br>passéist, Paris
  </td></tr>
</table></td></tr></table></body></html>`;
}

exports.handler = async (event) => {
  try { connectLambda(event); } catch (e) { /* contexte Blobs fourni autrement */ }
  const store = getStore('passeist-newsletter');
  try { await brevo.ping(); } catch (err) { console.error('brevo ping :', err.message); }

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

  // Validation de Tom obligatoire (aperçu reçu le samedi, bouton dans la messagerie)
  const approved = await store.get('state/approved', { type: 'json' });
  if (!approved || approved.date !== nextSendDate()) {
    console.log('newsletter : non validée pour ' + nextSendDate() + ', rien n\'est envoyé (les pièces attendent)');
    return { statusCode: 200, body: 'not approved' };
  }

  // 3. Sélection de Tom en tête, puis le reste par maison (la plus fournie en premier)
  const featured = await featuredItems(store);
  const featIds = new Set(featured.map(f => f.id));
  const groups = await groupsFor(fresh.filter(id => !featIds.has(id)));

  // 4. Envoi (français, puis autres langues si la liste existe)
  const date = new Date().toISOString().slice(0, 10);
  const top = groups.slice(0, 3).map(g => title(g.brand)).join(', ');
  await brevo.sendCampaign({
    lang: 'fr', name: `Nouveautés ${date} (FR)`,
    subject: `Cette semaine chez passéist · ${top}…`,
    html: buildHtml('fr', groups, fresh.length, featured),
  });
  if (brevo.listFor('en') && brevo.listFor('en') !== brevo.listFor('fr')) {
    await brevo.sendCampaign({
      lang: 'en', name: `New pieces ${date} (EN)`,
      subject: `This week at passéist · ${top}…`,
      html: buildHtml('en', groups, fresh.length, featured),
    });
  }
  await store.setJSON('state/seen', ids.concat(seenList.filter(id => !PRODUCTS[id])));
  await store.delete('state/featured');   // la sélection est à refaire chaque semaine
  console.log(`newsletter : envoyée (${fresh.length} pièces, ${groups.length} maisons)`);
  return { statusCode: 200, body: 'sent' };
};

// Utilisés par newsletter.js (test depuis la messagerie) et l'aperçu local
exports._buildHtml = buildHtml;
exports._groupsFor = groupsFor;
exports._featuredItems = featuredItems;
exports._BATCH = BATCH;
exports._nextSendDate = nextSendDate;
