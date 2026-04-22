// ── Insights routes ──────────────────────────────────────────
// Account insights, media insights, and demographics.

const { Router } = require('express');
const config = require('../config');
const instagram = require('../services/instagram');
const { requireAuth } = require('../middleware/auth');

const router = Router();
const API = `https://graph.instagram.com/${config.instagram.apiVersion}`;
const encode = encodeURIComponent;

// ── Media insights (per-post) ────────────────────────────────
router.get('/api/media/insights', requireAuth, async (req, res) => {
  const mediaId = req.query.media_id;
  if (!mediaId) return res.status(400).json({ error: 'Missing media_id' });

  try {
    const metrics = 'views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time';
    const data = await fetch(
      `${API}/${mediaId}/insights?metric=${metrics}&locale=en_US&access_token=${encode(req.accessToken)}`
    ).then(r => r.json());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Account insights (30-day window) ─────────────────────────
// Each entry maps a route to the query string for that metric.
const accountInsights = {
  '/api/insights/overview': () => {
    const metrics = 'accounts_engaged,reach,views,likes,comments,shares,saves,total_interactions';
    return `metric=${metrics}&period=day&metric_type=total_value`;
  },
  '/api/insights/reach-media':     () => 'metric=reach&period=day&metric_type=total_value&breakdown=media_product_type',
  '/api/insights/reach-follower':  () => 'metric=reach&period=day&metric_type=total_value&breakdown=follow_type',
  '/api/insights/views-media':     () => 'metric=views&period=day&metric_type=total_value&breakdown=media_product_type',
  '/api/insights/follows':         () => 'metric=follows_and_unfollows&period=day&metric_type=total_value&breakdown=follow_type',
  '/api/insights/profile-taps':    () => 'metric=profile_links_taps&period=day&metric_type=total_value&breakdown=contact_button_type',
};

// Register a route for each account insight
for (const [path, buildQuery] of Object.entries(accountInsights)) {
  router.get(path, requireAuth, async (req, res) => {
    try {
      const userId = await instagram.getUserId(req.accessToken);
      const since = Math.floor(Date.now() / 1000) - 30 * 86400;
      const until = Math.floor(Date.now() / 1000);
      const qs = buildQuery();
      const data = await fetch(
        `${API}/${userId}/insights?${qs}&since=${since}&until=${until}&locale=en_US&access_token=${encode(req.accessToken)}`
      ).then(r => r.json());
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

// ── Demographics & engaged audience ──────────────────────────
const demographicInsights = {
  '/api/insights/demographics/country': { metric: 'follower_demographics', breakdown: 'country' },
  '/api/insights/demographics/city':    { metric: 'follower_demographics', breakdown: 'city' },
  '/api/insights/demographics/age':     { metric: 'follower_demographics', breakdown: 'age' },
  '/api/insights/demographics/gender':  { metric: 'follower_demographics', breakdown: 'gender' },
  '/api/insights/engaged/country':      { metric: 'engaged_audience_demographics', breakdown: 'country' },
  '/api/insights/engaged/city':         { metric: 'engaged_audience_demographics', breakdown: 'city' },
  '/api/insights/engaged/age':          { metric: 'engaged_audience_demographics', breakdown: 'age' },
  '/api/insights/engaged/gender':       { metric: 'engaged_audience_demographics', breakdown: 'gender' },
};

for (const [path, { metric, breakdown }] of Object.entries(demographicInsights)) {
  router.get(path, requireAuth, async (req, res) => {
    try {
      const userId = await instagram.getUserId(req.accessToken);
      const data = await fetch(
        `${API}/${userId}/insights?metric=${metric}&period=lifetime&timeframe=this_month&breakdown=${breakdown}&metric_type=total_value&locale=en_US&access_token=${encode(req.accessToken)}`
      ).then(r => r.json());
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = router;
