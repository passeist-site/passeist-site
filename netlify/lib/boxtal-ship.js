// Envoi Boxtal d'une commande Stripe payée (Tom, 2026-11-15)
// Utilisé par stripe-webhook.js (automatique, à chaque paiement) et par
// boxtal-order.js (bouton « Créer le bordereau » de la messagerie, pour une
// commande passée en mode à blanc).
// BOXTAL_LIVE=1 et paiement réel : l'envoi est commandé chez Boxtal, le bordereau
// arrive par e-mail. Sinon : e-mail « à blanc » avec ce qui aurait été commandé.
const boxtal = require('./boxtal');
const brevo = require('./brevo');

const esc = t => String(t || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// force : recrée l'envoi même si un passage « à blanc » a déjà eu lieu (jamais si un vrai envoi existe)
async function shipSession({ session, store, PRODUCTS, force = false, carrier = '' }) {
  const md = session.metadata || {};
  const notify = process.env.ORDER_NOTIFY_EMAIL || 'info@passeist.com';
  try {
    const prev = await store.get('boxtal/' + session.id, { type: 'json' });
    if (prev && prev.id) return { already: true, id: prev.id };
    if (prev && !force) return { skipped: true };
    const ids = (md.passeist_ids || '').split(',').filter(Boolean);
    const types = ids.map(id => (PRODUCTS[id] || {}).type || '');
    const pieces = ids.map(id => ({ type: (PRODUCTS[id] || {}).type || '', price: (PRODUCTS[id] || {}).price || 0 }));
    const order = boxtal.buildOrder({ session, types, pieces, carrier, valueEur: (session.amount_subtotal || 0) / 100 });
    const resume = `${whereText(session)}<br>Poids déclaré : ${order.shipment.packages[0].weight} kg<br>Offre : ${esc(order.shippingOfferCode)}`;
    if (session.livemode === true && boxtal.live()) {
      const res = await boxtal.createOrder(order);
      const c = res.content || {};
      await store.setJSON('boxtal/' + session.id, { id: c.id, status: c.status, at: new Date().toISOString() });
      await store.setJSON('boxtal-order/' + c.id, { session: session.id, email: (session.customer_details || {}).email || '', name: (session.customer_details || {}).name || '', lang: session.locale || 'fr' });
      console.log('✓ Envoi Boxtal créé :', c.id, c.status);
      await brevo.sendOne({ to: notify, subject: 'Envoi créé — ' + (md.passeist_ids || session.id), html: `Commande ${esc(session.id)}<br>${resume}<br>Envoi Boxtal ${esc(c.id)} (${esc(c.status)}). Le bordereau arrive dans un e-mail séparé dès que Boxtal l'a généré.` });
      return { created: true, id: c.id, status: c.status };
    }
    await store.setJSON('boxtal/' + session.id, { dryRun: true, at: new Date().toISOString() });
    await brevo.sendOne({ to: notify, subject: '[À blanc] Envoi qui aurait été créé — ' + (md.passeist_ids || session.id),
      html: `Mode à blanc (BOXTAL_LIVE pas activé${session.livemode ? '' : ', paiement test'}) : rien n'a été commandé chez Boxtal.<br>${resume}<br>Pour le créer pour de vrai : messagerie, « Bordereau Boxtal », collez ${esc(session.id)}.<pre style="font-size:11px">${esc(JSON.stringify(order, null, 2))}</pre>` });
    return { dryRun: true };
  } catch (err) {
    console.error('Boxtal :', err.message);
    try { await brevo.sendOne({ to: notify, subject: '⚠ Bordereau non créé — ' + session.id, html: 'Erreur Boxtal : ' + esc(err.message) + '<br>À créer à la main sur boxtal.com.' }); } catch (e) {}
    return { error: String(err.message).slice(0, 300) };
  }
}

// Où va le colis (e-mails et page de validation)
const COUNTRY_FR = { FR: 'France', BE: 'Belgique', LU: 'Luxembourg', DE: 'Allemagne', IT: 'Italie', ES: 'Espagne', NL: 'Pays-Bas', GB: 'Royaume-Uni', CH: 'Suisse', AT: 'Autriche', PT: 'Portugal', IE: 'Irlande', GR: 'Grèce', SE: 'Suède', DK: 'Danemark', NO: 'Norvège', FI: 'Finlande', PL: 'Pologne', CZ: 'Tchéquie', US: 'États-Unis', CA: 'Canada', JP: 'Japon', KR: 'Corée du Sud', AU: 'Australie', HK: 'Hong Kong', SG: 'Singapour' };
function whereText(session) {
  const md = session.metadata || {};
  if (md.ship_mode === 'relay') return 'Point relais : ' + esc(md.relay_name) + ' (' + esc(md.relay_address) + ')';
  const c = boxtal.destCountry(session);
  const head = c === 'FR' ? 'Livraison à domicile' : 'Livraison à domicile · ' + esc(COUNTRY_FR[c] || c) + (boxtal.EU27.has(c) ? '' : ' (hors UE : déclaration de douane jointe)');
  // Adresse complète, pour la vérifier avant de créer le bordereau (Tom, 2026-11-17)
  const ship = session.shipping_details || (session.collected_information || {}).shipping_details || {};
  const a = ship.address || (session.customer_details || {}).address || {};
  const lines = [ship.name, a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(' '), a.state, COUNTRY_FR[a.country] || a.country].filter(Boolean).map(esc);
  const phone = (session.customer_details || {}).phone;
  return head + (lines.length ? '<br>' + lines.join('<br>') : '') + (phone ? '<br>Tél. ' + esc(phone) : '');
}

// Lien signé « Créer le bordereau » (e-mail et notification à Tom) : HMAC de la commande
function signFor(sessionId) {
  return require('crypto').createHmac('sha256', process.env.CHAT_ADMIN_KEY || 'x').update('boxtal:' + sessionId).digest('hex').slice(0, 32);
}
function validateUrl(sessionId) {
  return (process.env.URL || 'https://passeist.com') + '/.netlify/functions/boxtal-order?s=' + encodeURIComponent(sessionId) + '&t=' + signFor(sessionId);
}

// Vente en relais / domicile : rien n'est commandé tout de suite. Tom reçoit un e-mail et une
// notification avec « Créer le bordereau » (validation en un clic, Tom 2026-11-15) : il vérifie
// que la pièce n'est pas partie ailleurs (Vestiaire, Vinted) avant de payer l'étiquette.
async function requestValidation({ session, store, PRODUCTS }) {
  const md = session.metadata || {};
  const notify = process.env.ORDER_NOTIFY_EMAIL || 'info@passeist.com';
  const prev = await store.get('boxtal/' + session.id, { type: 'json' });
  if (prev) return { skipped: true };
  await store.setJSON('boxtal/' + session.id, { pending: true, at: new Date().toISOString() });
  const ids = (md.passeist_ids || '').split(',').filter(Boolean);
  const pieces = ids.map(id => { const p = PRODUCTS[id] || {}; return esc((p.brand || '') + ' · ' + (p.type || id)); }).join('<br>');
  const where = whereText(session);
  const url = validateUrl(session.id);
  await brevo.sendOne({ to: notify, subject: 'Nouvelle commande — bordereau à valider', html:
    `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1C2230">`
    + `<b>${pieces}</b><br>${((session.amount_total || 0) / 100).toLocaleString('fr-FR')} € · ${esc((session.customer_details || {}).name)}<br>${where}<br><br>`
    + `<b>1.</b> Retirez la pièce des autres plateformes :<br>${delistHtml(ids, PRODUCTS)}<br><br>`
    + `<b>2.</b> Si elle était toujours disponible, créez le bordereau :<br><br>`
    + `<a href="${url}" style="display:inline-block;background:#1C2230;color:#fff;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:600">Créer le bordereau</a>`
    + `<br><br><span style="color:#888;font-size:13px">Pièce plus disponible : n'appuyez pas, remboursez le client dans Stripe. Rien n'est payé chez Boxtal.</span></div>` });
  return { pending: true, url };
}

// Liens pour retirer la pièce des autres plateformes après une vente sur le site (Tom, 2026-11-16) :
// l'annonce Vestiaire exacte, et l'annonce Vinted quand la synchro l'a retrouvée (champ vt),
// sinon une recherche Vinted pré-remplie
const VINTED_URL = process.env.VINTED_URL || 'https://www.vinted.fr/member/16032770';
function vintedSearch(p) {
  const price = Number(p.price) || 0;
  const type = String(p.type || '').replace(/\s+en\s+.*$/i, '');   // « Pull en laine » → « Pull »
  const q = new URLSearchParams({ search_text: ((p.brand || '') + ' ' + type).trim().toLowerCase(), order: 'newest_first' });
  if (price) { q.set('price_from', String(Math.max(0, Math.round(price * 0.8)))); q.set('price_to', String(Math.round(price * 1.2 + 10))); q.set('currency', 'EUR'); }
  return 'https://www.vinted.fr/catalog?' + q.toString();
}
function delistLinks(ids, PRODUCTS) {
  return ids.map(id => {
    const p = PRODUCTS[id] || {};
    return { id, label: (p.brand || '') + ' · ' + (p.type || id),
      vestiaire: p.vc ? 'https://fr.vestiairecollective.com' + (p.vc.startsWith('/') ? p.vc : '/' + p.vc) : '',
      vinted: /^https:\/\/www\.vinted\.fr\//.test(p.vt || '') ? p.vt : '',
      // Sans annonce reliée : recherche Vinted pré-remplie (marque + type, prix proche du site)
      vintedSearch: vintedSearch(p) };
  });
}
function delistHtml(ids, PRODUCTS) {
  const btn = (href, txt) => `<a href="${esc(href)}" style="display:inline-block;margin:4px 6px 4px 0;border:1px solid #1C2230;color:#1C2230;text-decoration:none;padding:9px 14px;border-radius:8px;font-size:13px">${txt}</a>`;
  const ls = delistLinks(ids, PRODUCTS), many = ls.length > 1;
  return ls.map(l => (l.vestiaire ? btn(l.vestiaire, 'Annonce Vestiaire' + (many ? ' · ' + esc(l.label) : '')) : '')
      + btn(l.vinted || l.vintedSearch, (l.vinted ? 'Annonce Vinted' : 'Chercher sur Vinted') + (many ? ' · ' + esc(l.label) : ''))).join('');
}

module.exports = { whereText, shipSession, requestValidation, validateUrl, signFor, delistLinks, delistHtml, VINTED_URL };
