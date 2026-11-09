/**
 * PIPELINE DE TRAITEMENT VOCALYS (100% GOOGLE GEMINI MULTIMODAL)
 * ---------------------------------------------------------------
 * 1. Détection de la durée exacte du média via probeDuration (contrôle quota/essai).
 * 2. Upload direct du fichier (audio ou vidéo) vers l'API Google Gemini File.
 * 3. Analyse multimodale en une seule passe :
 *    - Transcription intégrale,
 *    - Horodatages précis et identification des locuteurs,
 *    - Traduction automatique vers la langue cible (si demandée),
 *    - Résumé exécutif des points clés.
 * 4. Nettoyage immédiat du fichier temporaire sur les serveurs Google.
 * 5. Fallback automatique vers OpenAI Whisper si GEMINI_API_KEY est absent et OPENAI_API_KEY est présent.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { GoogleGenAI, Type } = require('@google/genai');
const OpenAI = require('openai');
const config = require('./config');

const gemini = config.gemini.apiKey ? new GoogleGenAI({ apiKey: config.gemini.apiKey }) : null;
const openai = config.openai.apiKey ? new OpenAI({ apiKey: config.openai.apiKey }) : null;

/** Détermine le type MIME du média pour Google Gemini. */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.mp3': 'audio/mp3',
    '.wav': 'audio/wav',
    '.m4a': 'audio/m4a',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.3gp': 'video/3gpp',
  };
  return map[ext] || 'audio/mp3';
}

/** Durée du média en secondes (optionnel : via ffmpeg si présent, sinon via Gemini). */
async function probeDuration(file) {
  try {
    const out = await new Promise((resolve) => {
      const p = spawn(ffmpegPath, ['-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => { err += d.toString(); });
      p.on('close', () => resolve(err));
      p.on('error', () => resolve('')); // ne crashe pas si ffmpeg n'est pas présent
    });
    const m = out && out.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m) {
      return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
    }
  } catch (_) {}
  return null; // La durée sera déduite directement des segments Gemini
}

/** Traitement multimodal via Google Gemini */
async function processWithGemini({ filePath, kind, source, targetLabel, onProgress }) {
  const mimeType = getMimeType(filePath);
  onProgress(15);

  // 1. Upload vers Google File API
  let uploadResult;
  try {
    uploadResult = await gemini.files.upload({
      file: filePath,
      config: { mimeType }
    });
  } catch (err) {
    throw new Error('Échec du transfert vers Google Gemini : ' + err.message);
  }
  onProgress(35);

  try {
    // 2. Préparation du prompt et des consignes
    const isTranslate = kind === 'translate' && targetLabel;
    const prompt = `Tu es un transcripteur et traducteur professionnel de référence.
Analyse fidèlement cet enregistrement audio ou vidéo.
TÂCHES :
1. Détecte la langue parlée principale.
2. Écris un court résumé des points clés abordés (2 à 3 phrases).
3. Transcris fidèlement chaque réplique avec les horodatages précis en secondes (start et end) et identifie chaque locuteur (ex: "Intervenant 1", "Journaliste", ou le nom de la personne si mentionné/affiché).
${isTranslate ? `4. Traduis chaque réplique vers la langue cible suivante : "${targetLabel}". Conserve le sens, le ton naturel et les noms propres.` : ''}

Consignes impératives :
- Sois exhaustif et fidèle aux propos réels.
- Start et End doivent être des nombres en secondes (ex: 14.5).
- Fournis obligatoirement la réponse selon le schéma JSON spécifié.`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        detectedLanguage: { type: Type.STRING },
        summary: { type: Type.STRING },
        segments: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              start: { type: Type.NUMBER },
              end: { type: Type.NUMBER },
              speaker: { type: Type.STRING },
              text: { type: Type.STRING },
              translation: { type: Type.STRING },
            },
            required: ['start', 'end', 'text']
          }
        }
      },
      required: ['detectedLanguage', 'segments']
    };

    // Attendre que le fichier soit actif si c'est une vidéo volumineuse
    let fileMeta = uploadResult;
    let attempts = 0;
    while (fileMeta.state === 'PROCESSING' && attempts < 15) {
      await new Promise((r) => setTimeout(r, 2000));
      fileMeta = await gemini.files.get({ name: uploadResult.name }).catch(() => fileMeta);
      attempts++;
    }
    if (fileMeta.state === 'FAILED') throw new Error('Échec de la préparation du fichier média par Google.');

    const filePart = {
      fileData: {
        fileUri: uploadResult.uri,
        mimeType: uploadResult.mimeType || mimeType,
      },
    };

    onProgress(50);

    // Liste de modèles avec basculement automatique en cas de charge temporaire (503)
    const modelsToTry = [
      config.gemini.model,
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash',
    ].filter((m, idx, arr) => arr.indexOf(m) === idx);

    let response;
    let lastErr;
    for (const targetModel of modelsToTry) {
      try {
        console.log(`[Gemini] Analyse en cours avec le modèle : ${targetModel}...`);
        response = await gemini.models.generateContent({
          model: targetModel,
          contents: [filePart, prompt],
          config: {
            responseMimeType: 'application/json',
            responseSchema: schema,
            temperature: 0.2,
          },
        });
        if (response && response.text) break;
      } catch (err) {
        lastErr = err;
        const is503 = err.status === 503 || String(err.message || '').includes('503') || String(err.message || '').includes('high demand');
        if (is503) {
          console.warn(`[Gemini] Modèle ${targetModel} en forte demande (503). Basculement immédiat vers le modèle suivant...`);
          continue;
        }
        throw err;
      }
    }
    if (!response) throw lastErr;
    onProgress(90);

    const parsed = JSON.parse(response.text || '{}');
    const rawSegments = Array.isArray(parsed.segments) ? parsed.segments : [];
    
    // Normalisation des segments
    const segments = rawSegments.map((s) => {
      const start = Number(s.start) || 0;
      const end = Number(s.end) || (start + 1);
      const speakerPrefix = s.speaker ? `[${s.speaker}] ` : '';
      const content = isTranslate && s.translation ? s.translation : s.text;
      return {
        start,
        end,
        speaker: s.speaker || null,
        text: speakerPrefix + String(content || '').trim()
      };
    }).filter((s) => s.text);

    return {
      detectedLanguage: parsed.detectedLanguage || source || 'auto',
      summary: parsed.summary || null,
      segments
    };
  } finally {
    // 3. Suppression du fichier distant chez Google
    if (uploadResult && uploadResult.name) {
      gemini.files.delete({ name: uploadResult.name }).catch(() => {});
    }
  }
}

