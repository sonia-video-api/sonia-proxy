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
    const animePrompt = `Modern TikTok Anime style, high quality digital art, vibrant colors, clean lines, expressive characters, cinematic lighting, 9:16 vertical format: ${prompt}`;
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
  const { histoire, voix = 'nova' } = req.body;
  if (!histoire) return res.status(400).json({ error: 'Histoire requise' });

  try {
    const pages = [
      { numero: 0, titre: 'Couverture', description: histoire.couverture.description_image, narration: histoire.couverture.narration_voix || histoire.couverture.texte_couverture },
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

      segments.push({
        index: page.numero,
        image: 'data:image/jpeg;base64,' + imageBase64Raw,
        audio: audioBase64,
        duree: page.numero === 0 ? 10 : 15
      });
    }

    return res.json({ segments, titre: histoire.titre });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Sonia Proxy v3 running on port ${PORT}`);
});
