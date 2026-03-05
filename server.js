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
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '376154181732-a842jan6p193tea2fgfctiq26ngphi44.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://sonia-video-bd-site.onrender.com';
const PROXY_URL = process.env.PROXY_URL || 'https://sonia-proxy.onrender.com';
const REDIRECT_URI = PROXY_URL + '/auth/callback';
const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID || 'b6747d04';

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'Sonia Video BD Proxy v2 - DALL-E 3 + FFmpeg' }));

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

// === GÉNÉRATION IMAGE DALL-E 3 (Standard et HD) ===
app.post('/api/generate/standard', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt requis' });

  try {
    const fullPrompt = `Comic book illustration, colorful BD style, vertical 9:16 format, vibrant colors, detailed artwork: ${prompt}`;
    const dalleRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + OPENAI_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: fullPrompt,
        n: 1,
        size: '1024x1792',
        quality: 'standard',
        response_format: 'url'
      })
    });

    if (!dalleRes.ok) {
      const err = await dalleRes.text();
      return res.status(500).json({ error: 'Erreur DALL-E 3: ' + err });
    }

    const dalleData = await dalleRes.json();
    const imageUrl = dalleData.data[0].url;
    return res.json({ images: [imageUrl] });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/generate/hd', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt requis' });

  try {
    const fullPrompt = `High quality comic book illustration, HD colorful BD style, vertical 9:16 format, ultra detailed vibrant artwork, professional illustration: ${prompt}`;
    const dalleRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + OPENAI_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: fullPrompt,
        n: 1,
        size: '1024x1792',
        quality: 'hd',
        response_format: 'url'
      })
    });

    if (!dalleRes.ok) {
      const err = await dalleRes.text();
      return res.status(500).json({ error: 'Erreur DALL-E 3 HD: ' + err });
    }

    const dalleData = await dalleRes.json();
    const imageUrl = dalleData.data[0].url;
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

// === GÉNÉRATION VIDÉO COMPLÈTE (Images + Voix + Assemblage FFmpeg) ===
app.post('/api/generer-video', async (req, res) => {
  const { histoire, qualite = 'standard', voix = 'nova' } = req.body;
  if (!histoire) return res.status(400).json({ error: 'Histoire requise' });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonia-'));
  
  try {
    // Vérifier si FFmpeg est disponible
    let ffmpegAvailable = false;
    try {
      execSync('ffmpeg -version', { stdio: 'ignore' });
      ffmpegAvailable = true;
    } catch(e) {
      ffmpegAvailable = false;
    }

    const pages = [{ 
      numero: 0, 
      titre_page: 'Couverture',
      description_image: histoire.couverture.description_image,
      narration_voix: histoire.couverture.narration_voix || histoire.couverture.texte_couverture
    }, ...histoire.pages];

    const imageFiles = [];
    const audioFiles = [];

    // Générer les images et voix en parallèle pour chaque page
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      
      // Générer l'image
      const imgPrompt = i === 0 
        ? `Comic book cover, title "${histoire.titre}", colorful BD style, vertical 9:16: ${page.description_image}`
        : page.description_image;
      
      const quality = qualite === 'hd' ? 'hd' : 'standard';
      const fullPrompt = `Comic book illustration, colorful BD style, vertical 9:16 format, vibrant colors: ${imgPrompt}`;
      
      const dalleRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + OPENAI_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: fullPrompt,
          n: 1,
          size: '1024x1792',
          quality: quality,
          response_format: 'url'
        })
      });

      if (!dalleRes.ok) throw new Error('Erreur image page ' + i);
      const dalleData = await dalleRes.json();
      const imageUrl = dalleData.data[0].url;

      // Télécharger l'image
      const imgRes = await fetch(imageUrl);
      const imgBuffer = await imgRes.arrayBuffer();
      const imgPath = path.join(tmpDir, `page_${i}.jpg`);
      fs.writeFileSync(imgPath, Buffer.from(imgBuffer));
      imageFiles.push(imgPath);

      // Générer la voix off
      const voixText = page.narration_voix || page.narration || page.dialogue || '';
      if (voixText && ffmpegAvailable) {
        const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + OPENAI_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'tts-1',
            input: voixText,
            voice: voix,
            response_format: 'mp3'
          })
        });

        if (ttsRes.ok) {
          const audioBuffer = await ttsRes.arrayBuffer();
          const audioPath = path.join(tmpDir, `audio_${i}.mp3`);
          fs.writeFileSync(audioPath, Buffer.from(audioBuffer));
          audioFiles.push(audioPath);
        } else {
          audioFiles.push(null);
        }
      } else {
        audioFiles.push(null);
      }
    }

    if (!ffmpegAvailable) {
      // Sans FFmpeg: retourner les images en base64
      const imagesBase64 = imageFiles.map(f => {
        const buf = fs.readFileSync(f);
        return 'data:image/jpeg;base64,' + buf.toString('base64');
      });
      
      // Nettoyer
      fs.rmSync(tmpDir, { recursive: true, force: true });
      
      return res.json({ 
        type: 'images',
        images: imagesBase64,
        titre: histoire.titre,
        message: 'FFmpeg non disponible - images générées'
      });
    }

    // Avec FFmpeg: assembler la vidéo MP4
    const videoPath = path.join(tmpDir, 'video_final.mp4');
    const segmentFiles = [];

    for (let i = 0; i < imageFiles.length; i++) {
      const segPath = path.join(tmpDir, `segment_${i}.mp4`);
      
      if (audioFiles[i]) {
        // Durée basée sur l'audio
        execSync(`ffmpeg -loop 1 -i "${imageFiles[i]}" -i "${audioFiles[i]}" -c:v libx264 -tune stillimage -c:a aac -b:a 128k -pix_fmt yuv420p -shortest -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" "${segPath}" -y 2>/dev/null`);
      } else {
        // Durée fixe de 4 secondes
        execSync(`ffmpeg -loop 1 -i "${imageFiles[i]}" -c:v libx264 -t 4 -pix_fmt yuv420p -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" "${segPath}" -y 2>/dev/null`);
      }
      segmentFiles.push(segPath);
    }

    // Créer le fichier de liste pour la concaténation
    const listPath = path.join(tmpDir, 'list.txt');
    const listContent = segmentFiles.map(f => `file '${f}'`).join('\n');
    fs.writeFileSync(listPath, listContent);

    // Concaténer tous les segments
    execSync(`ffmpeg -f concat -safe 0 -i "${listPath}" -c copy "${videoPath}" -y 2>/dev/null`);

    // Lire la vidéo et l'envoyer
    const videoBuffer = fs.readFileSync(videoPath);
    const videoBase64 = videoBuffer.toString('base64');

    // Nettoyer
    fs.rmSync(tmpDir, { recursive: true, force: true });

    return res.json({
      type: 'video',
      video: videoBase64,
      format: 'mp4',
      titre: histoire.titre
    });

  } catch (err) {
    // Nettoyer en cas d'erreur
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
