// ── Auth routes ──────────────────────────────────────────────
// Handles OAuth start, callback, status polling, and logout.

const { Router } = require('express');
const config = require('../config');
const sessionStore = require('../services/session');
const instagram = require('../services/instagram');
const { renderPage } = require('../utils/html');

const router = Router();
const encode = encodeURIComponent;

// ── Start OAuth: returns session ID + Instagram auth URL ─────
router.get('/api/auth/start', (req, res) => {
  const sessionId = sessionStore.create();

  const authUrl =
    'https://www.instagram.com/oauth/authorize' +
    `?client_id=${config.instagram.appId}` +
    `&redirect_uri=${encode(config.instagram.redirectUri)}` +
    `&response_type=code` +
    `&scope=${encode(config.instagram.scopes)}` +
    `&state=${sessionId}`;

  console.log(`  Session created: ${sessionId}`);
  res.json({ session_id: sessionId, auth_url: authUrl });
});

// ── OAuth callback: Instagram redirects here after login ─────
router.get('/auth/callback', async (req, res) => {
  const code = (req.query.code || '').replace(/#_$/, '');
  const state = req.query.state;
  const error = req.query.error;

  if (error) {
    const session = sessionStore.get(state);
    if (session) session.status = 'error';
    return res.send(renderPage(
      '❌ Login Cancelled',
      req.query.error_description || 'Authorization was denied.'
    ));
  }

  if (!state || !sessionStore.get(state)) {
    return res.send(renderPage(
      '❌ Invalid Session',
      'Session expired. Please try again from the app.'
    ));
  }

  console.log(`  Exchanging code for token (session: ${state})`);

  try {
    const tokenData = await instagram.exchangeCodeForToken(code);

    if (tokenData.error_message) {
      sessionStore.get(state).status = 'error';
      return res.send(renderPage('❌ Login Failed', tokenData.error_message));
    }

    const accessToken = tokenData.data
      ? tokenData.data[0].access_token
      : tokenData.access_token;
    const userId = tokenData.data
      ? tokenData.data[0].user_id
      : tokenData.user_id;

    const session = sessionStore.get(state);
    session.accessToken = accessToken;
    session.userId = userId;
    session.status = 'authenticated';

    console.log(`  ✅ Authenticated user ${userId}`);
    res.send(renderPage('✅ Login Successful!', 'You can close this window and go back to the app.'));
  } catch (err) {
    sessionStore.get(state).status = 'error';
    res.send(renderPage('❌ Error', err.message));
  }
});

// ── Poll auth status ─────────────────────────────────────────
router.get('/api/auth/status', (req, res) => {
  const sessionId = req.query.session_id;
  const session = sessionId ? sessionStore.get(sessionId) : null;

  if (!session) {
    return res.status(404).json({ status: 'not_found' });
  }

  res.json({ status: session.status, user_id: session.userId });
});

// ── Logout ───────────────────────────────────────────────────
router.get('/api/auth/logout', (req, res) => {
  const sessionId =
    req.headers['authorization']?.replace('Bearer ', '') ||
    req.query.session_id;

  if (sessionId) sessionStore.remove(sessionId);
  res.json({ status: 'logged_out' });
});

module.exports = router;
