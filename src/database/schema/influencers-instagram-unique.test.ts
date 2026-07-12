/**
 * Feature: google-auth-onboarding, Property 5
 *
 * Property 5 — Instagram user id is unique only when present.
 * Validates: Requirements 3.3
 *
 * There is no test Postgres wired into this project (no DB harness / no CI
 * database), so rather than exercising a live connection this test asserts
 * that the migration SQL DEFINITION encodes partial-unique semantics, and
 * then property-tests that a faithful simulator of that parsed index produces
 * the correct "would-violate-unique" outcome across generated inputs:
 *
 *   a duplicate is a violation  IFF  both values are non-null and equal.
 *
 * The simulator's WHERE guard is DERIVED from the parsed migration text, so if
 * the migration ever loses its `WHERE instagram_user_id IS NOT NULL` clause
 * (degrading to a plain UNIQUE index) the property fails — two NULL rows would
 * then be reported as a conflict, which the property forbids.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import fc from 'fast-check';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../drizzle/0002_google_auth_onboarding.sql',
);
const INDEX_NAME = 'uq_influencers_instagram_user_id';
const COLUMN = 'instagram_user_id';

interface ParsedPartialIndex {
  isUnique: boolean;
  column: string;
  /** The raw text of the WHERE clause, or null when the index has no guard. */
  whereClause: string | null;
}

/**
 * Locate the `CREATE ... INDEX <name>` statement in the migration and pull out
 * whether it is UNIQUE, the indexed column, and its WHERE guard (if any).
 */
function parseIndexDefinition(sql: string, indexName: string): ParsedPartialIndex {
  const statements = sql.split('--> statement-breakpoint');
  const stmt = statements.find(
    (s) => /CREATE\s+(UNIQUE\s+)?INDEX/i.test(s) && s.includes(indexName),
  );
  if (!stmt) {
    throw new Error(`Index "${indexName}" not found in migration SQL`);
  }

  const isUnique = /CREATE\s+UNIQUE\s+INDEX/i.test(stmt);

  // Column list inside the parentheses following `USING btree ( ... )`.
  const colMatch = stmt.match(/USING\s+btree\s*\(([^)]*)\)/i);
  const column = colMatch ? colMatch[1].replace(/["\s]/g, '') : '';

  // Everything after WHERE (up to the trailing semicolon) is the guard.
  const whereMatch = stmt.match(/WHERE\s+([\s\S]*?);?\s*$/i);
  const whereClause = whereMatch ? whereMatch[1].trim() : null;

  return { isUnique, column, whereClause };
}

/**
 * Build the guard predicate that the WHERE clause encodes. A partial index
 * only enforces uniqueness for rows the WHERE clause admits; rows it rejects
 * are invisible to the index and can freely duplicate (including NULLs).
 */
function guardFromWhereClause(
  whereClause: string | null,
  column: string,
): (value: string | null) => boolean {
  if (!whereClause) {
    // No WHERE clause -> a plain unique index that considers every row.
    return () => true;
  }
  const mentionsColumn = whereClause.includes(column);
  const isNotNull = /IS\s+NOT\s+NULL/i.test(whereClause);
  if (mentionsColumn && isNotNull) {
    return (value) => value !== null;
  }
  // Any other guard we don't model precisely -> treat as "always considered".
  return () => true;
}

/**
 * Faithful simulator of a (partial) unique index: insert `values` one by one,
 * skipping rows the guard rejects, and report the first duplicate collision.
 */
function insertViolatesUnique(
  values: (string | null)[],
  guard: (value: string | null) => boolean,
): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    if (!guard(value)) continue; // excluded by the WHERE clause
    const key = value as string;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

describe('Feature: google-auth-onboarding, Property 5 — partial unique index on instagram_user_id', () => {
  const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');
  const parsed = parseIndexDefinition(migrationSql, INDEX_NAME);
  const guard = guardFromWhereClause(parsed.whereClause, COLUMN);

  // ── Definition assertions: the migration encodes partial-unique semantics ──

  it('defines a UNIQUE index on instagram_user_id', () => {
    expect(parsed.isUnique).toBe(true);
    expect(parsed.column).toBe(COLUMN);
  });

  it('guards the index with WHERE instagram_user_id IS NOT NULL', () => {
    expect(parsed.whereClause).not.toBeNull();
    expect(parsed.whereClause).toMatch(/instagram_user_id/i);
    expect(parsed.whereClause).toMatch(/IS\s+NOT\s+NULL/i);
  });

  it('drops the old non-partial unique constraint and makes the column nullable', () => {
    expect(migrationSql).toMatch(/DROP\s+CONSTRAINT\s+"?influencers_instagram_user_id_unique"?/i);
    expect(migrationSql).toMatch(/ALTER\s+COLUMN\s+"?instagram_user_id"?\s+DROP\s+NOT\s+NULL/i);
  });

  // ── Example-based edge cases ──

  it('allows two rows with null instagram_user_id', () => {
    expect(insertViolatesUnique([null, null], guard)).toBe(false);
  });

  it('rejects a duplicate non-null instagram_user_id', () => {
    expect(insertViolatesUnique(['ig_123', 'ig_123'], guard)).toBe(true);
  });

  it('allows distinct non-null instagram_user_ids', () => {
    expect(insertViolatesUnique(['ig_123', 'ig_456'], guard)).toBe(false);
  });

  it('allows a null alongside a non-null instagram_user_id', () => {
    expect(insertViolatesUnique([null, 'ig_123'], guard)).toBe(false);
    expect(insertViolatesUnique(['ig_123', null], guard)).toBe(false);
  });

  // ── Property: a pair violates uniqueness IFF both are non-null and equal ──

  it('a pair of instagram_user_id values conflicts iff both are non-null and equal', () => {
    const igValue = fc.option(fc.string({ minLength: 1, maxLength: 24 }), { nil: null });
    fc.assert(
      fc.property(igValue, igValue, (a, b) => {
        const expectedConflict = a !== null && b !== null && a === b;
        expect(insertViolatesUnique([a, b], guard)).toBe(expectedConflict);
      }),
      { numRuns: 200 },
    );
  });

  it('null instagram_user_id never conflicts, no matter how many rows', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (n) => {
        const nulls: (string | null)[] = Array.from({ length: n }, () => null);
        expect(insertViolatesUnique(nulls, guard)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('a repeated non-null value among arbitrary rows is always detected as a conflict', () => {
    const igValue = fc.option(fc.string({ minLength: 1, maxLength: 12 }), { nil: null });
    fc.assert(
      fc.property(
        fc.array(igValue, { maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        (rows, dup) => {
          // Insert the same non-null value twice somewhere in the sequence.
          const values = [dup, ...rows, dup];
          expect(insertViolatesUnique(values, guard)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
