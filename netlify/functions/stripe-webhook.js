// Netlify Function — webhook Stripe
// Reçoit les événements Stripe (notamment checkout.session.completed)
// et déclenche les actions post-paiement :
//   - Email de notification à Tom (via le compte Stripe directement)
//   - Bascule auto SOLD_IDS du produit vendu (via GitHub API push)
//
// ENV VARS NÉCESSAIRES :
//   STRIPE_SECRET_KEY    = sk_test_... ou sk_live_...
//   STRIPE_WEBHOOK_SECRET = whsec_... (généré dans Stripe Dashboard → Webhooks)
//   GITHUB_TOKEN          = ghp_... ou github_pat_... (avec perm Contents:write)
//   GITHUB_REPO           = passeist-site/passeist-site (par défaut)
//
// Endpoint exposé : https://passeist.com/.netlify/functions/stripe-webhook
// À enregistrer dans Stripe Dashboard → Développeurs → Webhooks → "Ajouter un endpoint"
// Events à écouter : checkout.session.completed

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const GITHUB_REPO = process.env.GITHUB_REPO || 'passeist-site/passeist-site';

async function basculeSoldIdsOnGitHub(productIds) {
  if (!process.env.GITHUB_TOKEN) {
    console.warn('GITHUB_TOKEN absent — skip bascule SOLD_IDS auto');
    return;
  }
  // 1. Get current index.html via GitHub API
  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    'User-Agent': 'passeist-stripe-webhook',
    Accept: 'application/vnd.github+json',
  };
  const fileUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/index.html`;
  const fileRes = await fetch(fileUrl, { headers });
  if (!fileRes.ok) throw new Error(`GitHub fetch fail: ${fileRes.status}`);
  const fileData = await fileRes.json();
  const sha = fileData.sha;
  let html = Buffer.from(fileData.content, 'base64').toString('utf8');

  // 2. Parse SOLD_IDS et ajoute les ids
  const m = html.match(/(const SOLD_IDS = new Set\(\[)([\s\S]*?)(\]\);)/);
  if (!m) throw new Error('SOLD_IDS not found');
  const existingIds = new Set([...m[2].matchAll(/"(\d+)"/g)].map(x => x[1]));
  let added = 0;
  for (const id of productIds) {
    if (!existingIds.has(id)) { existingIds.add(id); added++; }
  }
  if (added === 0) { console.log('Aucun nouveau SOLD à ajouter'); return; }
  const inside = '\n  ' + [...existingIds].map(i => `"${i}"`).join(',\n  ') + '\n';
  html = html.replace(m[0], m[1] + inside + m[3]);

  // 3. Validation : aucune virgule manquante
  const test = html.match(/(const SOLD_IDS = new Set\(\[)([\s\S]*?)(\]\);)/);
  if (/"\d+"\s*\n\s*"\d+"/.test(test[2])) {
    throw new Error('Virgule manquante détectée — abort');
  }

  // 4. Commit via GitHub API
  const commitRes = await fetch(fileUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `auto-sold: ${added} ventes Stripe (IDs: ${productIds.join(', ')})\n\n🤖 Webhook stripe-webhook automatique`,
      content: Buffer.from(html, 'utf8').toString('base64'),
      sha,
      branch: 'main',
      committer: { name: 'passeist-bot', email: 'bot@passeist.com' },
    }),
  });
  if (!commitRes.ok) {
    const err = await commitRes.text();
    throw new Error(`GitHub commit fail: ${commitRes.status} ${err}`);
  }
  console.log(`✓ ${added} SOLD_IDS basculés via webhook Stripe`);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  const sig = event.headers['stripe-signature'];
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // On traite uniquement le succès de paiement
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    console.log('✓ Paiement réussi :', session.id, session.amount_total, session.currency);

    // Récupère les IDs des produits achetés depuis metadata
    const productIds = (session.metadata && session.metadata.passeist_ids || '').split(',').filter(Boolean);
    if (productIds.length > 0) {
      try {
        await basculeSoldIdsOnGitHub(productIds);
      } catch (err) {
        console.error('Erreur bascule SOLD :', err.message);
        // On ne fait pas échouer le webhook pour ça (le paiement reste valide)
      }
    }
    // Stripe envoie déjà un email de confirmation au client (configurable dans Dashboard)
    // Pour notifier Tom : un email "Nouveau paiement" est envoyé par Stripe à l'admin du compte.
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
