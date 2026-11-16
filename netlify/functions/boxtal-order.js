// Bouton « Bordereau Boxtal » de la messagerie (Tom, 2026-11-15) : crée l'envoi Boxtal
// d'une commande déjà payée (référence Stripe cs_live_…), par ex. passée en mode à blanc.
// Accès réservé (en-tête x-admin-key = CHAT_ADMIN_KEY). Exige BOXTAL_LIVE=1.
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const boxtal = require('../lib/boxtal');
const { shipSession, signFor, delistLinks } = require('../lib/boxtal-ship');
const PRODUCTS = require('./products.json');

const json = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
function isAdmin(event) {
  const key = process.env.CHAT_ADMIN_KEY || '';
  const given = (event.headers && event.headers['x-admin-key']) || '';
  if (!key || given.length !== key.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
}

// Page du lien « Créer le bordereau » (e-mail / notification) : GET montre la commande et un
// bouton, seul l'appui (POST) crée l'envoi (les messageries qui pré-ouvrent les liens ne
// déclenchent donc rien). Lien signé : HMAC de la commande (lib/boxtal-ship.js).
const page = (title, body) => ({ statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>
<body style="margin:0;background:#1C2230;color:#f4f1ec;font-family:Helvetica,Arial,sans-serif"><div style="max-width:440px;margin:0 auto;padding:40px 20px">
<div style="font-size:28px;letter-spacing:-1px;margin-bottom:28px">passéist<span style="color:#5a7593">.</span></div>${body}</div></body></html>` });
const escH = t => String(t || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

async function linkFlow(event) {
  const q = event.queryStringParameters || {};
  let s = q.s, t = q.t;
  if (event.httpMethod === 'POST') { const f = new URLSearchParams(event.body || ''); s = f.get('s'); t = f.get('t'); }
  if (!s || !t || t.length !== 32 || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(signFor(s)))) return page('Lien invalide', '<p>Lien invalide ou expiré.</p>');
  let session;
  try { session = await stripe.checkout.sessions.retrieve(s); } catch (e) { return page('Commande introuvable', '<p>Commande introuvable.</p>'); }
  const md = session.metadata || {};
  const pieces = (md.passeist_ids || '').split(',').filter(Boolean).map(id => escH(((PRODUCTS[id] || {}).brand || '') + ' · ' + ((PRODUCTS[id] || {}).type || id))).join('<br>');
  const where = md.ship_mode === 'relay' ? 'Point relais ' + escH(md.relay_name) : 'Livraison à domicile';
  const card = `<div style="background:#262D3C;border-radius:12px;padding:20px;line-height:1.6;margin-bottom:22px"><b>${pieces}</b><br>${((session.amount_total || 0) / 100).toLocaleString('fr-FR')} € · ${escH((session.customer_details || {}).name)}<br><span style="color:#a8a6a1">${where}</span></div>`;
  try { connectLambda(event); } catch (e) {}
  const store = getStore('passeist-orders');
  const prev = await store.get('boxtal/' + s, { type: 'json' });
  if (prev && prev.id) return page('Bordereau déjà créé', card + '<p>✓ Bordereau déjà créé. Il est dans vos e-mails.</p>');
  const ids = (md.passeist_ids || '').split(',').filter(Boolean);
  const lk = (href, txt) => `<a href="${escH(href)}" style="display:block;text-align:center;border:1px solid rgba(244,241,236,.35);color:#f4f1ec;text-decoration:none;border-radius:10px;padding:13px;margin-bottom:10px;font-size:15px">${txt}</a>`;
  const delist = `<p style="margin:0 0 10px;font-size:14px;color:#d6d2cc">1. Retirez la pièce des autres plateformes :</p>`
    + delistLinks(ids, PRODUCTS).map(l => (l.vestiaire ? lk(l.vestiaire, 'Annonce Vestiaire' + (ids.length > 1 ? ' · ' + escH(l.label) : '')) : '')
      + lk(l.vinted || l.vintedSearch, (l.vinted ? 'Annonce Vinted' : 'Chercher sur Vinted') + (ids.length > 1 ? ' · ' + escH(l.label) : ''))).join('')
    + `<p style="margin:22px 0 10px;font-size:14px;color:#d6d2cc">2. Si elle était toujours disponible :</p>`;
  if (event.httpMethod !== 'POST') return page('Créer le bordereau', card + delist
    + `<form method="post"><input type="hidden" name="s" value="${escH(s)}"><input type="hidden" name="t" value="${escH(t)}">`
    + `<button style="width:100%;background:#5a7593;color:#fff;border:0;border-radius:10px;padding:16px;font-size:16px;font-weight:600">Créer le bordereau</button></form>`
    + `<p style="color:#a8a6a1;font-size:13px;line-height:1.6;margin-top:18px">Pièce plus disponible ? N'appuyez pas : remboursez le client dans Stripe. Rien n'est payé chez Boxtal.</p>`);
  if (!boxtal.live()) return page('Mode réel inactif', card + '<p>Le mode réel Boxtal n\'est pas activé (BOXTAL_LIVE=1).</p>');
  const r = await shipSession({ session, store, PRODUCTS, force: true });
  if (r.error) return page('Refusé par Boxtal', card + '<p>Boxtal a refusé l\'envoi :</p><p style="color:#a8a6a1">' + escH(r.error) + '</p><p>Envoyez-moi ce message pour corriger.</p>');
  return page('Bordereau créé', card + '<p>✓ Envoi créé chez Boxtal. Le bordereau arrive dans vos e-mails dans quelques minutes.</p>');
}

exports.handler = async (event) => {
  if ((event.queryStringParameters || {}).s || /(^|&)s=/.test(event.body || '')) return linkFlow(event);
  if (event.httpMethod !== 'POST') return json(405, { error: 'method' });
  if (!isAdmin(event)) return json(401, { error: 'unauthorized' });
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}
  // Commande retrouvée par : référence cs_live_…, ID du paiement pi_… (appli Stripe),
  // référence P-XXXXXXXX (e-mail de confirmation) ou e-mail du client (dernière commande payée)
  const q = String(body.session || '').trim();
  let sid = (q.match(/cs_(live|test)_[A-Za-z0-9]+/) || [])[0];
  try {
    if (!sid && /pi_[A-Za-z0-9]+/.test(q)) {
      const r = await stripe.checkout.sessions.list({ payment_intent: q.match(/pi_[A-Za-z0-9]+/)[0], limit: 1 });
      sid = r.data[0] && r.data[0].id;
    } else if (!sid && /@/.test(q)) {
      const r = await stripe.checkout.sessions.list({ customer_details: { email: q.toLowerCase() }, limit: 20 });
      const paid = r.data.filter(x => x.payment_status === 'paid').sort((a, b) => b.created - a.created)[0];
      sid = paid && paid.id;
    } else if (!sid && /^P-?[A-Za-z0-9]{6,}$/i.test(q)) {
      const ref = q.replace(/^P-?/i, '').toLowerCase();
      for await (const x of stripe.checkout.sessions.list({ limit: 100 })) {
        if (x.id.toLowerCase().endsWith(ref)) { sid = x.id; break; }
        if (Date.now() / 1000 - x.created > 90 * 86400) break;
      }
    }
  } catch (e) { return json(400, { error: 'Stripe : ' + String(e.message).slice(0, 120) }); }
  const id = sid ? [sid] : null;
  if (!id) return json(400, { error: 'commande introuvable (e-mail du client, pi_… ou cs_live_…)' });
  if (!boxtal.enabled()) return json(400, { error: 'clés Boxtal absentes' });
  if (!boxtal.live()) return json(400, { error: 'mode réel pas activé (BOXTAL_LIVE=1 sur Netlify)' });
  let session;
  try { session = await stripe.checkout.sessions.retrieve(id[0]); }
  catch (e) { return json(400, { error: 'commande Stripe introuvable : ' + String(e.message).slice(0, 120) }); }
  if (session.payment_status !== 'paid') return json(400, { error: 'commande non payée' });
  const md = session.metadata || {};
  if (md.ship_mode !== 'relay' && md.ship_mode !== 'home') return json(400, { error: 'commande sans livraison relais ou domicile' });
  try { connectLambda(event); } catch (e) {}
  const r = await shipSession({ session, store: getStore('passeist-orders'), PRODUCTS, force: true });
  if (r.error) return json(502, { error: 'Boxtal : ' + r.error });
  if (r.already) return json(200, { ok: true, already: true, id: r.id });
  return json(200, { ok: true, id: r.id, status: r.status });
};
