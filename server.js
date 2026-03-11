const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
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

// === HELPER: Nettoyer le prompt pour éviter les erreurs JSON ===
function nettoyerPrompt(prompt) {
  if (!prompt) return '';
  return prompt.replace(/[\n\r\t]/g, ' ').replace(/"/g, "'").trim();
}

// === HELPER: Télécharger une image et la convertir en base64 ===
async function imageToBase64(url) {
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

// === FONCTION : Generer image style Herge (BD classique) via Replicate ===
async function genererImageHerge(prompt) {
  const promptNettoye = nettoyerPrompt(prompt);
  const promptFinal = `Herge style, ligne claire, comic book illustration: ${promptNettoye}. Style: classic comic book art, clear line art style, Tintin aesthetic, clean ink outlines, limited color palette, European comic book style`;

  try {
    const res = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': 'Token ' + REPLICATE_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: 'cjwbw/herge-style',
        input: {
          prompt: promptFinal.substring(0, 1000),
          width: 1024,
          height: 1792,
          num_outputs: 1
        }
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(`Replicate Herge erreur ${res.status}`);
    }

    const data = await res.json();
    let prediction = data;
    let maxWait = 120000;
    let elapsed = 0;
    
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && elapsed < maxWait) {
      await new Promise(r => setTimeout(r, 3000));
      elapsed += 3000;
      
      const checkRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { 'Authorization': 'Token ' + REPLICATE_TOKEN }
      });
      prediction = await checkRes.json();
    }

    if (prediction.status === 'succeeded' && prediction.output && prediction.output[0]) {
      return prediction.output[0];
    } else {
      throw new Error(`Replicate Herge echoue: ${prediction.status}`);
    }
  } catch (err) {
    console.warn('Replicate Herge echoue:', err.message);
    throw err;
  }
}

// === FONCTION : Generer image via Pollinations.ai (Gratuit) ===
async function genererImagePollinations(prompt) {
  const promptNettoye = nettoyerPrompt(prompt);
  const seed = Math.floor(Math.random() * 1000000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptNettoye)}?width=768&height=1344&model=flux&seed=${seed}&nologo=true`;
  return url;
}

// === FONCTION : Generer image via DALL-E 3 (OpenAI) ===
async function genererImageDalle(prompt, quality = 'standard') {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + OPENAI_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: prompt,
      n: 1,
      size: '1024x1792',
      quality: quality
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ? err.error.message : 'Erreur DALL-E 3');
  }

  const data = await res.json();
  return data.data[0].url;
}

// === HELPER: Générer image avec style TikTok Anime (Pollinations par défaut) ===
async function genererImageAvecFallback(prompt, style = 'standard') {
  try {
    // Prompt ultra-détaillé pour Flux.1 avec cohérence stricte
    const animePrompt = `MASTERPIECE, 8K ultra-detailed, professional comic book illustration, Flux.1 quality. Style: Modern TikTok Anime, vibrant saturated colors, clean ink lines, expressive detailed faces, cinematic studio lighting, perfect anatomy, consistent character design throughout. Format: 9:16 vertical. Quality: ultra-sharp, high-contrast, professional comic art. ${prompt}. CRITICAL: Maintain exact same character appearance, clothing, and features across all variations.`;
    return await genererImagePollinations(animePrompt);
  } catch (err) {
    console.warn('Pollinations échoué, fallback DALL-E 3:', err.message);
    try {
      return await genererImageDalle(prompt, style);
    } catch (dalleErr) {
      return `https://via.placeholder.com/768x1344/1a0a2e/ffd700?text=Image+Error`;
    }
  }
}

// === ROUTES API ===

app.get('/', (req, res) => {
  res.send('Sonia Proxy v3 (Stable) is running');
});

app.post('/api/generer-bd', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt requis' });

  try {
    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + OPENAI_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Tu es un scénariste de BD professionnel. Génère une histoire de BD courte (1 couverture + 4 pages) en JSON.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' }
      })
    });

    const data = await gptRes.json();
    const histoire = JSON.parse(data.choices[0].message.content);
    return res.json(histoire);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// === ENDPOINT: Générer BD à partir d'une image téléchargée ===
