"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
exports.getEnv = getEnv;
exports.getEnvOptional = getEnvOptional;
function getEnv(key, fallback) {
    const value = process.env[key] ?? fallback;
    if (value === undefined) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}
function getEnvOptional(key, fallback = '') {
    return process.env[key] ?? fallback;
}
exports.env = {
    nodeEnv: getEnvOptional('NODE_ENV', 'development'),
    port: parseInt(getEnvOptional('PORT', '3000'), 10),
    appBaseUrl: getEnvOptional('APP_BASE_URL', 'http://localhost:3000'),
    corsOrigins: getEnvOptional('CORS_ORIGINS', '*'),
    databaseUrl: getEnvOptional('DATABASE_URL'),
    supabaseUrl: getEnvOptional('SUPABASE_URL'),
    supabasePublishableKey: getEnvOptional('SUPABASE_PUBLISHABLE_KEY'),
    supabaseSecretKey: getEnvOptional('SUPABASE_SECRET_KEY'),
    supabaseServiceRoleKey: getEnvOptional('SUPABASE_SERVICE_ROLE_KEY'),
    instagramAppId: getEnvOptional('INSTAGRAM_APP_ID'),
    instagramAppSecret: getEnvOptional('INSTAGRAM_APP_SECRET'),
    redirectUri: getEnvOptional('REDIRECT_URI'),
    instagramScopes: 'instagram_business_basic,instagram_business_manage_insights',
    instagramApiVersion: 'v25.0',
    geminiApiKey: getEnvOptional('GEMINI_API_KEY'),
    geminiModel: getEnvOptional('GEMINI_MODEL', 'gemini-2.0-flash'),
    sessionTtlMs: 60 * 60 * 1000,
    sessionCleanupIntervalMs: 30 * 60 * 1000,
};
//# sourceMappingURL=env.js.map