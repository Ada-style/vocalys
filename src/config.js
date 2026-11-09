/**
 * CONFIGURATION CENTRALE DE VOCALYS
 * ---------------------------------------------------------------
 * Tout ce qui est modifiable (prix, quotas, langues, identité) est ici ou dans .env.
 * Le front-end lit ces plans via GET /api/config : changez les prix ICI uniquement.
 * (Les montants réellement facturés sont ceux définis dans Stripe : gardez-les identiques.)
 */
require('dotenv').config();
const path = require('path');

const e = (k, d = '') => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

const config = {
  env: e('NODE_ENV', 'development'),
  port: parseInt(e('PORT', '3000'), 10),
  baseUrl: e('BASE_URL', 'http://localhost:3000').replace(/\/$/, ''),
  jwtSecret: e('JWT_SECRET', 'dev-secret-change-me'),
  dataDir: path.resolve(e('DATA_DIR', process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data'))),
  maxConcurrentJobs: parseInt(e('MAX_CONCURRENT_JOBS', '2'), 10),

  /**
   * ESSAI GRATUIT à l'inscription : 1 audio + 1 vidéo, puis abonnement obligatoire.
   * maxMinutes : durée maximale de CHAQUE fichier d'essai
   * maxFileMb  : poids maximal d'un fichier d'essai
   * requireVerifiedEmail : true = l'essai n'est utilisable qu'après clic sur le lien de confirmation e-mail
   *                        (recommandé contre les créations de comptes en série ; exige que SMTP fonctionne)
   */
  trial: {
    maxMinutes: parseFloat(e('TRIAL_MAX_MINUTES', '2')),
    maxFileMb: parseInt(e('TRIAL_MAX_FILE_MB', '500'), 10),
    requireVerifiedEmail: e('TRIAL_REQUIRE_VERIFIED_EMAIL', 'false') === 'true',
  },

  app: {
    name: e('APP_NAME', 'Vocalys'),
    supportEmail: e('SUPPORT_EMAIL', 'support@example.com'),
    companyName: e('COMPANY_NAME', 'Nom de votre société'),
    companyAddress: e('COMPANY_ADDRESS', 'Adresse'),
    companyCountry: e('COMPANY_COUNTRY', 'Pays'),
    companyRegistration: e('COMPANY_REGISTRATION', 'N° d\'immatriculation'),
  },

  stripe: {
    secretKey: e('STRIPE_SECRET_KEY'),
    webhookSecret: e('STRIPE_WEBHOOK_SECRET'),
  },

  saspay: {
    apiKey: e('SASPAY_API_KEY'),
    webhookSecret: e('SASPAY_WEBHOOK_SECRET'),
    baseUrl: e('SASPAY_BASE_URL', 'https://api.saspay.me').replace(/\/$/, ''),
    currency: e('SASPAY_CURRENCY', 'XOF'),
  },

  gemini: {
    apiKey: e('GEMINI_API_KEY'),
    model: e('GEMINI_MODEL', 'gemini-3.5-flash-lite'),
  },

  openai: {
    apiKey: e('OPENAI_API_KEY'),
    whisperModel: e('WHISPER_MODEL', 'whisper-1'),
    translateModel: e('TRANSLATE_MODEL', 'gpt-4o-mini'),
  },

  smtp: {
    host: e('SMTP_HOST'),
    port: parseInt(e('SMTP_PORT', '587'), 10),
    secure: e('SMTP_SECURE', 'false') === 'true',
    user: e('SMTP_USER'),
    pass: e('SMTP_PASS'),
    from: e('MAIL_FROM', 'Vocalys <no-reply@example.com>'),
  },

  /**
   * LES 3 ABONNEMENTS (aucune période d'essai).
   * minutes     : quota mensuel de transcription en minutes
   * maxFileMb   : taille maximale d'un fichier
   * historyDays : durée de conservation de l'historique (null = illimité)
   * stripePriceId : identifiant du prix Stripe (variable .env)
   */
  plans: {
    starter: {
      name: 'Starter', priceEur: 9, priceFcfa: 5900, minutes: 300, hours: 5, maxFileMb: 500, historyDays: 30,
      stripePriceId: e('STRIPE_PRICE_STARTER'), highlight: false,
      features: ['5 h de transcription / mois', 'Fichiers jusqu\'à 500 Mo', 'Traduction vers 15 langues', 'Export TXT et SRT', 'Historique 30 jours'],
    },
    pro: {
      name: 'Pro', priceEur: 19, priceFcfa: 12500, minutes: 1800, hours: 30, maxFileMb: 2048, historyDays: null,
      stripePriceId: e('STRIPE_PRICE_PRO'), highlight: true,
      features: ['30 h de transcription / mois', 'Fichiers jusqu\'à 2 Go', 'Traduction vers 15 langues', 'Export TXT et SRT', 'Historique illimité', 'Traitement prioritaire'],
    },
    business: {
      name: 'Business', priceEur: 49, priceFcfa: 32000, minutes: 9000, hours: 150, maxFileMb: 5120, historyDays: null,
      stripePriceId: e('STRIPE_PRICE_BUSINESS'), highlight: false,
      features: ['150 h de transcription / mois', 'Fichiers jusqu\'à 5 Go', 'Traduction vers 15 langues', 'Export TXT et SRT', 'Historique illimité', 'Support dédié 7j/7'],
    },
  },

  /**
   * LANGUES. code = code ISO 639-1 utilisé par Whisper.
   * source:true  => proposée comme langue du fichier audio (reconnue par Whisper)
   * target:true  => proposée comme langue de traduction
   */
  languages: [
    { code: 'auto', label: 'Détection automatique', source: true, target: false },
    { code: 'fr', label: 'Français', source: true, target: true },
    { code: 'en', label: 'Anglais', source: true, target: true },
    { code: 'es', label: 'Espagnol', source: true, target: true },
    { code: 'pt', label: 'Portugais', source: true, target: true },
    { code: 'ar', label: 'Arabe', source: true, target: true },
    { code: 'de', label: 'Allemand', source: true, target: true },
    { code: 'it', label: 'Italien', source: true, target: true },
    { code: 'sw', label: 'Swahili', source: true, target: true },
    { code: 'ln', label: 'Lingala', source: true, target: true },
    { code: 'ha', label: 'Haoussa', source: true, target: true },
    { code: 'yo', label: 'Yoruba', source: true, target: true },
    { code: 'zh', label: 'Chinois', source: true, target: true },
    { code: 'ru', label: 'Russe', source: true, target: true },
    { code: 'tr', label: 'Turc', source: true, target: true },
    { code: 'wo', label: 'Wolof (traduction expérimentale)', source: false, target: true },
  ],

  allowedExt: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.flac', '.wma', '.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.3gp'],
};

if (config.env === 'production') {
  if (!config.jwtSecret || config.jwtSecret.length < 32 || config.jwtSecret === 'dev-secret-change-me') {
    throw new Error('JWT_SECRET manquant ou trop court (32 caractères minimum). Voir .env.example');
  }
}

module.exports = config;
