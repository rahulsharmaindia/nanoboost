import { Client } from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const sessionId = process.argv[2];
if (!sessionId) {
  console.error('Usage: node scripts/check-session.mjs <session_id>');
  process.exit(1);
}

const client = new Client({ connectionString: env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(
  `select session_id, web_redirect_uri, status, provider_user_id,
          token_expires_at, created_at, expires_at
     from sessions
    where session_id = $1`,
  [sessionId],
);
console.log(JSON.stringify(rows, null, 2));
await client.end();
