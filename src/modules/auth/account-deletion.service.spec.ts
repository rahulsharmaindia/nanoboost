// ── AccountDeletionService unit tests ────────────────────────
// Tests for DPDP/GDPR pseudonymization on right-to-erasure.
// Requirements: 8.5, 8.7

import { createHash } from 'crypto';
import { AccountDeletionService } from './account-deletion.service';

// ── Helpers ──────────────────────────────────────────────────

function sha256Hex(value: string): string {
  return 'pseudonymized:' + createHash('sha256').update(value).digest('hex');
}

/**
 * Build a minimal fake Drizzle client.
 *
 * The service calls tx.update(table).set(data).where(...) twice inside
 * the transaction — once for the users table, once for creator_profiles.
 * We track each call in order so tests can inspect what was written.
 */
function buildFakeDb(
  userRow: Record<string, unknown> | null,
  profileRow: Record<string, unknown> | null,
) {
  // Ordered list of { set } objects captured from tx.update().set()
  const updateCalls: Array<Record<string, unknown>> = [];

  // Tracks how many times tx.select() has been called inside the transaction
  // so we can return the right row (user first, profile second).
  let selectCallCount = 0;

  const makeQueryBuilder = (row: Record<string, unknown> | null) => {
    const b: any = {
      select: () => b,
      from: () => b,
      where: () => b,
      limit: () => Promise.resolve(row ? [row] : []),
    };
    return b;
  };

  const makeUpdateBuilder = () => {
    const b: any = {
      set: (data: Record<string, unknown>) => {
        updateCalls.push(data);
        return b;
      },
      where: () => Promise.resolve(),
    };
    return b;
  };

  const txProxy = {
    select: () => {
      selectCallCount++;
      const row = selectCallCount === 1 ? userRow : profileRow;
      return makeQueryBuilder(row);
    },
    update: (_table: unknown) => makeUpdateBuilder(),
  };

  const db = {
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      selectCallCount = 0; // reset per transaction
      await fn(txProxy);
    },
    // Used by isPseudonymized()
    select: () => makeQueryBuilder(userRow),
    // Expose for assertions
    _updateCalls: updateCalls,
  };

  return db;
}

// ── Tests ─────────────────────────────────────────────────────

