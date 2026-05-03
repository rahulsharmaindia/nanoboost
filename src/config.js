// ── All environment variables in one place ───────────────────
// Add new env vars here as the app grows.

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  instagram: {
    appId: process.env.INSTAGRAM_APP_ID || '',
    appSecret: process.env.INSTAGRAM_APP_SECRET || '',
    redirectUri: process.env.REDIRECT_URI || '',
    scopes: 'instagram_business_basic,instagram_business_manage_insights',
    apiVersion: 'v25.0',
  },
  session: {
    ttlMs: 60 * 60 * 1000,       // 1 hour
    cleanupIntervalMs: 30 * 60 * 1000, // 30 minutes
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  },
};

module.exports = config;
