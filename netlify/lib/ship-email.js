// E-mail « Votre commande est en route » (Tom, 2026-11-15), même habillage que la
// confirmation de commande (order-email.js) : logo, carte, photo des pièces, bouton de suivi.
// Envoyé par tracking-send.js (colis expédié à la main) et boxtal-webhook.js (suivi Boxtal).
const brevo = require('./brevo');

const SITE = 'https://passeist.com';
const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const title = (s) => String(s || '').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, m => m.toUpperCase());

function buildShipHtml({ en, firstName, ref, carrier, number, url, items }) {
  // Texte repris du modèle Pennylane de Tom (2026-11-15)
  const hello = firstName ? (en ? `Hello ${esc(firstName)},` : `Bonjour ${esc(firstName)},`) : (en ? 'Hello,' : 'Bonjour,');
  const rows = (items || []).map(it => `
    <tr>
      <td width="96" valign="top" style="padding:10px 14px 10px 0;">
        ${it.img ? `<img src="${esc(it.img)}" width="96" alt="" style="display:block;width:96px;height:auto;border-radius:6px;background:#ffffff;">` : ''}
      </td>
      <td valign="middle" style="padding:10px 0;font-size:14px;line-height:1.5;color:#f4f1ec;">${esc(it.name)}</td>
    </tr>`).join('');
  return `<!DOCTYPE html><html lang="${en ? 'en' : 'fr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"></head>
<body style="margin:0;padding:0;background:#1C2230;font-family:Helvetica,Arial,sans-serif;color:#f4f1ec;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#1C2230;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;padding:28px 16px;">
  <tr><td align="center" style="font-size:32px;letter-spacing:-1px;padding-bottom:22px;">
    <a href="${SITE}/" style="color:#f4f1ec;text-decoration:none;">passéist<span style="color:#5a7593;">.</span></a></td></tr>
  <tr><td style="background:#262D3C;border-radius:12px;padding:24px 22px;">
    <div style="font-size:18px;margin-bottom:10px;">${hello}</div>
    <div style="font-size:14px;line-height:1.6;color:#d6d2cc;">${en
      ? `Your order is on its way with ${esc(carrier)}. You can track your parcel in real time using the link below and your tracking number.`
      : `Votre commande est en route avec ${esc(carrier)}. Vous pouvez suivre votre colis en temps réel grâce au lien ci-dessous et à votre numéro de suivi.`}</div>
    ${rows ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:18px;border-top:1px solid rgba(244,241,236,0.12);">${rows}</table>` : ''}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px;border-top:1px solid rgba(244,241,236,0.12);">
      <tr><td style="padding:14px 0 4px;font-size:12px;color:#a8a6a1;">${en ? 'Tracking number' : 'Numéro de suivi'}</td></tr>
      <tr><td style="padding:0 0 18px;font-size:16px;letter-spacing:0.04em;color:#f4f1ec;">${esc(number)}</td></tr>
      <tr><td align="center"><a href="${esc(url)}" style="display:inline-block;background:#5a7593;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;padding:14px 26px;border-radius:8px;">${en ? 'Track my parcel' : 'Suivre mon colis'}</a></td></tr>
    </table>
    <div style="margin-top:18px;font-size:12px;line-height:1.6;color:#a8a6a1;">${en ? 'Order' : 'Commande'} <span style="color:#d6d2cc;">${esc(ref)}</span></div>
    <div style="margin-top:18px;font-size:14px;line-height:1.6;color:#d6d2cc;">${en
      ? 'Thank you for your purchase and for your trust in passéist. It’s a pleasure to have you as a customer.<br><br>Best regards,<br>passéist'
      : 'Merci pour votre achat et pour votre confiance en passéist. C’est un plaisir de vous compter parmi nos clients.<br><br>Bien cordialement,<br>passéist'}</div>
  </td></tr>
  <tr><td align="center" style="padding:22px 12px 8px;font-size:13px;line-height:1.6;color:#d6d2cc;">
    ${en ? 'A question about your delivery? Just reply to this email, or write to' : 'Une question sur votre livraison ? Répondez simplement à cet e-mail, ou écrivez à'}
    <a href="mailto:info@passeist.com" style="color:#f4f1ec;">info@passeist.com</a>.
  </td></tr>
  <tr><td align="center" style="padding:14px 12px 0;font-size:11px;line-height:1.6;color:#a8a6a1;">PASSEIST EURL · Paris</td></tr>
</table></td></tr></table></body></html>`;
}

// Pièces de la commande (nom et photo) à partir de la session Stripe
async function itemsFor(stripe, sessionId) {
  try {
    const li = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 20, expand: ['data.price.product'] });
    return li.data.map(x => {
      const prod = (x.price && x.price.product) || {};
      const id = (prod.metadata && prod.metadata.passeist_id) || '';
      const name = String(prod.name || x.description || '').replace(/^([^—]+)—/, (m, b) => title(b.trim()) + ' ·');
      return { name, img: id ? `${SITE}/.netlify/images?url=${encodeURIComponent('/img/' + id + '-0-md.webp')}&fm=jpg&w=300` : '' };
    });
  } catch (e) { return []; }
}

async function sendShipEmail({ stripe, session, carrier, number, url }) {
  const cd = session.customer_details || {};
  const en = String(session.locale || '').startsWith('en');
  const firstName = String(cd.name || '').trim().split(/\s+/)[0] || '';
  const ref = 'P-' + String(session.id).slice(-8).toUpperCase();
  const items = await itemsFor(stripe, session.id);
  await brevo.sendOne({ to: cd.email, subject: en ? 'Your passéist order is on its way' : 'Votre commande passéist est en route',
    html: buildShipHtml({ en, firstName, ref, carrier, number, url, items }) });
}

module.exports = { buildShipHtml, sendShipEmail };
