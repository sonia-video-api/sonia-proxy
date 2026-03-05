const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '376154181732-a842jan6p193tea2fgfctiq26ngphi44.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://sonia-video-bd-site.onrender.com';
const PROXY_URL = process.env.PROXY_URL || 'https://sonia-proxy.onrender.com';
const REDIRECT_URI = PROXY_URL + '/auth/callback';
const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID || 'b6747d04';

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'Sonia Video BD Proxy v3 - Replicate DALL-E 3 + OpenAI TTS + FFmpeg.wasm' }));

// === HELPER: Nettoyer prompt pour éviter les erreurs de contenu sensible ===
function nettoyerPrompt(prompt) {
  // Remplacer les mots potentiellement sensibles par des équivalents neutres
  const remplacements = [
    [/\b(sexy|sexi|nude|naked|nue|nu |déshabillé|déshabillée|lingerie|bikini|sous-vêtement)\b/gi, 'habillé'],
    [/\b(violence|sang|mort|tuer|assassin|blessure|arme|pistolet|fusil|couteau|bombe)\b/gi, 'aventure'],
    [/\b(drogue|alcool|cigarette|fumer|cannabis|cocaïne|héroïne)\b/gi, 'boisson'],
    [/\b(haine|racisme|raciste|discrimination|insulte)\b/gi, 'amitié'],
    [/\b(terrorisme|terroriste|attentat|explosion)\b/gi, 'action'],
  ];
  let cleaned = prompt;
  for (const [pattern, replacement] of remplacements) {
    cleaned = cleaned.replace(pattern, replacement);
  }
  return cleaned;
}

