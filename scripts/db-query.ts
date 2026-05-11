// ── Ad-hoc SQL query runner against the hosted DB ────────────
// Read-only oriented. Takes a SQL statement from --sql, --file,
// or stdin and prints the result as a table (or JSON with --json).
//
// Examples:
//   npx tsx scripts/db-query.ts --sql "SELECT COUNT(*) FROM users"
//   echo "SELECT * FROM brand_profiles LIMIT 5" | npx tsx scripts/db-query.ts
//   npx tsx scripts/db-query.ts --file scripts/queries/brands.sql --json

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

function parseArgs(argv: string[]): { sql?: string; file?: string; json: boolean } {
  const out: { sql?: string; file?: string; json: boolean } = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sql') out.sql = argv[++i];
    else if (a === '--file') out.file = argv[++i];
    else if (a === '--json') out.json = true;
  }
  return out;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sql = args.sql ?? (args.file ? readFileSync(args.file, 'utf8') : await readStdin());
  if (!sql || !sql.trim()) {
    console.error('No SQL provided. Use --sql "...", --file path.sql, or pipe via stdin.');
    process.exit(2);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    const started = Date.now();
    const result = await pool.query(sql);
    const ms = Date.now() - started;

    if (args.json) {
      console.log(JSON.stringify(result.rows, null, 2));
    } else if (result.rows.length === 0) {
      console.log(`(0 rows, ${result.command ?? 'OK'}, ${ms}ms)`);
    } else {
      console.table(result.rows);
      console.log(`(${result.rows.length} rows, ${ms}ms)`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌', (err as Error).message);
  process.exit(1);
});
