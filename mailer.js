/**
 * E-MAILS AUTOMATIQUES
 * ---------------------------------------------------------------
 * Utilise SMTP (variables SMTP_* du .env). Si SMTP n'est pas configuré,
 * l'e-mail est simplement affiché dans la console (pratique pour tester en local).
 *
 * E-mails envoyés :
 *  1. sendWelcomePlans  : confirmation d'inscription + les 3 abonnements cliquables
 *  2. sendReset         : réinitialisation du mot de passe
 *  3. sendPaymentOk     : confirmation d'abonnement après paiement
 *  4. sendPaymentFailed : échec de paiement
 *  5. sendContact       : message du formulaire Contact reçu par l'équipe
 */
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const config = require('./config');

const C = { primary: '#5b4bff', teal: '#12bfa9', ink: '#14172b', mute: '#5a6080', bg: '#f6f7fc', border: '#e2e5f2' };

let transport = null;
if (config.smtp.host) {
  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, inner) {
  return `<!DOCTYPE html><html lang="fr"><body style="margin:0;background:${C.bg};font-family:Arial,Helvetica,sans-serif;color:${C.ink}">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border:1px solid ${C.border};border-radius:16px">
<tr><td style="padding:22px 26px;border-bottom:1px solid ${C.border}">
  <table cellpadding="0" cellspacing="0"><tr>
   <td style="width:38px;height:38px;background:${C.primary};border-radius:10px;text-align:center;color:#fff;font-weight:bold;font-size:20px">&#9835;</td>
   <td style="padding-left:10px;font-size:20px;font-weight:bold;color:${C.ink}">${esc(config.app.name)}</td>
  </tr></table>
</td></tr>
<tr><td style="padding:26px"><h2 style="margin:0 0 14px;font-size:22px">${esc(title)}</h2>${inner}</td></tr>
<tr><td style="padding:16px 26px;border-top:1px solid ${C.border};font-size:12px;color:${C.mute}">
  ${esc(config.app.companyName)} · ${esc(config.app.companyAddress)}<br>Besoin d'aide ? ${esc(config.app.supportEmail)}
</td></tr></table></td></tr></table></body></html>`;
}

const btn = (href, label) =>
  `<a href="${href}" style="display:inline-block;background:${C.primary};color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px">${label}</a>`;

async function send({ to, subject, html, replyTo }) {
  const msg = { from: config.smtp.from, to, subject, html, replyTo };
  if (!transport) {
    console.log('\n[EMAIL non envoyé : SMTP non configuré]\nÀ :', to, '\nObjet :', subject, '\n' + html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 600) + '\n');
    return;
  }
  try { await transport.sendMail(msg); } catch (err) { console.error('Erreur envoi e-mail :', err.message); }
}

/** Jeton signé (7 jours) inclus dans les liens "Choisir cet abonnement" de l'e-mail. */
function planLinkToken(userId) {
  return jwt.sign({ uid: userId, purpose: 'plan-link' }, config.jwtSecret, { expiresIn: '7d' });
}

/** Jeton signé (7 jours) du lien « Confirmer mon adresse e-mail ». */
function verifyToken(userId) {
  return jwt.sign({ uid: userId, purpose: 'verify' }, config.jwtSecret, { expiresIn: '7d' });
}

