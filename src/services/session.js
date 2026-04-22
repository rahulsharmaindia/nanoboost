// ── In-memory session store ──────────────────────────────────
// Each session holds an Instagram access token after OAuth completes.

const crypto = require('crypto');
const config = require('../config');

const sessions = new Map();

// Remove expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > config.session.ttlMs) {
      sessions.delete(id);
    }
  }
}, config.session.cleanupIntervalMs);

/**
 * Create a new pending session and return its ID.
 */
function create() {
  const id = crypto.randomUUID();
  sessions.set(id, {
    accessToken: null,
    userId: null,
    createdAt: Date.now(),
    status: 'pending',
  });
  return id;
}

/**
 * Get a session by ID. Returns undefined if not found.
 */
function get(id) {
  return sessions.get(id);
}

/**
 * Delete a session (used on logout).
 */
function remove(id) {
  sessions.delete(id);
}

/**
 * Find the first session matching a predicate.
 * Returns { id, session } or null if none match.
 */
function findBy(predicate) {
  for (const [id, session] of sessions) {
    if (predicate(session)) return { id, session };
  }
  return null;
}

module.exports = { create, get, remove, findBy };
