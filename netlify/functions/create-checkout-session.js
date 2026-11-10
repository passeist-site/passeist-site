// Netlify Function — crée une Stripe Checkout Session pour les items du panier.
// Appelée par le frontend au clic sur "Procéder au paiement".
//
// ENV VARS NÉCESSAIRES (à définir dans Netlify Site Settings → Environment Variables) :
//   STRIPE_SECRET_KEY  = sk_test_... (mode test) ou sk_live_... (production)
//
// Body POST attendu (JSON) :
//   {
//     items: [{ id, brand, type, price, slug, image }, ...],
//     locale: 'fr' | 'en',
//     country: 'FR' | 'BE' | ... (code pays ISO pour calcul frais port)
//   }
//
// Réponse :
//   { url: 'https://checkout.stripe.com/c/pay/cs_test_...' }
//
// → le frontend redirige vers cette URL, Stripe gère le paiement,
//   au succès l'utilisateur revient sur /success?session_id=...

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getStore, connectLambda } = require('@netlify/blobs');

// Pièces déjà vendues sur le site (enregistrées par stripe-webhook dans Netlify
// Blobs). En cas d'erreur de lecture, on ne bloque pas le paiement.
async function findSoldIds(event, ids) {
  try {
    connectLambda(event);
    const store = getStore('passeist-sold');
    const found = await Promise.all(ids.map(async id => ((await store.get(String(id))) ? String(id) : null)));
    return found.filter(Boolean);
  } catch (err) {
    console.error('Lecture vendus (Blobs) impossible :', err.message);
    return [];
  }
}

// Source de vérité des prix côté serveur (généré depuis index.html via tools/export_products.py)
// IMPORTANT : on N'UTILISE JAMAIS le prix envoyé par le client — il est trivialement
// modifiable via les devtools. Le prix Stripe est toujours celui du JSON serveur.
const PRODUCTS = require('./products.json');

// Frais de port par zone (en centimes, devise EUR) — cohérents avec CGV
const SHIPPING_RATES = {
  FR: { amount: 1500, label: 'Livraison France' },         // 15€
  EU: { amount: 2500, label: 'Livraison Europe' },         // 25€
  WORLD: { amount: 5500, label: 'Livraison internationale' }, // 55€
};

const EU_COUNTRIES = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
  'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
  // UK + Suisse + Norvège : on les met en zone EU pour la simplicité (frais ≈ 15€)
  'GB','CH','NO',
]);

