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
const VINTED_URL = process.env.VINTED_URL || 'https://www.vinted.fr/member/16032770';
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

async function detailFor(id) {
  const url = `${SITE}/img/${id}-1-md.webp`;
  try { const r = await fetch(url, { method: 'HEAD' }); return r.ok ? url : ''; } catch (e) { return ''; }
}

async function itemFor(id, withDetail) {
  const p = PRODUCTS[id];
  return {
    id, brand: p.brand || 'Autres', type: p.label || p.type, season: p.season || '', year: p.year || 0, size: p.size, price: p.price,
    url: `${SITE}/product/${[slugify(p.brand), slugify(p.type), id].filter(Boolean).join('-')}`,
    img: await photoFor(id),
    detail: withDetail ? await detailFor(id) : '',
  };
}

// Sélection de Tom (« À la une », choisie dans la messagerie) : pièces encore en vente
async function featuredItems(store) {
  const f = await store.get('state/featured', { type: 'json' });
  const ids = (f && Array.isArray(f.ids) ? f.ids : []).filter(id => PRODUCTS[id]);
  return Promise.all(ids.map(id => itemFor(id, false)));   // pas de 2e photo (écartée par Tom)
}

// Pièces regroupées par maison, la plus fournie en premier
async function groupsFor(ids) {
  const items = await Promise.all(ids.map(id => itemFor(id, false)));
  const byBrand = new Map();
  items.forEach(it => { if (!byBrand.has(it.brand)) byBrand.set(it.brand, []); byBrand.get(it.brand).push(it); });
  return [...byBrand].map(([brand, list]) => ({ brand, items: list }))
    .sort((a, b) => b.items.length - a.items.length || a.brand.localeCompare(b.brand));
}

