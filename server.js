// ── Entry point ──────────────────────────────────────────────
// Starts the Express server. Keep this file thin.

const app = require('./src/app');
const config = require('./src/config');

// Prevent unhandled rejections from crashing the process
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Server running on port ${config.port}`);
  console.log(`Redirect URI: ${config.instagram.redirectUri}`);
  console.log(`App ID loaded: ${config.instagram.appId ? 'yes' : '❌ MISSING'}`);
  console.log(`App Secret loaded: ${config.instagram.appSecret ? 'yes' : '❌ MISSING'}`);
  console.log(`Redirect URI loaded: ${config.instagram.redirectUri ? 'yes' : '❌ MISSING'}`);
  console.log(`Gemini API key loaded: ${config.gemini.apiKey ? 'yes' : '⚠️  NOT SET (AI features disabled)'}`);
});
