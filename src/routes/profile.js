// ── Profile & media routes ───────────────────────────────────

const { Router } = require('express');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = Router();
const API = `https://graph.instagram.com/${config.instagram.apiVersion}`;
const encode = encodeURIComponent;

// ── User profile ─────────────────────────────────────────────
router.get('/api/profile', requireAuth, async (req, res) => {
  try {
    const fields = 'user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count';
    const data = await fetch(`${API}/me?fields=${fields}&access_token=${encode(req.accessToken)}`).then(r => r.json());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── User media list ──────────────────────────────────────────
router.get('/api/media', requireAuth, async (req, res) => {
  try {
    const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
    const data = await fetch(`${API}/me/media?fields=${fields}&access_token=${encode(req.accessToken)}`).then(r => r.json());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
