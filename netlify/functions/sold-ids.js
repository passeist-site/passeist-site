// Netlify Function — liste des pièces vendues sur le site (Netlify Blobs).
// Le site la lit au chargement pour afficher tout de suite une pièce comme
// vendue, sans attendre la republication (cf. stripe-webhook.js).
const { getStore, connectLambda } = require('@netlify/blobs');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
  try {
    connectLambda(event);
    const store = getStore('passeist-sold');
    const { blobs } = await store.list();
    return { statusCode: 200, headers, body: JSON.stringify({ ids: blobs.map(b => b.key) }) };
  } catch (err) {
    console.error('sold-ids :', err.message);
    // En cas d'erreur, liste vide : le site reste utilisable (SOLD_IDS statique)
    return { statusCode: 200, headers, body: JSON.stringify({ ids: [], error: 'unavailable' }) };
  }
};
