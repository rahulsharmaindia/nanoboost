// ── Instagram Graph API helpers ──────────────────────────────
// All outbound calls to Instagram live here.

const config = require('../config');

const API_BASE = `https://graph.instagram.com/${config.instagram.apiVersion}`;
const encode = encodeURIComponent;

/**
 * GET JSON from a URL. Uses the built-in fetch (Node 18+).
 */
async function fetchJSON(url) {
  const res = await fetch(url);
  const data = await res.json();
  return data;
}

/**
 * POST a form-encoded body and return JSON.
 */
async function postForm(url, params) {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return res.json();
}

/**
 * Exchange an OAuth code for an access token.
 */
async function exchangeCodeForToken(code) {
  return postForm('https://api.instagram.com/oauth/access_token', {
    client_id: config.instagram.appId,
    client_secret: config.instagram.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: config.instagram.redirectUri,
    code,
  });
}

/**
 * Get the authenticated user's Instagram user ID.
 */
async function getUserId(token) {
  const me = await fetchJSON(`${API_BASE}/me?fields=user_id&access_token=${encode(token)}`);
  return me.user_id || me.id;
}

module.exports = { fetchJSON, postForm, exchangeCodeForToken, getUserId };
