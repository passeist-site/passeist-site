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
async function shipSession({ session, store, PRODUCTS, force = false }) {
  const md = session.metadata || {};
  const notify = process.env.ORDER_NOTIFY_EMAIL || 'info@passeist.com';
  try {
    const prev = await store.get('boxtal/' + session.id, { type: 'json' });
    if (prev && prev.id) return { already: true, id: prev.id };
    if (prev && !force) return { skipped: true };
    const ids = (md.passeist_ids || '').split(',').filter(Boolean);
    const types = ids.map(id => (PRODUCTS[id] || {}).type || '');
    const order = boxtal.buildOrder({ session, types, valueEur: (session.amount_subtotal || 0) / 100 });
    const resume = `${md.ship_mode === 'relay' ? 'Point relais : ' + esc(md.relay_name) + ' (' + esc(md.relay_address) + ')' : 'Domicile'}<br>Poids déclaré : ${order.shipment.packages[0].weight} kg<br>Offre : ${esc(order.shippingOfferCode)}`;
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

module.exports = { shipSession };