function shippingForCountry(country) {
  if (!country) return SHIPPING_RATES.FR;
  if (country === 'FR') return SHIPPING_RATES.FR;
  if (EU_COUNTRIES.has(country)) return SHIPPING_RATES.EU;
  return SHIPPING_RATES.WORLD;
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://passeist.com',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { items, locale, country, cancelUrl } = JSON.parse(event.body || '{}');
    if (!Array.isArray(items) || items.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Items required' }) };
    }

    const baseUrl = process.env.URL || 'https://passeist.com';
    const lang = locale === 'en' ? 'en' : 'fr';

    // Anti double vente : refuse une pièce déjà vendue sur le site
    const soldIds = await findSoldIds(event, items.map(i => String(i.id || '')).filter(Boolean));
    if (soldIds.length > 0) {
      return {
        statusCode: 409,
        headers: { 'Access-Control-Allow-Origin': 'https://passeist.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'sold',
          sold: soldIds,
          message: lang === 'en'
            ? 'Sorry, this piece has just been sold.'
            : 'Désolé, cette pièce vient d\'être vendue.',
        }),
      };
    }
    const ship = shippingForCountry(country);

    // Validation cancelUrl : doit être une URL passeist.com (sécu : pas de redirection ouverte)
    let safeCancelUrl = `${baseUrl}/cancel.html`;
    if (cancelUrl && typeof cancelUrl === 'string') {
      try {
        const u = new URL(cancelUrl);
        // Accepte uniquement passeist.com (et sous-domaines Netlify pour deploy previews)
        if (u.hostname === 'passeist.com' ||
            u.hostname === 'www.passeist.com' ||
            u.hostname.endsWith('.netlify.app')) {
          safeCancelUrl = cancelUrl;
        }
      } catch (e) {
        // URL invalide → on garde le fallback
      }
    }

    // Construit les line items Stripe en validant chaque article contre PRODUCTS
    // (source de vérité serveur). Refuse la session si :
    //   - id inconnu (article non vendu sur passeist.com)
    //   - prix manquant ou invalide dans la donnée serveur
    // Les champs visuels (brand/type/size) viennent aussi du serveur — pas du client.
    const validationErrors = [];
    const lineItems = items.map(item => {
      const id = String(item.id || '');
      const ref = PRODUCTS[id];
      if (!ref) {
        validationErrors.push(`unknown_id:${id}`);
        return null;
      }
      const priceCents = Math.round(parseFloat(ref.price) * 100);
      if (!isFinite(priceCents) || priceCents <= 0) {
        validationErrors.push(`invalid_price:${id}`);
        return null;
      }
      return {
        price_data: {
          currency: 'eur',
          product_data: {
            name: `${ref.brand} — ${ref.type}`,
            description: ref.size ? `Taille ${ref.size}` : undefined,
            // image envoyée par le client : on la filtre par host (anti SSRF / abus)
            images: (item.image && /^https:\/\/(passeist\.com|images\.vestiairecollective\.com)/i.test(item.image))
              ? [item.image]
              : [],
            metadata: { passeist_id: id, slug: ref.slug || '' },
          },
          unit_amount: priceCents, // prix serveur, pas client
        },
        quantity: 1,
      };
    }).filter(Boolean);

    if (validationErrors.length > 0) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': 'https://passeist.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Items invalides : ' + validationErrors.join(', ') }),
      };
    }
    if (lineItems.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': 'https://passeist.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Aucun article valide' }),
      };
    }

    // Construction des shipping_options (Stripe demande un format spécifique)
    const shippingOptions = [{
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: ship.amount, currency: 'eur' },
        display_name: ship.label,
        delivery_estimate: {
          minimum: { unit: 'business_day', value: 2 },
          maximum: { unit: 'business_day', value: 7 },
        },
      },
    }];

    // Moyens de paiement (Tom, nov. 2026) : uniquement des paiements
    // immédiats. La pièce est marquée vendue dès « commande passée » (cf
    // stripe-webhook) : un prélèvement SEPA, un virement ou un paiement en
    // espèces, confirmés des jours plus tard, la bloqueraient sans être payée.
    // card = carte + Apple Pay + Google Pay ; link = Link (Stripe) ;
    // klarna = paiement en 3 ou 4 fois. Stripe n'affiche que ceux qui
    // conviennent au pays et à la devise du client.
    const PAYMENT_METHODS = ['card', 'link', 'klarna', 'bancontact', 'ideal', 'revolut_pay'];
    const sessionParams = {
      mode: 'payment',
      payment_method_types: PAYMENT_METHODS,
      line_items: lineItems,
      shipping_address_collection: {
        allowed_countries: [
          'FR','BE','LU','DE','IT','ES','NL','GB','CH','AT','PT','IE','GR',
          'SE','DK','NO','FI','PL','CZ','HU','HR','SI','SK','EE','LV','LT',
          'BG','RO','CY','MT','US','CA','JP','KR','AU','NZ','SG','HK',
        ],
      },
      shipping_options: shippingOptions,
      billing_address_collection: 'required',
      // Champ « Code promo » (ex. les 10 % offerts si une pièce n'était plus disponible)
      allow_promotion_codes: true,
      phone_number_collection: { enabled: true },
      // Pas de relance de panier abandonné : un client qui avait ouvert le
      // paiement deux fois recevait un « lien de paiement » après avoir payé.
      locale: lang,
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: safeCancelUrl,
      metadata: {
        passeist_ids: items.map(i => i.id).join(','),
      },
    };
    // Un moyen refusé par Stripe (pas activé dans le tableau de bord…) ne doit
    // jamais empêcher de payer. Avant : au moindre refus on repassait à la carte
    // seule, et tous les autres moyens disparaissaient (Tom, 2026-11-10). Maintenant
    // on retire seulement le moyen refusé et on réessaie ; carte seule en dernier.
    let session;
    let methods = PAYMENT_METHODS.slice();
    for (let attempt = 0; ; attempt++) {
      try {
        session = await stripe.checkout.sessions.create({ ...sessionParams, payment_method_types: methods });
        break;
      } catch (e) {
        const txt = String(e && e.param || '') + ' ' + String(e && e.message || '');
        if (!(e && e.type === 'StripeInvalidRequestError' && /payment_method/i.test(txt))) throw e;
        const bad = methods.filter(m => m !== 'card' && txt.includes(m));
        console.warn('Moyen de paiement refusé par Stripe :', bad.join(',') || '?', '-', e.message);
        if (!bad.length || attempt >= 5) { methods = ['card']; }
        else { methods = methods.filter(m => !bad.includes(m)); }
        if (attempt >= 6) throw e;
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://passeist.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: session.url, id: session.id }),
    };
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': 'https://passeist.com' },
      body: JSON.stringify({ error: 'server' }),
    };
  }
};
