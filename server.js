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
const POLLINATIONS_API_KEY = process.env.POLLINATIONS_API_KEY || 'pk_N4V5yUJoxX7x1HQ5';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = STRIPE_SECRET_KEY ? require('stripe')(STRIPE_SECRET_KEY) : null;

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'Sonia Video BD Proxy v6 - DALL-E 3 HD (qualité BD pro) + OpenAI TTS + Recherche Web' }));

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

// === HELPER: Générer image via Pollinations.ai (avec clé API) ===
async function genererImagePollinations(prompt) {
  const promptNettoye = nettoyerPrompt(prompt);
  const encodedPrompt = encodeURIComponent(promptNettoye.substring(0, 500));
  const seed = Math.floor(Math.random() * 999999);
  // Avec clé API : pas de rate limit, meilleure qualité
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=1344&model=flux&seed=${seed}&nologo=true&token=${POLLINATIONS_API_KEY}`;
  return url;
}

// === HELPER: Générer image via DALL-E 3 (haute qualité, style BD professionnel, retry auto) ===
async function genererImageReplicate(prompt, isHD = false, isPage = false) {
  const promptNettoye = nettoyerPrompt(prompt);
  
  let prefix, suffix;
  if (isPage) {
    // Prompt pour page BD multi-panneaux style anime/manga moderne
    prefix = 'Comic book page layout with 3 vertical panels stacked, manga/anime art style, warm cinematic lighting. ';
    suffix = ' Art style: semi-realistic anime/manga style illustration, 3 panels separated by thin black borders, each panel shows a different moment of the scene, expressive cartoon characters with detailed eyes and emotions, warm indoor lighting (lamp, phone glow), speech bubbles with readable French text inside, bold clean ink outlines, rich warm colors (amber, dark blue, golden), detailed backgrounds (bedroom, phone screen details), 9:16 vertical format, professional webtoon/manhwa quality. Each panel has white speech bubbles with black text. NO photorealism, stylized illustration only.';
  } else {
    // Prompt pour couverture style comic book américain moderne
    prefix = 'Modern American comic book cover illustration, single scene portrait format. ';
    suffix = ' Art style: professional comic book illustration, semi-realistic cartoon style, bold clean ink outlines, dramatic cinematic lighting, deep rich colors with strong contrast, expressive character faces with detailed eyes, dynamic composition, dark atmospheric background with city lights or dramatic sky, vibrant saturated colors, bold white text with dark outline for title at top, subtitle text at bottom in yellow or white, 9:16 vertical portrait format, Marvel Comics / DC Comics quality, professional graphic novel cover art. NO photorealism, stylized illustration only.';
  }
  const promptFinal = (prefix + promptNettoye + suffix).substring(0, 4000);

  const MAX_RETRIES = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + OPENAI_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: promptFinal,
          n: 1,
          size: '1024x1792',
          quality: isHD ? 'hd' : 'standard',
          style: 'vivid'
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error ? errData.error.message : 'Erreur inconnue';
        const status = res.status;
        // Retry sur erreurs serveur (500, 502, 503) ou rate limit (429)
        if ((status >= 500 || status === 429) && attempt < MAX_RETRIES) {
          const delay = attempt * 5000; // 5s, 10s
          console.log(`DALL-E 3 erreur ${status} (tentative ${attempt}/${MAX_RETRIES}), retry dans ${delay/1000}s...`);
          await new Promise(r => setTimeout(r, delay));
          lastError = new Error('Erreur DALL-E 3: ' + errMsg);
          continue;
        }
        throw new Error('Erreur DALL-E 3: ' + errMsg);
      }

      const data = await res.json();
      if (data.data && data.data[0] && data.data[0].url) {
        return data.data[0].url;
      }
      throw new Error('DALL-E 3: pas d\'image dans la réponse');

    } catch (err) {
      if (attempt < MAX_RETRIES && err.message && !err.message.includes('content_policy')) {
        const delay = attempt * 5000;
        console.log(`DALL-E 3 exception (tentative ${attempt}/${MAX_RETRIES}), retry dans ${delay/1000}s: ${err.message}`);
        await new Promise(r => setTimeout(r, delay));
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error('DALL-E 3: échec après 3 tentatives');
}

// === HELPER: Recherche d'informations sur Internet (DuckDuckGo) ===
async function rechercherInternet(query) {
  try {
    // Utiliser DuckDuckGo Instant Answer API (gratuite, sans clé)
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'SoniaVideoBD/1.0' } });
    const data = await res.json();
    
    let infos = [];
    
    // Résultat principal
    if (data.AbstractText) infos.push(data.AbstractText);
    
    // Topics liés
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      data.RelatedTopics.slice(0, 5).forEach(t => {
        if (t.Text) infos.push(t.Text);
      });
    }
    
    // Résultat de réponse directe
    if (data.Answer) infos.push(data.Answer);
    
    return infos.join(' | ').substring(0, 1000);
  } catch(e) {
    return '';
  }
}

// === HELPER: Recherche actualités récentes (NewsAPI gratuite via RSS) ===
async function rechercherActualites(query) {
  try {
    // Utiliser le flux RSS de Google News (gratuit)
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=fr&gl=FR&ceid=FR:fr`;
    const res = await fetch(url, { headers: { 'User-Agent': 'SoniaVideoBD/1.0' } });
    const xml = await res.text();
    
    // Extraire les titres des articles
    const titres = [];
    const matches = xml.matchAll(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/g);
    let count = 0;
    for (const m of matches) {
      if (count > 0 && count <= 5) titres.push(m[1]); // Skip le premier (titre du flux)
      count++;
    }
    
    return titres.join(' | ').substring(0, 800);
  } catch(e) {
    return '';
  }
}

