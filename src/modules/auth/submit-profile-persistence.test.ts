/**
 * Feature: google-auth-onboarding, Property 11
 *
 * Property 11 — Valid submission persists all fields, stamps contact
 * unverified, and marks the profile complete.
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 *
 * *For any* valid profile submission (non-empty Instagram handle, non-empty
 * free-text niche, non-negative integer follower count, non-empty contact
 * number, and an optional display name), after `AccountController.submitProfile`
 * runs against the authenticated influencer, reading that influencer back
 * returns the SAME (trimmed) handle / niche / follower count / contact number,
 * `contact_verification_status = 'unverified'`, `profile_completion_status =
 * 'complete'`, and the same display name when a non-empty value was supplied
 * (otherwise the display name is left unchanged). The handler also returns
 * `{ profile_completion_status: 'complete' }`.
 *
 * There is no test Postgres wired into this project (see jest.config.js and the
 * existing influencers-instagram-unique.test.ts / google-callback-success.test.ts,
 * which use fast-check with in-memory doubles). So this test constructs the real
 * `AccountController` with a faithful in-memory `db` double that models the
 * Drizzle chain `db.update(table).set(patch).where(eq(col, id))`: `set` stores
 * the patch, and `where` extracts the compared id from the `eq(...)` condition
 * and applies the patch to the matching in-memory influencer row. The
 * `sessionService` is unused by `submitProfile`, so it is a bare stub.
 */

import { describe, it, expect } from '@jest/globals';
import fc from 'fast-check';
import { eq } from 'drizzle-orm';
import { Request } from 'express';
import { AccountController } from './account.controller';
import { influencers } from '../../database/schema/influencers.schema';
import { NICHE_VALUES } from './niche.constants';

// ── In-memory influencer row (only the fields this endpoint touches) ──

interface InfluencerRow {
  influencerId: string;
  instagramHandle: string | null;
  niche: string | null;
  followerCount: number;
  contactNumber: string | null;
  displayName: string | null;
  contactVerificationStatus: 'unverified' | 'verified';
  profileCompletionStatus: 'incomplete' | 'complete';
  updatedAt: Date | null;
}

/**
 * Pull the value compared inside an `eq(column, value)` condition. Drizzle
 * inlines a primitive value passed to `eq` as a raw query chunk (see the
 * explored structure); a bound parameter instead carries a `.value`. We handle
 * both so the fake `where` can locate the targeted row exactly like Postgres
 * would, rather than blindly patching every row.
 */
function extractEqValue(cond: any): unknown {
  const chunks: any[] = cond?.queryChunks ?? [];
  for (const chunk of chunks) {
    if (typeof chunk === 'string') return chunk;
    if (typeof chunk === 'number' || typeof chunk === 'boolean') return chunk;
    if (chunk && typeof chunk === 'object' && 'value' in chunk && !Array.isArray(chunk.value)) {
      return chunk.value;
    }
  }
  return undefined;
}

/**
 * Faithful in-memory double of the Drizzle client for the single write path
 * `submitProfile` uses: `db.update(table).set(patch).where(cond)`. `set`
 * records the patch; `where` resolves the targeted influencer id from the
 * `eq(...)` condition and merges the patch into the matching row(s).
 */
class FakeDb {
  rows: InfluencerRow[] = [];

  update(_table: unknown) {
    let patch: Partial<InfluencerRow> = {};
    const builder = {
      set: (p: Partial<InfluencerRow>) => {
        patch = p;
        return builder;
      },
      where: async (cond: unknown) => {
        const targetId = extractEqValue(cond);
        for (const row of this.rows) {
          if (row.influencerId === targetId) {
            Object.assign(row, patch);
          }
        }
      },
    };
    return builder;
  }
}

const SEEDED_ID = 'inf_authenticated_001';
const INITIAL_DISPLAY_NAME = '__unchanged_display_name__';

function seededRow(): InfluencerRow {
  return {
    influencerId: SEEDED_ID,
    instagramHandle: null,
    niche: null,
    followerCount: 0,
    contactNumber: null,
    displayName: INITIAL_DISPLAY_NAME,
    contactVerificationStatus: 'unverified',
    profileCompletionStatus: 'incomplete',
    updatedAt: null,
  };
}

