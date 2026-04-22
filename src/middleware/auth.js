// ── Auth middleware ───────────────────────────────────────────
// Resolves the session from the request and attaches the access
// token to req. Returns 401 if no valid session is found.

const sessionStore = require('../services/session');

/**
 * Extracts session ID from Authorization header or query param,
 * then attaches req.session and req.accessToken.
 */
function requireAuth(req, res, next) {
  const sessionId =
    req.headers['authorization']?.replace('Bearer ', '') ||
    req.query.session_id;

  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const session = sessionStore.get(sessionId);

  if (!session || !session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Make token available to route handlers
  req.accessToken = session.accessToken;
  req.sessionId = sessionId;
  next();
}

module.exports = { requireAuth };