/** Fallback OpenAI Whisper (conservé pour rétrocompatibilité) */
async function processWithWhisperFallback({ filePath, workDir, kind, source, targetLabel, onProgress }) {
  if (!openai) throw new Error('Aucun moteur IA configuré. Veuillez renseigner GEMINI_API_KEY dans votre fichier .env.');
  onProgress(20);
  // Découpage mono 16kHz
  fs.mkdirSync(workDir, { recursive: true });
  const p = spawn(ffmpegPath, ['-y', '-i', filePath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k',
    '-f', 'segment', '-segment_time', '600', '-reset_timestamps', '1', path.join(workDir, 'chunk_%03d.mp3')], { stdio: ['ignore', 'ignore', 'pipe'] });
  await new Promise((res, rej) => p.on('close', (c) => c === 0 ? res() : rej(new Error('Erreur ffmpeg'))));
  const chunks = fs.readdirSync(workDir).filter(f => f.endsWith('.mp3')).sort().map(f => path.join(workDir, f));

  let segments = [];
  let detected = null;
  for (let i = 0; i < chunks.length; i++) {
    const params = { file: fs.createReadStream(chunks[i]), model: config.openai.whisperModel, response_format: 'verbose_json' };
    if (source && source !== 'auto') params.language = source;
    const r = await openai.audio.transcriptions.create(params);
    detected = detected || r.language;
    const offset = i * 600;
    (r.segments || []).forEach(s => segments.push({ start: s.start + offset, end: s.end + offset, text: s.text.trim() }));
    onProgress(20 + Math.round(((i + 1) / chunks.length) * 60));
  }
  return { detectedLanguage: detected, segments };
}

/**
 * Traitement principal.
 * Appelé depuis transcriptions.js.
 */
async function processMedia({ filePath, workDir, kind, source, targetLabel, clientDuration, checkQuota, onProgress }) {
  let duration = await probeDuration(filePath);
  if (!duration && clientDuration && !isNaN(clientDuration)) {
    duration = parseFloat(clientDuration);
  }

  // Si la durée a pu être mesurée avant, on vérifie le quota tout de suite
  if (duration) {
    const durationMin = Math.max(1, Math.ceil(duration / 60));
    checkQuota(durationMin, duration);
  }
  onProgress(5);

  let result;
  if (gemini) {
    result = await processWithGemini({ filePath, kind, source, targetLabel, onProgress });
  } else {
    result = await processWithWhisperFallback({ filePath, workDir, kind, source, targetLabel, onProgress });
  }

  if (!result.segments || !result.segments.length) {
    throw new Error('Aucune parole détectée dans ce fichier.');
  }

  // Si la durée n'était pas connue avant, on la déduit des segments horodatés de Gemini
  if (!duration) {
    const lastSeg = result.segments[result.segments.length - 1];
    duration = (lastSeg && lastSeg.end) ? Number(lastSeg.end) : 30;
    const durationMin = Math.max(1, Math.ceil(duration / 60));
    checkQuota(durationMin, duration);
  }

  const durationMin = Math.max(1, Math.ceil(duration / 60));
  onProgress(98);
  const text = result.segments.map((s) => `[${stamp(s.start)}] ${s.text}`).join('\n');
  return {
    durationMin,
    segments: result.segments,
    text,
    detectedLanguage: result.detectedLanguage,
    summary: result.summary
  };
}

const pad = (n, l = 2) => String(Math.floor(n)).padStart(l, '0');
function stamp(sec) {
  const h = sec / 3600, m = (sec % 3600) / 60, s = sec % 60;
  return (h >= 1 ? pad(h) + ':' : '') + pad(m) + ':' + pad(s);
}
function srtTime(sec) {
  const ms = Math.round((sec % 1) * 1000);
  return `${pad(sec / 3600)}:${pad((sec % 3600) / 60)}:${pad(sec % 60)},${String(ms).padStart(3, '0')}`;
}
function toSrt(segments) {
  return segments.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(Math.max(s.end, s.start + 0.5))}\n${s.text}\n`).join('\n');
}
function toPlain(segments) {
  return segments.map((s) => s.text).join('\n');
}

module.exports = { processMedia, toSrt, toPlain, stamp };
