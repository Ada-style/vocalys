# VOCALYS : site de transcription et traduction (audio / vidéo → texte)

Site complet par abonnement : inscription, **2 essais gratuits**, e-mail de confirmation avec les 3 offres, paiement Stripe, espace de travail, historique, guide, pages légales.
Le code est terminé : il suffit de **coller vos clés** dans le fichier `.env`, puis de mettre en ligne.

Démo visuelle (sans vrai paiement ni vraie transcription) : https://claude.ai/artifact/LgyHeZrZSRa83mmoTFbPXd

---

## 1. CE QUE FAIT LE SITE

| Fonction | Où c'est dans le code |
|---|---|
| Pages (accueil, tarifs, à propos, contact, FAQ, guide, confidentialité, CGU, mentions, connexion, inscription, mot de passe oublié) | `public/js/app.js` |
| Espace de travail (choix du fichier dans le gestionnaire de fichiers, transcription, traduction, progression, export TXT/SRT) | `public/js/app.js` + `src/transcriptions.js` + `src/pipeline.js` |
| **Essai gratuit : 1 audio + 1 vidéo, 2 min maximum par fichier** | `src/trial.js` + `src/transcriptions.js` |
| Historique, paramètres, export et suppression des données | `public/js/app.js` + `src/auth.js` |
| Inscription, connexion, confirmation d'e-mail, mot de passe oublié | `src/auth.js` |
| E-mail automatique de bienvenue (essais + 3 abonnements cliquables) | `src/mailer.js` |
| Paiement par abonnement (page Stripe, renouvellement, changement de formule, résiliation) | `src/billing.js` |
| Prix, quotas, langues, essai, identité du site | `src/config.js` |
| Base de données | `src/db.js` (SQLite, créée et mise à jour automatiquement) |
| Logo et charte graphique | `public/img/*.svg`, `public/css/style.css` |

**Parcours client :** inscription (nom, e-mail, mot de passe) → arrivée directe dans l'espace de travail avec **2 essais gratuits** (1 audio, 1 vidéo) → e-mail avec les 3 abonnements → quand les essais sont épuisés, abonnement obligatoire : clic sur la formule → page de paiement Stripe → retour dans l'espace de travail → import d'un fichier → texte (copie, TXT, SRT) → historique.

---

## 2. ESSAI GRATUIT : RÈGLES (appliquées par le serveur)

- Chaque nouveau client a **1 essai audio et 1 essai vidéo**, sans carte bancaire.
- **Chaque fichier d'essai dure 2 minutes maximum** (réglable : `TRIAL_MAX_MINUTES`) et pèse au plus 100 Mo (`TRIAL_MAX_FILE_MB`).
- Un fichier plus long est **refusé sans consommer l'essai**.
- Un essai est consommé quand la transcription **réussit**. Un essai déjà utilisé ne revient jamais.
- L'usage est mémorisé **sur le compte et par adresse e-mail** (table `trial_usage`) : se déconnecter puis se reconnecter, ou supprimer le compte et le recréer avec le même e-mail, ne redonne aucun essai.
- Quand les deux essais sont utilisés, l'espace de travail affiche « Vous avez épuisé vos essais gratuits » et le serveur refuse tout nouvel envoi (code 402) tant qu'il n'y a pas d'abonnement actif.
- Les essais sont gérés par Vocalys, **pas par Stripe** : ne configurez aucun essai dans Stripe.

**Limite à connaître :** un client peut créer un compte avec une autre adresse e-mail pour obtenir de nouveaux essais. Pour freiner cela, mettez `TRIAL_REQUIRE_VERIFIED_EMAIL=true` : l'essai ne fonctionne alors qu'après clic sur le lien « Confirmer mon adresse e-mail » (cela exige un SMTP qui fonctionne). Il n'y a volontairement pas de blocage par adresse IP, car sur les réseaux mobiles de nombreux clients partagent la même IP et seraient bloqués à tort.

---

## 3. OÙ COLLER VOS INFORMATIONS (tout est dans `.env`)

Copiez `.env.example` en `.env`, puis remplissez :

| Variable | Où la trouver |
|---|---|
| `BASE_URL` | L'adresse de votre site (ex : `https://vocalys.com`) |
| `JWT_SECRET` | Générez-la : `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `STRIPE_SECRET_KEY` | Stripe > Développeurs > Clés API > Clé secrète |
| `STRIPE_PRICE_STARTER` / `PRO` / `BUSINESS` | Stripe > Catalogue de produits > chaque prix (`price_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe > Développeurs > Webhooks > votre endpoint > Secret de signature |
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys (ajoutez du crédit) |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Votre fournisseur d'e-mails (Brevo, Resend, Mailjet, OVH...) |
| `SUPPORT_EMAIL`, `COMPANY_*` | Vos informations légales (affichées dans CGU, confidentialité, mentions) |
| `TRIAL_MAX_MINUTES`, `TRIAL_MAX_FILE_MB`, `TRIAL_REQUIRE_VERIFIED_EMAIL` | Réglages de l'essai gratuit (valeurs par défaut : 2, 100, false) |

