/**
 * VOCALYS : SERVEUR PRINCIPAL
 * ---------------------------------------------------------------
 * Démarrage :  npm install  puis  npm start
 * Sert à la fois l'API (/api/...) et le site (dossier /public).
 */
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

const config = require('./src/config');
require('./src/db');
const auth = require('./src/auth');
const billing = require('./src/billing');
const transcriptions = require('./src/transcriptions');
const mailer = require('./src/mailer');

const app = express();
app.set('trust proxy', 1); // derrière le proxy de l'hébergeur (Render, Railway, Nginx...)

/* Sécurité des en-têtes HTTP (CSP stricte : seuls nos propres scripts s'exécutent) */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: config.env === 'production' ? [] : null,
    },
  },
}));

/* Webhook Stripe : DOIT être déclaré AVANT express.json() car il lui faut le corps brut. */
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billing.webhookHandler);

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

/* Limitation de débit (anti-abus) */
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false }));
const strict = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tentatives. Réessayez dans quelques minutes.' } });
app.use('/api/auth/login', strict);
app.use('/api/auth/register', strict);
app.use('/api/auth/forgot', strict);
app.use('/api/auth/reset', strict);
app.use('/api/contact', strict);

/* Configuration publique lue par le site (prix, langues, identité). Aucune donnée secrète. */
app.get('/api/config', (req, res) => {
  const plans = {};
  for (const [k, p] of Object.entries(config.plans)) {
    const { stripePriceId, ...pub } = p;
    plans[k] = pub;
  }
  res.json({ app: config.app, plans, languages: config.languages, trial: config.trial });
});

app.use('/api/auth', auth.router);
app.use('/api/billing', billing.router);
app.use('/api/transcriptions', transcriptions.router);

app.post('/api/contact', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 100);
    const email = String(req.body.email || '').trim().slice(0, 190);
    const subject = String(req.body.subject || 'Question générale').slice(0, 100);
    const message = String(req.body.message || '').trim().slice(0, 5000);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || message.length < 5) throw new auth.HttpError(400, 'Veuillez remplir correctement le formulaire.');
    await mailer.sendContact({ name, email, subject, message });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Route introuvable.' }));

/* Site statique */
app.use(express.static(path.join(__dirname, 'public'), { maxAge: config.env === 'production' ? '1h' : 0 }));

/* Gestion centralisée des erreurs */
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Erreur interne du serveur.' : err.message });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`\n${config.app.name} démarré sur ${config.baseUrl} (port ${config.port})`);
    if (config.saspay.apiKey) {
      console.log('✓ Paiement : Agrégateur SasPay activé (Mobile Money Wave/Orange/MTN/Moov + Cartes)');
    } else if (config.stripe.secretKey) {
      console.log('✓ Paiement : Stripe activé');
    } else {
      console.log('! Paiement non configuré : ajoutez SASPAY_API_KEY dans votre fichier .env');
    }

    if (config.gemini.apiKey) {
      console.log(`✓ IA Multimodale : Google Gemini activé (${config.gemini.model})`);
    } else if (config.openai.apiKey) {
      console.log('✓ IA : OpenAI Whisper activé');
    } else {
      console.log('! IA non configurée : ajoutez GEMINI_API_KEY dans votre fichier .env');
    }

    if (!config.smtp.host) console.log('! SMTP non configuré : les e-mails sont affichés dans cette console.');
  });
}

module.exports = app;
