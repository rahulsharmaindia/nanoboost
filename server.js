const https = require('https');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const querystring = require('querystring');

// ── Configuration ─────────────────────────────────────────────
const CONFIG = {
  INSTAGRAM_APP_ID: process.env.IG_APP_ID || '1664270071481343',
  INSTAGRAM_APP_SECRET: process.env.IG_APP_SECRET || '0d42f1be12864e501257a6bc43507432',
  REDIRECT_URI: process.env.IG_REDIRECT_URI || 'https://host/auth/callback',
  PORT: parseInt(process.env.PORT, 10) || 3000,
  USE_HTTPS: process.env.USE_HTTPS === 'true',
};

// ── Session store (in-memory; use Redis/DB in production) ────
// Maps sessionId → { accessToken, userId, createdAt }
const sessions = new Map();

// Clean expired sessions every 30 min
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > 3600000) sessions.delete(id); // 1 hour TTL
  }
}, 1800000);

// ── Create server ────────────────────────────────────────────
// HTTPS for Instagram OAuth callback, HTTP for Flutter app API calls
const httpServer = http.createServer(handleRequest);
let httpsServer = null;

if (fs.existsSync('cert.pem') && fs.existsSync('key.pem')) {
  httpsServer = https.createServer({ key: fs.readFileSync('key.pem'), cert: fs.readFileSync('cert.pem') }, handleRequest);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${CONFIG.PORT}`);
  const start = Date.now();

  console.log(`\n→ ${req.method} ${url.pathname}${url.search ? '?...' : ''}`);
  console.log(`  Time: ${new Date().toISOString()}`);

  const origEnd = res.end.bind(res);
  res.end = function (...args) {
    console.log(`← ${res.statusCode} ${url.pathname} (${Date.now() - start}ms)`);
    return origEnd(...args);
  };

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // ── Health check ───────────────────────────────────────────
  if (url.pathname === '/health') return json(res, 200, { status: 'ok' });

  // ── Step 1: App calls this to get the login URL ────────────
  // Returns a session ID + the Instagram OAuth URL
  if (url.pathname === '/api/auth/start') {
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, { accessToken: null, userId: null, createdAt: Date.now(), status: 'pending' });

    const scopes = 'instagram_business_basic,instagram_business_manage_insights';
    const authUrl = `https://www.instagram.com/oauth/authorize`
      + `?client_id=${CONFIG.INSTAGRAM_APP_ID}`
      + `&redirect_uri=${enc(CONFIG.REDIRECT_URI)}`
      + `&response_type=code`
      + `&scope=${enc(scopes)}`
      + `&state=${sessionId}`;

    console.log(`  Created session: ${sessionId}`);
    console.log(`  Auth URL: ${authUrl}`);
    console.log(`  App ID: ${CONFIG.INSTAGRAM_APP_ID}`);
    console.log(`  Redirect URI: ${CONFIG.REDIRECT_URI}`);
    return json(res, 200, { session_id: sessionId, auth_url: authUrl });
  }

  // ── Step 2: Instagram redirects here after user authorizes ─
  if (url.pathname === '/auth/callback') {
    const code = (url.searchParams.get('code') || '').replace(/#_$/, '');
    const state = url.searchParams.get('state'); // session ID
    const error = url.searchParams.get('error');

    if (error) {
      if (state && sessions.has(state)) sessions.get(state).status = 'error';
      return htmlPage(res, '❌ Login Cancelled', url.searchParams.get('error_description') || 'Authorization was denied.');
    }

    if (!state || !sessions.has(state)) {
      return htmlPage(res, '❌ Invalid Session', 'Session expired or invalid. Please try again from the app.');
    }

    console.log(`  Auth code received for session ${state}, exchanging...`);

    try {
      const tokenData = await postForm('https://api.instagram.com/oauth/access_token', {
        client_id: CONFIG.INSTAGRAM_APP_ID,
        client_secret: CONFIG.INSTAGRAM_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: CONFIG.REDIRECT_URI,
        code,
      });

      if (tokenData.error_message) {
        sessions.get(state).status = 'error';
        console.log(`  Token exchange failed: ${tokenData.error_message}`);
        return htmlPage(res, '❌ Login Failed', tokenData.error_message);
      }

      const accessToken = tokenData.data ? tokenData.data[0].access_token : tokenData.access_token;
      const userId = tokenData.data ? tokenData.data[0].user_id : tokenData.user_id;

      // Store token in session
      const session = sessions.get(state);
      session.accessToken = accessToken;
      session.userId = userId;
      session.status = 'authenticated';
      console.log(`  ✅ Session ${state} authenticated for user ${userId}`);

      return htmlPage(res, '✅ Login Successful!', 'You can close this window and go back to the app.');
    } catch (err) {
      sessions.get(state).status = 'error';
      console.log(`  Token exchange error: ${err.message}`);
      return htmlPage(res, '❌ Error', err.message);
    }
  }

  // ── Step 3: App polls this to check if auth is complete ────
  if (url.pathname === '/api/auth/status') {
    const sessionId = url.searchParams.get('session_id');
    if (!sessionId || !sessions.has(sessionId)) {
      return json(res, 404, { status: 'not_found' });
    }
    const session = sessions.get(sessionId);
    return json(res, 200, {
      status: session.status, // 'pending', 'authenticated', or 'error'
      user_id: session.userId,
    });
  }

  // ── Helper: get token from session_id header/param ─────────
  const sessionId = req.headers['authorization']?.replace('Bearer ', '') || url.searchParams.get('session_id');
  const session = sessionId ? sessions.get(sessionId) : null;
  const token = session?.accessToken;

  // All API routes below require an authenticated session
  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/auth/start' && url.pathname !== '/api/auth/status') {
    if (!token) return json(res, 401, { error: 'Not authenticated. Provide session_id.' });
  }

  // ── Profile ────────────────────────────────────────────────
  if (url.pathname === '/api/profile') {
    try {
      const fields = 'user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count';
      const data = await fetchJSON(`https://graph.instagram.com/v25.0/me?fields=${fields}&access_token=${enc(token)}`);
      return json(res, 200, data);
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ── Media ──────────────────────────────────────────────────
  if (url.pathname === '/api/media') {
    try {
      const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
      const data = await fetchJSON(`https://graph.instagram.com/v25.0/me/media?fields=${fields}&access_token=${enc(token)}`);
      return json(res, 200, data);
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ── Media insights ─────────────────────────────────────────
  if (url.pathname === '/api/media/insights') {
    const mediaId = url.searchParams.get('media_id');
    if (!mediaId) return json(res, 400, { error: 'Missing media_id' });
    try {
      const metrics = 'views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time';
      const data = await fetchJSON(`https://graph.instagram.com/v25.0/${mediaId}/insights?metric=${metrics}&locale=en_US&access_token=${enc(token)}`);
      return json(res, 200, data);
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ── Account insights overview ──────────────────────────────
  if (url.pathname === '/api/insights/overview') {
    try {
      const userId = await getUserId(token);
      const since = Math.floor(Date.now() / 1000) - 30 * 86400;
      const until = Math.floor(Date.now() / 1000);
      const metrics = 'accounts_engaged,reach,views,likes,comments,shares,saves,total_interactions';
      const data = await fetchJSON(`https://graph.instagram.com/v25.0/${userId}/insights?metric=${metrics}&period=day&metric_type=total_value&since=${since}&until=${until}&locale=en_US&access_token=${enc(token)}`);
      return json(res, 200, data);
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ── Reach by media type ────────────────────────────────────
  if (url.pathname === '/api/insights/reach-media') {
    try {
      const userId = await getUserId(token);
      const since = Math.floor(Date.now() / 1000) - 30 * 86400;
      const until = Math.floor(Date.now() / 1000);
      const data = await fetchJSON(`https://graph.instagram.com/v25.0/${userId}/insights?metric=reach&period=day&metric_type=total_value&breakdown=media_product_type&since=${since}&until=${until}&locale=en_US&access_token=${enc(token)}`);
      return json(res, 200, data);
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ── Reach by follower type ─────────────────────────────────
  if (url.pathname === '/api/insights/reach-follower') {
    try {
      const userId = await getUserId(token);
      const since = Math.floor(Date.now() / 1000) - 30 * 86400;
      const until = Math.floor(Date.now() / 1000);
      const data = await fetchJSON(`https://graph.instagram.com/v25.0/${userId}/insights?metric=reach&period=day&metric_type=total_value&breakdown=follow_type&since=${since}&until=${until}&locale=en_US&access_token=${enc(token)}`);
      return json(res, 200, data);
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ── Views by media type ────────────────────────────────────
  if (url.pathname === '/api/insights/views-media') {
    try {
      const userId = await getUserId(token);
      const since = Math.floor(Date.now() / 1000) - 30 * 86400;
      const until = Math.floor(Date.now() / 1000);
      const data = await fetchJSON(`https://graph.instagram.com/v25.0/${userId}/insights?metric=views&period=day&metric_type=total_value&breakdown=media_product_type&since=${since}&until=${until}&locale=en_US&access_token=${enc(token)}`);
      return json(res, 200, data);
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ── Follows & unfollows ────────────────────────────────────
  if (url.pathname === '/api/insights/follows') {
    try {
      const userId = await getUserId(token);
      const since = Math.floor(Date.now() / 1000) - 30 * 86400;
      const until = Math.floor(Date.now() / 1000);
      const data = await fetchJSON(`https://graph.instagram.com/v25.0/${userId}/insights?metric=follows_and_unfollows&period=day&metric_type=total_value&breakdown=follow_type&since=${since}&until=${until}&locale=en_US&access_token=${enc(token)}`);
      return json(res, 200, data);
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ── Profile link taps ──────────────────────────────────────
  if (url.pathname === '/api/insights/profile-taps') {
    try {
      const userId = await getUserId(token);
      const since = Math.floor(Date.now() / 1000) - 30 * 86400;
      const until = Math.floor(Date.now() / 1000);
      const data = await fetchJSON(`https://graph.instagram.com/v25.0/${userId}/insights?metric=profile_links_taps&period=day&metric_type=total_value&breakdown=contact_button_type&since=${since}&until=${until}&locale=en_US&access_token=${enc(token)}`);
      return json(res, 200, data);
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ── Demographics ───────────────────────────────────────────
  const demoRoutes = {
    '/api/insights/demographics/country': { metric: 'follower_demographics', breakdown: 'country' },
    '/api/insights/demographics/city': { metric: 'follower_demographics', breakdown: 'city' },
    '/api/insights/demographics/age': { metric: 'follower_demographics', breakdown: 'age' },
    '/api/insights/demographics/gender': { metric: 'follower_demographics', breakdown: 'gender' },
    '/api/insights/engaged/country': { metric: 'engaged_audience_demographics', breakdown: 'country' },
    '/api/insights/engaged/city': { metric: 'engaged_audience_demographics', breakdown: 'city' },
    '/api/insights/engaged/age': { metric: 'engaged_audience_demographics', breakdown: 'age' },
    '/api/insights/engaged/gender': { metric: 'engaged_audience_demographics', breakdown: 'gender' },
  };

  if (demoRoutes[url.pathname]) {
    try {
      const { metric, breakdown } = demoRoutes[url.pathname];
      const userId = await getUserId(token);
      const data = await fetchJSON(`https://graph.instagram.com/v25.0/${userId}/insights?metric=${metric}&period=lifetime&timeframe=this_month&breakdown=${breakdown}&metric_type=total_value&locale=en_US&access_token=${enc(token)}`);
      return json(res, 200, data);
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ── Logout ─────────────────────────────────────────────────
  if (url.pathname === '/api/auth/logout') {
    if (sessionId && sessions.has(sessionId)) sessions.delete(sessionId);
    return json(res, 200, { status: 'logged_out' });
  }

  json(res, 404, { error: 'Not found' });
}

// ── Helpers ──────────────────────────────────────────────────
const enc = (s) => encodeURIComponent(s);

async function getUserId(token) {
  const me = await fetchJSON(`https://graph.instagram.com/v25.0/me?fields=user_id&access_token=${enc(token)}`);
  return me.user_id || me.id;
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function htmlPage(res, title, message) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{font-family:-apple-system,sans-serif;background:linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045);
    min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0}
    .card{background:#fff;border-radius:16px;padding:32px;max-width:400px;width:90%;text-align:center;
    box-shadow:0 20px 60px rgba(0,0,0,.25)}h2{color:#262626;margin-bottom:12px}
    p{color:#8e8e8e;font-size:15px;line-height:1.5}</style></head>
    <body><div class="card"><h2>${title}</h2><p>${message}</p></div></body></html>`);
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Invalid JSON')); } });
    }).on('error', reject);
  });
}

function postForm(url, params) {
  const postData = querystring.stringify(params);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Invalid JSON')); } });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

httpServer.listen(CONFIG.PORT, () => {
  console.log(`HTTP server running at http://localhost:${CONFIG.PORT} (for Flutter app)`);
});

if (httpsServer) {
  const httpsPort = CONFIG.PORT + 1; // 3001
  httpsServer.listen(httpsPort, () => {
    console.log(`HTTPS server running at https://localhost:${httpsPort} (for Instagram callback)`);
    // Override redirect URI to use HTTPS port
    CONFIG.REDIRECT_URI = `https://localhost:${httpsPort}/auth/callback`;
    console.log(`Redirect URI: ${CONFIG.REDIRECT_URI}`);
  });
}
