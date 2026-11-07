/**
 * TRANSCRIPTIONS : envoi du fichier, traitement en arrière-plan, historique, export
 * ---------------------------------------------------------------
 * POST   /api/transcriptions            (multipart : file, kind, source, target)  => { id }
 * GET    /api/transcriptions            liste (historique)
 * GET    /api/transcriptions/:id        détail + progression (le front l'interroge toutes les 2,5 s)
 * GET    /api/transcriptions/:id/download?format=txt|srt
 * DELETE /api/transcriptions/:id
 *
 * Le traitement est asynchrone : l'upload répond tout de suite, le travail se fait en
 * arrière-plan (file d'attente limitée par MAX_CONCURRENT_JOBS), puis le statut passe à "done".
 * Quota : les minutes ne sont décomptées QUE si le traitement réussit.
 */
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');
const { requireAuth, requirePlan, HttpError } = require('./auth');
const pipeline = require('./pipeline');
const trial = require('./trial');

const router = express.Router();
const uploadDir = path.join(config.dataDir, 'uploads');

const maxMb = Math.max(...Object.values(config.plans).map((p) => p.maxFileMb));
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const okType = /^(audio|video)\//.test(file.mimetype) || config.allowedExt.includes(ext);
    if (!okType || !config.allowedExt.includes(ext)) return cb(new HttpError(400, 'Format non pris en charge. Utilisez un fichier audio ou vidéo (MP3, WAV, M4A, MP4, MOV, MKV, WEBM...).'));
    cb(null, true);
  },
});

const labelOf = (code) => (config.languages.find((l) => l.code === code) || {}).label || code;
const remaining = (u) => Math.max(0, (config.plans[u.plan] ? config.plans[u.plan].minutes : 0) - u.used_minutes);

/* ----------------------- File d'attente simple en mémoire ----------------------- */
const queue = [];
let running = 0;
function enqueue(job) { queue.push(job); tick(); }
function tick() {
  while (running < config.maxConcurrentJobs && queue.length) {
    const job = queue.shift();
    running++;
    runJob(job).catch((e) => console.error('Job :', e)).finally(() => { running--; tick(); });
  }
}

async function runJob({ id, userId, filePath, kind, source, target, trialKind }) {
  const workDir = path.join(uploadDir, 'work_' + id);
  const set = (fields) => {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE transcriptions SET ${keys.map((k) => k + ' = @' + k).join(', ')} WHERE id = @id`).run({ ...fields, id });
  };
  try {
    set({ status: 'processing', progress: 2 });
    const result = await pipeline.processMedia({
      filePath, workDir, kind, source,
      sourceLabel: source === 'auto' ? null : labelOf(source),
      targetLabel: labelOf(target),
      checkQuota: (min, seconds) => {
        const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (trialKind) {
          // ESSAI GRATUIT : durée maximale par fichier (l'essai n'est pas consommé si le fichier est refusé)
          if (seconds > config.trial.maxMinutes * 60 + 3) throw new Error(`En essai gratuit, chaque fichier est limité à ${config.trial.maxMinutes} minutes (le vôtre dure ${(seconds / 60).toFixed(1)} min). Votre essai n'est pas consommé : choisissez un fichier plus court ou passez à un abonnement.`);
        } else if (min > remaining(u)) throw new Error(`Quota mensuel insuffisant : ce fichier dure ${min} min et il vous reste ${remaining(u)} min. Passez à une formule supérieure.`);
        set({ duration_min: min });
      },
      onProgress: (p) => set({ progress: p }),
    });
    if (trialKind) trial.consume(db.prepare('SELECT * FROM users WHERE id = ?').get(userId), trialKind); // essai consommé seulement en cas de succès
    else db.prepare('UPDATE users SET used_minutes = used_minutes + ? WHERE id = ?').run(result.durationMin, userId);
    set({ status: 'done', progress: 100, duration_min: result.durationMin, text: result.text, segments: JSON.stringify(result.segments) });
  } catch (err) {
    console.error('Échec transcription', id, err.message);
    set({ status: 'failed', error: String(err.message || 'Erreur de traitement').slice(0, 300) });
  } finally {
    fs.rm(filePath, { force: true }, () => {});
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  }
}

// Au redémarrage du serveur, les travaux interrompus sont marqués en échec (le client peut relancer).
db.prepare("UPDATE transcriptions SET status='failed', error='Traitement interrompu par un redémarrage du serveur. Relancez le fichier.' WHERE status IN ('queued','processing')").run();

/* ----------------------------------- Routes ----------------------------------- */
router.use(requireAuth);

