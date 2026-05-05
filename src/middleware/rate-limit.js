// ── Simple in-memory rate limiter ────────────────────────────
// Prevents abuse and helps stay within Meta API rate limits.
// In production, replace with Redis-backed rate limiting.

const rateLimitStore = new Map();

const CLEANUP_INTERVAL = 60 * 1000; // 1 minute

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now - entry.windowStart > entry.windowMs) {
      rateLimitStore.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

/**
 * Creates a rate limiting middleware.
 * @param {object} options
 * @param {number} options.windowMs - Time window in milliseconds (default: 60s)
 * @param {number} options.max - Max requests per window (default: 60)
 * @param {string} options.message - Error message when rate limited
 */
function rateLimit({ windowMs = 60000, max = 60, message = 'Too many requests, please try again later.' } = {}) {
  return (req, res, next) => {
    // Use session_id or IP as the key
    const key = req.query.session_id ||
      req.headers['authorization']?.replace('Bearer ', '') ||
      req.ip ||
      'anonymous';

    const now = Date.now();
    let entry = rateLimitStore.get(key);

    if (!entry || now - entry.windowStart > windowMs) {
      entry = { windowStart: now, count: 0, windowMs };
      rateLimitStore.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    res.set('X-RateLimit-Reset', String(Math.ceil((entry.windowStart + windowMs) / 1000)));

    if (entry.count > max) {
      return res.status(429).json({ error: message });
    }

    next();
  };
}

/**
 * Stricter rate limit for Meta API proxy routes.
 * Instagram API has a limit of ~200 calls/user/hour.
 */
const metaApiLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 180, // Leave headroom below Meta's 200/hour limit
  message: 'Rate limit reached for Instagram API calls. Please wait before trying again.',
});

/**
 * General API rate limit.
 */
const generalLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: 'Too many requests. Please slow down.',
});

/**
 * Auth endpoint rate limit (prevent brute force).
 */
const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: 'Too many login attempts. Please try again in 15 minutes.',
});

module.exports = { rateLimit, metaApiLimit, generalLimit, authLimit };
