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
  appBaseUrl: getEnvOptional('APP_BASE_URL', 'http://localhost:3000'),
  corsOrigins: getEnvOptional('CORS_ORIGINS', '*'),

  // Database
  databaseUrl: getEnvOptional('DATABASE_URL'),

  // Supabase
  supabaseUrl: getEnvOptional('SUPABASE_URL'),
  supabasePublishableKey: getEnvOptional('SUPABASE_PUBLISHABLE_KEY'),
  supabaseSecretKey: getEnvOptional('SUPABASE_SECRET_KEY'),
  supabaseServiceRoleKey: getEnvOptional('SUPABASE_SERVICE_ROLE_KEY'),

  // Instagram / Meta
  instagramAppId: getEnvOptional('INSTAGRAM_APP_ID'),
  instagramAppSecret: getEnvOptional('INSTAGRAM_APP_SECRET'),
  redirectUri: getEnvOptional('REDIRECT_URI'),
  instagramScopes: 'instagram_business_basic,instagram_business_manage_insights',
  instagramApiVersion: 'v25.0',

  // Gemini AI
  geminiApiKey: getEnvOptional('GEMINI_API_KEY'),
  geminiModel: getEnvOptional('GEMINI_MODEL', 'gemini-2.0-flash'),

  // Session (legacy in-memory fallback TTL)
  sessionTtlMs: 60 * 60 * 1000,
  sessionCleanupIntervalMs: 30 * 60 * 1000,
};