// === ENDPOINT: Recherche sur Internet ===
app.post('/api/recherche-web', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query requise' });
  
  try {
    const [infos, actualites] = await Promise.all([
      rechercherInternet(query),
      rechercherActualites(query)
    ]);
    
    return res.json({
      infos: infos || '',
      actualites: actualites || '',
      source: 'DuckDuckGo + Google News'
    });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// === GÉNÉRATION HISTOIRE BD PAR IA (GPT) ===
app.post('/api/histoire', async (req, res) => {
  const { phrase, rechercherWeb = false } = req.body;
  if (!phrase) return res.status(400).json({ error: 'Phrase requise' });

  try {
    // Recherche d'informations sur Internet si demandée
    let contextWeb = '';
    if (rechercherWeb) {
      const [infosWeb, actualitesWeb] = await Promise.all([
        rechercherInternet(phrase),
        rechercherActualites(phrase)
      ]);
      if (infosWeb) contextWeb += `\n\nInformations trouvées sur Internet : ${infosWeb}`;
      if (actualitesWeb) contextWeb += `\n\nActualités récentes : ${actualitesWeb}`;
    }

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
Tu crées des histoires BD courtes, vivantes et émouvantes en français.${contextWeb ? '\nTu utilises les informations réelles trouvées sur Internet pour enrichir l\'histoire et la rendre actuelle et réaliste.' : ''}
Réponds UNIQUEMENT en JSON valide, sans markdown, sans explication.`
          },
          {
            role: 'user',
            content: `Crée une histoire BD complète basée sur cette idée : "${phrase}"${contextWeb}

Réponds en JSON avec cette structure exacte :
{
  "titre": "Titre accrocheur de la BD",
  "genre": "Comédie / Aventure / Romance / Drame / etc.",
  "personnages": "Description courte des personnages principaux",
  "couverture": {
    "description_image": "Description détaillée pour générer l'image de couverture (en anglais, style comic book coloré, vertical 9:16)",
    "texte_couverture": "Phrase d'accroche sur la couverture",
    "narration_voix": "Résumé court et accrocheur de toute l'histoire en 2-3 phrases maximum (environ 10 secondes de lecture à voix haute). Doit donner envie de lire la suite."
  },
  "pages": [
    {
      "numero": 1,
      "titre_page": "Titre court de la page",
      "description_image": "Description détaillée pour générer l'image (en anglais, style comic book coloré, vertical 9:16, avec personnages et décor)",
      "narration": "Texte de narration de la page (2-3 phrases en français)",
      "dialogue": "Dialogue principal de la page (en français)",
      "narration_voix": "Narration vivante et détaillée de cette page (4-5 phrases en français, environ 15 secondes de lecture à voix haute). Décrit l'action, les émotions des personnages et les dialogues clés."
    },
    {
      "numero": 2,
      "titre_page": "Titre court",
      "description_image": "Description image en anglais, style comic book coloré, vertical 9:16",
      "narration": "Narration en français",
      "dialogue": "Dialogue en français",
      "narration_voix": "Narration vivante et détaillée de cette page (4-5 phrases en français, environ 15 secondes de lecture à voix haute). Décrit l'action, les émotions et les dialogues."
    },
    {
      "numero": 3,
      "titre_page": "Titre court",
      "description_image": "Description image en anglais, style comic book coloré, vertical 9:16",
      "narration": "Narration en français",
      "dialogue": "Dialogue en français",
      "narration_voix": "Narration vivante et détaillée de cette page (4-5 phrases en français, environ 15 secondes de lecture à voix haute). Décrit l'action, les émotions et les dialogues."
    },
    {
      "numero": 4,
      "titre_page": "Titre court",
      "description_image": "Description image en anglais, style comic book coloré, vertical 9:16",
      "narration": "Narration en français",
      "dialogue": "Dialogue en français",
      "narration_voix": "Conclusion émouvante de l'histoire (4-5 phrases en français, environ 15 secondes de lecture à voix haute). Résout l'intrigue et laisse une impression mémorable."
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
        ? 'Modern comic book cover illustration HD, two cartoon characters on an adventure, dramatic cinematic lighting, bold ink outlines, vibrant saturated colors, Marvel DC style, 9:16 vertical portrait'
        : 'Modern comic book cover illustration, two cartoon characters smiling, dramatic lighting, bold ink outlines, vibrant saturated colors, Marvel DC style, 9:16 vertical portrait';
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
    const fullPrompt = `Modern American comic book illustration, Marvel DC style, semi-realistic cartoon, bold ink outlines, dramatic cinematic lighting, vibrant saturated colors, expressive characters, 9:16 vertical portrait format: ${prompt}`;
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
    const fullPrompt = `Modern American comic book illustration HD, Marvel DC style, semi-realistic cartoon, bold ink outlines, dramatic cinematic lighting, vibrant saturated colors, expressive characters, 9:16 vertical portrait format: ${prompt}`;
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

      // Générer l'image - couverture ou page BD
      const isPageBD = i > 0;
      const dialogues = page.dialogues ? page.dialogues.map(d => `"${d.texte}"`).join(', ') : '';
      const imgPrompt = i === 0
        ? `Comic book cover, title "${histoire.titre}", dramatic cinematic lighting, bold ink outlines, vibrant saturated colors, expressive character, dark atmospheric background, Marvel DC style, 9:16 vertical: ${page.description_image}`
        : `3-panel comic page, scene: ${page.description_image}${dialogues ? `, speech bubbles containing: ${dialogues}` : ''}, warm indoor lighting, expressive characters, anime/manga style`;

      const fullPrompt = imgPrompt;

      let imageUrl;
      try {
        imageUrl = await genererImageReplicate(fullPrompt, false, isPageBD);
      } catch (imgErr) {
        console.warn('DALL-E 3 échoué, fallback Pollinations.ai:', imgErr.message);
        // Fallback vers Pollinations.ai (gratuit)
        try {
          imageUrl = await genererImagePollinations(fullPrompt);
        } catch (polErr) {
          // Fallback ultime : image placeholder
          imageUrl = `https://via.placeholder.com/768x1344/1a0a2e/ffd700?text=Page+${i}`;
        }
      }

      // Télécharger l'image et la convertir en base64
      const imgRes = await fetch(imageUrl);
      const imgBuffer = await imgRes.arrayBuffer();
      const imageBase64 = 'data:image/png;base64,' + Buffer.from(imgBuffer).toString('base64');

      // Générer la voix off TTS
      let audioBase64 = null;
      const voixText = page.narration_voix || page.narration || page.dialogue || '';
      // Couverture : ~10s = ~150 caractères | Pages : ~15s = ~250 caractères
      const maxChars = i === 0 ? 200 : 350;
      const voixTronque = voixText.substring(0, maxChars);
      if (voixTronque.trim()) {
        const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + OPENAI_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'tts-1',
            input: voixTronque,
            voice: voix,
            response_format: 'mp3'
          })
        });

        if (ttsRes.ok) {
          const audioBuffer = await ttsRes.arrayBuffer();
          audioBase64 = 'data:audio/mp3;base64,' + Buffer.from(audioBuffer).toString('base64');
        }
      }

      // Estimer la durée en secondes (basé sur longueur du texte)
      const dureeEstimee = i === 0 ? 10 : 15; // Couverture 10s, pages 15s

      segments.push({
        index: i,
        titre: page.titre_page || (i === 0 ? 'Couverture' : `Page ${i}`),
        image: imageBase64,
        audio: audioBase64,
        texte: voixText,
        duree: dureeEstimee
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

// === PROFIL RÉSEAU SOCIAL (TikTok, YouTube, Twitter/X) ===
app.post('/api/profil-social', async (req, res) => {
  const { username, plateforme = 'tiktok' } = req.body;
  if (!username) return res.status(400).json({ error: 'Nom d\'utilisateur requis' });

  const nomNettoye = username.replace(/^@/, '').trim();

  try {
    let profil = { nom: nomNettoye, bio: '', followers: '', avatar: '', plateforme, videos: [] };

    if (plateforme === 'tiktok') {
      // Scraper TikTok
      const ttRes = await fetch(`https://www.tiktok.com/@${nomNettoye}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'
        }
      });
      if (ttRes.ok) {
        const html = await ttRes.text();
        const match = html.match(/id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
        if (match) {
          const data = JSON.parse(match[1]);
          const findAll = (d, key, res = []) => {
            if (typeof d === 'object' && d !== null) {
              if (Array.isArray(d)) d.forEach(v => findAll(v, key, res));
              else { if (key in d) res.push(d[key]); Object.values(d).forEach(v => findAll(v, key, res)); }
            }
            return res;
          };
          profil.nom = findAll(data, 'nickname')[0] || nomNettoye;
          profil.bio = findAll(data, 'signature')[0] || '';
          profil.followers = findAll(data, 'followerCount')[0] || '';
          profil.avatar = findAll(data, 'avatarLarger')[0] || '';
          profil.likes = findAll(data, 'heartCount')[0] || '';
          // Vidéos récentes
          const descs = findAll(data, 'desc').filter(d => d && d.length > 5);
          profil.videos = descs.slice(0, 5);
        }
      }
    } else if (plateforme === 'youtube') {
      // Scraper YouTube
      const ytRes = await fetch(`https://www.youtube.com/@${nomNettoye}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      if (ytRes.ok) {
        const html = await ytRes.text();
        const nameMatch = html.match(/"channelMetadataRenderer"[\s\S]*?"title":"([^"]+)"/);
        const descMatch = html.match(/"description":"([^"]{0,300})"/);
        const subsMatch = html.match(/"subscriberCountText"[\s\S]*?"simpleText":"([^"]+)"/);
        const avatarMatch = html.match(/"avatar"[\s\S]*?"url":"(https:\/\/yt3[^"]+)"/);
        const videoMatches = [...html.matchAll(/"title":{"runs":\[{"text":"([^"]{5,100})"}\]/g)].slice(0, 5);
        if (nameMatch) profil.nom = nameMatch[1];
        if (descMatch) profil.bio = descMatch[1].replace(/\\n/g, ' ').substring(0, 200);
        if (subsMatch) profil.followers = subsMatch[1];
        if (avatarMatch) profil.avatar = avatarMatch[1];
        profil.videos = videoMatches.map(m => m[1]).filter(v => v && !v.includes('\\'));
      }
    } else if (plateforme === 'twitter') {
      // Pour Twitter/X : utiliser GPT pour imaginer le profil
      profil.bio = `Utilisateur Twitter/X @${nomNettoye}`;
      profil.plateforme = 'twitter';
    }

    // Générer l'histoire BD basée sur le profil avec GPT
    const contexte = `
Plateforme: ${profil.plateforme.toUpperCase()}
Nom d'utilisateur: @${profil.nom}
Bio/Description: ${profil.bio || 'Non disponible'}
Followers/Abonnés: ${profil.followers || 'Non disponible'}
Contenu récent: ${profil.videos.length > 0 ? profil.videos.join(', ') : 'Non disponible'}
`;

    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.9,
        messages: [
          {
            role: 'system',
            content: `Tu es un scénariste créatif qui crée des histoires BD humoristiques et bienveillantes basées sur des profils de réseaux sociaux.
Tu crées une histoire fun, positive et flatteuse pour le créateur de contenu.
Réponds UNIQUEMENT en JSON valide, sans markdown.`
          },
          {
            role: 'user',
            content: `Crée une histoire BD complète et amusante basée sur ce profil de réseau social :
${contexte}

L'histoire doit mettre en scène @${profil.nom} comme héros/héroïne de la BD, en lien avec son contenu et sa communauté.

Réponds en JSON avec cette structure exacte :
{
  "titre": "Titre accrocheur de la BD avec @${profil.nom}",
  "genre": "Comédie / Aventure / etc.",
  "personnages": "Description des personnages (incluant @${profil.nom} comme héros)",
  "couverture": {
    "description_image": "Description en anglais pour générer l'image de couverture (style comic book coloré, vertical 9:16, avec @${profil.nom} comme personnage principal)",
    "texte_couverture": "Phrase d'accroche sur la couverture",
    "narration_voix": "Résumé court et accrocheur de l'histoire en 2-3 phrases (environ 10 secondes à voix haute)"
  },
  "pages": [
    {
      "numero": 1,
      "titre_page": "Titre court",
      "description_image": "Description en anglais pour l'image (style comic book, vertical 9:16)",
      "narration": "Narration en français",
      "dialogue": "Dialogue en français",
      "narration_voix": "Narration vivante 4-5 phrases (~15 secondes)"
    },
    {"numero": 2, "titre_page": "Titre", "description_image": "Description anglais", "narration": "Narration fr", "dialogue": "Dialogue fr", "narration_voix": "Narration 4-5 phrases"},
    {"numero": 3, "titre_page": "Titre", "description_image": "Description anglais", "narration": "Narration fr", "dialogue": "Dialogue fr", "narration_voix": "Narration 4-5 phrases"},
    {"numero": 4, "titre_page": "Titre", "description_image": "Description anglais", "narration": "Narration fr", "dialogue": "Dialogue fr", "narration_voix": "Conclusion 4-5 phrases"}
  ]
}`
          }
        ]
      })
    });

    if (!gptRes.ok) throw new Error('Erreur GPT: ' + await gptRes.text());
    const gptData = await gptRes.json();
    let histoire;
    try {
      histoire = JSON.parse(gptData.choices[0].message.content);
    } catch(e) {
      const jsonMatch = gptData.choices[0].message.content.match(/{[\s\S]+}/);
      histoire = JSON.parse(jsonMatch[0]);
    }

    return res.json({
      profil,
      histoire,
      message: `Histoire BD créée pour @${profil.nom} (${profil.plateforme})`
    });

  } catch (err) {
    return res.status(500).json({ error: 'Erreur profil social: ' + err.message });
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

// ============================================================
// === STRIPE PAIEMENTS ===
// ============================================================

// Retourner la clé publique Stripe au frontend
app.get('/api/stripe/config', (req, res) => {
  res.json({ publishableKey: STRIPE_PUBLISHABLE_KEY });
});

// Packs disponibles
const PACKS = {
  starter: { name: 'Pack Starter', bds: 5, price: 499, description: '5 BD vidéos' },
  standard: { name: 'Pack Standard', bds: 10, price: 899, description: '10 BD vidéos' },
  pro: { name: 'Pack Pro', bds: 20, price: 1999, description: '20 BD vidéos' },
  business: { name: 'Pack Business', bds: 40, price: 3499, description: '40 BD vidéos' },
};

// Créer une session de paiement Stripe Checkout
app.post('/api/stripe/create-checkout-session', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe non configuré' });
  try {
    const { pack, email } = req.body;
    const packInfo = PACKS[pack];
    if (!packInfo) return res.status(400).json({ error: 'Pack invalide' });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email || undefined,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: packInfo.name,
            description: packInfo.description,
            images: ['https://sonia-video-bd-site.onrender.com/logo.png'],
          },
          unit_amount: packInfo.price, // en centimes
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: FRONTEND_URL + '?payment=success&pack=' + pack + '&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: FRONTEND_URL + '?payment=cancelled',
      metadata: { pack, bds: packInfo.bds.toString() },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Vérifier le statut d'un paiement
app.get('/api/stripe/verify-payment/:sessionId', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe non configuré' });
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    if (session.payment_status === 'paid') {
      const pack = session.metadata.pack;
      const bds = parseInt(session.metadata.bds);
      res.json({ success: true, pack, bds, email: session.customer_email });
    } else {
      res.json({ success: false, status: session.payment_status });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Webhook Stripe (pour confirmer les paiements côté serveur)
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    if (STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body);
    }
  } catch (err) {
    return res.status(400).send('Webhook Error: ' + err.message);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('Paiement confirmé:', session.id, 'Pack:', session.metadata.pack);
  }
  res.json({ received: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Sonia Proxy v2 running on port ' + PORT));