app.post('/api/generer-bd-image', async (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'Image requise' });

  try {
    // Analyser l'image avec Vision API d'OpenAI
    const visionRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + OPENAI_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyse cette image et décris en détail: les personnages (apparence, expressions), le décor, l\'ambiance, les actions, les couleurs, le style. Sois très spécifique pour que je puisse générer une BD cohérente.' },
              { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + image } }
            ]
          }
        ]
      })
    });

    if (!visionRes.ok) {
      const err = await visionRes.json();
      throw new Error('Erreur Vision API: ' + (err.error?.message || 'Unknown'));
    }

    const visionData = await visionRes.json();
    const imageAnalysis = visionData.choices[0].message.content;

    // Générer une histoire BD basée sur l'analyse de l'image
    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + OPENAI_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Tu es un scénariste de BD et un réalisateur de vidéos IA professionnel. Basé sur l\'analyse d\'une image, crée une histoire de BD courte (1 couverture + 4 pages) optimisée pour TikTok, YouTube et Twitter. IMPORTANT : Les descriptions d\'images doivent être extrêmement détaillées pour assurer une cohérence visuelle parfaite. Tu dois aussi générer une narration vocale (narration_voix) captivante pour chaque page. Réponds UNIQUEMENT avec du JSON valide.'
          },
          {
            role: 'user',
            content: `Voici l'analyse détaillée d'une image:\n\n${imageAnalysis}\n\nCrée une histoire BD complète (couverture + 4 pages) basée sur cette image. Chaque page doit avoir 3 panneaux. Utilise les personnages et le décor de l'image. La narration doit être adaptée à une vidéo TikTok/YouTube.\n\nIMPORTANT POUR LA COUVERTURE:\n- Le titre DOIT être en gros texte 3D stylisé, bien visible et accrocheur\n- Utilisez des effets de relief, d'ombres portées et de textures (métalique, néon, doré, etc.)\n- Le titre doit être centré et dominant sur l'image\n- Couleurs vibrantes et contraste élevé pour la lisibilité\n\nRéponds en JSON avec cette structure:\n{\n  "titre": "Titre de l'histoire (court et accrocheur)",\n  "couverture": {\n    "description_image": "Description détaillée pour générer l'image de couverture avec TITRE 3D STYLISÉ EN GROS TEXTE",\n    "sous_titre": "Sous-titre optionnel",\n    "narration_voix": "Texte d'introduction accrocheur pour la vidéo"\n  },\n  "pages": [\n    {\n      "numero": 1,\n      "titre_page": "Titre de la page",\n      "narration": "Narration courte pour la BD",\n      "narration_voix": "Texte de narration fluide et captivant pour la voix off de la vidéo",\n      "description_image": "Description ultra-détaillée pour générer l'image",\n      "panneaux": [\n        { "texte": "Dialogue 1" },\n        { "texte": "Dialogue 2" },\n        { "texte": "Dialogue 3" }\n      ]\n    }\n  ]\n}`
          }
        ],
        response_format: { type: 'json_object' }
      })
    });

    if (!gptRes.ok) {
      const err = await gptRes.json();
      throw new Error('Erreur GPT: ' + (err.error?.message || 'Unknown'));
    }

    const gptData = await gptRes.json();
    const histoire = JSON.parse(gptData.choices[0].message.content);

    return res.json({ histoire });
  } catch (err) {
    console.error('Erreur /api/generer-bd-image:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/generate/standard', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt requis' });

  try {
    const imageUrl = await genererImageAvecFallback(prompt, 'standard');
    return res.json({ images: [imageUrl] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/generer-video', async (req, res) => {
  const { histoire, voix = 'nova', musique = 'none' } = req.body;
  if (!histoire) return res.status(400).json({ error: 'Histoire requise' });

  try {
    const pages = [
      { numero: 0, titre: 'Couverture', description: `${histoire.couverture.description_image}. CRITICAL: Include a large, bold 3D title text "${histoire.titre}" prominently displayed in the center with 3D effects (relief, drop shadow, metallic/neon texture). The title must be the dominant visual element with vibrant colors and high contrast. Style: Professional comic book cover, masterpiece quality, 8K ultra-detailed.`, narration: histoire.couverture.narration_voix || histoire.couverture.texte_couverture },
      ...histoire.pages.map((p, i) => ({ numero: i + 1, titre: `Page ${i+1}`, description: p.description_image, narration: p.narration_voix }))
    ];

    const segments = [];

    for (const page of pages) {
      let imageUrl = await genererImageAvecFallback(page.description);
      let imageBase64Raw = await imageToBase64(imageUrl);

      if (page.numero === 0) {
        try {
          const pythonInput = JSON.stringify({
            image: imageBase64Raw,
            titre: histoire.titre,
            sous_titre: histoire.couverture.sous_titre || ''
          });
          
          const pythonResult = await new Promise((resolve, reject) => {
            const scriptPath = path.join(__dirname, 'add_text_cover.py');
            const proc = spawn('python3', [scriptPath]);
            let stdout = '', stderr = '';
            proc.stdout.on('data', (d) => stdout += d);
            proc.stderr.on('data', (d) => stderr += d);
            proc.on('close', (c) => c !== 0 ? reject(new Error(stderr)) : resolve(stdout));
            const t = setTimeout(() => { proc.kill(); reject(new Error('Timeout')); }, 30000);
            proc.stdin.on('error', (e) => { clearTimeout(t); reject(e); });
            proc.stdin.write(pythonInput);
            proc.stdin.end();
          });
          
          imageBase64Raw = JSON.parse(pythonResult).image;
        } catch (e) { console.warn('Erreur Python couverture:', e.message); }
      }

      let audioBase64 = null;
      try {
        const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'tts-1', input: page.narration.substring(0, 400), voice: voix, response_format: 'mp3' })
        });
        if (ttsRes.ok) {
          const audioBuf = await ttsRes.arrayBuffer();
          audioBase64 = 'data:audio/mp3;base64,' + Buffer.from(audioBuf).toString('base64');
        }
      } catch (e) { console.warn('Erreur TTS:', e.message); }

      let mixedAudioBase64 = audioBase64;
      if (musique !== 'none' && audioBase64) {
        try {
          const mixInput = JSON.stringify({
            voice: audioBase64,
            music: musique
          });
          
          const mixResult = await new Promise((resolve, reject) => {
            const scriptPath = path.join(__dirname, 'mix_audio.py');
            const proc = spawn('python3', [scriptPath]);
            let stdout = '', stderr = '';
            proc.stdout.on('data', (d) => stdout += d);
            proc.stderr.on('data', (d) => stderr += d);
            proc.on('close', (c) => c !== 0 ? reject(new Error(stderr)) : resolve(stdout));
            const t = setTimeout(() => { proc.kill(); reject(new Error('Timeout')); }, 30000);
            proc.stdin.on('error', (e) => { clearTimeout(t); reject(e); });
            proc.stdin.write(mixInput);
            proc.stdin.end();
          });
          
          mixedAudioBase64 = JSON.parse(mixResult).audio;
        } catch (e) { console.warn('Erreur Python mixage:', e.message); }
      }

      segments.push({
        index: page.numero,
        image: 'data:image/jpeg;base64,' + imageBase64Raw,
        audio: mixedAudioBase64,
        duree: page.numero === 0 ? 10 : 15
      });
    }

    return res.json({ segments, titre: histoire.titre, musique: musique });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Sonia Proxy v3 running on port ${PORT}`);
});

// === ENDPOINT: Générer BD à partir d'un profil social (4 pages x 4 cases + couverture) ===
app.post('/api/bd-social', async (req, res) => {
  try {
    const { username, platform, pages = 4, voix = 'nova', musique = 'epic' } = req.body;
    
    if (!username || !platform) {
      return res.status(400).json({ error: 'username et platform requis' });
    }

    // Étape 1 : Analyser le profil social et créer un scénario
    const promptAnalyse = `Tu es un scénariste créatif. Analyse le compte ${platform} "@${username}" et crée une histoire BD captivante en ${pages} pages (4 cases par page) + 1 couverture.

STRUCTURE REQUISE:
- COUVERTURE: Titre accrocheur, image représentative du compte
- PAGE 1 (4 cases): Introduction du personnage/thème
- PAGE 2 (4 cases): Développement de l'action
- PAGE 3 (4 cases): Climax ou rebondissement
- PAGE 4 (4 cases): Conclusion/moral

Pour CHAQUE case, fournis:
- titre_case: Titre court
- description_image: Description ultra-détaillée (couleurs, personnages, décor, ambiance)
- narration: Texte narratif (max 50 mots)
- dialogue: Dialogue des personnages (max 30 mots)

Réponds UNIQUEMENT en JSON valide, sans markdown.`;

    const histRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4-turbo',
        messages: [{ role: 'user', content: promptAnalyse }],
        temperature: 0.8,
        max_tokens: 4000
      })
    });

    const histData = await histRes.json();
    if (!histRes.ok) throw new Error(histData.error?.message || 'Erreur génération histoire');

    let histoire = {};
    try {
      const content = histData.choices[0].message.content;
      histoire = JSON.parse(content);
    } catch (e) {
      throw new Error('Réponse IA invalide: ' + e.message);
    }

    // Étape 2 : Générer les images pour chaque case
    const images = [];
    const totalCases = 1 + (pages * 4); // 1 couverture + pages * 4 cases

    // Couverture
    if (histoire.couverture) {
      const coverPrompt = `MASTERPIECE, 8K ultra-detailed, professional comic book cover. ${histoire.couverture.description_image}. Style: Modern TikTok Anime, vibrant colors, dynamic composition, professional comic art.`;
      const coverUrl = await genererImageAvecFallback(coverPrompt);
      images.push({ type: 'couverture', url: coverUrl, titre: histoire.couverture.titre_case });
    }

    // Pages et cases
    if (histoire.pages && Array.isArray(histoire.pages)) {
      for (let p = 0; p < histoire.pages.length; p++) {
        const page = histoire.pages[p];
        if (page.cases && Array.isArray(page.cases)) {
          for (let c = 0; c < page.cases.length; c++) {
            const caseData = page.cases[c];
            const casePrompt = `Comic book panel, BD illustration. ${caseData.description_image}. Style: Modern TikTok Anime, vibrant colors, clean lines, professional comic art. Panel ${c + 1} of page ${p + 1}.`;
            const caseUrl = await genererImageAvecFallback(casePrompt);
            images.push({
              type: 'case',
              page: p + 1,
              case: c + 1,
              url: caseUrl,
              titre: caseData.titre_case,
              narration: caseData.narration,
              dialogue: caseData.dialogue
            });
          }
        }
      }
    }

    return res.json({
      success: true,
      titre: histoire.titre || `L'histoire de @${username}`,
      images: images,
      totalCases: images.length,
      histoire: histoire
    });

  } catch (err) {
    console.error('Erreur /api/bd-social:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// === ENDPOINT: Démarrer le serveur ===