// A run of whitespace characters (possibly empty) to wrap around field values.
const whitespaceArb = fc
  .array(fc.constantFrom(' ', '\t', '\n'), { maxLength: 3 })
  .map((chars) => chars.join(''));

// A string that is non-empty after trimming, optionally wrapped in surrounding
// whitespace so we exercise the controller's `.trim()` on each field.
const paddedNonEmpty = fc
  .tuple(
    whitespaceArb,
    fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
    whitespaceArb,
  )
  .map(([lead, core, trail]) => `${lead}${core.trim()}${trail}`);

// Niche is mandatory free text: a predefined suggestion OR a custom typed value.
const nicheArb = fc.oneof(
  fc.constantFrom(...NICHE_VALUES),
  paddedNonEmpty,
);

// Optional display name: sometimes absent, sometimes whitespace-only (treated as
// absent by the controller), sometimes a meaningful padded value.
const displayNameArb = fc.oneof(
  fc.constant(undefined),
  whitespaceArb,
  paddedNonEmpty,
);

const submissionArb = fc.record({
  instagramHandle: paddedNonEmpty,
  niche: nicheArb,
  followerCount: fc.nat(),
  contactNumber: paddedNonEmpty,
  displayName: displayNameArb,
});

describe('Feature: google-auth-onboarding, Property 11 — valid profile persistence', () => {
  it('persists trimmed fields, stamps contact unverified, and marks the profile complete', async () => {
    await fc.assert(
      fc.asyncProperty(submissionArb, async (dto) => {
        // Fresh doubles per run for isolation.
        const db = new FakeDb();
        db.rows.push(seededRow());
        const controller = new AccountController({} as any, db as any);
        const req = { influencerId: SEEDED_ID } as unknown as Request;

        const result = await controller.submitProfile(req, dto as any);

        // Handler reports completion (Req 6.5).
        expect(result).toEqual({ profile_completion_status: 'complete' });

        const row = db.rows.find((r) => r.influencerId === SEEDED_ID)!;

        // Mandatory fields persisted, trimmed (Req 6.1, 6.2).
        expect(row.instagramHandle).toBe(dto.instagramHandle.trim());
        expect(row.niche).toBe(dto.niche.trim());
        expect(row.followerCount).toBe(dto.followerCount);
        expect(row.contactNumber).toBe(dto.contactNumber.trim());

        // Contact stamped unverified (Req 6.4) and profile marked complete (Req 6.5).
        expect(row.contactVerificationStatus).toBe('unverified');
        expect(row.profileCompletionStatus).toBe('complete');

        // Display name persisted only when a non-empty trimmed value was
        // supplied; otherwise the existing value is left unchanged (Req 6.3).
        const trimmedDisplay = dto.displayName?.trim();
        if (trimmedDisplay) {
          expect(row.displayName).toBe(trimmedDisplay);
        } else {
          expect(row.displayName).toBe(INITIAL_DISPLAY_NAME);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('only updates the authenticated influencer, leaving other rows untouched', async () => {
    const db = new FakeDb();
    db.rows.push(seededRow());
    const other: InfluencerRow = { ...seededRow(), influencerId: 'inf_other_999' };
    db.rows.push(other);

    const controller = new AccountController({} as any, db as any);
    const req = { influencerId: SEEDED_ID } as unknown as Request;

    await controller.submitProfile(req, {
      instagramHandle: 'creator',
      niche: 'Tech',
      followerCount: 1200,
      contactNumber: '+15551234567',
    } as any);

    const target = db.rows.find((r) => r.influencerId === SEEDED_ID)!;
    expect(target.profileCompletionStatus).toBe('complete');
    expect(target.instagramHandle).toBe('creator');

    // The unrelated influencer must be unchanged (faithful row targeting).
    expect(other.profileCompletionStatus).toBe('incomplete');
    expect(other.instagramHandle).toBeNull();
  });

  it('confirms the eq(...) condition value extraction targets the influencer id', () => {
    expect(extractEqValue(eq(influencers.influencerId, SEEDED_ID))).toBe(SEEDED_ID);
  });
});
