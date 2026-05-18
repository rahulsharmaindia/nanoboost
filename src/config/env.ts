// ── Environment variable validation and access ───────────────
// All env vars are read here. The app will fail fast if required
// vars are missing in production.

export function getEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function getEnvOptional(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

export const env = {
  nodeEnv: getEnvOptional('NODE_ENV', 'development'),
  port: parseInt(getEnvOptional('PORT', '3000'), 10),
  serverUrl: getEnvOptional('SERVER_URL', 'http://localhost:3000'),
  corsOrigins: getEnvOptional('CORS_ORIGINS', '*'),

  // Database
  databaseUrl: getEnvOptional('DATABASE_URL'),

  // Supabase
  supabaseUrl: getEnvOptional('SUPABASE_URL'),
  supabaseServiceRoleKey: getEnvOptional('SUPABASE_SERVICE_ROLE_KEY'),

  // Instagram / Meta
  instagramAppId: getEnvOptional('INSTAGRAM_APP_ID'),
  instagramAppSecret: getEnvOptional('INSTAGRAM_APP_SECRET'),
  redirectUri: getEnvOptional('REDIRECT_URI'),
  instagramScopes: 'instagram_business_basic,instagram_business_manage_insights',
  instagramApiVersion: 'v25.0',

  // OAuth callback fallback for web/desktop browsers.
  //
  // When a session row has no `web_redirect_uri` (e.g. the start
  // request didn't carry it, or the migration hasn't been applied
  // on this DB), the auth callback would otherwise fall back to
  // the mobile-only `iginsights://` scheme — which renders as a
  // blank tab in desktop Chrome. Setting this var (e.g. the PWA
  // origin) keeps desktop browsers landing back on the app.
  webFallbackUri: getEnvOptional('WEB_FALLBACK_URI'),

  // Gemini AI
  geminiApiKey: getEnvOptional('GEMINI_API_KEY'),
  geminiModel: getEnvOptional('GEMINI_MODEL', 'gemini-2.0-flash'),

  // ── Session & token lifetimes ──────────────────────────────
  // Creator sessions are pinned to the lifetime of the Instagram
  // long-lived token (60 days). The auth guard auto-refreshes the
  // token in the background when it gets close to expiry, which
  // extends both the token and the session expiry forward.
  //
  // Brand sessions reuse the same TTL for convenience.
  sessionTtlMs: 60 * 24 * 60 * 60 * 1000,          // 60 days

  // Instagram long-lived token lifetime (Meta spec: 60 days).
  instagramLongLivedTokenTtlMs: 60 * 24 * 60 * 60 * 1000,

  // Refresh window: proactively refresh a long-lived token if it
  // is within this many days of expiry. Meta also requires the
  // token to be at least 24 hours old before it can be refreshed.
  instagramTokenRefreshWindowMs: 7 * 24 * 60 * 60 * 1000,  // 7 days
  instagramTokenMinAgeForRefreshMs: 24 * 60 * 60 * 1000,   // 24 hours

  // ── Token encryption at rest ───────────────────────────────
  // 32-byte key (hex or base64-encoded) used to AES-256-GCM-encrypt
  // Instagram access tokens before storing them in Postgres.
  // In production this MUST be set. In development the app logs a
  // warning and falls back to plaintext so local dev still works.
  tokenEncryptionKey: getEnvOptional('TOKEN_ENCRYPTION_KEY'),
};