router.post('/', (req, res, next) => {
  const u = req.user;
  const hasPlan = !!u.plan && ['active', 'trialing', 'past_due'].includes(u.sub_status);
  if (!hasPlan) {
    const ts = trial.status(u);
    if (ts.audio && ts.video) return next(new HttpError(402, 'Vous avez épuisé vos essais gratuits. Choisissez un abonnement pour continuer.'));
    if (config.trial.requireVerifiedEmail && !u.email_verified) return next(new HttpError(403, "Confirmez d'abord votre adresse e-mail (lien reçu à l'inscription) pour utiliser l'essai gratuit."));
  }
  if (hasPlan && remaining(u) <= 0) return next(new HttpError(402, 'Votre quota mensuel est épuisé. Passez à une formule supérieure ou attendez le renouvellement.'));
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'Fichier trop volumineux.'));
      return next(err);
    }
    try {
      if (!req.file) throw new HttpError(400, 'Aucun fichier reçu.');
      let trialKind = null;
      if (!hasPlan) {
        trialKind = trial.mediaKind(req.file);
        if (trial.isUsed(u, trialKind) || trial.isPending(u, trialKind)) {
          fs.rm(req.file.path, { force: true }, () => {});
          throw new HttpError(402, `Votre essai gratuit ${trialKind === 'video' ? 'vidéo' : 'audio'} est déjà utilisé. Choisissez un abonnement pour continuer.`);
        }
      }
      const maxFileMb = hasPlan ? config.plans[u.plan].maxFileMb : config.trial.maxFileMb;
      if (req.file.size > maxFileMb * 1024 * 1024) {
        fs.rm(req.file.path, { force: true }, () => {});
        throw new HttpError(413, `Fichier trop volumineux pour ${hasPlan ? 'votre formule' : 'l\'essai gratuit'} (${maxFileMb} Mo maximum).`);
      }
      const kind = req.body.kind === 'translate' ? 'translate' : 'transcribe';
      const source = config.languages.find((l) => l.code === req.body.source && l.source) ? req.body.source : 'auto';
      let target = null;
      if (kind === 'translate') {
        const t = config.languages.find((l) => l.code === req.body.target && l.target);
        if (!t) throw new HttpError(400, 'Choisissez une langue de traduction.');
        target = t.code;
      }
      const id = crypto.randomUUID();
      db.prepare(`INSERT INTO transcriptions (id,user_id,filename,kind,source_lang,target_lang,status,progress,created_at,trial_kind)
                  VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, req.user.id, req.file.originalname.slice(0, 200), kind, source, target, 'queued', 0, Date.now(), trialKind);
      enqueue({ id, userId: req.user.id, filePath: req.file.path, kind, source, target, trialKind });
      res.status(202).json({ id });
    } catch (e) {
      if (req.file) fs.rm(req.file.path, { force: true }, () => {});
      next(e);
    }
  });
});

const view = (r, withText) => ({
  id: r.id, filename: r.filename, kind: r.kind, sourceLang: r.source_lang, targetLang: r.target_lang,
  durationMin: r.duration_min, status: r.status, progress: r.progress, error: r.error, createdAt: r.created_at,
  ...(withText ? { text: r.text } : {}),
});

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM transcriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 500').all(req.user.id);
  res.json({ items: rows.map((r) => view(r, false)) });
});

router.get('/:id', (req, res, next) => {
  const r = db.prepare('SELECT * FROM transcriptions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!r) return next(new HttpError(404, 'Introuvable.'));
  res.json({ item: view(r, true) });
});

router.get('/:id/download', (req, res, next) => {
  const r = db.prepare('SELECT * FROM transcriptions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!r || r.status !== 'done') return next(new HttpError(404, 'Introuvable.'));
  const segs = JSON.parse(r.segments || '[]');
  const fmt = req.query.format === 'srt' ? 'srt' : 'txt';
  const base = r.filename.replace(/\.[^.]+$/, '').replace(/[^\w\-. ]+/g, '_').slice(0, 80) || 'transcription';
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${base}.${fmt}"`);
  res.send(fmt === 'srt' ? pipeline.toSrt(segs) : pipeline.toPlain(segs));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM transcriptions WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

/** Nettoyage quotidien : applique la durée d'historique des formules limitées (ex : Starter = 30 jours). */
function purgeOld() {
  for (const [key, p] of Object.entries(config.plans)) {
    if (!p.historyDays) continue;
    const limit = Date.now() - p.historyDays * 86400000;
    db.prepare('DELETE FROM transcriptions WHERE created_at < ? AND user_id IN (SELECT id FROM users WHERE plan = ?)').run(limit, key);
  }
}
setInterval(purgeOld, 24 * 3600 * 1000).unref();
purgeOld();

module.exports = { router };
