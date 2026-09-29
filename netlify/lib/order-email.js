// E-mail de confirmation passéist, envoyé par Brevo après chaque paiement
// Stripe (cf. stripe-webhook.js). Le reçu Stripe reste envoyé en plus.
const brevo = require('./brevo');

const SITE = 'https://passeist.com';
const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const title = (s) => String(s || '').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, m => m.toUpperCase());
const money = (cents, en) => (cents / 100).toLocaleString(en ? 'en-GB' : 'fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';

async function photoFor(id) {
  const url = `${SITE}/img/${id}-0-md.webp`;
  try { const r = await fetch(url, { method: 'HEAD' }); return r.ok ? url : ''; } catch (e) { return ''; }
}

// items : [{ id, name, amount (centimes) }]
function buildHtml({ en, firstName, items, shipping, total, address }) {
  const hello = firstName ? (en ? `Thank you, ${esc(firstName)}` : `Merci ${esc(firstName)}`) : (en ? 'Thank you' : 'Merci');
  const rows = items.map(it => `
    <tr>
      <td width="96" valign="top" style="padding:10px 14px 10px 0;">
        ${it.img ? `<img src="${it.img}" width="96" alt="" style="display:block;width:96px;height:auto;border-radius:6px;background:#ffffff;">` : ''}
      </td>
      <td valign="top" style="padding:10px 0;font-size:14px;line-height:1.5;color:#f4f1ec;">
        ${esc(it.name)}<br><span style="color:#a8a6a1;">${money(it.amount, en)}</span>
      </td>
    </tr>`).join('');
  return `<!DOCTYPE html><html lang="${en ? 'en' : 'fr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"></head>
<body style="margin:0;padding:0;background:#1C2230;font-family:Helvetica,Arial,sans-serif;color:#f4f1ec;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#1C2230;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;padding:28px 16px;">
  <tr><td align="center" style="font-size:32px;letter-spacing:-1px;padding-bottom:22px;">
    <a href="${SITE}/" style="color:#f4f1ec;text-decoration:none;">passéist<span style="color:#5a7593;">.</span></a></td></tr>
  <tr><td style="background:#262D3C;border-radius:12px;padding:24px 22px;">
    <div style="font-size:21px;margin-bottom:8px;">${hello}</div>
    <div style="font-size:14px;line-height:1.6;color:#d6d2cc;">${en
      ? 'Your order is confirmed. We are preparing your piece with care: it ships within 2 to 5 business days, tracked, and you will receive the tracking number by email.'
      : 'Votre commande est confirmée. Nous préparons votre pièce avec soin : elle part sous 2 à 5 jours ouvrés, en envoi suivi, et vous recevrez le numéro de suivi par e-mail.'}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:18px;border-top:1px solid rgba(244,241,236,0.12);">${rows}</table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid rgba(244,241,236,0.12);font-size:13px;color:#d6d2cc;">
      <tr><td style="padding:10px 0 2px;">${en ? 'Shipping' : 'Livraison'}</td><td align="right" style="padding:10px 0 2px;">${money(shipping, en)}</td></tr>
      <tr><td style="padding:4px 0;font-size:15px;color:#f4f1ec;">Total</td><td align="right" style="padding:4px 0;font-size:15px;color:#f4f1ec;">${money(total, en)}</td></tr>
    </table>
    ${address ? `<div style="margin-top:16px;font-size:13px;line-height:1.6;color:#a8a6a1;">${en ? 'Delivery to' : 'Livraison à'}<br><span style="color:#d6d2cc;">${address}</span></div>` : ''}
  </td></tr>
  <tr><td align="center" style="padding:22px 12px 8px;font-size:13px;line-height:1.6;color:#d6d2cc;">
    ${en ? 'A question about your order? Just reply to this email, or write to' : 'Une question sur votre commande ? Répondez simplement à cet e-mail, ou écrivez à'}
    <a href="mailto:info@passeist.com" style="color:#f4f1ec;">info@passeist.com</a>.
  </td></tr>
  <tr><td align="center" style="padding:14px 12px 0;font-size:11px;line-height:1.6;color:#a8a6a1;">
    ${en ? 'Your payment receipt is sent separately by Stripe.' : 'Votre reçu de paiement vous est envoyé séparément par Stripe.'}<br>passéist · Paris
  </td></tr>
</table></td></tr></table></body></html>`;
}

// session : Checkout Session Stripe ; lineItems : résultat de listLineItems (price.product développé)
async function sendOrderEmail(session, lineItems) {
  const cd = session.customer_details || {};
  const to = cd.email;
  if (!to || !brevo.enabled()) return false;
  const en = String(session.locale || '').startsWith('en');
  const firstName = String(cd.name || '').trim().split(/\s+/)[0] || '';
  const items = await Promise.all((lineItems || []).map(async li => {
    const prod = (li.price && li.price.product) || {};
    const id = (prod.metadata && prod.metadata.passeist_id) || '';
    const name = String(prod.name || li.description || '').replace(/^([^—]+)—/, (m, b) => title(b.trim()) + ' ·');
    return { id, name, amount: li.amount_total, img: id ? await photoFor(id) : '' };
  }));
  const ship = session.shipping_details || (session.collected_information && session.collected_information.shipping_details) || {};
  const a = ship.address || {};
  const address = [ship.name, a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(' '), a.country].filter(Boolean).map(esc).join('<br>');
  const shipping = (session.shipping_cost && session.shipping_cost.amount_total) || 0;
  const html = buildHtml({ en, firstName, items, shipping, total: session.amount_total || 0, address });
  await brevo.sendOne({ to, subject: en ? 'Your passéist order is confirmed' : 'Votre commande passéist est confirmée', html });
  return true;
}

module.exports = { sendOrderEmail, buildHtml };