async function sendWelcomePlans(user) {
  const t = planLinkToken(user.id);
  const rows = Object.entries(config.plans).map(([key, p]) => `
   <tr><td style="padding:14px;border:1px solid ${p.highlight ? C.primary : C.border};border-radius:12px">
     <table width="100%" cellpadding="0" cellspacing="0"><tr>
       <td><b style="font-size:17px">${esc(p.name)}</b>${p.highlight ? ` <span style="background:${C.primary};color:#fff;font-size:11px;padding:2px 8px;border-radius:99px">Populaire</span>` : ''}<br>
           <span style="color:${C.mute};font-size:14px">${p.hours} h de transcription par mois<br>Fichiers jusqu'à ${p.maxFileMb >= 1024 ? p.maxFileMb / 1024 + ' Go' : p.maxFileMb + ' Mo'}</span></td>
       <td align="right" style="white-space:nowrap"><b style="font-size:20px">${p.priceEur} €</b><span style="color:${C.mute};font-size:13px"> /mois</span><br>
           <a href="${config.baseUrl}/api/billing/choose/${key}?t=${t}" style="display:inline-block;margin-top:8px;background:${C.primary};color:#fff;text-decoration:none;font-weight:bold;padding:8px 16px;border-radius:8px;font-size:14px">Choisir</a></td>
     </tr></table></td></tr><tr><td style="height:10px"></td></tr>`).join('');
  const html = layout(`Bienvenue ${user.name.split(' ')[0]} !`, `
    <p style="line-height:1.6;color:${C.mute}">Votre compte est créé. 🎁 Vous disposez de <b>2 essais gratuits</b> (1 audio et 1 vidéo, ${config.trial.maxMinutes} min maximum par fichier) dans votre espace de travail. Pour aller plus loin ensuite, choisissez votre abonnement : un clic vous mène à la page de paiement sécurisée.</p>
    <p>${btn(config.baseUrl + '/api/auth/verify?t=' + verifyToken(user.id), 'Confirmer mon adresse e-mail')}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0">${rows}</table>
    <p style="font-size:13px;color:${C.mute}">Après vos 2 essais gratuits, un abonnement est nécessaire · Résiliable à tout moment depuis vos paramètres.<br>Ces liens sont valables 7 jours ; ensuite, rendez-vous sur la page Tarifs.</p>
    <p>${btn(config.baseUrl + '/#/guide', 'Lire le guide d\'utilisation')}</p>`);
  await send({ to: user.email, subject: `Bienvenue sur ${config.app.name} : choisissez votre abonnement`, html });
}

async function sendReset(user, token) {
  const link = `${config.baseUrl}/#/reinitialiser?token=${encodeURIComponent(token)}`;
  const html = layout('Réinitialisation du mot de passe', `
    <p style="line-height:1.6;color:${C.mute}">Vous avez demandé à réinitialiser votre mot de passe. Ce lien est valable 1 heure et ne peut servir qu'une fois.</p>
    <p>${btn(link, 'Choisir un nouveau mot de passe')}</p>
    <p style="font-size:13px;color:${C.mute}">Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.</p>`);
  await send({ to: user.email, subject: 'Réinitialisation de votre mot de passe', html });
}

async function sendPaymentOk(user, planKey) {
  const p = config.plans[planKey];
  const html = layout('Abonnement confirmé ✓', `
    <p style="line-height:1.6;color:${C.mute}">Merci ! Votre abonnement <b>${esc(p.name)}</b> (${p.priceEur} €/mois) est actif. Vous disposez de ${p.hours} h de transcription ce mois-ci.</p>
    <p>${btn(config.baseUrl + '/#/espace', 'Ouvrir mon espace de travail')}</p>
    <p style="font-size:13px;color:${C.mute}">Votre facture est disponible à tout moment dans Paramètres > Gérer mon abonnement.</p>`);
  await send({ to: user.email, subject: `Votre abonnement ${p.name} est actif`, html });
}

async function sendPaymentFailed(user) {
  const html = layout('Échec de paiement', `
    <p style="line-height:1.6;color:${C.mute}">Nous n'avons pas pu prélever votre abonnement. Mettez à jour votre moyen de paiement pour conserver l'accès.</p>
    <p>${btn(config.baseUrl + '/#/parametres', 'Mettre à jour mon paiement')}</p>`);
  await send({ to: user.email, subject: 'Échec de paiement de votre abonnement', html });
}

async function sendContact({ name, email, subject, message }) {
  const html = layout('Nouveau message de contact', `
    <p><b>De :</b> ${esc(name)} (${esc(email)})<br><b>Sujet :</b> ${esc(subject)}</p>
    <p style="white-space:pre-wrap;line-height:1.6">${esc(message)}</p>`);
  await send({ to: config.app.supportEmail, subject: `[Contact] ${subject}`, html, replyTo: email });
}

module.exports = { sendWelcomePlans, sendReset, sendPaymentOk, sendPaymentFailed, sendContact, planLinkToken };
