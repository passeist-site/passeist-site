// Netlify Function planifiée (samedi 18 h, cf. netlify.toml) : envoie à Tom
// l'aperçu exact de la newsletter du lendemain et une notification sur son
// téléphone. Elle ne partira dimanche que s'il la valide dans la messagerie.
const { getStore, connectLambda } = require('@netlify/blobs');
const brevo = require('../lib/brevo');
const { notifyAdmin } = require('../lib/admin-push');
const send = require('./newsletter-send');
const PRODUCTS = require('./products.json');

exports.handler = async (event) => {
  try { connectLambda(event); } catch (e) { /* contexte Blobs fourni autrement */ }
  const store = getStore('passeist-newsletter');
  const seenList = await store.get('state/seen', { type: 'json' });
  if (!Array.isArray(seenList)) return { statusCode: 200, body: 'pas encore initialisée' };
  const seen = new Set(seenList);
  const fresh = Object.keys(PRODUCTS).filter(id => !seen.has(id));
  const date = send._nextSendDate();
  if (fresh.length < send._BATCH && !send._composed()) {   // semaine choisie par Tom : aperçu quand même
    await notifyAdmin({ title: 'passéist · newsletter', body: `Seulement ${fresh.length} nouvelles pièces : pas d'envoi demain.`, url: '/messagerie/#newsletter', tag: 'newsletter' });
    return { statusCode: 200, body: 'trop peu' };
  }
  const featured = await send._featuredItems(store);
  const featIds = new Set(featured.map(f => f.id));
  const groups = await send._groupsFor(fresh.filter(id => !featIds.has(id)));
  const html = send._buildHtml('fr', groups, fresh.length, featured, ((await store.get('state/note', { type: 'json' })) || {}).text || '').replace('{{ unsubscribe }}', 'https://passeist.com/');
  const to = process.env.NEWSLETTER_PREVIEW_TO || process.env.NEWSLETTER_FROM || 'info@passeist.com';
  try { await brevo.sendOne({ to, subject: `[À valider] Newsletter du ${date}`, html }); }
  catch (err) { console.error('aperçu newsletter :', err.message); }
  await notifyAdmin({ title: 'passéist · newsletter à valider', body: `${send._composed() ? 'Votre sélection' : fresh.length + ' nouvelles pièces'}. Aperçu envoyé sur ${to} : validez avant dimanche 17 h.`, url: '/messagerie/#newsletter', tag: 'newsletter' });
  return { statusCode: 200, body: 'aperçu envoyé' };
};
