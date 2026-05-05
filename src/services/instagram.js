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
 * Exchange a short-lived token for a long-lived token (60 days).
 * Required for production — short-lived tokens expire in 1 hour.
 */
async function exchangeForLongLivedToken(shortLivedToken) {
  try {
    const data = await fetchJSON(
      `${API_BASE}/access_token` +
      `?grant_type=ig_exchange_token` +
      `&client_secret=${encode(config.instagram.appSecret)}` +
      `&access_token=${encode(shortLivedToken)}`
    );
    if (data.access_token) {
      console.log(`  ✅ Long-lived token obtained (expires in ${data.expires_in}s)`);
      return data.access_token;
    }
    console.warn('  ⚠️ Long-lived token exchange failed, using short-lived token');
    return shortLivedToken;
  } catch (err) {
    console.warn('  ⚠️ Long-lived token exchange error:', err.message);
    return shortLivedToken;
  }
}

/**
 * Refresh a long-lived token (valid tokens can be refreshed once per day,
 * only if the token is at least 24 hours old and not expired).
 */
async function refreshLongLivedToken(token) {
  try {
    const data = await fetchJSON(
      `${API_BASE}/refresh_access_token` +
      `?grant_type=ig_refresh_token` +
      `&access_token=${encode(token)}`
    );
    if (data.access_token) {
      return data.access_token;
    }
    return token;
  } catch (err) {
    console.warn('[Instagram] Token refresh failed:', err.message);
    return token;
  }
}

/**
 * Get the authenticated user's Instagram user ID.
 */
async function getUserId(token) {
  const me = await fetchJSON(`${API_BASE}/me?fields=user_id&access_token=${encode(token)}`);
  return me.user_id || me.id;
}

module.exports = { fetchJSON, postForm, exchangeCodeForToken, exchangeForLongLivedToken, refreshLongLivedToken, getUserId };