function buildHtml(lang, groups, total, featured, note, edition) {
  // Version « hyper luxe » (Tom) : fond blanc où les photos se fondent, texte
  // bleu nuit, petites capitales espacées, beaucoup de vide, 8 pièces au plus.
  const en = lang === 'en';
  const INK = '#1C2230', DIM = '#5b6070', MUTE = '#9a9ca3', BG = '#ffffff', LINE = '#e6e4df';
  const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";
  const track = (u) => u + (u.includes('?') ? '&' : '?') + 'utm_source=newsletter&utm_medium=email';
  const dateTxt = new Date().toLocaleDateString(en ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  const caps = (t, size, color, extra) => `<div style="font-family:${FONT};font-size:${size}px;letter-spacing:3px;text-transform:uppercase;color:${color};${extra || ''}">${t}</div>`;
  const caption = (p, big) =>
    caps(esc(title(p.brand)), big ? 10 : 9, INK, `margin-top:${big ? 22 : 16}px;`) +
    `<div style="font-family:${FONT};font-size:${big ? 15 : 13}px;font-weight:300;color:${DIM};margin-top:7px;">${esc(p.type)}</div>` +
    `<div style="font-family:${FONT};font-size:${big ? 12 : 11}px;letter-spacing:1px;color:${MUTE};margin-top:6px;">${esc(p.price)}&nbsp;€</div>`;
  const photo = (p, w) => p.img
    ? `<img src="${p.img}" width="${w}" alt="${esc(p.brand + ' ' + p.type)}" style="display:block;width:100%;max-width:${w}px;height:auto;margin:0 auto;border:0;">`
    : '';

  // Coups de cœur : grande photo + détail en gros plan (2e photo) à côté
  const picks = (featured || []).slice(0, 3).map(p => `
    <tr><td align="center" style="padding:0 0 72px;">
      <a href="${track(p.url)}" style="text-decoration:none;display:block;">
        ${p.detail ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
          <td width="64%" valign="top" style="padding-right:8px;">${photo(p, 300)}</td>
          <td width="36%" valign="bottom"><img src="${p.detail}" width="170" alt="" style="display:block;width:100%;max-width:170px;height:auto;border:0;"></td>
        </tr></table>` : photo(p, 420)}
        ${caption(p, true)}</a>
    </td></tr>`).join('');
  const noteBlock = note ? `
  <tr><td align="center" style="padding:0 22px 64px;font-family:${FONT};font-size:14px;line-height:1.8;font-style:italic;font-weight:300;color:${DIM};">
    ${esc(note).replace(/\n/g, '<br>')}
  </td></tr>` : '';

  const rest = [];
  groups.forEach(g => g.items.forEach(it => rest.push(it)));
  const shown = rest.slice(0, Math.max(0, 15 - Math.min(3, (featured || []).length)));   // 15 pièces au plus (Tom)
  // Grille simple, 2 colonnes (l'effet chronologique avec les dates a été
  // essayé puis écarté par Tom)
  const cell = (p) => p ? `<td width="50%" valign="top" align="center" style="padding:0 14px 60px;">
        <a href="${track(p.url)}" style="text-decoration:none;display:block;">${photo(p, 230)}${caption(p, false)}</a></td>` : '<td width="50%"></td>';
  const rows = [];
  for (let i = 0; i < shown.length; i += 2) rows.push(`<tr>${cell(shown[i])}${cell(shown[i + 1])}</tr>`);

  // Édition composée par Tom (newsletter-edition.json) : remplace la grille
  let body = `${noteBlock}
  ${picks}
  <tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows.join('')}</table></td></tr>`;
  if (edition) {
    const L = (v) => (v && typeof v === 'object') ? (v[lang] || v.fr || '') : (v || '');
    const urlOf = (id) => `${SITE}/product/${[slugify(PRODUCTS[id].brand), slugify(PRODUCTS[id].type), id].filter(Boolean).join('-')}`;
    const piece = (it, big) => {
      const p = PRODUCTS[it.id];
      const src = `${SITE}/img/${it.id}-${it.photo || 0}-${big ? 'xl' : 'md'}.webp`;
      const w = big ? 472 : 230;
      return `<a href="${track(urlOf(it.id))}" style="text-decoration:none;display:block;"><img src="${src}" width="${w}" alt="${esc(p.brand + ' ' + p.type)}" style="display:block;width:100%;max-width:${w}px;height:auto;margin:0 auto;border:0;">${caption({ brand: p.brand, type: L(it.name) || p.label || p.type, price: p.price }, big)}</a>`;
    };
    const text = (t) => t ? `<tr><td align="center" style="padding:0 18px 56px;font-family:${FONT};font-size:14px;line-height:1.85;font-weight:300;color:${DIM};">${esc(t)}</td></tr>` : '';
    const heading = (t) => t ? `<tr><td align="center" style="padding:24px 0 12px;font-family:${FONT};font-size:20px;font-weight:300;letter-spacing:0.5px;color:${INK};">${esc(t)}</td></tr>
  <tr><td align="center" style="padding:0 0 28px;"><div style="width:24px;height:1px;background:${INK};opacity:0.35;font-size:0;line-height:0;">&nbsp;</div></td></tr>` : '';
    const edNote = L(edition.note);
    body = (edNote ? `<tr><td align="center" style="padding:0 18px 64px;font-family:${FONT};font-size:14px;line-height:1.85;font-style:italic;font-weight:300;color:${DIM};">${esc(edNote)}</td></tr>` : '') +
      (edition.sections || []).map(sec => {
        if (sec.type === 'hero') {
          if (!PRODUCTS[sec.id]) return '';   // pièce vendue entre-temps : retirée
          return heading(L(sec.title)) + `<tr><td align="center" style="padding:0 0 26px;">${piece(sec, true)}</td></tr>` + text(L(sec.text));
        }
        const pairs = (sec.pairs || []).map(pr => pr.filter(it => PRODUCTS[it.id])).filter(pr => pr.length);
        if (!pairs.length) return '';
        return heading(L(sec.title)) + text(L(sec.text)) + pairs.map(pr => `<tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>` +
          pr.map(it => `<td width="50%" valign="top" align="center" style="padding:0 8px 52px;">${piece(it, false)}</td>`).join('') +
          (pr.length === 1 ? '' : '') + `</tr></table></td></tr>`).join('');
      }).join('');
  }

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>${en ? 'This week at passéist' : 'Cette semaine chez passéist'}</title></head>
<body style="margin:0;padding:0;background:${BG};">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BG};"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;padding:56px 24px 40px;">
  <tr><td align="center">
    <a href="${track(SITE + '/')}" style="text-decoration:none;"><img src="${SITE}/img/newsletter-logo.png" width="200" alt="passéist." style="display:block;width:200px;max-width:200px;height:auto;margin:0 auto;border:0;"></a></td></tr>
  <tr><td align="center" style="padding:22px 0 0;">${caps(esc(dateTxt), 9, MUTE)}</td></tr>
  <tr><td align="center" style="padding:64px 0 14px;font-family:${FONT};font-size:24px;font-weight:300;letter-spacing:0.5px;color:${INK};">${en ? 'This week' : 'Cette semaine'}</td></tr>
  <tr><td align="center" style="padding:0 0 72px;"><div style="width:32px;height:1px;background:${INK};opacity:0.35;font-size:0;line-height:0;">&nbsp;</div></td></tr>
  ${body}
  <tr><td align="center" style="padding:12px 0 80px;">
    <a href="${track(SITE + '/shop')}" style="display:inline-block;font-family:${FONT};border-bottom:1px solid ${INK};color:${INK};text-decoration:none;font-size:10px;letter-spacing:3px;text-transform:uppercase;padding:0 0 6px;">${en ? 'Discover the ' + total + ' new pieces' : 'Découvrir les ' + total + ' nouveautés'}</a>
  </td></tr>
  <tr><td align="center" style="border-top:1px solid ${LINE};padding:36px 0 0;font-family:${FONT};font-size:11px;line-height:2;color:${DIM};">
    ${en ? 'Also on' : 'Aussi sur'} <a href="${VESTIAIRE_URL}" style="color:${INK};text-decoration:none;border-bottom:1px solid ${LINE};">Vestiaire Collective</a> ${en ? 'and' : 'et'} <a href="${VINTED_URL || 'https://www.vinted.fr/'}" style="color:${INK};text-decoration:none;border-bottom:1px solid ${LINE};">Vinted</a><br>
    <a href="${track(SITE + '/?app=1')}" style="color:${INK};text-decoration:none;border-bottom:1px solid ${LINE};">${en ? 'passéist on your phone' : 'passéist sur votre téléphone'}</a>
  </td></tr>
  <tr><td align="center" style="padding:28px 0 0;font-family:${FONT};font-size:10px;line-height:1.8;color:${MUTE};">
    ${en
      ? 'We never want to clutter your inbox: to unsubscribe, <a href="{{ unsubscribe }}" style="color:' + DIM + ';">click here</a>.'
      : 'Nous ne voulons surtout pas encombrer votre boîte mail : pour vous désabonner, <a href="{{ unsubscribe }}" style="color:' + DIM + ';">cliquez ici</a>.'}<br>passéist · Paris
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
  const note = ((await store.get('state/note', { type: 'json' })) || {}).text || '';

  // 4. Envoi (français, puis autres langues si la liste existe)
  const date = new Date().toISOString().slice(0, 10);
  const top = groups.slice(0, 3).map(g => title(g.brand)).join(', ');
  await brevo.sendCampaign({
    lang: 'fr', name: `Nouveautés ${date} (FR)`,
    subject: `Cette semaine chez passéist · ${top}…`,
    html: buildHtml('fr', groups, fresh.length, featured, note),
  });
  if (brevo.listFor('en') && brevo.listFor('en') !== brevo.listFor('fr')) {
    await brevo.sendCampaign({
      lang: 'en', name: `New pieces ${date} (EN)`,
      subject: `This week at passéist · ${top}…`,
      html: buildHtml('en', groups, fresh.length, featured, note),
    });
  }
  await store.setJSON('state/seen', ids.concat(seenList.filter(id => !PRODUCTS[id])));
  await store.delete('state/featured');   // la sélection est à refaire chaque semaine
  await store.delete('state/note');
  console.log(`newsletter : envoyée (${fresh.length} pièces, ${groups.length} maisons)`);
  return { statusCode: 200, body: 'sent' };
};

// Utilisés par newsletter.js (test depuis la messagerie) et l'aperçu local
exports._buildHtml = buildHtml;
exports._groupsFor = groupsFor;
exports._featuredItems = featuredItems;
exports._BATCH = BATCH;
exports._nextSendDate = nextSendDate;
