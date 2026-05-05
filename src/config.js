// ── Legacy config (used by Express routes) ───────────────────
// NestJS modules use src/config/env.ts instead.
// This file exists for backward compatibility with legacy routes
// and the test suite.

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
  instagram: {
    appId: process.env.INSTAGRAM_APP_ID || '',
    appSecret: process.env.INSTAGRAM_APP_SECRET || '',
    redirectUri: process.env.REDIRECT_URI || '',
    scopes: 'instagram_business_basic,instagram_business_manage_insights',
    apiVersion: 'v25.0',
  },
  session: {
    ttlMs: 60 * 60 * 1000,
    cleanupIntervalMs: 30 * 60 * 1000,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  },
};

module.exports = config;
