// Netlify Function planifiée (chaque dimanche, cf. netlify.toml) — une seule
// notification par semaine aux clients abonnés : les pièces arrivées depuis
// la dernière, avec les maisons les plus représentées. Rien si aucune nouveauté.
const { getStore, connectLambda } = require('@netlify/blobs');
const push = require('../lib/push');
const PRODUCTS = require('./products.json'); // pièces en vente (vendues exclues)

const title = (s) => String(s || '').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, m => m.toUpperCase());

exports.handler = async (event) => {
  try { connectLambda(event); } catch (e) { /* contexte Blobs fourni autrement */ }
  const store = getStore(push.STORE);
  const ids = Object.keys(PRODUCTS);
  const seenList = await store.get('state/seen', { type: 'json' });
  if (!Array.isArray(seenList)) {
    await store.setJSON('state/seen', ids);
    return { statusCode: 200, body: 'init' };
  }
  const seen = new Set(seenList);
  const fresh = ids.filter(id => !seen.has(id));
  if (fresh.length < 3) return { statusCode: 200, body: 'trop peu de nouveautés' };
  if (!push.ready()) return { statusCode: 200, body: 'clés VAPID absentes' };

  const count = new Map();
  fresh.forEach(id => { const b = PRODUCTS[id].brand || ''; count.set(b, (count.get(b) || 0) + 1); });
  const brands = [...count].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b]) => title(b)).filter(Boolean).join(', ');
  const n = fresh.length;
  const payloads = {
    fr: { title: `passéist · ${n} nouvelle${n > 1 ? 's' : ''} pièce${n > 1 ? 's' : ''}`, body: `Cette semaine : ${brands}${count.size > 3 ? '…' : ''}`, url: '/shop', tag: 'news' },
    en: { title: `passéist · ${n} new piece${n > 1 ? 's' : ''}`, body: `This week: ${brands}${count.size > 3 ? '…' : ''}`, url: '/shop', tag: 'news' },
  };

  const { blobs } = await store.list({ prefix: 'client/' });
  let sent = 0;
  for (const b of blobs) {
    const rec = await store.get(b.key, { type: 'json' });
    if (!rec || !rec.news) continue;
    if (await push.send(store, b.key.slice('client/'.length), payloads[rec.lang === 'en' ? 'en' : 'fr'])) sent++;
  }
  await store.setJSON('state/seen', ids.concat(seenList.filter(id => !PRODUCTS[id])));
  console.log(`notifications de la semaine : ${n} pièces, ${sent} envoyées`);
  return { statusCode: 200, body: 'sent ' + sent };
};
