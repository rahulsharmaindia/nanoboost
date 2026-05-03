
// ── AI routes ────────────────────────────────────────────────
// Proxies requests to Google Gemini API for content generation.

const { Router } = require('express');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = Router();

// System prompts for each generation type
const SYSTEM_PROMPTS = {
  content_idea: 'You are a creative social media strategist. Generate engaging content ideas for Instagram influencers. Be specific, trendy, and actionable. Return 3-5 ideas in a numbered list.',
  hook_creator: 'You are an expert at writing viral hooks for Instagram Reels and videos. Generate 5 attention-grabbing hooks that stop the scroll. Each hook should be under 10 words.',
  bio_generator: 'You are an Instagram bio expert. Generate 3 creative, concise Instagram bio options. Each should be under 150 characters, include relevant emojis, and convey personality.',
  script_idea: 'You are a viral content scriptwriter for Instagram Reels. Write a short-form video script (30-60 seconds) with clear scenes, dialogue/voiceover, and visual directions.',
  story_idea: 'You are an Instagram Stories strategist. Generate a 5-7 slide Instagram Story sequence with specific content for each slide, including interactive elements (polls, questions, sliders).',
  caption_idea: 'You are a copywriter specializing in Instagram captions. Write 3 engaging captions that drive comments and saves. Include relevant hashtags and a clear CTA.',
};

// POST /api/ai/generate
router.post('/api/ai/generate', requireAuth, async (req, res) => {
  const { type, prompt } = req.body;

  if (!type || !prompt) {
    return res.status(400).json({ error: 'type and prompt are required' });
  }

  if (!config.gemini.apiKey) {
    return res.status(503).json({ error: 'AI service not configured' });
  }

  const systemPrompt = SYSTEM_PROMPTS[type];
  if (!systemPrompt) {
    return res.status(400).json({
      error: `Invalid type. Valid types: ${Object.keys(SYSTEM_PROMPTS).join(', ')}`,
    });
  }

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`;
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: `${systemPrompt}\n\nUser request: ${prompt}` },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 1024,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.error?.message || 'Gemini API error';
      return res.status(502).json({ error: errMsg });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    res.json({ result: text });
  } catch (err) {
    res.status(500).json({ error: 'AI generation failed: ' + err.message });
  }
});

module.exports = router;
