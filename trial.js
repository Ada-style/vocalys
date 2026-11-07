/**
 * ESSAI GRATUIT : 1 audio + 1 vidéo, durée limitée (TRIAL_MAX_MINUTES, 2 min par défaut)
 * ---------------------------------------------------------------
 * Règles appliquées CÔTÉ SERVEUR (impossible à contourner depuis le navigateur) :
 *  - un essai audio et un essai vidéo par client, jamais renouvelés ;
 *  - un essai est consommé uniquement quand la transcription RÉUSSIT ;
 *  - un fichier plus long que la limite est refusé SANS consommer l'essai ;
 *  - l'usage est mémorisé par compte ET par adresse e-mail (table trial_usage) :
 *    se déconnecter/reconnecter, ou supprimer puis recréer le compte avec le même e-mail,
 *    ne redonne aucun essai ;
 *  - dès que les deux essais sont utilisés, seul un abonnement permet de continuer.
 * Voir README, section « Essai gratuit », pour renforcer l'anti-abus (ex : confirmation d'e-mail obligatoire).
 */
const path = require('path');
const config = require('./config');
const db = require('./db');

const VIDEO_EXT = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.3gp'];

/** 'video' ou 'audio' d'après le fichier envoyé. */
function mediaKind(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  return (file.mimetype || '').startsWith('video/') || VIDEO_EXT.includes(ext) ? 'video' : 'audio';
}

const safe = (kind) => (kind === 'video' ? 'video' : 'audio'); // liste blanche (évite toute injection SQL)

function isUsed(user, kind) {
  kind = safe(kind);
  if (user['trial_' + kind]) return true;
  return !!db.prepare('SELECT 1 FROM trial_usage WHERE email = ? AND kind = ?').get(user.email, kind);
}

/** Un traitement d'essai de ce type est déjà en cours ou terminé (évite deux envois simultanés). */
function isPending(user, kind) {
  return !!db.prepare("SELECT 1 FROM transcriptions WHERE user_id = ? AND trial_kind = ? AND status IN ('queued','processing','done')").get(user.id, safe(kind));
}

/** Consomme l'essai (appelé quand la transcription a réussi). */
function consume(user, kind) {
  kind = safe(kind);
  db.prepare(`UPDATE users SET trial_${kind} = 1 WHERE id = ?`).run(user.id);
  db.prepare('INSERT OR IGNORE INTO trial_usage (email, kind, used_at) VALUES (?, ?, ?)').run(user.email, kind, Date.now());
}

function status(user) {
  return { audio: isUsed(user, 'audio'), video: isUsed(user, 'video'), maxMinutes: config.trial.maxMinutes };
}

module.exports = { mediaKind, isUsed, isPending, consume, status };
