/**
 * AUTHENTIFICATION ET COMPTE
 * ---------------------------------------------------------------
 * - Mots de passe hachés avec bcrypt (jamais stockés en clair)
 * - Session = cookie HttpOnly signé (JWT), 7 jours
 * - Réinitialisation de mot de passe par e-mail (lien à usage unique, 1 h)
 *
 * Routes (toutes préfixées par /api/auth) :
 *  POST /register   POST /login   POST /logout   GET /me
 *  POST /forgot     POST /reset
 *  PATCH /profile   POST /password   GET /export   DELETE /account
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('./config');
const db = require('./db');
const mailer = require('./mailer');
const trial = require('./trial');

const router = express.Router();
const COOKIE = 'vx_token';
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: config.env === 'production', maxAge: 7 * 24 * 3600 * 1000, path: '/' };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 190;

function publicUser(u) {
  const plan = u.plan ? config.plans[u.plan] : null;
  return {
    id: u.id, name: u.name, email: u.email, emailVerified: !!u.email_verified,
    plan: u.plan, planName: plan ? plan.name : null, subStatus: u.sub_status,
    quotaMinutes: plan ? plan.minutes : 0, usedMinutes: u.used_minutes,
    maxFileMb: plan ? plan.maxFileMb : config.trial.maxFileMb, periodEnd: u.period_end, createdAt: u.created_at,
    trial: plan ? null : trial.status(u),
  };
}

function setSession(res, user) {
  const token = jwt.sign({ uid: user.id }, config.jwtSecret, { expiresIn: '7d' });
  res.cookie(COOKIE, token, cookieOpts);
}

/** Middleware : charge req.user ou renvoie 401. */
function requireAuth(req, res, next) {
  try {
    const token = req.cookies[COOKIE];
    if (!token) throw new Error('no token');
    const { uid } = jwt.verify(token, config.jwtSecret);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    if (!user) throw new Error('no user');
    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Connexion requise.' });
  }
}

/** Middleware : exige un abonnement actif. */
function requirePlan(req, res, next) {
  const ok = req.user.plan && ['active', 'trialing', 'past_due'].includes(req.user.sub_status);
  if (!ok) return res.status(402).json({ error: 'Un abonnement actif est nécessaire.' });
  next();
}

router.post('/register', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (name.length < 2 || name.length > 80) throw new HttpError(400, 'Nom invalide.');
    if (!emailOk(email)) throw new HttpError(400, 'Adresse e-mail invalide.');
    if (password.length < 8 || password.length > 100) throw new HttpError(400, 'Le mot de passe doit contenir au moins 8 caractères.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Un compte existe déjà avec cet e-mail.');

    const user = {
      id: crypto.randomUUID(), name, email, password_hash: await bcrypt.hash(password, 11),
      email_verified: 0, plan: null, used_minutes: 0, created_at: Date.now(),
    };
    db.prepare(`INSERT INTO users (id,name,email,password_hash,email_verified,plan,used_minutes,created_at)
                VALUES (@id,@name,@email,@password_hash,@email_verified,@plan,@used_minutes,@created_at)`).run(user);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    mailer.sendWelcomePlans(row); // envoi en arrière-plan
    setSession(res, row);
    res.status(201).json({ user: publicUser(row) });
  } catch (e) { next(e); }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) throw new HttpError(401, 'E-mail ou mot de passe incorrect.');
    setSession(res, user);
    res.json({ user: publicUser(user) });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

/** Lien « Confirmer mon adresse e-mail » de l'e-mail de bienvenue. */
router.get('/verify', (req, res) => {
  try {
    const { uid, purpose } = jwt.verify(String(req.query.t || ''), config.jwtSecret);
    if (purpose !== 'verify') throw new Error('bad token');
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(uid);
    res.redirect(`${config.baseUrl}/#/espace?verified=1`);
  } catch (e) { res.redirect(`${config.baseUrl}/#/connexion`); }
});

router.post('/forgot', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user) {
    // Le jeton est signé avec (secret + hash actuel du mot de passe) : il devient invalide dès qu'on change le mot de passe.
    const token = jwt.sign({ uid: user.id, purpose: 'reset' }, config.jwtSecret + user.password_hash, { expiresIn: '1h' });
    mailer.sendReset(user, token);
  }
  res.json({ ok: true }); // même réponse dans tous les cas (ne révèle pas si l'e-mail existe)
});

router.post('/reset', async (req, res, next) => {
  try {
    const token = String(req.body.token || '');
    const password = String(req.body.password || '');
    if (password.length < 8 || password.length > 100) throw new HttpError(400, 'Le mot de passe doit contenir au moins 8 caractères.');
    const decoded = jwt.decode(token);
    const user = decoded && db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.uid);
    if (!user) throw new HttpError(400, 'Lien invalide ou expiré.');
    try { jwt.verify(token, config.jwtSecret + user.password_hash); } catch (e) { throw new HttpError(400, 'Lien invalide ou expiré.'); }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(password, 11), user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.patch('/profile', requireAuth, (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (name.length < 2 || name.length > 80) throw new HttpError(400, 'Nom invalide.');
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  } catch (e) { next(e); }
});

router.post('/password', requireAuth, async (req, res, next) => {
  try {
    const { current, next: nw } = req.body;
    if (!(await bcrypt.compare(String(current || ''), req.user.password_hash))) throw new HttpError(400, 'Mot de passe actuel incorrect.');
    if (String(nw || '').length < 8 || String(nw).length > 100) throw new HttpError(400, 'Le nouveau mot de passe doit contenir au moins 8 caractères.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(String(nw), 11), req.user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Export des données personnelles (droit d'accès / portabilité). */
router.get('/export', requireAuth, (req, res) => {
  const u = publicUser(req.user);
  const items = db.prepare('SELECT id,filename,kind,source_lang,target_lang,duration_min,status,text,created_at FROM transcriptions WHERE user_id = ?').all(req.user.id);
  res.setHeader('Content-Disposition', 'attachment; filename="mes-donnees-vocalys.json"');
  res.json({ exportedAt: new Date().toISOString(), account: u, transcriptions: items });
});

/** Suppression définitive du compte (annule aussi l'abonnement Stripe). */
router.delete('/account', requireAuth, async (req, res, next) => {
  try {
    const billing = require('./billing');
    await billing.cancelSubscriptionNow(req.user).catch((e) => console.error('Annulation Stripe :', e.message));
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id); // supprime aussi les transcriptions (ON DELETE CASCADE)
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = { router, requireAuth, requirePlan, publicUser, HttpError };
