/* =====================================================================
   VOCALYS : APPLICATION FRONT-END (une seule page, navigation par #/...)
   Aucune clé secrète ici : tout passe par l'API du serveur (/api/...).
   Prix, quotas et langues viennent de GET /api/config (fichier src/config.js).
   Pages : accueil, tarifs, à propos, contact, FAQ, guide, confidentialité, CGU, mentions,
           connexion, inscription, mot de passe oublié/réinitialisation,
           espace de travail, historique, paramètres.
   ===================================================================== */
(function () {
  'use strict';
  var CFG = null, USER = null, pollTimer = null;

  /* ---------- Utilitaires ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg, type) {
    var d = document.createElement('div'); d.textContent = msg; if (type === 'err') d.className = 'err';
    $('#toast').appendChild(d); setTimeout(function () { d.remove(); }, 3800);
  }
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch('/api' + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || 'Erreur du serveur.'); e.status = r.status; throw e; }
        return d;
      });
    });
  }
  function fmtMin(m) { m = Math.round(m); return Math.floor(m / 60) + ' h ' + ('0' + (m % 60)).slice(-2) + ' min'; }
  function fmtDate(t) { return new Date(t).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }); }
  function langLabel(code) { var l = (CFG.languages || []).filter(function (x) { return x.code === code; })[0]; return l ? l.label.replace(/ \(.*\)/, '') : code; }
  function go(h) { location.hash = h; }
  function msg(id, type, text) { var el = $(id); if (el) el.innerHTML = text ? '<div class="msg ' + type + '">' + esc(text) + '</div>' : ''; }
  function plans() { return Object.keys(CFG.plans); }
  function sizeLabel(mb) { return mb >= 1024 ? (mb / 1024) + ' Go' : mb + ' Mo'; }

  /* ---------- Navigation ---------- */
  function renderNav(r) {
    var l = [['#/', 'Accueil'], ['#/tarifs', 'Tarifs'], ['#/guide', 'Guide'], ['#/faq', 'FAQ'], ['#/apropos', 'À propos'], ['#/contact', 'Contact']];
    var h = l.map(function (x) { return '<a href="' + x[0] + '" class="' + (r === x[0] ? 'on' : '') + '">' + x[1] + '</a>'; }).join('');
    if (USER) {
      h += '<a href="#/espace" class="' + (r === '#/espace' ? 'on' : '') + '">Espace de travail</a><a href="#/historique" class="' + (r === '#/historique' ? 'on' : '') + '">Historique</a><a href="#/parametres" class="' + (r === '#/parametres' ? 'on' : '') + '">Paramètres</a><a href="#/" id="logout">Déconnexion</a>';
    } else {
      h += '<a href="#/connexion">Connexion</a><a href="#/inscription" class="btn sm" style="color:#fff">S\'inscrire</a>';
    }
    $('#nav').innerHTML = h; $('#nav').classList.remove('open');
    var o = $('#logout');
    if (o) o.onclick = function (e) { e.preventDefault(); api('/auth/logout', { method: 'POST' }).finally(function () { USER = null; go('#/'); route(); }); };
  }

  /* ---------- Pages publiques ---------- */
  function pricingCards() {
    return '<div class="grid">' + plans().map(function (k) {
      var p = CFG.plans[k], current = USER && USER.plan === k;
      return '<div class="card' + (p.highlight ? ' hl' : '') + '">' + (p.highlight ? '<span class="tag">Le plus choisi</span>' : '') +
        '<h3>' + esc(p.name) + '</h3><div class="price">' + p.priceEur + ' €<small> / mois</small></div><div class="mu">≈ ' + p.priceFcfa.toLocaleString('fr-FR') + ' FCFA / mois</div>' +
        '<ul class="ck">' + p.features.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' +
        (current ? '<span class="btn alt block" style="cursor:default">Votre formule actuelle</span>' : '<button class="btn block" data-plan="' + k + '">Choisir ' + esc(p.name) + '</button>') + '</div>';
    }).join('') + '</div><p class="mu c" style="margin-top:12px">2 essais gratuits à l’inscription (1 audio + 1 vidéo), puis abonnement. Paiement sécurisé par Stripe. Résiliable à tout moment.</p>';
  }

  function pHome() {
    var feats = [['🎙️', 'Transcription audio', 'MP3, WAV, M4A, OGG : déposez votre fichier et récupérez le texte horodaté.'], ['🎬', 'Transcription vidéo', 'MP4, MOV, MKV, WEBM : la piste audio est extraite automatiquement.'], ['🌍', 'Traduction', 'Traduisez vos transcriptions vers 15 langues, dont le swahili, le lingala et le haoussa.'], ['🗂️', 'Historique', 'Retrouvez, copiez ou exportez en TXT et SRT toutes vos transcriptions.'], ['🔒', 'Données protégées', 'Chiffrement, accès personnel, fichiers supprimés après traitement.'], ['⚡', 'Espace fluide', 'Un seul écran : importer, choisir la langue, obtenir le texte.']];
    var how = [['1', 'Inscrivez-vous', 'Nom, e-mail, mot de passe. C\'est tout.'], ['2', 'Testez gratuitement', '1 audio et 1 vidéo offerts pour découvrir la valeur de Vocalys.'], ['3', 'Abonnez-vous', 'Un e-mail vous présente les 3 offres : un clic, et vous transcrivez sans limite d’essai.']];
    var tips = ['Privilégiez un enregistrement clair, avec peu de bruit de fond.', 'Rapprochez le micro de la personne qui parle.', 'Indiquez la bonne langue du fichier avant de lancer.', 'Un seul locuteur à la fois donne de meilleurs résultats.', 'Relisez toujours les noms propres et les termes techniques.', 'Gardez une copie de vos fichiers originaux.'];
    return '<section class="hero"><span class="pill">Audio · Vidéo · Texte</span><h1>Transformez vos audios et vidéos en texte, <span class="grad">dans toutes les langues</span></h1><p>Importez un fichier, obtenez sa transcription en quelques minutes, puis traduisez-la. Simple, sécurisé, pensé pour les professionnels.</p><div class="row" style="justify-content:center"><a class="btn" href="#/inscription">Essayer gratuitement</a><a class="btn line" href="#/tarifs">Voir les tarifs</a></div><p class="mu" style="margin-top:16px;font-size:.95rem">🎁 2 essais gratuits à l’inscription : 1 audio + 1 vidéo, sans carte bancaire.</p></section>' +
      '<section><div class="grid">' + feats.map(function (x) { return '<div class="card"><div style="font-size:1.8rem">' + x[0] + '</div><h3>' + x[1] + '</h3><span class="mu">' + x[2] + '</span></div>'; }).join('') + '</div></section>' +
      '<section><h2 class="c">Comment ça marche</h2><div class="grid">' + how.map(function (x) { return '<div class="card"><div class="step" style="margin:0"><b>' + x[0] + '</b><div><h3>' + x[1] + '</h3><span class="mu">' + x[2] + '</span></div></div></div>'; }).join('') + '</div></section>' +
      '<section><h2 class="c">Nos abonnements</h2>' + pricingCards() + '</section>' +
      '<section><h2 class="c">Nos recommandations pour de meilleurs résultats</h2><div class="grid">' + tips.map(function (x) { return '<div class="card">💡 ' + x + '</div>'; }).join('') + '</div></section>';
  }

  function pPricing() {
    var rows = [['Heures de transcription / mois', function (p) { return p.hours + ' h'; }], ['Taille max. par fichier', function (p) { return sizeLabel(p.maxFileMb); }], ['Historique', function (p) { return p.historyDays ? p.historyDays + ' jours' : 'Illimité'; }], ['Prix mensuel', function (p) { return p.priceEur + ' €'; }]];
    return '<section><h1 class="c">Tarifs</h1><p class="mu c">Trois formules claires, précédées de 2 essais gratuits (1 audio + 1 vidéo) à l’inscription. Pas de frais cachés.</p>' + pricingCards() +
      '<h2 style="margin-top:34px">Comparatif</h2><div class="card scroll"><table><tr><th></th>' + plans().map(function (k) { return '<th>' + esc(CFG.plans[k].name) + '</th>'; }).join('') + '</tr>' +
      rows.map(function (r) { return '<tr><th>' + r[0] + '</th>' + plans().map(function (k) { return '<td>' + r[1](CFG.plans[k]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div></section>';
  }

  function pAbout() {
    return '<section><h1>À propos de ' + esc(CFG.app.name) + '</h1><div class="card"><p>' + esc(CFG.app.name) + ' est né d\'un constat simple : une grande partie du savoir circule à l\'oral, en vidéo ou en audio, et reste difficile à exploiter. Notre mission est de rendre chaque voix lisible, partageable et traduisible, y compris pour les langues africaines souvent oubliées des outils numériques.</p><p>Nous servons les entrepreneurs, formateurs, journalistes, étudiants, créateurs de contenu et équipes qui veulent gagner du temps.</p><h3>Nos valeurs</h3><ul class="ck"><li>Simplicité : un outil qui s\'utilise sans formation</li><li>Confidentialité : vos fichiers vous appartiennent</li><li>Accessibilité : des tarifs adaptés au marché africain francophone</li></ul></div></section>';
  }

  function pContact() {
    return '<section><h1>Contact</h1><div class="grid"><div class="card"><form id="cf"><label for="cn">Nom</label><input id="cn" required maxlength="100"><label for="ce">E-mail</label><input id="ce" type="email" required><label for="cs">Sujet</label><select id="cs"><option>Question générale</option><option>Facturation</option><option>Problème technique</option><option>Partenariat</option></select><label for="cm">Message</label><textarea id="cm" rows="5" required minlength="5" maxlength="5000"></textarea><div id="cr"></div><button class="btn" style="margin-top:12px" type="submit">Envoyer</button></form></div><div class="card"><h3>Autres moyens</h3><p class="mu">Support : ' + esc(CFG.app.supportEmail) + '<br>Réponse sous 24 h ouvrées.</p><p class="mu">Consultez d\'abord la <a href="#/faq">FAQ</a> et le <a href="#/guide">guide</a>.</p></div></div></section>';
  }

  function pFaq() {
    var q = [['Y a-t-il un essai gratuit ?', 'Oui : à l’inscription, vous disposez de 2 essais gratuits, un pour un audio et un pour une vidéo (2 minutes maximum par fichier), sans carte bancaire. Une fois les deux essais utilisés, vous choisissez l’un des trois abonnements, résiliable à tout moment. Les essais ne sont pas renouvelables.'], ['Quels formats sont acceptés ?', 'Audio : MP3, WAV, M4A, AAC, OGG, FLAC. Vidéo : MP4, MOV, MKV, WEBM, AVI.'], ['Combien de temps dure une transcription ?', 'Généralement une fraction de la durée du fichier. Une heure d\'audio est traitée en quelques minutes. Vous pouvez quitter la page : le résultat apparaît dans votre historique.'], ['Quelle est la précision ?', 'Elle dépend de la qualité sonore. Avec un audio clair, elle est très élevée. Relisez toujours les noms propres.'], ['Mes fichiers sont-ils conservés ?', 'Non : les fichiers audio et vidéo sont supprimés dès la fin du traitement. Seul le texte est conservé dans votre historique, que vous pouvez effacer à tout moment.'], ['Comment payer ?', 'Par carte bancaire sur une page de paiement sécurisée hébergée par Stripe. Nous ne voyons ni ne stockons votre numéro de carte.'], ['Comment résilier ?', 'Dans Paramètres > Gérer mon abonnement. L\'accès reste actif jusqu\'à la fin de la période payée.'], ['Que se passe-t-il si je dépasse mon quota ?', 'Les nouveaux fichiers sont refusés tant que le quota n\'est pas renouvelé ; vous pouvez passer à une formule supérieure à tout moment. Vos données restent intactes.'], ['Quand mon quota est-il renouvelé ?', 'Chaque mois, à la date de renouvellement de votre abonnement.'], ['J\'ai oublié mon mot de passe', 'Sur la page Connexion, cliquez sur « Mot de passe oublié » : vous recevez un lien par e-mail.']];
    return '<section><h1>Questions fréquentes</h1>' + q.map(function (x) { return '<details><summary>' + x[0] + '</summary><p class="mu">' + x[1] + '</p></details>'; }).join('') + '</section>';
  }

  function pGuide() {
    var s = [['Créer votre compte', 'Cliquez sur « S\'inscrire », saisissez votre nom, e-mail et mot de passe (8 caractères minimum), acceptez les CGU. Vous recevez aussitôt 2 essais gratuits : 1 audio et 1 vidéo (2 minutes maximum par fichier).'], ['Ouvrir l\'e-mail de confirmation', 'Vous recevez un message présentant les 3 abonnements. Cliquez sur celui que vous voulez (vérifiez vos courriers indésirables si besoin).'], ['Payer', 'Sur la page de paiement sécurisée, vérifiez le récapitulatif, saisissez vos informations de carte puis validez.'], ['Accéder à l\'espace de travail', 'Après le paiement, vous arrivez directement dans votre espace de travail.'], ['Importer un fichier', 'Choisissez « Transcrire » ou « Traduire », déposez votre audio ou vidéo, sélectionnez la langue du fichier (ou la détection automatique).'], ['Suivre et récupérer le résultat', 'Une barre de progression s\'affiche. Copiez le texte ou téléchargez-le en TXT ou SRT (sous-titres). Il est enregistré dans l\'historique.'], ['Gérer votre compte', 'Dans Paramètres : profil, mot de passe, changement ou résiliation d\'abonnement, factures, thème, export et suppression de vos données.']];
    return '<section><h1>Guide d\'utilisation</h1><p class="mu">De l\'inscription à votre premier texte en 7 étapes.</p>' + s.map(function (x, i) { return '<div class="card step" style="margin-bottom:12px"><b>' + (i + 1) + '</b><div><h3>' + x[0] + '</h3><span class="mu">' + x[1] + '</span></div></div>'; }).join('') + '<a class="btn" href="#/inscription">Commencer</a></section>';
  }

  function pPrivacy() {
    var a = CFG.app;
    return '<section><h1>Politique de confidentialité</h1><div class="card"><p class="mu">Dernière mise à jour : ' + new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) + '. Texte modèle : faites-le valider par un juriste avant la mise en ligne.</p><h3>1. Responsable du traitement</h3><p>' + esc(a.companyName) + ', ' + esc(a.companyAddress) + '. Contact : ' + esc(a.supportEmail) + '.</p><h3>2. Données collectées</h3><p>Nom, adresse e-mail, mot de passe (stocké sous forme chiffrée irréversible), historique de transcriptions (texte), informations de facturation traitées par notre prestataire de paiement Stripe.</p><h3>3. Finalités</h3><p>Fournir le service, gérer votre abonnement, assurer la sécurité du site, répondre à vos demandes. Nous ne vendons jamais vos données.</p><h3>4. Fichiers audio et vidéo</h3><p>Ils sont traités uniquement pour produire votre texte, transmis à notre prestataire de transcription et de traduction (OpenAI) sous contrat, puis supprimés de nos serveurs à la fin du traitement.</p><h3>5. Paiement</h3><p>Les numéros de carte sont saisis sur la page sécurisée de Stripe (certifié PCI-DSS). ' + esc(a.name) + ' ne les reçoit ni ne les conserve.</p><h3>6. Conservation</h3><p>Les données de compte sont conservées tant que le compte existe. L\'historique est conservé selon votre formule (30 jours pour Starter, illimité sinon) ou jusqu\'à suppression par vos soins.</p><h3>7. Vos droits</h3><p>Accès, rectification, export (Paramètres > Exporter mes données), suppression du compte (Paramètres) ou sur demande à ' + esc(a.supportEmail) + '.</p><h3>8. Sécurité</h3><p>Connexion HTTPS, mots de passe hachés, cookies de session protégés (HttpOnly), limitation des tentatives de connexion, accès restreint aux données.</p><h3>9. Cookies</h3><p>Un seul cookie technique de session, indispensable à la connexion. Aucun cookie publicitaire.</p></div></section>';
  }

  function pTerms() {
    var a = CFG.app;
    return '<section><h1>Conditions générales d\'utilisation</h1><div class="card"><p class="mu">Texte modèle : faites-le valider par un juriste avant la mise en ligne.</p><h3>1. Objet</h3><p>' + esc(a.name) + ' fournit un service en ligne de transcription et de traduction d\'audio et de vidéo en texte.</p><h3>2. Compte</h3><p>Vous êtes responsable de la confidentialité de vos identifiants et de l\'exactitude des informations fournies.</p><h3>3. Abonnements et paiement</h3><p>Trois formules mensuelles, précédées de 2 essais gratuits à l\'inscription (1 audio et 1 vidéo, 2 minutes maximum par fichier, non renouvelables), payables d\'avance par carte via Stripe. Le renouvellement est automatique jusqu\'à résiliation. Le quota de minutes est remis à zéro à chaque renouvellement et ne se reporte pas.</p><h3>4. Changement de formule</h3><p>Vous pouvez changer de formule à tout moment ; la différence est calculée au prorata.</p><h3>5. Résiliation et remboursement</h3><p>Vous pouvez résilier à tout moment ; l\'accès reste actif jusqu\'à la fin de la période payée. Sauf obligation légale contraire, les périodes déjà commencées ne sont pas remboursées.</p><h3>6. Usage acceptable</h3><p>Il est interdit d\'importer des contenus illégaux ou dont vous n\'avez pas les droits, ou d\'utiliser le service pour porter atteinte à la vie privée d\'autrui.</p><h3>7. Qualité des résultats</h3><p>La précision dépend de la qualité des fichiers. Les résultats doivent être relus avant tout usage officiel, juridique ou médical.</p><h3>8. Responsabilité</h3><p>' + esc(a.name) + ' ne peut être tenu responsable d\'une utilisation inappropriée des transcriptions ni d\'une interruption temporaire du service.</p><h3>9. Droit applicable</h3><p>Les présentes conditions sont soumises au droit de : ' + esc(a.companyCountry) + '.</p></div></section>';
  }

  function pLegal() {
    var a = CFG.app;
    return '<section><h1>Mentions légales</h1><div class="card"><p><b>Éditeur :</b> ' + esc(a.companyName) + '<br><b>Adresse :</b> ' + esc(a.companyAddress) + '<br><b>Pays :</b> ' + esc(a.companyCountry) + '<br><b>Immatriculation :</b> ' + esc(a.companyRegistration) + '<br><b>Contact :</b> ' + esc(a.supportEmail) + '</p><p><b>Hébergeur :</b> à compléter avec le nom et l\'adresse de votre hébergeur.</p></div></section>';
  }
  function p404() { return '<section class="hero"><h1>Page introuvable</h1><a class="btn" href="#/">Retour à l\'accueil</a></section>'; }

  /* ---------- Connexion, inscription, mot de passe ---------- */
  function pSignup() {
    return '<div class="narrow card"><h2>Créer un compte</h2><p class="mu">Inscription en 20 secondes. 2 essais gratuits offerts : 1 audio + 1 vidéo. Un e-mail vous présente aussi les abonnements.</p><form id="sf"><label for="sn">Nom complet</label><input id="sn" required autocomplete="name" maxlength="80"><label for="se">E-mail</label><input id="se" type="email" required autocomplete="email"><label for="sp">Mot de passe (8 caractères minimum)</label><input id="sp" type="password" minlength="8" required autocomplete="new-password"><label style="display:flex;gap:8px;align-items:flex-start;font-weight:400"><input id="sc" type="checkbox" style="width:auto;margin-top:5px" required><span>J\'accepte les <a href="#/cgu">CGU</a> et la <a href="#/confidentialite">politique de confidentialité</a>.</span></label><div id="sr"></div><button class="btn block" style="margin-top:12px">Créer mon compte</button></form><p class="mu c">Déjà inscrit ? <a href="#/connexion">Connexion</a></p></div>';
  }
  function pLogin() {
    return '<div class="narrow card"><h2>Connexion</h2><form id="lf"><label for="le">E-mail</label><input id="le" type="email" required autocomplete="email"><label for="lp">Mot de passe</label><input id="lp" type="password" required autocomplete="current-password"><div id="lr"></div><button class="btn block" style="margin-top:12px">Se connecter</button></form><p class="mu c"><a href="#/oubli">Mot de passe oublié ?</a><br>Pas de compte ? <a href="#/inscription">S\'inscrire</a></p></div>';
  }
  function pForgot() {
    return '<div class="narrow card"><h2>Mot de passe oublié</h2><p class="mu">Saisissez votre e-mail : nous vous envoyons un lien valable 1 heure.</p><form id="ff"><label for="fe">E-mail</label><input id="fe" type="email" required><div id="fr"></div><button class="btn block" style="margin-top:12px">Envoyer le lien</button></form></div>';
  }
  function pReset() {
    return '<div class="narrow card"><h2>Nouveau mot de passe</h2><form id="rf"><label for="rp">Nouveau mot de passe (8 caractères minimum)</label><input id="rp" type="password" minlength="8" required autocomplete="new-password"><div id="rr"></div><button class="btn block" style="margin-top:12px">Enregistrer</button></form></div>';
  }

  /* ---------- Espace de travail ---------- */
  function langOptions(kind, selected) {
    return CFG.languages.filter(function (l) { return l[kind]; }).map(function (l) { return '<option value="' + l.code + '"' + (l.code === selected ? ' selected' : '') + '>' + esc(l.label) + '</option>'; }).join('');
  }
  function trialBox(u) {
    var tr = u.trial, max = CFG.trial.maxMinutes;
    if (tr.audio && tr.video) return '<div class="c"><div style="font-size:2rem">🔒</div><h3>Vous avez épuisé vos essais gratuits</h3><p class="mu">Vos 2 essais (1 audio + 1 vidéo) ont été utilisés. Pour continuer, passez à un abonnement.</p><a class="btn" href="#/tarifs">Choisir un abonnement</a></div>';
    return '<b>🎁 Essai gratuit</b> <span class="mu">(' + max + ' min maximum par fichier)</span><div class="row" style="margin-top:8px"><span class="badge ' + (tr.audio ? 'err' : 'ok') + '">🎙️ Audio : ' + (tr.audio ? 'utilisé' : 'disponible') + '</span><span class="badge ' + (tr.video ? 'err' : 'ok') + '">🎬 Vidéo : ' + (tr.video ? 'utilisé' : 'disponible') + '</span></div>' +
      (CFG.trial.requireVerifiedEmail && !u.emailVerified ? '<div class="msg err">Confirmez votre adresse e-mail (lien reçu à l’inscription) pour utiliser l’essai.</div>' : '');
  }
  function isVid(f) { return (f.type || '').indexOf('video') === 0 || /\.(mp4|mov|mkv|webm|avi|m4v|3gp)$/i.test(f.name || ''); }

  function pWork() {
    var u = USER, free = !u.plan, exhausted = free && u.trial.audio && u.trial.video;
    var head = '<section><h1>Espace de travail</h1><p class="mu">Bonjour ' + esc(u.name.split(' ')[0]) + ', ' + (free ? 'essai gratuit' : 'formule <b>' + esc(u.planName) + '</b>') + '.</p>' +
      (u.subStatus === 'past_due' ? '<div class="msg err">Votre dernier paiement a échoué. <a href="#/parametres">Mettre à jour mon paiement</a></div>' : '');
    var stats;
    if (free) {
      stats = '<div class="card" id="tb" style="margin-bottom:16px;border:2px solid var(--pr)">' + trialBox(u) + '</div>';
    } else {
      var left = Math.max(0, u.quotaMinutes - u.usedMinutes), pct = Math.min(100, u.usedMinutes / u.quotaMinutes * 100);
      stats = '<div class="grid" style="margin-bottom:16px"><div class="card"><div class="mu">Temps restant ce mois-ci</div><div class="stat">' + fmtMin(left) + '</div><div class="bar2"><i style="width:' + pct + '%"></i></div></div><div class="card"><div class="mu">Fichier maximum</div><div class="stat">' + sizeLabel(u.maxFileMb) + '</div><a href="#/historique">Voir l\'historique</a></div></div>';
    }
    if (exhausted) return head + '<div class="card" id="tb" style="border:2px solid var(--pr)">' + trialBox(u) + '</div></section>';
    return head + stats +
      '<div class="card"><div class="tabs"><button class="btn" id="t1">Transcrire</button><button class="btn line" id="t2">Traduire</button></div>' +
      '<label class="drop" id="dz" for="ff" style="display:block;margin:0;font-weight:400;font-size:1rem"><div style="font-size:2rem">📁</div><b id="fn">Touchez ici pour choisir un fichier audio ou vidéo</b><div class="mu">Votre gestionnaire de fichiers s’ouvre · MP3, WAV, M4A, MP4, MOV, MKV, WEBM' + (free ? ' · ' + CFG.trial.maxMinutes + ' min maximum' : '') + '</div></label><input type="file" id="ff" accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.mp4,.mov,.mkv,.webm,.avi,.m4v,.3gp" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden">' +
      '<div class="row" style="margin-top:6px"><div class="grow"><label for="ls">Langue du fichier</label><select id="ls">' + langOptions('source', 'auto') + '</select></div><div class="grow" id="tw" style="display:none"><label for="lt">Traduire vers</label><select id="lt">' + langOptions('target', 'en') + '</select></div></div>' +
      '<div id="wr"></div><button class="btn block" id="go" style="margin-top:14px" disabled>Lancer la transcription</button><div class="bar2" id="pb" style="margin-top:14px;display:none"><i></i></div><div id="pst" class="mu" style="margin-top:6px"></div><div id="out2"></div></div></section>';
  }

  function showResult(item) {
    var ok = item.status === 'done';
    $('#out2').innerHTML = ok ?
      '<h3 style="margin-top:18px">Résultat</h3><div class="res">' + esc(item.text) + '</div><div class="row" style="margin-top:10px"><button class="btn alt sm" id="c1">Copier</button><a class="btn alt sm" href="/api/transcriptions/' + item.id + '/download?format=txt">Télécharger .txt</a><a class="btn alt sm" href="/api/transcriptions/' + item.id + '/download?format=srt">Sous-titres .srt</a><a class="btn line sm" href="#/historique">Historique</a></div>' :
      '<div class="msg err">' + esc(item.error || 'Échec du traitement.') + '</div>';
    if (ok) $('#c1').onclick = function () { navigator.clipboard.writeText(item.text).then(function () { $('#c1').textContent = 'Copié ✓'; }); };
  }

  function bindWork() {
    if (!$('#dz')) return; // essais épuisés : pas de formulaire
    var mode = 'transcribe', file = null;
    function setMode(m) { mode = m; $('#t1').className = 'btn' + (m === 'transcribe' ? '' : ' line'); $('#t2').className = 'btn' + (m === 'translate' ? '' : ' line'); $('#tw').style.display = m === 'translate' ? '' : 'none'; $('#go').textContent = m === 'translate' ? 'Lancer la traduction' : 'Lancer la transcription'; }
    $('#t1').onclick = function () { setMode('transcribe'); }; $('#t2').onclick = function () { setMode('translate'); };
    var dz = $('#dz');
    dz.ondragover = function (e) { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = function () { dz.classList.remove('over'); };
    dz.ondrop = function (e) { e.preventDefault(); dz.classList.remove('over'); pick(e.dataTransfer.files[0]); };
    $('#ff').onchange = function () { var f = this.files[0]; this.value = ''; pick(f); };
    function pick(f) {
      if (!f) return;
      file = null; $('#go').disabled = true;
      if (f.size > USER.maxFileMb * 1048576) { msg('#wr', 'err', (USER.plan ? 'Fichier trop volumineux pour votre formule' : 'Fichier trop volumineux pour l’essai gratuit') + ' (' + sizeLabel(USER.maxFileMb) + ' maximum).'); return; }
      if (!USER.plan && USER.trial[isVid(f) ? 'video' : 'audio']) { msg('#wr', 'err', 'Votre essai gratuit ' + (isVid(f) ? 'vidéo' : 'audio') + ' est déjà utilisé. Choisissez un abonnement pour continuer.'); return; }
      file = f; msg('#wr'); $('#fn').textContent = f.name + ' (' + (f.size / 1048576).toFixed(1) + ' Mo)'; $('#go').disabled = false;
      if (!USER.plan) { // contrôle de durée côté navigateur (le serveur revérifie de toute façon)
        var el = document.createElement(isVid(f) ? 'video' : 'audio'); el.preload = 'metadata'; el.src = URL.createObjectURL(f);
        el.onloadedmetadata = function () { var m = el.duration / 60; URL.revokeObjectURL(el.src); if (m > CFG.trial.maxMinutes + 0.05) { file = null; $('#go').disabled = true; msg('#wr', 'err', 'En essai gratuit, chaque fichier est limité à ' + CFG.trial.maxMinutes + ' minutes (le vôtre dure ' + m.toFixed(1) + ' min). Choisissez un fichier plus court ou un abonnement.'); } };
      }
    }
    $('#go').onclick = function () {
      if (!file) return;
      var fd = new FormData(); fd.append('kind', mode); fd.append('source', $('#ls').value); if (mode === 'translate') fd.append('target', $('#lt').value); fd.append('file', file);
      $('#go').disabled = true; $('#out2').innerHTML = ''; msg('#wr'); $('#pb').style.display = 'block'; var bar = $('#pb i'); bar.style.width = '0'; $('#pst').innerHTML = '<span class="spin"></span>Envoi du fichier...';
      var x = new XMLHttpRequest(); x.open('POST', '/api/transcriptions');
      x.upload.onprogress = function (e) { if (e.lengthComputable) { bar.style.width = (e.loaded / e.total * 20) + '%'; } };
      x.onerror = function () { fail('Connexion perdue pendant l\'envoi.'); };
      x.onload = function () {
        var d = {}; try { d = JSON.parse(x.responseText); } catch (e) { }
        if (x.status >= 300) return fail(d.error || 'Erreur lors de l\'envoi.');
        $('#pst').innerHTML = '<span class="spin"></span>Traitement en cours... vous pouvez quitter cette page, le résultat sera dans votre historique.';
        poll(d.id);
      };
      x.send(fd);
      function fail(t) { $('#pb').style.display = 'none'; $('#pst').textContent = ''; msg('#wr', 'err', t); $('#go').disabled = false; }
      function poll(id) {
        clearInterval(pollTimer);
        pollTimer = setInterval(function () {
          api('/transcriptions/' + id).then(function (d) {
            var it = d.item; bar.style.width = Math.max(20, it.progress) + '%';
            if (it.status === 'done' || it.status === 'failed') {
              clearInterval(pollTimer); $('#pb').style.display = 'none'; $('#pst').textContent = ''; $('#go').disabled = false;
              showResult(it);
              refreshUser().then(function () {
                if (USER && !USER.plan) { // mise à jour du compteur d'essais
                  var tb = $('#tb'); if (tb) tb.innerHTML = trialBox(USER);
                  if (it.status === 'done') {
                    var both = USER.trial.audio && USER.trial.video;
                    $('#out2').insertAdjacentHTML('beforeend', '<div class="msg ok" style="margin-top:14px">🎁 Essai gratuit utilisé. ' + (both ? 'Choisissez un abonnement pour continuer.' : 'Il vous reste l’essai ' + (USER.trial.audio ? 'vidéo' : 'audio') + '.') + ' <a href="#/tarifs">Voir les abonnements</a></div>');
                  }
                  if (both) $('#go').disabled = true;
                }
              });
            }
          }).catch(function () { /* on réessaie au prochain tour */ });
        }, 2500);
      }
    };
  }

  /* ---------- Historique ---------- */
  function pHistory() { return '<section><h1>Historique</h1><div id="hl" class="card"><span class="spin"></span>Chargement...</div></section>'; }
  function bindHistory() {
    function load() {
      api('/transcriptions').then(function (d) {
        var h = d.items;
        if (!h.length) { $('#hl').innerHTML = '<div class="c"><p class="mu">Aucune transcription pour l\'instant.</p><a class="btn" href="#/espace">Transcrire un fichier</a></div>'; return; }
        $('#hl').innerHTML = h.map(function (x) {
          var st = x.status === 'done' ? '<span class="badge ok">Terminé</span>' : x.status === 'failed' ? '<span class="badge err">Échec</span>' : '<span class="badge">En cours ' + x.progress + '%</span>';
          var lang = x.kind === 'translate' ? langLabel(x.sourceLang) + ' → ' + langLabel(x.targetLang) : langLabel(x.sourceLang);
          return '<div class="hist"><div><b>' + esc(x.filename) + '</b> ' + st + '<br><span class="mu">' + (x.kind === 'translate' ? 'Traduction' : 'Transcription') + ' · ' + esc(lang) + (x.durationMin ? ' · ' + x.durationMin + ' min' : '') + ' · ' + fmtDate(x.createdAt) + '</span>' + (x.status === 'failed' ? '<br><span style="color:var(--err);font-size:.9rem">' + esc(x.error || '') + '</span>' : '') + '</div><div class="row">' +
            (x.status === 'done' ? '<button class="btn alt sm" data-v="' + x.id + '">Voir</button><a class="btn alt sm" href="/api/transcriptions/' + x.id + '/download?format=txt">TXT</a><a class="btn alt sm" href="/api/transcriptions/' + x.id + '/download?format=srt">SRT</a>' : '') +
            '<button class="btn line sm" data-x="' + x.id + '">Supprimer</button></div></div>';
        }).join('');
        $$('[data-v]').forEach(function (b) {
          b.onclick = function () {
            api('/transcriptions/' + b.dataset.v).then(function (d) {
              $('#modal').innerHTML = '<div class="modal"><div class="box"><h3>' + esc(d.item.filename) + '</h3><div class="res">' + esc(d.item.text) + '</div><div class="row" style="margin-top:12px"><button class="btn alt sm" id="cp">Copier</button><button class="btn line sm" id="mc">Fermer</button></div></div></div>';
              $('#mc').onclick = function () { $('#modal').innerHTML = ''; };
              $('#cp').onclick = function () { navigator.clipboard.writeText(d.item.text).then(function () { $('#cp').textContent = 'Copié ✓'; }); };
            }).catch(function (e) { toast(e.message, 'err'); });
          };
        });
        $$('[data-x]').forEach(function (b) { b.onclick = function () { if (confirm('Supprimer cette transcription ?')) api('/transcriptions/' + b.dataset.x, { method: 'DELETE' }).then(load); }; });
      }).catch(function (e) { $('#hl').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; });
    }
    load();
  }

  /* ---------- Paramètres ---------- */
  function pSettings() {
    var u = USER, p = u.plan ? CFG.plans[u.plan] : null;
    return '<section><h1>Paramètres</h1><div class="grid">' +
      '<div class="card"><h3>Profil</h3><form id="sf1"><label for="an">Nom</label><input id="an" value="' + esc(u.name) + '" required maxlength="80"><label>E-mail</label><input value="' + esc(u.email) + '" disabled><div id="r1"></div><button class="btn sm" style="margin-top:12px">Enregistrer</button></form></div>' +
      '<div class="card"><h3>Mot de passe</h3><form id="sf2"><label for="op">Mot de passe actuel</label><input id="op" type="password" required autocomplete="current-password"><label for="np">Nouveau mot de passe</label><input id="np" type="password" minlength="8" required autocomplete="new-password"><div id="r2"></div><button class="btn sm" style="margin-top:12px">Modifier</button></form></div>' +
      '<div class="card"><h3>Abonnement</h3>' + (p ? '<p>Formule : <b>' + esc(p.name) + '</b> (' + p.priceEur + ' €/mois)' + (u.periodEnd ? '<br><span class="mu">Prochain renouvellement : ' + new Date(u.periodEnd).toLocaleDateString('fr-FR') + '</span>' : '') + '</p><div class="row"><a class="btn alt sm" href="#/tarifs">Changer de formule</a><button class="btn line sm" id="portal">Gérer mon abonnement</button></div><p class="mu" style="font-size:.88rem">Carte, factures et résiliation se gèrent sur le portail sécurisé Stripe.</p>' : '<p class="mu">Aucun abonnement actif.</p><a class="btn sm" href="#/tarifs">Choisir un abonnement</a>') + '</div>' +
      '<div class="card"><h3>Apparence</h3><select id="th" aria-label="Thème"><option value="">Automatique</option><option value="light">Clair</option><option value="dark">Sombre</option></select></div>' +
      '<div class="card"><h3>Mes données</h3><div class="row"><a class="btn alt sm" href="/api/auth/export">Exporter mes données</a><button class="btn danger sm" id="del">Supprimer mon compte</button></div></div></div></section>';
  }
  function bindSettings() {
    $('#sf1').onsubmit = function (e) { e.preventDefault(); api('/auth/profile', { method: 'PATCH', body: { name: $('#an').value } }).then(function (d) { USER = d.user; msg('#r1', 'ok', 'Profil mis à jour.'); }).catch(function (er) { msg('#r1', 'err', er.message); }); };
    $('#sf2').onsubmit = function (e) { e.preventDefault(); api('/auth/password', { method: 'POST', body: { current: $('#op').value, next: $('#np').value } }).then(function () { msg('#r2', 'ok', 'Mot de passe modifié.'); e.target.reset(); }).catch(function (er) { msg('#r2', 'err', er.message); }); };
    var th = $('#th'); try { th.value = localStorage.getItem('vx_theme') || ''; } catch (e) { }
    th.onchange = function () { var v = th.value; try { localStorage.setItem('vx_theme', v); } catch (e) { } applyTheme(); };
    var pt = $('#portal'); if (pt) pt.onclick = function () { api('/billing/portal', { method: 'POST' }).then(function (d) { location.href = d.url; }).catch(function (er) { toast(er.message, 'err'); }); };
    $('#del').onclick = function () { if (confirm('Supprimer définitivement votre compte, votre abonnement et vos données ? Cette action est irréversible.')) api('/auth/account', { method: 'DELETE' }).then(function () { USER = null; go('#/'); route(); }).catch(function (er) { toast(er.message, 'err'); }); };
  }
  function applyTheme() { var v = ''; try { v = localStorage.getItem('vx_theme') || ''; } catch (e) { } if (v) document.documentElement.setAttribute('data-theme', v); else document.documentElement.removeAttribute('data-theme'); }

  /* ---------- Formulaires publics ---------- */
  function startCheckout(plan) {
    if (!USER) { go('#/inscription?plan=' + plan); return; }
    api('/billing/checkout', { method: 'POST', body: { plan: plan } }).then(function (d) { location.href = d.url; }).catch(function (e) { toast(e.message, 'err'); });
  }
  function bindPublic(r, q) {
    if (r === '#/contact') $('#cf').onsubmit = function (e) { e.preventDefault(); api('/contact', { method: 'POST', body: { name: $('#cn').value, email: $('#ce').value, subject: $('#cs').value, message: $('#cm').value } }).then(function () { msg('#cr', 'ok', 'Merci, votre message est envoyé. Nous vous répondons sous 24 h ouvrées.'); e.target.reset(); }).catch(function (er) { msg('#cr', 'err', er.message); }); };
    if (r === '#/inscription') $('#sf').onsubmit = function (e) {
      e.preventDefault(); var plan = (q.match(/plan=(\w+)/) || [])[1];
      api('/auth/register', { method: 'POST', body: { name: $('#sn').value, email: $('#se').value, password: $('#sp').value } }).then(function (d) {
        USER = d.user;
        if (plan && CFG.plans[plan]) return startCheckout(plan);
        toast('Compte créé ! Vos 2 essais gratuits vous attendent.'); go('#/espace');
      }).catch(function (er) { msg('#sr', 'err', er.message); });
    };
    if (r === '#/connexion') $('#lf').onsubmit = function (e) { e.preventDefault(); api('/auth/login', { method: 'POST', body: { email: $('#le').value, password: $('#lp').value } }).then(function (d) { USER = d.user; go('#/espace'); }).catch(function (er) { msg('#lr', 'err', er.message); }); };
    if (r === '#/oubli') $('#ff').onsubmit = function (e) { e.preventDefault(); api('/auth/forgot', { method: 'POST', body: { email: $('#fe').value } }).then(function () { msg('#fr', 'ok', 'Si un compte existe avec cet e-mail, un lien vient d\'être envoyé.'); }).catch(function (er) { msg('#fr', 'err', er.message); }); };
    if (r === '#/reinitialiser') $('#rf').onsubmit = function (e) { e.preventDefault(); var t = decodeURIComponent((q.match(/token=([^&]+)/) || [])[1] || ''); api('/auth/reset', { method: 'POST', body: { token: t, password: $('#rp').value } }).then(function () { toast('Mot de passe modifié. Connectez-vous.'); go('#/connexion'); }).catch(function (er) { msg('#rr', 'err', er.message); }); };
  }

  /* ---------- Routeur ---------- */
  var AUTH = ['#/espace', '#/historique', '#/parametres'];
  function refreshUser() { return api('/auth/me').then(function (d) { USER = d.user; }).catch(function () { USER = null; }); }
  function route() {
    clearInterval(pollTimer);
    var h = location.hash || '#/', qi = h.indexOf('?'), q = qi > -1 ? h.slice(qi) : '', r = qi > -1 ? h.slice(0, qi) : h, html;
    if (AUTH.indexOf(r) > -1 && !USER) { go('#/connexion'); return; }
    var T = { '#/': pHome, '#/tarifs': pPricing, '#/apropos': pAbout, '#/contact': pContact, '#/faq': pFaq, '#/guide': pGuide, '#/confidentialite': pPrivacy, '#/cgu': pTerms, '#/mentions': pLegal, '#/connexion': pLogin, '#/inscription': pSignup, '#/oubli': pForgot, '#/reinitialiser': pReset, '#/espace': function () { return pWork(); }, '#/historique': pHistory, '#/parametres': function () { return pSettings(); } };
    html = (T[r] || p404)();
    $('#app').innerHTML = html; renderNav(r); window.scrollTo(0, 0);
    if (r === '#/espace') {
      bindWork();
      if (/paid=1/.test(q)) { refreshUser().then(function () { toast('Paiement reçu, merci ! Votre abonnement est actif.'); }); }
      if (/changed=1/.test(q)) toast('Votre formule a été modifiée.');
      if (/verified=1/.test(q)) refreshUser().then(function () { toast('Adresse e-mail confirmée ✓'); var tb = $('#tb'); if (tb && USER && !USER.plan) tb.innerHTML = trialBox(USER); });
    }
    if (r === '#/historique') bindHistory();
    if (r === '#/parametres') bindSettings();
    bindPublic(r, q);
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-plan]');
    if (b) { e.preventDefault(); startCheckout(b.getAttribute('data-plan')); }
  });
  $('#burger').onclick = function () { $('#nav').classList.toggle('open'); };
  $('#yr').textContent = new Date().getFullYear();
  applyTheme();

  /* Démarrage : on charge la configuration publique puis l'utilisateur connecté (s'il y en a un). */
  api('/config').then(function (c) {
    CFG = c; $('#brandName').textContent = c.app.name; $('#coName').textContent = c.app.companyName;
    return refreshUser();
  }).then(function () { window.addEventListener('hashchange', route); route(); })
    .catch(function () { $('#app').innerHTML = '<div class="msg err">Le service est momentanément indisponible. Réessayez dans un instant.</div>'; });
})();