Pour changer **prix, quotas, langues, noms des formules** : modifiez `src/config.js` (et gardez les mêmes montants dans Stripe).
Pour changer **couleurs** : variables en haut de `public/css/style.css`. **Logo** : fichiers de `public/img/`.

---

## 4. INSTALLATION EN LOCAL (test)

Prérequis : Node.js 18 ou plus (https://nodejs.org).

```bash
cd vocalys
npm install
cp .env.example .env      # puis remplissez .env
npm start                 # ouvrir http://localhost:3000
```

Sans clés, le site démarre quand même : les e-mails s'affichent dans la console, Stripe et OpenAI sont désactivés avec un message clair.

Test du paiement en local : installez la CLI Stripe puis lancez
`stripe listen --forward-to localhost:3000/api/billing/webhook` ; elle affiche le `whsec_...` à mettre dans `STRIPE_WEBHOOK_SECRET`. Carte de test : `4242 4242 4242 4242`, date future, CVC quelconque (clés `sk_test_` uniquement).

---

## 5. CONFIGURER STRIPE (une seule fois)

1. Créez un compte sur https://dashboard.stripe.com et activez votre compte (informations de société, compte bancaire).
2. **Catalogue de produits** : créez 3 produits **Starter (9 €)**, **Pro (19 €)**, **Business (49 €)**, chacun avec un **prix récurrent mensuel**. **Ne mettez aucun essai gratuit dans Stripe** (l'essai est géré par Vocalys). Copiez les 3 `price_...` dans `.env`.
3. **Webhooks** : ajoutez un endpoint `https://VOTRE-DOMAINE/api/billing/webhook` avec ces 5 événements :
   `checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`. Copiez le secret `whsec_...` dans `.env`.
4. **Portail client** : Paramètres > Facturation > Portail client > activez-le (changement de carte, factures, résiliation).
5. Pour passer en réel : remplacez les clés `sk_test_` par `sk_live_`, recréez les prix en mode réel et un webhook en mode réel.

Moyens de paiement locaux (Mobile Money) : Stripe ne les couvre pas partout en Afrique francophone. Pour les ajouter, il faut une seconde passerelle (CinetPay, Flutterwave, PayDunya...). Le point d'entrée à dupliquer est `startCheckout()` dans `src/billing.js` et le gestionnaire `webhookHandler()`.

---

## 6. METTRE EN LIGNE AVEC UN NOM DE DOMAINE

**Hébergement conseillé : Render.com ou Railway.app** (Node.js, certificat HTTPS automatique).

1. Mettez le dossier sur GitHub (le `.gitignore` exclut déjà `.env` et `data/`).
2. Render > New > Web Service > votre dépôt.
   Build : `npm install` · Start : `npm start`
3. **Disque persistant obligatoire** (sinon la base, donc les comptes, abonnements et essais utilisés, est perdue à chaque redéploiement) : ajoutez un Disk monté sur `/var/data` et mettez `DATA_DIR=/var/data`.
4. Ajoutez toutes les variables de `.env` dans « Environment ».
5. **Nom de domaine** : achetez-le (Namecheap, OVH, GoDaddy...). Dans Render > Settings > Custom Domains, ajoutez-le, puis créez chez votre registrar les enregistrements DNS indiqués (CNAME ou A). HTTPS s'active tout seul.
6. Mettez `BASE_URL=https://votre-domaine.com`, puis déclarez le webhook Stripe avec ce domaine.
7. **E-mails** : chez votre fournisseur SMTP, validez votre domaine d'envoi (enregistrements SPF et DKIM) pour éviter les courriers indésirables.

---

## 7. LISTE DE CONTRÔLE AVANT D'OUVRIR AU PUBLIC

- [ ] Inscription → arrivée dans l'espace de travail avec les 2 essais → e-mail de bienvenue reçu
- [ ] Essai audio de moins de 2 min : texte obtenu, badge « Audio : utilisé »
- [ ] Fichier de plus de 2 min : refusé, essai non consommé
- [ ] Essai vidéo de moins de 2 min : texte obtenu
- [ ] Après les 2 essais : écran « essais épuisés », envoi refusé ; déconnexion puis reconnexion : toujours bloqué
- [ ] Clic sur un abonnement (page Tarifs ou e-mail) → page Stripe → paiement test → accès sans limite d'essai
- [ ] Traduction vers une autre langue ; téléchargement TXT et SRT
- [ ] Changement de formule, résiliation (portail Stripe), renouvellement (quota remis à zéro)
- [ ] Mot de passe oublié
- [ ] Textes de **confidentialité, CGU et mentions légales relus par un juriste** (ce sont des modèles)
- [ ] Sauvegarde régulière du disque `DATA_DIR`
- [ ] Mode live Stripe activé, clés `sk_live_`

---

## 8. COÛTS À ANTICIPER

L'API OpenAI est facturée à l'usage (transcription Whisper au tarif par minute audio + traduction). Chaque client en essai coûte au maximum 4 minutes de transcription (2 fichiers de 2 min). Vérifiez les tarifs en vigueur sur openai.com/pricing et assurez-vous que la marge de chaque formule est positive en cas d'usage complet du quota (ex : le plan Business à 9 000 min/mois). Ajustez `minutes` et les prix dans `src/config.js` en conséquence. Prévoyez aussi l'hébergement (disque + CPU pour ffmpeg), l'envoi d'e-mails et les frais Stripe.

---

## 9. SÉCURITÉ DÉJÀ EN PLACE

Mots de passe hachés (bcrypt) · cookie de session HttpOnly + SameSite + Secure en production · limitation des tentatives (anti force brute) · en-têtes de sécurité et CSP stricte (Helmet) · validation de toutes les entrées · signature des webhooks Stripe vérifiée · jetons de réinitialisation à usage unique (1 h) · essais gratuits contrôlés par le serveur · fichiers audio/vidéo supprimés après traitement · numéros de carte jamais reçus par votre serveur (page Stripe) · export et suppression des données du client.

---

## 10. BRIEF À DONNER À UNE AUTRE IA (si vous voulez la faire modifier ou héberger le site)

> Voici un projet Node.js/Express complet appelé Vocalys (site SaaS de transcription et traduction audio/vidéo par abonnement, avec 2 essais gratuits : 1 audio + 1 vidéo, 2 minutes maximum par fichier, contrôlés côté serveur dans src/trial.js). Lis le README.md puis tous les fichiers. Le front-end est en JavaScript pur (public/js/app.js, navigation par `#/`), le back-end en Express + SQLite, paiement Stripe Checkout + webhooks, transcription via OpenAI Whisper et ffmpeg-static, e-mails via Nodemailer SMTP. Ne change pas l'architecture. Aide-moi à : (1) configurer le fichier .env, (2) déployer sur [Render/Railway/VPS] avec mon domaine [mon-domaine], (3) corriger les erreurs éventuelles. Ne mets jamais de clé secrète dans le code ni dans le front-end.

---

## 11. CHARTE GRAPHIQUE

- **Nom :** Vocalys (de « vocal » : la voix)
- **Logo :** carré arrondi en dégradé violet → turquoise contenant cinq barres blanches d'onde sonore (la voix qui devient écriture). Fichiers : `logo.svg` (fond clair), `logo-light.svg` (texte blanc, fond sombre), `logo-mark.svg` (icône seule), `favicon.svg`.
- **Couleurs :** violet électrique `#5b4bff` (principal) · turquoise `#12bfa9` (secondaire) · bleu nuit `#14172b` (texte) · fond `#f6f7fc` · succès `#12805c` · erreur `#c8283c`. Mode sombre : fond `#0f1120`, violet `#8174ff`, turquoise `#2fd8c2`.
- **Typographie :** Inter (sinon police système), titres en gras 800, interlettrage serré.
- **Formes :** coins arrondis 12 à 18 px, ombres très douces, beaucoup d'espace.
- **Ton :** simple, rassurant, professionnel, vouvoiement.

---

## 12. STRUCTURE DU PROJET

```
vocalys/
├── server.js                 démarrage, sécurité, routes
├── package.json
├── .env.example              modèle de configuration (à copier en .env)
├── README.md
├── src/
│   ├── config.js             prix, quotas, langues, essai, identité
│   ├── db.js                 base SQLite + migrations
│   ├── auth.js               comptes, sessions, confirmation d'e-mail, mot de passe
│   ├── trial.js              règles de l'essai gratuit (1 audio + 1 vidéo)
│   ├── billing.js            Stripe : paiement, webhook, portail
│   ├── transcriptions.js     upload, file d'attente, historique, export
│   ├── pipeline.js           ffmpeg + Whisper + traduction
│   └── mailer.js             e-mails HTML automatiques
└── public/
    ├── index.html
    ├── css/style.css
    ├── js/app.js
    ├── img/ (logo.svg, logo-light.svg, logo-mark.svg, favicon.svg)
    └── robots.txt
```
