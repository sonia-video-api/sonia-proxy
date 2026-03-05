const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();
app.use(cors());
app.use(express.json());

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || '';
const HERGE_MODEL = '3092b9f17c96c7a73952fc9170273b0362d53de1c0f27fcbd54773542e6c0e62';

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Sonia Proxy running on port ' + PORT));
