// Brevo (ex-Sendinblue) : envoi des e-mails de la newsletter « nouvelles pièces ».
//
// Variables d'environnement Netlify :
//   BREVO_API_KEY    clé API Brevo (SMTP & API → Clés API)
//   BREVO_LIST_FR    id de la liste des abonnés français
//   BREVO_LIST_EN    id de la liste des abonnés des autres langues
//                    (si absente : tout le monde dans BREVO_LIST_FR)
//   NEWSLETTER_FROM  adresse d'envoi validée dans Brevo (défaut info@passeist.com)
// Sans BREVO_API_KEY, rien n'est envoyé : les inscriptions restent en attente.
const API = 'https://api.brevo.com/v3';

function enabled() { return !!process.env.BREVO_API_KEY; }

function listFor(lang) {
  const fr = Number(process.env.BREVO_LIST_FR || 0);
  const en = Number(process.env.BREVO_LIST_EN || 0) || fr;
  return lang === 'en' ? en : fr;
}

async function call(path, method, body) {
  const r = await fetch(API + path, {
    method,
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Brevo ${method} ${path} : ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

// Ajoute (ou met à jour) un abonné. Renvoie true si c'est fait.
async function addToBrevo(email, lang) {
  if (!enabled() || !listFor(lang)) return false;
  await call('/contacts', 'POST', { email, listIds: [listFor(lang)], updateEnabled: true });
  return true;
}

// Crée une campagne et l'envoie tout de suite à la liste de la langue.
async function sendCampaign({ lang, subject, html, name }) {
  const listId = listFor(lang);
  if (!enabled() || !listId) return false;
  const from = process.env.NEWSLETTER_FROM || 'info@passeist.com';
  const { id } = await call('/emailCampaigns', 'POST', {
    name, subject,
    sender: { name: 'passéist', email: from },
    replyTo: from,
    htmlContent: html,
    recipients: { listIds: [listId] },
  });
  await call(`/emailCampaigns/${id}/sendNow`, 'POST');
  return true;
}

module.exports = { enabled, listFor, addToBrevo, sendCampaign };
