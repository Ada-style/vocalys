/**
 * BASE DE DONNÉES (SQLite, un seul fichier : DATA_DIR/vocalys.db)
 * Tables : users, transcriptions. Créées automatiquement au démarrage.
 * IMPORTANT en production : DATA_DIR doit être sur un disque PERSISTANT.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true });

const db = new Database(path.join(config.dataDir, 'vocalys.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  plan TEXT,                         -- starter | pro | business | NULL (aucun abonnement actif)
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  sub_status TEXT,                   -- active | past_due | canceled ...
  used_minutes INTEGER NOT NULL DEFAULT 0,
  period_end INTEGER,                -- fin de la période de facturation (timestamp ms)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_customer ON users(stripe_customer_id);

CREATE TABLE IF NOT EXISTS transcriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  kind TEXT NOT NULL,                -- transcribe | translate
  source_lang TEXT,
  target_lang TEXT,
  duration_min REAL,
  status TEXT NOT NULL,              -- queued | processing | done | failed
  progress INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  text TEXT,
  segments TEXT,                     -- JSON : [{start,end,text}]
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tr_user ON transcriptions(user_id, created_at DESC);
`);

/* Migrations légères (ajout des colonnes de l'essai gratuit sur une base existante) */
function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('users', 'trial_audio', 'INTEGER NOT NULL DEFAULT 0');   // 1 = essai audio consommé
addColumn('users', 'trial_video', 'INTEGER NOT NULL DEFAULT 0');   // 1 = essai vidéo consommé
addColumn('transcriptions', 'trial_kind', 'TEXT');                   // 'audio' | 'video' si traitement d'essai

/* Mémoire des essais par e-mail : survit à la suppression du compte (anti-contournement) */
db.exec(`CREATE TABLE IF NOT EXISTS trial_usage (
  email TEXT NOT NULL, kind TEXT NOT NULL, used_at INTEGER NOT NULL, PRIMARY KEY (email, kind)
);`);

module.exports = db;
