// ── Brand registration, login & retrieval routes ─────────────

const { Router } = require('express');
const crypto = require('crypto');
const sessionStore = require('../services/session');

const router = Router();

// ── Helpers ──────────────────────────────────────────────────

/**
 * Hash a password using SHA-256.
 */
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Middleware: require a valid business session (one with a businessId).
 * Checks Authorization header or session_id query param.
 */
function requireBrandAuth(req, res, next) {
  const sessionId =
    req.headers['authorization']?.replace('Bearer ', '') ||
    req.query.session_id;

  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const session = sessionStore.get(sessionId);
  if (!session || !session.businessId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  req.sessionId = sessionId;
  next();
}

// ── POST /api/brand/register ─────────────────────────────────
router.post('/api/brand/register', (req, res) => {
  try {
    const { name, logo, industry, website, description, socialLinks, businessId, password } = req.body;

    // Validate required fields
    const missing = [];
    if (!name) missing.push('name');
    if (!logo) missing.push('logo');
    if (!industry) missing.push('industry');
    if (!businessId) missing.push('businessId');
    if (!password) missing.push('password');

    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    // Check businessId uniqueness
    const existing = sessionStore.findBy(s => s.businessId === businessId);
    if (existing) {
      return res.status(409).json({ error: 'Business ID already taken' });
    }

    // Hash password
    const hashedPassword = hashPassword(password);

    // Create business session
    const sessionId = sessionStore.create();
    const session = sessionStore.get(sessionId);
    session.accessToken = null;
    session.userId = null;
    session.status = 'authenticated';
    session.businessId = businessId;
    session.hashedPassword = hashedPassword;
    session.brandData = {
      name,
      logo,
      industry,
      website: website || null,
      description: description || null,
      socialLinks: socialLinks || null,
      registeredAt: new Date().toISOString(),
    };

    res.json({ sessionId, brandData: session.brandData });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/brand/login ────────────────────────────────────
router.post('/api/brand/login', (req, res) => {
  try {
    const { businessId, password } = req.body;

    if (!businessId || !password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Find session with matching businessId
    const found = sessionStore.findBy(s => s.businessId === businessId);
    if (!found) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const hashedPassword = hashPassword(password);
    if (found.session.hashedPassword !== hashedPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create a new business session with the same brand data
    const sessionId = sessionStore.create();
    const session = sessionStore.get(sessionId);
    session.accessToken = null;
    session.userId = null;
    session.status = 'authenticated';
    session.businessId = found.session.businessId;
    session.hashedPassword = found.session.hashedPassword;
    session.brandData = found.session.brandData;

    res.json({ sessionId, brandData: session.brandData });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/brand ───────────────────────────────────────────
router.get('/api/brand', requireBrandAuth, (req, res) => {
  try {
    const session = sessionStore.get(req.sessionId);
    if (!session || !session.brandData) {
      return res.status(404).json({ error: 'No brand registered' });
    }
    res.json(session.brandData);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.requireBrandAuth = requireBrandAuth;
