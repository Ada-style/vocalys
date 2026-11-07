/**
 * PIPELINE DE TRAITEMENT : fichier audio/vidéo => texte (=> traduction)
 * ---------------------------------------------------------------
 * 1. ffmpeg (embarqué via le paquet "ffmpeg-static", rien à installer) extrait la piste audio,
 *    la convertit en MP3 mono léger et la découpe en morceaux de 10 minutes
 *    (l'API Whisper accepte 25 Mo maximum par envoi).
 * 2. Chaque morceau est envoyé à l'API OpenAI Whisper (clé OPENAI_API_KEY).
 * 3. Les segments horodatés sont recollés avec le bon décalage de temps.
 * 4. Si l'utilisateur demande une traduction, les segments sont traduits par lots (modèle TRANSLATE_MODEL).
 *
 * Pour utiliser un autre moteur de transcription (Deepgram, AssemblyAI, Google...),
 * remplacez UNIQUEMENT la fonction transcribeChunk() : elle doit renvoyer
 * { language, segments: [{ start, end, text }] } (temps en secondes, relatifs au morceau).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const OpenAI = require('openai');
const config = require('./config');

const CHUNK_SECONDS = 600;
const openai = config.openai.apiKey ? new OpenAI({ apiKey: config.openai.apiKey }) : null;

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error('Fichier illisible ou format non pris en charge.'))));
  });
}

/** Durée du média en secondes (lue dans la sortie de ffmpeg). */
async function probeDuration(file) {
  const out = await new Promise((resolve) => {
    const p = spawn(ffmpegPath, ['-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('close', () => resolve(err));
    p.on('error', () => resolve(err));
  });
  const m = out.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) throw new Error('Impossible de lire la durée : fichier invalide.');
  return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}

/** Extrait l'audio et le découpe en morceaux. Renvoie la liste triée des fichiers. */
async function makeChunks(input, dir) {
  fs.mkdirSync(dir, { recursive: true });
  await run(['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k',
    '-f', 'segment', '-segment_time', String(CHUNK_SECONDS), '-reset_timestamps', '1', path.join(dir, 'chunk_%03d.mp3')]);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort().map((f) => path.join(dir, f));
  if (!files.length) throw new Error('Aucune piste audio trouvée dans ce fichier.');
  return files;
}

/** >>> POINT DE REMPLACEMENT du moteur de transcription (voir l'en-tête du fichier). */
async function transcribeChunk(file, language) {
  if (!openai) throw new Error('Transcription non configurée (OPENAI_API_KEY manquante).');
  const params = { file: fs.createReadStream(file), model: config.openai.whisperModel, response_format: 'verbose_json' };
  if (language && language !== 'auto') params.language = language;
  const r = await openai.audio.transcriptions.create(params);
  const segments = (r.segments && r.segments.length)
    ? r.segments.map((s) => ({ start: s.start, end: s.end, text: String(s.text).trim() }))
    : [{ start: 0, end: 0, text: String(r.text || '').trim() }];
  return { language: r.language, segments };
}

/** Traduit les textes des segments par lots de 40, en conservant l'ordre. */
async function translateSegments(segments, fromLabel, toLabel) {
  if (!openai) throw new Error('Traduction non configurée (OPENAI_API_KEY manquante).');
  const out = [];
  for (let i = 0; i < segments.length; i += 40) {
    const batch = segments.slice(i, i + 40);
    let translated = null;
    for (let attempt = 0; attempt < 2 && !translated; attempt++) {
      const r = await openai.chat.completions.create({
        model: config.openai.translateModel,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `Tu es un traducteur professionnel. Traduis chaque phrase du tableau JSON "t" de ${fromLabel} vers ${toLabel}. Réponds UNIQUEMENT avec un objet JSON {"t":[...]} contenant exactement le même nombre d'éléments, dans le même ordre. Conserve le sens, le ton et les noms propres.` },
          { role: 'user', content: JSON.stringify({ t: batch.map((s) => s.text) }) },
        ],
      });
      try {
        const arr = JSON.parse(r.choices[0].message.content).t;
        if (Array.isArray(arr) && arr.length === batch.length) translated = arr.map(String);
      } catch (e) { /* on retente */ }
    }
    batch.forEach((s, k) => out.push({ start: s.start, end: s.end, text: translated ? translated[k] : s.text }));
  }
  return out;
}

/**
 * Traitement complet. onProgress(0..100) est appelé au fil de l'eau.
 * Renvoie { durationMin, segments, text, detectedLanguage }.
 */
async function processMedia({ filePath, workDir, kind, source, targetLabel, sourceLabel, checkQuota, onProgress }) {
  const duration = await probeDuration(filePath);
  const durationMin = Math.max(1, Math.ceil(duration / 60));
  checkQuota(durationMin, duration); // lève une erreur si le quota est dépassé (ou si le fichier d'essai est trop long)
  onProgress(5);

  const chunks = await makeChunks(filePath, workDir);
  onProgress(15);

  let segments = [];
  let detected = null;
  for (let i = 0; i < chunks.length; i++) {
    const r = await transcribeChunk(chunks[i], source);
    detected = detected || r.language;
    const offset = i * CHUNK_SECONDS;
    r.segments.forEach((s) => segments.push({ start: s.start + offset, end: s.end + offset, text: s.text }));
    onProgress(15 + Math.round(((i + 1) / chunks.length) * (kind === 'translate' ? 55 : 80)));
  }
  segments = segments.filter((s) => s.text);
  if (!segments.length) throw new Error('Aucune parole détectée dans ce fichier.');

  if (kind === 'translate') {
    segments = await translateSegments(segments, sourceLabel || detected || 'la langue source', targetLabel);
    onProgress(95);
  }
  const text = segments.map((s) => `[${stamp(s.start)}] ${s.text}`).join('\n');
  return { durationMin, segments, text, detectedLanguage: detected };
}

const pad = (n, l = 2) => String(Math.floor(n)).padStart(l, '0');
function stamp(sec) { const h = sec / 3600, m = (sec % 3600) / 60, s = sec % 60; return (h >= 1 ? pad(h) + ':' : '') + pad(m) + ':' + pad(s); }
function srtTime(sec) {
  const ms = Math.round((sec % 1) * 1000);
  return `${pad(sec / 3600)}:${pad((sec % 3600) / 60)}:${pad(sec % 60)},${String(ms).padStart(3, '0')}`;
}
function toSrt(segments) {
  return segments.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(Math.max(s.end, s.start + 0.5))}\n${s.text}\n`).join('\n');
}
function toPlain(segments) { return segments.map((s) => s.text).join('\n'); }

module.exports = { processMedia, toSrt, toPlain, stamp };
