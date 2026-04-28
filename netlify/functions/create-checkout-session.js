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

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
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
      phone_number_collection: { enabled: true },
      // Récupération auto du panier abandonné : Stripe envoie un email
      // de relance ~24h après abandon si le client a saisi son email
      after_expiration: {
        recovery: {
          enabled: true,
          allow_promotion_codes: false,
        },
      },
      locale: lang,
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: safeCancelUrl,
      metadata: {
        passeist_ids: items.map(i => i.id).join(','),
      },
    });

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
      body: JSON.stringify({ error: err.message }),
    };
  }
};
