const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();
app.use(cors());
app.use(express.json());

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || '';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const HERGE_MODEL = '3092b9f17c96c7a73952fc9170273b0362d53de1c0f27fcbd54773542e6c0e62';

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
    "description_image": "Description détaillée pour générer l'image de couverture (en anglais, style BD coloré)",
    "texte_couverture": "Phrase d'accroche sur la couverture"
  },
  "pages": [
    {
      "numero": 1,
      "titre_page": "Titre court de la page",
      "description_image": "Description détaillée pour générer l'image (en anglais, style BD coloré, avec personnages et décor)",
      "narration": "Texte de narration de la page (2-3 phrases en français)",
      "dialogue": "Dialogue principal de la page (en français)"
    },
    {
      "numero": 2,
      "titre_page": "Titre court",
      "description_image": "Description image en anglais",
      "narration": "Narration en français",
      "dialogue": "Dialogue en français"
    },
    {
      "numero": 3,
      "titre_page": "Titre court",
      "description_image": "Description image en anglais",
      "narration": "Narration en français",
      "dialogue": "Dialogue en français"
    },
    {
      "numero": 4,
      "titre_page": "Titre court",
      "description_image": "Description image en anglais",
      "narration": "Narration en français",
      "dialogue": "Dialogue en français"
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

    // Parser le JSON
    let histoire;
    try {
      histoire = JSON.parse(content);
    } catch(e) {
      // Essayer d'extraire le JSON si entouré de markdown
      const match = content.match(/\{[\s\S]*\}/);
      if (match) histoire = JSON.parse(match[0]);
      else return res.status(500).json({ error: 'Réponse GPT invalide' });
    }

    return res.json({ histoire });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'Sonia Video BD Proxy' }));

// === GÉNÉRATION IMAGE STANDARD (Hergé Style) ===
app.post('/api/generate/standard', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt requis' });

  try {
    const fullPrompt = prompt + ' herge_style';
    const startRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': 'Token ' + REPLICATE_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: HERGE_MODEL,
        input: { prompt: fullPrompt, num_outputs: 1 }
      })
    });

    if (!startRes.ok) {
      const err = await startRes.text();
      return res.status(500).json({ error: 'Erreur API Replicate: ' + err });
    }

    const prediction = await startRes.json();

    // Polling
    let result = prediction;
    let attempts = 0;
    while (result.status !== 'succeeded' && result.status !== 'failed' && attempts < 60) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch('https://api.replicate.com/v1/predictions/' + result.id, {
        headers: { 'Authorization': 'Token ' + REPLICATE_TOKEN }
      });
      result = await pollRes.json();
      attempts++;
    }

    if (result.status === 'succeeded' && result.output && result.output.length > 0) {
      return res.json({ images: result.output });
    } else {
      return res.status(500).json({ error: 'Génération échouée. Veuillez réessayer.' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// === GÉNÉRATION IMAGE HD (DALL-E 3) ===
app.post('/api/generate/hd', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt requis' });

  try {
    const startRes = await fetch('https://api.replicate.com/v1/models/openai/dall-e-3/predictions', {
      method: 'POST',
      headers: {
        'Authorization': 'Token ' + REPLICATE_TOKEN,
        'Content-Type': 'application/json',
        'Prefer': 'wait'
      },
      body: JSON.stringify({
        input: {
          prompt: prompt,
          quality: 'hd',
          size: '1024x1792'
        }
      })
    });

    if (!startRes.ok) {
      const err = await startRes.text();
      return res.status(500).json({ error: 'Erreur API DALL-E 3: ' + err });
    }

    const prediction = await startRes.json();

    // Polling
    let result = prediction;
    let attempts = 0;
    while (result.status !== 'succeeded' && result.status !== 'failed' && attempts < 60) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch('https://api.replicate.com/v1/predictions/' + result.id, {
        headers: { 'Authorization': 'Token ' + REPLICATE_TOKEN }
      });
      result = await pollRes.json();
      attempts++;
    }

    if (result.status === 'succeeded' && result.output) {
      const images = Array.isArray(result.output) ? result.output : [result.output];
      return res.json({ images });
    } else {
      return res.status(500).json({ error: 'Génération DALL-E 3 échouée. Veuillez réessayer.' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// === MUSIQUES LIBRES DE DROITS (Jamendo API) ===
app.get('/api/music', async (req, res) => {
  const { q, genre, limit = 10 } = req.query;

  try {
    // Jamendo API - client_id public gratuit
    const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID || 'b6747d04';
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
      // Si pas de résultat, retourner des musiques populaires
      const fallbackUrl = `https://api.jamendo.com/v3.0/tracks/?client_id=${JAMENDO_CLIENT_ID}&format=json&limit=${limit}&audioformat=mp32&order=popularity_total`;
      const fallRes = await fetch(fallbackUrl);
      const fallData = await fallRes.json();
      const tracks = (fallData.results || []).map(t => ({
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
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Sonia Proxy running on port ' + PORT));
