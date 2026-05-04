// ── AI routes ────────────────────────────────────────────────
// Proxies requests to Google Gemini API for content generation.

const { Router } = require('express');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = Router();

// System prompts for each generation type
const SYSTEM_PROMPTS = {
  content_idea: `You are a creative social-media strategist who specialises in Instagram growth.

Generate 5 unique, trend-aware content ideas for Instagram (Reels, carousels, or single posts).

For each idea include:
• A working title
• The recommended format (Reel / Carousel / Single Image / Collab Post)
• A one-sentence hook that would stop the scroll
• Why it works (trend, psychology, or algorithm reason)

Keep the tone conversational and actionable. Avoid generic advice.`,

  hook_creator: `You are a viral-hook specialist for short-form video on Instagram Reels and TikTok.

Generate 7 scroll-stopping hooks. Each hook must:
• Be 10 words or fewer
• Create curiosity, urgency, or a pattern interrupt
• Work as the first line spoken on camera OR as on-screen text

Group them by style:
— Curiosity gap (2 hooks)
— Bold claim (2 hooks)
— Relatable pain point (2 hooks)
— Contrarian / hot take (1 hook)`,

  bio_generator: `You are an Instagram bio copywriter who helps creators and brands make a strong first impression.

Generate 4 Instagram bio options. Each bio must:
• Be 150 characters or fewer (hard limit)
• Include 1-3 relevant emojis
• Communicate what the account is about within the first line
• End with a subtle CTA or value proposition

Provide one bio per style:
1. Professional & clean
2. Witty / personality-driven
3. Minimal & aesthetic
4. Authority / social-proof focused

Show the character count next to each option.`,

  script_idea: `You are a short-form video scriptwriter for Instagram Reels (30-60 seconds).

Write a ready-to-film script that includes:

HOOK (0-3 s): The opening line or visual that stops the scroll.
BODY (3-50 s): 3-5 concise scenes. For each scene provide:
  • On-screen text or voiceover line
  • Visual direction (what the viewer sees)
  • Any transition note (jump cut, zoom, text pop, etc.)
CTA (last 5-10 s): A clear call-to-action (follow, save, comment, share, link in bio).

Format the script so the creator can read it like a teleprompter. Keep sentences short and punchy.`,

  story_idea: `You are an Instagram Stories strategist who designs high-engagement story sequences.

Create a 5-7 slide Instagram Story sequence.

For each slide provide:
• Slide number and type (Photo / Video / Text / Boomerang)
• Visual description or background suggestion
• Text overlay or caption (keep it short — Stories are skimmed)
• Interactive sticker to use (Poll, Quiz, Question Box, Slider, Countdown, Link, or none)
  — Include the exact sticker text/options

End the sequence with a clear next step (swipe-up / link / DM prompt / "tap to see the post").

Design the sequence to maximise tap-through rate from slide 1 to the last slide.`,

  caption_idea: `You are an Instagram caption copywriter who drives saves, shares, and comments.

Write 3 caption options in different styles:

1. **Storytelling** — Open with a relatable micro-story (2-3 sentences), deliver a takeaway, end with a question CTA.
2. **Value / Listicle** — Lead with a bold statement, provide 3-5 quick tips or insights, end with a "Save this for later" CTA.
3. **Short & Punchy** — 1-2 impactful sentences max, designed for aesthetic or Reel cover posts, end with an emoji-based CTA.

For each caption also suggest:
• 5 niche-relevant hashtags (mix of broad and specific)
• 1 recommended posting time insight (e.g., "Best for weekday mornings")

Keep captions under 2,200 characters. Use line breaks for readability.`,
};

// Fields each tool type uses (for validation context)
const TOOL_FIELDS = {
  content_idea: ['niche', 'topic', 'tone', 'platform_goal', 'format'],
  hook_creator: ['niche', 'topic', 'tone'],
  bio_generator: ['niche', 'topic', 'tone', 'audience'],
  script_idea: ['niche', 'topic', 'tone', 'format'],
  story_idea: ['niche', 'topic', 'tone', 'platform_goal', 'audience'],
  caption_idea: ['niche', 'topic', 'tone', 'platform_goal', 'audience'],
};

/**
 * Builds a structured user context block from the request params.
 */
function buildUserContext({ niche, topic, tone, platform_goal, format, audience }) {
  const lines = [];
  if (niche) lines.push(`Niche: ${niche}`);
  if (topic) lines.push(`Topic/Idea: ${topic}`);
  if (tone) lines.push(`Tone: ${tone}`);
  if (platform_goal) lines.push(`Goal: ${platform_goal}`);
  if (format) lines.push(`Preferred format: ${format}`);
  if (audience) lines.push(`Target audience: ${audience}`);
  return lines.join('\n');
}

// POST /api/ai/generate
router.post('/api/ai/generate', requireAuth, async (req, res) => {
  const { type, niche, topic, tone, platform_goal, format, audience } = req.body;

  // --- backwards compat: accept old { type, prompt } shape ---
  const prompt = req.body.prompt;

  if (!type) {
    return res.status(400).json({ error: 'type is required' });
  }

  // Must have either structured topic or legacy prompt
  if (!topic && !prompt) {
    return res.status(400).json({ error: 'topic (or prompt) is required' });
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

  // Build the user message — structured params take priority over legacy prompt
  let userMessage;
  if (topic) {
    userMessage = buildUserContext({ niche, topic, tone, platform_goal, format, audience });
  } else {
    userMessage = `User request: ${prompt}`;
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
              { text: `${systemPrompt}\n\n${userMessage}` },
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
