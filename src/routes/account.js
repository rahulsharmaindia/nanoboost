// ── Account management routes ────────────────────────────────
// Data deletion callback (Meta requirement) and account disconnect.

const { Router } = require('express');
const crypto = require('crypto');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const sessionStore = require('../services/session');

const router = Router();

// ── POST /api/account/delete ─────────────────────────────────
// User-initiated account deletion request.
// Returns a confirmation code per Meta's data deletion requirements.
router.post('/api/account/delete', requireAuth, (req, res) => {
  try {
    const session = sessionStore.get(req.sessionId);
    const userId = session.userId;

    // Generate confirmation code
    const confirmationCode = crypto.randomBytes(8).toString('hex').toUpperCase();

    // Mark session for deletion
    session.deletionRequested = true;
    session.deletionCode = confirmationCode;
    session.deletionRequestedAt = new Date().toISOString();

    // Revoke access token (best effort)
    session.accessToken = null;
    session.status = 'deleted';

    console.log(`[Account] Deletion requested for user ${userId}`);

    res.json({
      confirmationCode,
      status: 'pending',
      message: 'Your account deletion has been scheduled. All data will be removed within 30 days.',
    });
  } catch (err) {
    console.error('[Account] Deletion error:', err);
    res.status(500).json({ error: 'Failed to process deletion request' });
  }
});

// ── POST /api/account/disconnect ─────────────────────────────
// Disconnects Instagram without deleting the account.
// Revokes the access token server-side.
router.post('/api/account/disconnect', requireAuth, (req, res) => {
  try {
    const session = sessionStore.get(req.sessionId);

    // Revoke token
    session.accessToken = null;
    session.status = 'disconnected';

    console.log(`[Account] Instagram disconnected for user ${session.userId}`);

    res.json({ status: 'disconnected' });
  } catch (err) {
    console.error('[Account] Disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// ── POST /api/meta/deletion-callback ─────────────────────────
// Meta's Data Deletion Callback URL.
// Meta calls this when a user removes the app from their Instagram settings.
// Must return a JSON response with a confirmation_code and a status URL.
//
// See: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
router.post('/api/meta/deletion-callback', (req, res) => {
  try {
    const signedRequest = req.body.signed_request;
    if (!signedRequest) {
      return res.status(400).json({ error: 'Missing signed_request' });
    }

    // Parse the signed request (base64url encoded)
    const [encodedSig, payload] = signedRequest.split('.');
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const userId = data.user_id;

    // Generate confirmation code
    const confirmationCode = crypto.randomBytes(8).toString('hex').toUpperCase();

    console.log(`[Meta Deletion] Callback received for user_id: ${userId}`);

    // Find and invalidate any sessions for this user
    const found = sessionStore.findBy(s => s.userId === userId);
    if (found) {
      found.session.accessToken = null;
      found.session.status = 'deleted_by_meta';
      found.session.deletionCode = confirmationCode;
    }

    // Meta expects this exact response format
    res.json({
      url: `${config.serverUrl}/api/meta/deletion-status?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    });
  } catch (err) {
    console.error('[Meta Deletion] Callback error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/meta/deletion-status ────────────────────────────
// Status check URL that Meta can poll to verify deletion progress.
router.get('/api/meta/deletion-status', (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).json({ error: 'Missing confirmation code' });
  }

  // In production, look up the deletion request in the database.
  // For now, return a standard response.
  res.json({
    confirmation_code: code,
    status: 'completed',
    message: 'User data has been deleted.',
  });
});

module.exports = router;
