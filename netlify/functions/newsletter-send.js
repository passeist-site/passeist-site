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
const INSTAGRAM_URL = 'https://www.instagram.com/passeist_paris/';
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
// Aujourd'hui (AAAA-MM-JJ, heure de Paris)
function todayParis(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
}
const BATCH = Number(process.env.NEWSLETTER_MIN || 8);   // minimum de pièces pour envoyer
let EDITION = null;
try { EDITION = require('./newsletter-edition.json'); } catch (e) { /* pas de semaine composée */ }
// Semaine composée par Tom : sa date tombe entre aujourd'hui et le prochain dimanche
// (date du jour si Tom l'envoie lui-même avant dimanche)
const composed = () => !!(EDITION && EDITION.date >= todayParis() && EDITION.date <= nextSendDate());

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

// Semaine composée par Tom : sections titrées (« Le surprenant »…), une grande
// photo ou des paires, chaque photo et son nom mènent à la fiche. Typographie
// du site : Inter (Helvetica si la messagerie ne charge pas les polices),
// marque en capitales, nom en italique, date en JetBrains Mono.
function editionHtml(lang, ed, total) {
  const en = lang === 'en';
  const L = (v) => (v && typeof v === 'object') ? (v[lang] || v.fr || '') : (v || '');
  const INK = '#1C2230', DIM = '#5b6070', MUTE = '#9a9ca3', LINE = '#e6e4df';
  const FONT = "Inter,'Helvetica Neue',Helvetica,Arial,sans-serif";
  const MONO = "'JetBrains Mono','SF Mono',Menlo,monospace";
  const track = (u) => u + (u.includes('?') ? '&' : '?') + 'utm_source=newsletter&utm_medium=email';
  const [y, m, d] = ed.date.split('-').map(Number);
  const dateTxt = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(en ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  const urlOf = (id) => `${SITE}/product/${[slugify(PRODUCTS[id].brand), slugify(PRODUCTS[id].type), id].filter(Boolean).join('-')}`;
  const piece = (it, big) => {
    const p = PRODUCTS[it.id];
    const w = big ? 512 : 252;
    const src = it.img ? `${SITE}/img/${it.img}` : `${SITE}/img/${it.id}-${it.photo || 0}-${big ? 'xl' : 'md'}.webp`;   // it.img : photo préparée pour la newsletter
    return `<a href="${track(urlOf(it.id))}" style="text-decoration:none;display:block;color:${INK};">
      <img src="${src}" width="${w}" alt="${esc(title(p.brand) + ', ' + L(it.name))}" style="display:block;width:100%;max-width:${w}px;height:auto;margin:0 auto;border:0;">
      <div style="font-family:${FONT};font-size:${big ? 12 : 10.5}px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${INK};margin-top:${big ? 20 : 14}px;">${esc(p.brand)}</div>
      <div class="nm" style="font-family:${FONT};font-size:${big ? 16 : 11.5}px;font-style:italic;font-weight:300;letter-spacing:-0.015em;${big ? '' : 'white-space:nowrap;'}line-height:1.4;color:${DIM};margin-top:4px;">${esc(L(it.name) || p.label || p.type)}</div>
      <div style="font-family:${FONT};font-size:${big ? 12 : 11}px;font-weight:400;color:${MUTE};margin-top:6px;">${esc(p.price)}&nbsp;€</div></a>`;
  };
  const heading = (t) => {
    // Pas de titre : le point bleu du logo passéist sépare les groupes
    if (!t) return `<tr><td align="center" style="padding:24px 0 60px;"><div style="width:13px;height:13px;border-radius:50%;background:#5a7593;font-size:0;line-height:0;">&nbsp;</div></td></tr>`;
    const mm = t.match(/^(Le |Les |La |L’|L'|The )(.*)$/);
    const h = mm ? `${esc(mm[1])}<span style="font-weight:500;">${esc(mm[2])}</span>` : `<span style="font-weight:500;">${esc(t)}</span>`;
    return `<tr><td align="center" style="padding:34px 0 26px;font-family:${FONT};font-size:19px;font-weight:300;letter-spacing:-0.02em;line-height:1;color:${INK};">${h}</td></tr>`;
  };
  let first = true;
  const sections = (ed.sections || []).map((sec) => {
    const items = (sec.items || []).filter(it => PRODUCTS[it.id]);   // pièce vendue entre-temps : retirée
    if (!items.length) return '';
    const head = (first && !L(sec.title)) ? '' : heading(L(sec.title));   // pas de point avant la première pièce
    first = false;
    if (sec.hero) return head + items.map(it => `<tr><td align="center" style="padding:0 0 26px;">${piece(it, true)}</td></tr>`).join('');
    const rows = [];
    for (let i = 0; i < items.length; i += 2) rows.push(`<tr><td align="center"><table role="presentation" width="${items.length - i > 1 ? '100%' : '50%'}" align="center" cellspacing="0" cellpadding="0"><tr>` +   // pièce seule (l'autre vendue) : centrée
      items.slice(i, i + 2).map(it => `<td width="${items.length - i > 1 ? '50%' : '100%'}" valign="top" align="center" style="padding:0 4px 52px;">${piece(it, false)}</td>`).join('') + `</tr></table></td></tr>`);
    return head + rows.join('');
  }).join('');

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;1,300&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
<style>@media (max-width:340px){.nm{white-space:normal !important;}}</style>
<title>${esc(L(ed.subject))}</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
${L(ed.preheader) ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(L(ed.preheader))}${'&#8199;&#847;'.repeat(60)}</div>` : ''}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px;padding:56px 14px 40px;">
  <tr><td align="center"><a href="${track(SITE + '/')}" style="text-decoration:none;"><img src="${SITE}/img/newsletter-logo-2.png" width="260" alt="passéist." style="display:block;width:260px;max-width:260px;height:auto;margin:0 auto;border:0;"></a></td></tr>
  <tr><td align="center" style="padding:8px 0 0;font-family:${MONO};font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${INK};">${esc(dateTxt)}</td></tr>
  ${L(ed.intro) ? `<tr><td align="center" style="padding:60px 16px 40px;font-family:${FONT};font-size:21px;line-height:1.4;font-weight:300;letter-spacing:-0.01em;color:${INK};">${esc(L(ed.intro))}</td></tr>` : ''}
  ${sections}
  <tr><td align="center" style="padding:20px 0 80px;">
    <a href="${track(SITE + '/shop')}" style="font-family:${FONT};border-bottom:1px solid ${INK};color:${INK};text-decoration:none;font-size:11px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;padding:0 0 6px;">${en ? 'See all new pieces' : 'Voir toutes les nouveautés'}</a>
  </td></tr>
  <tr><td align="center" style="border-top:1px solid ${LINE};padding:40px 0 22px;font-family:${MONO};font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${INK};">${en ? 'Find us' : 'Retrouvez-nous'}</td></tr>
  <tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:420px;"><tr>
      <td width="25%" align="center" valign="top" style="padding:0 2px;"><a href="${track(SITE + '/?app=1')}" style="text-decoration:none;color:${INK};"><img src="${SITE}/img/nl-icon-app.png" width="56" height="56" alt="${en ? 'Create the app' : 'Créer l’app'}" style="display:block;width:56px;height:56px;margin:0 auto;border:0;"><div style="font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:0;color:${INK};margin-top:10px;">${en ? 'Create the app' : 'Créer l’app'}</div></a></td>
      <td width="25%" align="center" valign="top" style="padding:0 2px;"><a href="${VINTED_URL}" style="text-decoration:none;color:${INK};"><img src="${SITE}/img/nl-icon-vinted.png" width="56" height="56" alt="Vinted" style="display:block;width:56px;height:56px;margin:0 auto;border:0;"><div style="font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:0;color:${INK};margin-top:10px;">Vinted</div></a></td>
      <td width="25%" align="center" valign="top" style="padding:0 2px;"><a href="${VESTIAIRE_URL}" style="text-decoration:none;color:${INK};"><img src="${SITE}/img/nl-icon-vc.png" width="56" height="56" alt="Vestiaire Collective" style="display:block;width:56px;height:56px;margin:0 auto;border:0;"><div style="font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:0;color:${INK};margin-top:10px;">Vestiaire Collective</div></a></td>
<td width="25%" align="center" valign="top" style="padding:0 2px;"><a href="${INSTAGRAM_URL}" style="text-decoration:none;color:${INK};"><img src="${SITE}/img/nl-icon-insta.png" width="56" height="56" alt="Instagram" style="display:block;width:56px;height:56px;margin:0 auto;border:0;"><div style="font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:0;color:${INK};margin-top:10px;">Instagram</div></a></td>
  </tr></table></td></tr>
  <tr><td align="center" style="padding:22px 16px 0;font-family:${FONT};font-size:12px;font-weight:300;line-height:1.7;color:${DIM};">
    ${en ? '<strong style="font-weight:600;color:' + INK + ';">Create your app</strong>, no App Store needed: on passeist.com, tap Share, then “Add to Home Screen”.' : '<strong style="font-weight:600;color:' + INK + ';">Créez votre application</strong>, sans passer par l’App Store : sur passeist.com, touchez Partager, puis « Sur l’écran d’accueil ».'}
  </td></tr>
  <tr><td align="center" style="padding:28px 0 0;font-family:${FONT};font-size:11px;font-weight:300;line-height:1.8;color:${MUTE};">
    ${en
      ? 'You are receiving this email as a passéist customer, including on Vinted. We never want to clutter your inbox: to unsubscribe, <a href="{{ unsubscribe }}" style="color:' + DIM + ';">click here</a>.'
      : 'Vous recevez cet e-mail en tant que client de passéist, notamment sur Vinted. Nous ne voulons surtout pas encombrer votre boîte mail : pour vous désabonner, <a href="{{ unsubscribe }}" style="color:' + DIM + ';">cliquez ici</a>.'}<br>PASSEIST EURL · Paris · <a href="${SITE}/privacy" style="color:${DIM};">${en ? 'Privacy' : 'Confidentialité'}</a>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function buildHtml(lang, groups, total, featured, note) {
  // Semaine composée par Tom (newsletter-edition.json) : elle remplace la mise en page automatique
  if (composed()) return editionHtml(lang, EDITION, total);
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

  let body = `${noteBlock}
  ${picks}
  <tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows.join('')}</table></td></tr>`;

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>${en ? 'This week at passéist' : 'Cette semaine chez passéist'}</title></head>
<body style="margin:0;padding:0;background:${BG};">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BG};"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;padding:56px 24px 40px;">
  <tr><td align="center">
    <a href="${track(SITE + '/')}" style="text-decoration:none;"><img src="${SITE}/img/newsletter-logo-2.png" width="200" alt="passéist." style="display:block;width:200px;max-width:200px;height:auto;margin:0 auto;border:0;"></a></td></tr>
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
  // Semaine composée déjà envoyée par Tom (bouton « Envoyer maintenant ») : rien de plus
  if (composed() && ((await store.get('state/editionSent', { type: 'json' })) || {}).date === EDITION.date) {
    console.log('newsletter : sélection du ' + EDITION.date + ' déjà envoyée');
    return { statusCode: 200, body: 'already sent' };
  }
  if (fresh.length < BATCH && !composed()) return { statusCode: 200, body: 'waiting' };
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
    subject: (composed() && EDITION.subject) ? EDITION.subject.fr : `Cette semaine chez passéist · ${top}…`,
    html: buildHtml('fr', groups, fresh.length, featured, note),
  });
  if (brevo.listFor('en') && brevo.listFor('en') !== brevo.listFor('fr')) {
    await brevo.sendCampaign({
      lang: 'en', name: `New pieces ${date} (EN)`,
      subject: (composed() && EDITION.subject) ? (EDITION.subject.en || EDITION.subject.fr) : `This week at passéist · ${top}…`,
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
exports._editionHtml = editionHtml;
exports._groupsFor = groupsFor;
exports._featuredItems = featuredItems;
exports._BATCH = BATCH;
exports._nextSendDate = nextSendDate;
exports._edition = () => EDITION;
exports._composed = composed;

// Envoi immédiat de la semaine composée (bouton « Envoyer maintenant » de la messagerie)
exports._sendEditionNow = async (store) => {
  if (!composed()) throw new Error('aucune sélection pour cette semaine');
  if (((await store.get('state/editionSent', { type: 'json' })) || {}).date === EDITION.date) throw new Error('déjà envoyée');
  if (!brevo.enabled()) throw new Error('clé Brevo absente');
  await store.setJSON('state/editionSent', { date: EDITION.date, at: new Date().toISOString() });   // avant l'envoi : jamais deux fois
  await brevo.sendCampaign({ lang: 'fr', name: `Nouveautés ${EDITION.date} (FR)`, subject: EDITION.subject.fr, html: editionHtml('fr', EDITION, 0) });
  if (brevo.listFor('en') && brevo.listFor('en') !== brevo.listFor('fr')) {
    await brevo.sendCampaign({ lang: 'en', name: `New pieces ${EDITION.date} (EN)`, subject: EDITION.subject.en || EDITION.subject.fr, html: editionHtml('en', EDITION, 0) });
  }
  await store.setJSON('state/seen', Object.keys(PRODUCTS));   // pièces annoncées
  await store.delete('state/approved');
  await store.delete('state/featured');
  await store.delete('state/note');
};
