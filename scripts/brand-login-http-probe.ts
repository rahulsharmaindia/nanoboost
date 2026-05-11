// ── Brand login HTTP probe ───────────────────────────────────
// Hits a live server's POST /api/brand/login with the same body
// shape the Flutter app sends, and prints the status + response.
// Does not persist anything.
//
// Usage (PROBE_PASSWORD is read from env — never via argv):
//   PROBE_BUSINESS_ID=1111 PROBE_PASSWORD='...' \
//     PROBE_BASE_URL='https://nanoboost-staging.up.railway.app' \
//     npx tsx scripts/brand-login-http-probe.ts

import 'dotenv/config';

async function main() {
  const businessId = process.env.PROBE_BUSINESS_ID;
  const password = process.env.PROBE_PASSWORD;
  const baseUrl = process.env.PROBE_BASE_URL ?? 'http://localhost:3000';
  if (!businessId || !password) {
    console.error('Set PROBE_BUSINESS_ID and PROBE_PASSWORD env vars.');
    process.exit(2);
  }

  const url = `${baseUrl.replace(/\/$/, '')}/api/brand/login`;
  console.log(`POST ${url}`);
  console.log(`businessId: ${businessId}`);
  console.log(`password: <${password.length} chars, provided via env>`);

  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessId, password }),
  });
  const ms = Date.now() - started;

  const text = await res.text();
  let redacted = text;
  try {
    const parsed = JSON.parse(text);
    // Redact sessionId if present — not a secret per se, but not useful in chat.
    if (parsed?.data?.sessionId) {
      parsed.data.sessionId = `<${String(parsed.data.sessionId).length}-char session id>`;
    }
    redacted = JSON.stringify(parsed, null, 2);
  } catch {
    /* not JSON — print as-is */
  }

  console.log(`\nstatus: ${res.status} ${res.statusText}  (${ms}ms)`);
  console.log('response headers:');
  for (const [k, v] of res.headers.entries()) console.log(`  ${k}: ${v}`);
  console.log('\nresponse body:');
  console.log(redacted);
}

main().catch((err) => {
  console.error('❌', (err as Error).message);
  process.exit(1);
});