describe('AccountDeletionService', () => {
  describe('pseudonymizeUser', () => {
    it('hashes the email field on the users row', async () => {
      const userRow = { id: 'user-1', email: 'alice@example.com' };
      const db = buildFakeDb(userRow, null);
      const service = new AccountDeletionService(db as any);

      const result = await service.pseudonymizeUser('user-1');

      expect(result.userId).toBe('user-1');
      expect(result.fieldsReplaced).toContain('users.email');

      // First update call is for the users table
      const usersUpdate = db._updateCalls[0];
      expect(usersUpdate['email']).toBe(sha256Hex('alice@example.com'));
    });

    it('does not re-hash an already-pseudonymized email', async () => {
      const alreadyHashed = sha256Hex('alice@example.com');
      const userRow = { id: 'user-1', email: alreadyHashed };
      const db = buildFakeDb(userRow, null);
      const service = new AccountDeletionService(db as any);

      const result = await service.pseudonymizeUser('user-1');

      expect(result.fieldsReplaced).not.toContain('users.email');
      // No update should have been issued (only updatedAt would be set,
      // but the service skips the update when there's nothing to change)
      const emailUpdates = db._updateCalls.filter(u => 'email' in u);
      expect(emailUpdates).toHaveLength(0);
    });

    it('pseudonymizes creator profile displayName and username', async () => {
      const userRow = { id: 'user-1', email: 'bob@example.com' };
      const profileRow = {
        userId: 'user-1',
        displayName: 'Bob Creator',
        username: 'bobcreator',
        bio: 'My bio',
        profilePictureUrl: 'https://cdn.example.com/bob.jpg',
      };
      const db = buildFakeDb(userRow, profileRow);
      const service = new AccountDeletionService(db as any);

      const result = await service.pseudonymizeUser('user-1');

      expect(result.fieldsReplaced).toContain('creator_profiles.displayName');
      expect(result.fieldsReplaced).toContain('creator_profiles.username');
      expect(result.fieldsReplaced).toContain('creator_profiles.bio');
      expect(result.fieldsReplaced).toContain('creator_profiles.profilePictureUrl');

      // Second update call is for creator_profiles
      const profileUpdate = db._updateCalls[1];
      expect(profileUpdate['displayName']).toBe(sha256Hex('Bob Creator'));
      expect(profileUpdate['username']).toBe(sha256Hex('bobcreator'));
      expect(profileUpdate['bio']).toBeNull();
      expect(profileUpdate['profilePictureUrl']).toBeNull();
    });

    it('returns empty fieldsReplaced when user does not exist', async () => {
      const db = buildFakeDb(null, null);
      const service = new AccountDeletionService(db as any);

      const result = await service.pseudonymizeUser('nonexistent');

      expect(result.fieldsReplaced).toHaveLength(0);
    });

    it('does NOT issue updates for financial tables', async () => {
      // The service must only call tx.update() for users and creator_profiles.
      // We verify by counting update calls — at most 2 (one per table).
      const userRow = { id: 'user-1', email: 'carol@example.com' };
      const profileRow = {
        userId: 'user-1',
        displayName: 'Carol',
        username: 'carol',
        bio: null,
        profilePictureUrl: null,
      };
      const db = buildFakeDb(userRow, profileRow);
      const service = new AccountDeletionService(db as any);

      await service.pseudonymizeUser('user-1');

      // At most 2 update calls: one for users, one for creator_profiles.
      // Financial tables (subscriptions, payments, etc.) must not be touched.
      expect(db._updateCalls.length).toBeLessThanOrEqual(2);

      // None of the update payloads should contain subscription/payment fields
      const allKeys = db._updateCalls.flatMap(u => Object.keys(u));
      const financialFields = ['tier', 'status', 'amountMinorUnits', 'providerRef', 'addonId'];
      for (const field of financialFields) {
        expect(allKeys).not.toContain(field);
      }
    });

    it('returns a pseudonymizedAt timestamp', async () => {
      const before = new Date();
      const userRow = { id: 'user-1', email: 'dave@example.com' };
      const db = buildFakeDb(userRow, null);
      const service = new AccountDeletionService(db as any);

      const result = await service.pseudonymizeUser('user-1');
      const after = new Date();

      expect(result.pseudonymizedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.pseudonymizedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('isPseudonymized', () => {
    it('returns true when email starts with pseudonymized: prefix', async () => {
      const userRow = { email: sha256Hex('eve@example.com') };
      const db = buildFakeDb(userRow, null);
      const service = new AccountDeletionService(db as any);

      expect(await service.isPseudonymized('user-1')).toBe(true);
    });

    it('returns false when email is a real address', async () => {
      const userRow = { email: 'frank@example.com' };
      const db = buildFakeDb(userRow, null);
      const service = new AccountDeletionService(db as any);

      expect(await service.isPseudonymized('user-1')).toBe(false);
    });

    it('returns false when user does not exist', async () => {
      const db = buildFakeDb(null, null);
      const service = new AccountDeletionService(db as any);

      expect(await service.isPseudonymized('nonexistent')).toBe(false);
    });
  });

  describe('sha256 hash properties', () => {
    it('produces a deterministic hash for the same input', () => {
      const h1 = sha256Hex('test@example.com');
      const h2 = sha256Hex('test@example.com');
      expect(h1).toBe(h2);
    });

    it('produces different hashes for different inputs', () => {
      const h1 = sha256Hex('alice@example.com');
      const h2 = sha256Hex('bob@example.com');
      expect(h1).not.toBe(h2);
    });

    it('always starts with the pseudonymized: prefix', () => {
      expect(sha256Hex('anything')).toMatch(/^pseudonymized:/);
    });
  });
});
