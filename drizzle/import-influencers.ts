// ── Bulk influencer import + magic-link invite generation ────
//
// Reads a CSV of influencer profiles, inserts them into the
// `influencers` table, mints one single-use invite token per
// influencer, and prints a personalized magic-link URL for each.
//
// The influencer redeems their link (GET /api/auth/invite?token=…),
// which issues a session — no password or OAuth needed for first
// access. They can optionally connect Instagram later for live
// analytics.
//
// Usage:
//   npx tsx drizzle/import-influencers.ts <path-to-csv> [--base-url https://app.example.com] [--expires-days 14]
//
// Expected CSV columns (header row required, case-insensitive):
//   instagram_handle   (required)
//   display_name       (optional)
//   email              (optional)
//   follower_count     (optional, integer)
//   niche              (optional)
//   bio                (optional)
//   profile_picture_url(optional)
//   contact_number     (optional)
//
// Idempotency: an influencer with a matching instagram_handle is
// reused rather than duplicated, so re-running the import only mints
// a fresh token (useful if a previous link expired).

import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

interface CliArgs {
  csvPath: string;
  baseUrl: string;
  expiresDays: number;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  let csvPath = '';
  let baseUrl = process.env.WEB_FALLBACK_URI || 'http://localhost:3000';
  let expiresDays = 14;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base-url') {
      baseUrl = argv[++i] ?? baseUrl;
    } else if (arg === '--expires-days') {
      expiresDays = parseInt(argv[++i] ?? '14', 10);
    } else if (!arg.startsWith('--')) {
      csvPath = arg;
    }
  }

  if (!csvPath) {
    console.error(
      'Usage: npx tsx drizzle/import-influencers.ts <path-to-csv> [--base-url https://app.example.com] [--expires-days 14]',
    );
    process.exit(1);
  }
  return { csvPath, baseUrl: baseUrl.replace(/\/+$/, ''), expiresDays };
}

// Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped
// quotes ("") and commas/newlines inside quotes. Avoids adding a
// dependency for a one-off admin script.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      // Handle CRLF: skip the \n after a \r.
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      // Skip fully-empty lines.
      if (row.length > 1 || row[0].trim() !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  // Flush the trailing field/row (file without trailing newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0].trim() !== '') rows.push(row);
  }
  return rows;
}

async function main() {
  const { csvPath, baseUrl, expiresDays } = parseArgs();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL is not set.');
    process.exit(1);
  }

  const raw = readFileSync(csvPath, 'utf8');
  const rows = parseCsv(raw);
  if (rows.length < 2) {
    console.error('❌ CSV must have a header row and at least one data row.');
    process.exit(1);
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const idxHandle = col('instagram_handle');
  if (idxHandle === -1) {
    console.error('❌ CSV must include an "instagram_handle" column.');
    process.exit(1);
  }
  const idxDisplay = col('display_name');
  const idxEmail = col('email');
  const idxFollowers = col('follower_count');
  const idxNiche = col('niche');
  const idxBio = col('bio');
  const idxPicture = col('profile_picture_url');
  const idxContact = col('contact_number');

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });

  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000);
  const results: { handle: string; url: string }[] = [];
  let created = 0;
  let reused = 0;
  let skipped = 0;

  try {
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      const get = (idx: number) => (idx >= 0 ? (cells[idx] ?? '').trim() : '');

      const handle = get(idxHandle).replace(/^@/, '');
      if (!handle) {
        skipped++;
        continue;
      }

      const displayName = get(idxDisplay) || null;
      const email = get(idxEmail) || null;
      const followerCount = parseInt(get(idxFollowers) || '0', 10) || 0;
      const niche = get(idxNiche) || null;
      const bio = get(idxBio) || null;
      const picture = get(idxPicture) || null;
      const contact = get(idxContact) || null;

      // A pre-seeded profile is "complete enough" to browse once it has
      // the essentials brands filter on. Missing niche/contact drops the
      // influencer into onboarding on first login to fill the gaps.
      const isComplete = !!(niche && followerCount > 0);

      // Reuse an existing row with the same handle (idempotent re-runs).
      const existing = await pool.query(
        'SELECT influencer_id FROM influencers WHERE instagram_handle = $1 LIMIT 1',
        [handle],
      );

      let influencerId: string;
      if (existing.rows.length > 0) {
        influencerId = existing.rows[0].influencer_id;
        reused++;
      } else {
        influencerId = randomUUID();
        await pool.query(
          `INSERT INTO influencers (
             influencer_id, instagram_handle, display_name, email,
             follower_count, niche, bio, profile_picture_url, contact_number,
             profile_completion_status, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), now())`,
          [
            influencerId,
            handle,
            displayName,
            email,
            followerCount,
            niche,
            bio,
            picture,
            contact,
            isComplete ? 'complete' : 'incomplete',
          ],
        );
        created++;
      }

      // Mint a fresh single-use invite token.
      const token = randomBytes(24).toString('base64url');
      await pool.query(
        `INSERT INTO influencer_invite_tokens (token, influencer_id, expires_at, created_at)
         VALUES ($1, $2, $3, now())`,
        [token, influencerId, expiresAt],
      );

      results.push({ handle, url: `${baseUrl}/invite?token=${token}` });
    }

    console.log('');
    console.log('── Invite links (send each to the matching influencer) ──');
    for (const { handle, url } of results) {
      console.log(`@${handle}\t${url}`);
    }
    console.log('');
    console.log(
      `✓ Done. ${created} created, ${reused} reused, ${skipped} skipped. ` +
        `Tokens expire ${expiresAt.toISOString().split('T')[0]}.`,
    );
  } catch (e) {
    console.error('❌ Import failed:', (e as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