// === HELPER: Générer image via Replicate DALL-E 3 ===
async function genererImageReplicate(prompt) {
  // Nettoyer le prompt avant envoi
  const promptNettoye = nettoyerPrompt(prompt);
  // Ajouter un préfixe de style BD pour orienter la génération
  const promptFinal = promptNettoye + ', style bande dessinée colorée, illustration professionnelle, adapté à tous publics';

  // Lancer la prédiction
  const startRes = await fetch('https://api.replicate.com/v1/models/openai/dall-e-3/predictions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + REPLICATE_TOKEN,
      'Content-Type': 'application/json',
      'Prefer': 'wait'
    },
    body: JSON.stringify({
      input: {
        prompt: promptFinal,
        size: '1024x1792',
        quality: 'standard',
        style: 'vivid'
      }
    })
  });

  if (!startRes.ok) {
    const err = await startRes.text();
    if (err.includes('E005') || err.includes('sensitive') || err.includes('flagged')) {
      throw new Error('CONTENU_SENSIBLE');
    }
    throw new Error('Erreur Replicate DALL-E 3: ' + err);
  }

  const prediction = await startRes.json();

  // Si déjà terminé (Prefer: wait)
  if (prediction.status === 'succeeded' && prediction.output && prediction.output[0]) {
    return prediction.output[0];
  }

  // Sinon, polling jusqu'à completion
  const predId = prediction.id;
  let attempts = 0;
  while (attempts < 60) {
    await new Promise(r => setTimeout(r, 3000));
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${predId}`, {
      headers: { 'Authorization': 'Bearer ' + REPLICATE_TOKEN }
    });
    const pollData = await pollRes.json();
    if (pollData.status === 'succeeded' && pollData.output && pollData.output[0]) {
      return pollData.output[0];
    }
    if (pollData.status === 'failed' || pollData.status === 'canceled') {
      const errMsg = pollData.error || pollData.status || '';
      // Erreur E005 = contenu sensible → réessayer avec prompt générique
      if (errMsg.includes('E005') || errMsg.includes('sensitive') || errMsg.includes('flagged')) {
        throw new Error('CONTENU_SENSIBLE');
      }
      throw new Error('Replicate échec: ' + errMsg);
    }
    attempts++;
  }
  throw new Error('Timeout Replicate après 3 minutes');
}

// === GÉNÉRATION HISTOIRE BD PAR IA (GPT) ===
app.post('/api/histoire', async (req, res) => {
  const { phrase } = req.body;
  if (!phrase) return res.status(400).json({ error: 'Phrase requise' });

  try {
    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + OPENAI_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.85,
        messages: [
          {
            role: 'system',
            content: `Tu es un scénariste de bandes dessinées créatif et talentueux. 
Tu crées des histoires BD courtes, vivantes et émouvantes en français.
Réponds UNIQUEMENT en JSON valide, sans markdown, sans explication.`
          },
          {
            role: 'user',
            content: `Crée une histoire BD complète basée sur cette idée : "${phrase}"

Réponds en JSON avec cette structure exacte :
{
  "titre": "Titre accrocheur de la BD",
  "genre": "Comédie / Aventure / Romance / Drame / etc.",
  "personnages": "Description courte des personnages principaux",
  "couverture": {
    "description_image": "Description détaillée pour générer l'image de couverture (en anglais, style comic book coloré, vertical 9:16)",
    "texte_couverture": "Phrase d'accroche sur la couverture",
    "narration_voix": "Texte de narration pour la voix off de la couverture (2 phrases en français)"
  },
  "pages": [
    {
      "numero": 1,
      "titre_page": "Titre court de la page",
      "description_image": "Description détaillée pour générer l'image (en anglais, style comic book coloré, vertical 9:16, avec personnages et décor)",
      "narration": "Texte de narration de la page (2-3 phrases en français)",
      "dialogue": "Dialogue principal de la page (en français)",
      "narration_voix": "Texte complet pour la voix off de cette page (3-4 phrases en français)"
    },
    {
      "numero": 2,
      "titre_page": "Titre court",
      "description_image": "Description image en anglais, style comic book coloré, vertical 9:16",
      "narration": "Narration en français",
      "dialogue": "Dialogue en français",
      "narration_voix": "Texte voix off en français"
    },
    {
      "numero": 3,
      "titre_page": "Titre court",
      "description_image": "Description image en anglais, style comic book coloré, vertical 9:16",
      "narration": "Narration en français",
      "dialogue": "Dialogue en français",
      "narration_voix": "Texte voix off en français"
    },
    {
      "numero": 4,
      "titre_page": "Titre court",
      "description_image": "Description image en anglais, style comic book coloré, vertical 9:16",
      "narration": "Narration en français",
      "dialogue": "Dialogue en français",
      "narration_voix": "Texte voix off en français"
    }
  ]
}`
          }
        ]
      })
    });

    if (!gptRes.ok) {
      const err = await gptRes.text();
      return res.status(500).json({ error: 'Erreur GPT: ' + err });
    }

    const gptData = await gptRes.json();
    const content = gptData.choices[0].message.content.trim();

    let histoire;
    try {
      histoire = JSON.parse(content);
    } catch(e) {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) histoire = JSON.parse(match[0]);
      else return res.status(500).json({ error: 'Réponse GPT invalide' });
    }

    return res.json({ histoire });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// === HELPER: Générer image avec fallback si contenu sensible ===
async function genererImageAvecFallback(prompt, style = 'standard') {
  try {
    return await genererImageReplicate(prompt);
  } catch (err) {
    if (err.message === 'CONTENU_SENSIBLE') {
      // Réessayer avec un prompt générique et sûr
      const promptFallback = style === 'hd'
        ? 'High quality comic book illustration, HD colorful BD style, vertical 9:16 format, two friendly characters having an adventure in a colorful world, professional illustration'
        : 'Comic book illustration, colorful BD style, vertical 9:16 format, two friendly characters smiling in a sunny landscape, vibrant colors, detailed artwork';
      return await genererImageReplicate(promptFallback);
    }
    throw err;
  }
}

// === GÉNÉRATION IMAGE DALL-E 3 via Replicate (Standard) ===
app.post('/api/generate/standard', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt requis' });

  try {
    const fullPrompt = `Comic book illustration, colorful BD style, vertical 9:16 format, vibrant colors, detailed artwork: ${prompt}`;
    const imageUrl = await genererImageAvecFallback(fullPrompt, 'standard');
    return res.json({ images: [imageUrl] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// === GÉNÉRATION IMAGE DALL-E 3 via Replicate (HD) ===
app.post('/api/generate/hd', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt requis' });

  try {
    const fullPrompt = `High quality comic book illustration, HD colorful BD style, vertical 9:16 format, ultra detailed vibrant artwork, professional illustration: ${prompt}`;
    const imageUrl = await genererImageAvecFallback(fullPrompt, 'hd');
    return res.json({ images: [imageUrl] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// === GÉNÉRATION VOIX OFF (OpenAI TTS) ===
app.post('/api/tts', async (req, res) => {
  const { text, voice = 'nova' } = req.body;
  if (!text) return res.status(400).json({ error: 'Texte requis' });

  try {
    const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + OPENAI_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: voice, // alloy, echo, fable, onyx, nova, shimmer
        response_format: 'mp3'
      })
    });

    if (!ttsRes.ok) {
      const err = await ttsRes.text();
      return res.status(500).json({ error: 'Erreur TTS: ' + err });
    }

    const audioBuffer = await ttsRes.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');
    return res.json({ audio: audioBase64, format: 'mp3' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// === GÉNÉRATION VIDÉO COMPLÈTE (Images + Voix en base64 pour assemblage côté client) ===
app.post('/api/generer-video', async (req, res) => {
  const { histoire, qualite = 'standard', voix = 'nova' } = req.body;
  if (!histoire) return res.status(400).json({ error: 'Histoire requise' });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonia-'));

  try {
    const pages = [
      {
        numero: 0,
        titre_page: 'Couverture',
        description_image: histoire.couverture.description_image,
        narration_voix: histoire.couverture.narration_voix || histoire.couverture.texte_couverture
      },
      ...histoire.pages
    ];

    const segments = [];

    // Générer les images et voix pour chaque page
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      // Générer l'image via Replicate DALL-E 3
      const imgPrompt = i === 0
        ? `Comic book cover, title "${histoire.titre}", colorful BD style, vertical 9:16: ${page.description_image}`
        : `Comic book page ${i}, BD illustration style, colorful: ${page.description_image}`;

      const fullPrompt = `Comic book illustration, colorful BD style, vertical 9:16 format, vibrant colors, professional comic art: ${imgPrompt}`;

      let imageUrl;
      try {
        imageUrl = await genererImageReplicate(fullPrompt);
      } catch (imgErr) {
        if (imgErr.message === 'CONTENU_SENSIBLE') {
          // Fallback avec prompt générique
          const fallbackPrompt = i === 0
            ? `Comic book cover, colorful BD style, vertical 9:16, two friendly characters on an adventure, vibrant colors, professional comic art`
            : `Comic book page ${i}, BD illustration style, colorful, friendly characters in action, vibrant colors`;
          imageUrl = await genererImageReplicate(fallbackPrompt);
        } else {
          throw imgErr;
        }
      }

      // Télécharger l'image et la convertir en base64
      const imgRes = await fetch(imageUrl);
      const imgBuffer = await imgRes.arrayBuffer();
      const imageBase64 = 'data:image/png;base64,' + Buffer.from(imgBuffer).toString('base64');

      // Générer la voix off TTS
      let audioBase64 = null;
      const voixText = page.narration_voix || page.narration || page.dialogue || '';
      if (voixText.trim()) {
        const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + OPENAI_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'tts-1',
            input: voixText.substring(0, 500), // Limiter la longueur
            voice: voix,
            response_format: 'mp3'
          })
        });

        if (ttsRes.ok) {
          const audioBuffer = await ttsRes.arrayBuffer();
          audioBase64 = 'data:audio/mp3;base64,' + Buffer.from(audioBuffer).toString('base64');
        }
      }

      segments.push({
        index: i,
        titre: page.titre_page || (i === 0 ? 'Couverture' : `Page ${i}`),
        image: imageBase64,
        audio: audioBase64,
        texte: voixText
      });
    }

    // Nettoyer
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(e) {}

    // Retourner les segments pour assemblage côté client (FFmpeg.wasm)
    return res.json({
      type: 'segments',
      segments: segments,
      titre: histoire.titre,
      message: 'Segments prêts pour assemblage vidéo'
    });

  } catch (err) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(e) {}
    return res.status(500).json({ error: err.message });
  }
});

// === MUSIQUES LIBRES DE DROITS (Jamendo API) ===
app.get('/api/music', async (req, res) => {
  const { q, genre, limit = 10 } = req.query;

  try {
    let url = `https://api.jamendo.com/v3.0/tracks/?client_id=${JAMENDO_CLIENT_ID}&format=json&limit=${limit}&audioformat=mp32&include=musicinfo&order=popularity_total`;
    if (q) url += `&search=${encodeURIComponent(q)}`;
    if (genre) url += `&tags=${encodeURIComponent(genre)}`;

    const jamRes = await fetch(url);
    if (!jamRes.ok) throw new Error('Erreur API Jamendo: ' + jamRes.status);

    const jamData = await jamRes.json();

    if (jamData.results && jamData.results.length > 0) {
      const tracks = jamData.results.map(t => ({
        id: t.id,
        name: t.name,
        artist_name: t.artist_name,
        duration: t.duration,
        audio: t.audio,
        audiodownload: t.audiodownload,
        shareurl: t.shareurl,
        image: t.image
      }));
      return res.json({ tracks });
    } else {
      const fallbackUrl = `https://api.jamendo.com/v3.0/tracks/?client_id=${JAMENDO_CLIENT_ID}&format=json&limit=${limit}&audioformat=mp32&order=popularity_total`;
      const fallRes = await fetch(fallbackUrl);
      const fallData = await fallRes.json();
      const tracks = (fallData.results || []).map(t => ({
        id: t.id, name: t.name, artist_name: t.artist_name,
        duration: t.duration, audio: t.audio, audiodownload: t.audiodownload,
        shareurl: t.shareurl, image: t.image
      }));
      return res.json({ tracks });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// === GOOGLE OAUTH ===
app.get('/auth/google', (req, res) => {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account'
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(FRONTEND_URL + '?error=no_code');

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect(FRONTEND_URL + '?error=token_failed');

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': 'Bearer ' + tokenData.access_token }
    });
    const user = await userRes.json();

    const userParam = encodeURIComponent(JSON.stringify({
      name: user.name, email: user.email,
      picture: user.picture, id: user.id
    }));
    res.redirect(FRONTEND_URL + '?user=' + userParam);

  } catch (err) {
    res.redirect(FRONTEND_URL + '?error=' + encodeURIComponent(err.message));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Sonia Proxy v2 running on port ' + PORT));
