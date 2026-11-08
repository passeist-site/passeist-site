// Brevo (ex-Sendinblue) : envoi des e-mails de la newsletter « nouvelles pièces ».
//
// Variables d'environnement Netlify :
//   BREVO_API_KEY    clé API Brevo (SMTP & API → Clés API)
//   BREVO_LIST_FR    id de la liste des abonnés français
//   BREVO_LIST_EN    id de la liste des abonnés des autres langues
//                    (si absente : tout le monde dans BREVO_LIST_FR)
//   NEWSLETTER_FROM  adresse d'envoi validée dans Brevo (défaut info@passeist.com)
//   BREVO_UNSUB_FR   id de la page de désinscription Brevo (français), facultatif
//   BREVO_UNSUB_EN   id de la page de désinscription Brevo (anglais), facultatif
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
    // Page de désinscription Brevo avec bouton de confirmation (les robots
    // antivirus qui ouvrent tous les liens ne désinscrivent plus personne)
    ...(process.env['BREVO_UNSUB_' + String(lang).toUpperCase()] ? { unsubscriptionPageId: process.env['BREVO_UNSUB_' + String(lang).toUpperCase()] } : {}),
  });
  await call(`/emailCampaigns/${id}/sendNow`, 'POST');
  return true;
}

// E-mail unique (test de la newsletter depuis la messagerie)
async function sendOne({ to, subject, html }) {
  if (!enabled()) return false;
  const from = process.env.NEWSLETTER_FROM || 'info@passeist.com';
  await call('/smtp/email', 'POST', { sender: { name: 'passéist', email: from }, to: [{ email: to }], subject, htmlContent: html });
  return true;
}

// Appel léger quotidien : Brevo désactive les clés inutilisées 90 jours.
async function ping() {
  if (!enabled()) return false;
  await call('/account', 'GET');
  return true;
}

// Nom et nombre de contacts d'une liste (vérification avant l'envoi, messagerie)
async function listInfo(id) {
  if (!enabled() || !id) return null;
  const l = await call(`/contacts/lists/${id}`, 'GET');
  return { id, name: l.name, count: l.uniqueSubscribers ?? l.totalSubscribers ?? 0 };
}

// Renvoie la newsletter à UNE personne déjà inscrite (inscrite après l'envoi, par ex.).
// C'est une vraie campagne Brevo (objet normal, lien de désinscription, statistiques),
// envoyée à une petite liste « passéist · envoi à une personne » vidée avant chaque
// envoi. Refuse une adresse qui n'est dans aucune des deux listes de la newsletter :
// jamais d'envoi à quelqu'un qui ne s'est pas inscrit.
const SINGLE_LIST = 'passéist · envoi à une personne';
async function sendCampaignTo({ email, subject, html, name }) {
  if (!enabled()) throw new Error('clé Brevo absente');
  let contact;
  try { contact = await call(`/contacts/${encodeURIComponent(email)}`, 'GET'); }
  catch (e) { throw new Error('adresse inconnue de Brevo : elle ne s\'est pas inscrite à la newsletter'); }
  const ids = contact.listIds || [];
  const fr = listFor('fr'), en = listFor('en');
  const lang = ids.includes(fr) ? 'fr' : ids.includes(en) ? 'en' : null;
  if (!lang) throw new Error('cette adresse n\'est pas inscrite à la newsletter');
  if (contact.emailBlacklisted) throw new Error('cette adresse s\'est désabonnée');
  // Petite liste réutilisée, dans le même dossier que la liste de la newsletter
  const all = await call('/contacts/lists?limit=50&offset=0', 'GET');
  let list = (all.lists || []).find(l => l.name === SINGLE_LIST);
  if (!list) {
    const main = await call(`/contacts/lists/${listFor(lang)}`, 'GET');
    list = await call('/contacts/lists', 'POST', { name: SINGLE_LIST, folderId: main.folderId });
  }
  try { await call(`/contacts/lists/${list.id}/contacts/remove`, 'POST', { all: true }); } catch (e) { /* liste déjà vide */ }
  await call(`/contacts/lists/${list.id}/contacts/add`, 'POST', { emails: [email] });
  const from = process.env.NEWSLETTER_FROM || 'info@passeist.com';
  const { id } = await call('/emailCampaigns', 'POST', {
    name: name(lang), subject: subject(lang),
    sender: { name: 'passéist', email: from },
    replyTo: from,
    htmlContent: html(lang),
    recipients: { listIds: [list.id] },
    ...(process.env['BREVO_UNSUB_' + lang.toUpperCase()] ? { unsubscriptionPageId: process.env['BREVO_UNSUB_' + lang.toUpperCase()] } : {}),
  });
  await call(`/emailCampaigns/${id}/sendNow`, 'POST');
  return lang;
}

module.exports = { enabled, listFor, listInfo, addToBrevo, sendCampaign, sendCampaignTo, sendOne, ping };
