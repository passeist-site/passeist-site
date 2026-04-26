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

// Frais de port par zone (en centimes, devise EUR)
const SHIPPING_RATES = {
  FR: { amount: 800, label: 'Livraison France · Colissimo Suivi' },          // 8€
  EU: { amount: 1500, label: 'Livraison Europe · Colissimo International' }, // 15€
  WORLD: { amount: 2500, label: 'International express · DHL' },             // 25€
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
        'Access-Control-Allow-Origin': '*',
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
    const { items, locale, country } = JSON.parse(event.body || '{}');
    if (!Array.isArray(items) || items.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Items required' }) };
    }

    const baseUrl = process.env.URL || 'https://passeist.com';
    const lang = locale === 'en' ? 'en' : 'fr';
    const ship = shippingForCountry(country);

    // Construit les line items Stripe
    const lineItems = items.map(item => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: `${item.brand} — ${item.type}`,
          description: item.size ? `Taille ${item.size}` : undefined,
          images: item.image ? [item.image] : [],
          metadata: { passeist_id: item.id, slug: item.slug || '' },
        },
        unit_amount: Math.round(parseFloat(item.price) * 100), // en centimes
      },
      quantity: 1, // 1 exemplaire unique par produit
    }));

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
      locale: lang,
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/cancel.html`,
      metadata: {
        passeist_ids: items.map(i => i.id).join(','),
      },
    });

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: session.url, id: session.id }),
    };
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
