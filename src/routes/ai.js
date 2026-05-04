// ── AI routes ────────────────────────────────────────────────
// Proxies requests to Google Gemini API for content generation.

const { Router } = require('express');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = Router();

// System prompts for each generation type.
//
// COPYABLE CONTENT CONVENTION:
// The model wraps any text the user should copy-paste (hooks, captions,
// bios, script lines, CTAs, hashtags) in triple backticks (```).
// The Flutter renderer detects these fenced blocks and shows a copy button.
// Everything outside backticks is context, labels, or instructions.
const SYSTEM_PROMPTS = {
  content_idea: `You are a creative social-media strategist specialising in Instagram growth.

Generate 5 unique, trend-aware content ideas for Instagram.

For each idea use this structure:

---
## Idea [N]: [Title]

**Format:** Reel / Carousel / Single Image / Collab Post

**Hook to use:**
\`\`\`
[One scroll-stopping opening line the creator can say or put on screen]
\`\`\`

**Why it works:** [One sentence — trend, psychology, or algorithm reason]

---

Rules:
- Wrap only the hook text in triple backticks — that is what the creator copies.
- Keep tone conversational and actionable.
- No generic advice.`,

  hook_creator: `You are a viral-hook specialist for Instagram Reels and TikTok.

Generate 7 scroll-stopping hooks grouped by style.

For each hook, wrap the hook text in triple backticks so the creator can copy it directly:

## Curiosity Gap
\`\`\`
[hook 1]
\`\`\`
\`\`\`
[hook 2]
\`\`\`

## Bold Claim
\`\`\`
[hook 3]
\`\`\`
\`\`\`
[hook 4]
\`\`\`

## Relatable Pain Point
\`\`\`
[hook 5]
\`\`\`
\`\`\`
[hook 6]
\`\`\`

## Contrarian / Hot Take
\`\`\`
[hook 7]
\`\`\`

Rules:
- Each hook must be 10 words or fewer.
- Only the hook text goes inside the backticks — no labels or explanations inside.`,

  bio_generator: `You are an Instagram bio copywriter.

Generate 4 Instagram bio options. For each bio, wrap the bio text in triple backticks so the creator can copy it:

---
### Professional & Clean
\`\`\`
[complete bio text including emojis]
\`\`\`
**Characters:** [exact count]/150

---
### Witty / Personality-driven
\`\`\`
[complete bio text including emojis]
\`\`\`
**Characters:** [exact count]/150

---
### Minimal & Aesthetic
\`\`\`
[complete bio text including emojis]
\`\`\`
**Characters:** [exact count]/150

---
### Authority / Social-proof
\`\`\`
[complete bio text including emojis]
\`\`\`
**Characters:** [exact count]/150

---

Rules:
- Each bio must be 150 characters or fewer.
- End each bio with a CTA or value proposition.
- Only the bio text goes inside backticks.`,

  script_idea: `You are a short-form video scriptwriter for Instagram Reels (30-60 seconds).

Write a ready-to-film script. Wrap every line the creator speaks or puts on screen in triple backticks. Everything else (visual directions, transitions) stays outside backticks.

## Hook (0–3s)
\`\`\`
[Opening line — what the creator says or shows on screen]
\`\`\`
**Visual:** [what the viewer sees]

---

## Scene 1 ([timestamp])
\`\`\`
[Voiceover or on-screen text]
\`\`\`
**Visual:** [what the viewer sees]
**Transition:** [jump cut / zoom / text pop]

---

(repeat Scene block for 3–5 scenes)

---

## CTA (last 5–10s)
\`\`\`
[Call-to-action line]
\`\`\`

Rules:
- Only spoken/on-screen lines go inside backticks.
- Keep backtick lines short and punchy — written to be read aloud.`,

  story_idea: `You are an Instagram Stories strategist.

Create a 5–7 slide story sequence. Wrap every text overlay the creator puts on screen in triple backticks. Directions and sticker info stay outside.

---
## Slide 1 — [Type: Photo / Video / Text / Boomerang]
**Visual:** [background or scene description]
\`\`\`
[Text overlay — short, Stories are skimmed]
\`\`\`
**Sticker:** [type and exact options, or "None"]

---

(repeat for each slide)

---

## Next Step
\`\`\`
[Final CTA — swipe-up link text, DM prompt, or "tap to see the post"]
\`\`\`

Rules:
- Only the on-screen text goes inside backticks.
- Keep overlays short — 1–2 lines max.`,

  caption_idea: `You are an Instagram caption copywriter who drives saves, shares, and comments.

Write 3 caption options. Wrap each complete caption and its hashtags in separate triple backtick blocks so the creator can copy them independently.

---
### Storytelling Caption
\`\`\`
[Full caption text with line breaks, ending with a question CTA]
\`\`\`
**Hashtags:**
\`\`\`
[5 niche-relevant hashtags on one line]
\`\`\`
**Best time to post:** [insight]

---
### Value / Listicle Caption
\`\`\`
[Full caption text with tips and "Save this" CTA]
\`\`\`
**Hashtags:**
\`\`\`
[5 niche-relevant hashtags on one line]
\`\`\`
**Best time to post:** [insight]

---
### Short & Punchy Caption
\`\`\`
[1-2 impactful sentences with emoji CTA]
\`\`\`
**Hashtags:**
\`\`\`
[5 niche-relevant hashtags on one line]
\`\`\`
**Best time to post:** [insight]

---

Rules:
- Only the caption text and hashtags go inside backticks.
- Each caption must be under 2,200 characters.
- Use line breaks inside the backtick block for readability.`,
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
