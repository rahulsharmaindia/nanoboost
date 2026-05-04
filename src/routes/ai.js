// ── AI routes ────────────────────────────────────────────────
// Proxies requests to Google Gemini API for content generation.

const { Router } = require('express');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = Router();

// System prompts for each generation type
// All prompts use a consistent markdown-like format so the Flutter app
// can parse and render them with proper typography and copy buttons.
//
// FORMAT RULES (must be followed exactly):
//   ## Section Title       → rendered as a section header
//   ### Sub-title          → rendered as a sub-header
//   **bold text**          → rendered bold
//   COPY: <content>        → rendered as a copyable content block
//   ---                    → rendered as a divider between items
//   Plain lines            → rendered as body text
const SYSTEM_PROMPTS = {
  content_idea: `You are a creative social-media strategist specialising in Instagram growth.

Generate 5 unique, trend-aware content ideas. Use EXACTLY this format for each idea:

---
## Idea [number]: [Title]

**Format:** [Reel / Carousel / Single Image / Collab Post]

**Hook:**
COPY: [One scroll-stopping opening line]

**Why it works:** [One sentence — trend, psychology, or algorithm reason]
---

Keep the tone conversational and actionable. No generic advice.`,

  hook_creator: `You are a viral-hook specialist for Instagram Reels and TikTok.

Generate 7 scroll-stopping hooks grouped by style. Use EXACTLY this format:

## Curiosity Gap

COPY: [hook 1]

COPY: [hook 2]

## Bold Claim

COPY: [hook 3]

COPY: [hook 4]

## Relatable Pain Point

COPY: [hook 5]

COPY: [hook 6]

## Contrarian / Hot Take

COPY: [hook 7]

Each hook must be 10 words or fewer. No explanations after each hook — just the hook text inside COPY blocks.`,

  bio_generator: `You are an Instagram bio copywriter.

Generate 4 Instagram bio options. Use EXACTLY this format for each:

---
### [Style name] Bio

COPY: [The complete bio text including emojis]

**Characters:** [exact count]/150
---

Styles: Professional & Clean, Witty / Personality-driven, Minimal & Aesthetic, Authority / Social-proof.
Each bio must be 150 characters or fewer and end with a CTA or value proposition.`,

  script_idea: `You are a short-form video scriptwriter for Instagram Reels (30-60 seconds).

Write a ready-to-film script using EXACTLY this format:

## Hook (0–3s)

COPY: [Opening line or on-screen text]

**Visual:** [What the viewer sees]

---

## Scene [n] ([timestamp])

COPY: [Voiceover or on-screen text]

**Visual:** [What the viewer sees]
**Transition:** [Jump cut / zoom / text pop / etc.]

---

(repeat Scene block for each scene)

---

## CTA (last 5–10s)

COPY: [Call-to-action line]

Keep every COPY line short and punchy — written so the creator can read it like a teleprompter.`,

  story_idea: `You are an Instagram Stories strategist.

Create a 5–7 slide story sequence using EXACTLY this format for each slide:

---
## Slide [n] — [Type: Photo / Video / Text / Boomerang]

**Visual:** [Background or scene description]

COPY: [Text overlay — keep it short, Stories are skimmed]

**Sticker:** [Sticker type and exact text/options, or "None"]
---

End with a ## Next Step section:

## Next Step

COPY: [The final CTA — swipe-up link, DM prompt, or "tap to see the post"]`,

  caption_idea: `You are an Instagram caption copywriter who drives saves, shares, and comments.

Write 3 caption options using EXACTLY this format:

---
### Storytelling Caption

COPY: [Full caption text with line breaks, ending with a question CTA]

**Hashtags:**
COPY: [5 niche-relevant hashtags]

**Best time to post:** [insight]

---
### Value / Listicle Caption

COPY: [Full caption text with tips and "Save this" CTA]

**Hashtags:**
COPY: [5 niche-relevant hashtags]

**Best time to post:** [insight]

---
### Short & Punchy Caption

COPY: [1-2 impactful sentences with emoji CTA]

**Hashtags:**
COPY: [5 niche-relevant hashtags]

**Best time to post:** [insight]
---

Each caption must be under 2,200 characters. Use line breaks for readability.`,
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
