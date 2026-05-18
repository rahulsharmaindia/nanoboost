// ── FeatureFlagsService unit tests ───────────────────────────
// Covers Task 25.4: default false, env var parsing (true / false /
// percentage), deterministic per-user rollout via FNV-1a hashing,
// and graceful handling of malformed values.

import { FeatureFlagsService } from './feature-flags.service';

describe('FeatureFlagsService — creator_packages_enabled', () => {
  const ENV_KEY = 'CREATOR_PACKAGES_ENABLED';
  const originalValue = process.env[ENV_KEY];

  function setFlag(value: string | undefined): void {
    if (value === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = value;
    }
  }

  afterAll(() => {
    setFlag(originalValue);
  });

  describe('default behaviour', () => {
    it('defaults to disabled when env var is unset', () => {
      setFlag(undefined);
      const flags = new FeatureFlagsService();
      expect(flags.creatorPackagesEnabled).toBe(false);
      expect(flags.isCreatorPackagesEnabledForUser('user-1')).toBe(false);
      expect(flags.isCreatorPackagesEnabledForUser(undefined)).toBe(false);
    });

    it('treats empty string as disabled', () => {
      setFlag('');
      const flags = new FeatureFlagsService();
      expect(flags.creatorPackagesEnabled).toBe(false);
      expect(flags.isCreatorPackagesEnabledForUser('user-1')).toBe(false);
    });
  });

  describe('boolean env values', () => {
    it('"true" enables the flag globally', () => {
      setFlag('true');
      const flags = new FeatureFlagsService();
      expect(flags.creatorPackagesEnabled).toBe(true);
      expect(flags.isCreatorPackagesEnabledForUser('user-1')).toBe(true);
      expect(flags.isCreatorPackagesEnabledForUser(undefined)).toBe(true);
    });

    it('"false" disables the flag globally', () => {
      setFlag('false');
      const flags = new FeatureFlagsService();
      expect(flags.creatorPackagesEnabled).toBe(false);
      expect(flags.isCreatorPackagesEnabledForUser('user-1')).toBe(false);
    });

    it('case is normalised — "TRUE" works', () => {
      setFlag('TRUE');
      const flags = new FeatureFlagsService();
      expect(flags.creatorPackagesEnabled).toBe(true);
    });

    it('whitespace is stripped — "  true  " works', () => {
      setFlag('  true  ');
      const flags = new FeatureFlagsService();
      expect(flags.creatorPackagesEnabled).toBe(true);
    });
  });

  describe('percentage rollout', () => {
    it('"0" is equivalent to disabled', () => {
      setFlag('0');
      const flags = new FeatureFlagsService();
      expect(flags.creatorPackagesEnabled).toBe(false);
      for (const id of ['a', 'b', 'c', 'd']) {
        expect(flags.isCreatorPackagesEnabledForUser(id)).toBe(false);
      }
    });

    it('"100" is equivalent to fully enabled', () => {
      setFlag('100');
      const flags = new FeatureFlagsService();
      expect(flags.creatorPackagesEnabled).toBe(true);
      for (const id of ['a', 'b', 'c', 'd']) {
        expect(flags.isCreatorPackagesEnabledForUser(id)).toBe(true);
      }
    });

    it('partial percentage does not satisfy the global getter', () => {
      setFlag('50');
      const flags = new FeatureFlagsService();
      // creatorPackagesEnabled (global) is false because the flag's truth
      // value depends on the user during a rollout.
      expect(flags.creatorPackagesEnabled).toBe(false);
    });

    it('partial percentage returns false when no userId is supplied', () => {
      setFlag('50');
      const flags = new FeatureFlagsService();
      expect(flags.isCreatorPackagesEnabledForUser(undefined)).toBe(false);
      expect(flags.isCreatorPackagesEnabledForUser(null)).toBe(false);
    });

    it('per-user check is deterministic for the same userId', () => {
      setFlag('50');
      const flags = new FeatureFlagsService();
      const a = flags.isCreatorPackagesEnabledForUser('stable-user-id');
      const b = flags.isCreatorPackagesEnabledForUser('stable-user-id');
      const c = flags.isCreatorPackagesEnabledForUser('stable-user-id');
      expect(a).toBe(b);
      expect(b).toBe(c);
    });

    it('rollout is monotonic — 5% cohort ⊆ 25% cohort ⊆ 100% cohort', () => {
      const ids = Array.from({ length: 500 }, (_, i) => `user-${i}`);

      setFlag('5');
      const flags5 = new FeatureFlagsService();
      const cohort5 = ids.filter((id) =>
        flags5.isCreatorPackagesEnabledForUser(id),
      );

      setFlag('25');
      const flags25 = new FeatureFlagsService();
      const cohort25 = ids.filter((id) =>
        flags25.isCreatorPackagesEnabledForUser(id),
      );

      setFlag('100');
      const flags100 = new FeatureFlagsService();
      const cohort100 = ids.filter((id) =>
        flags100.isCreatorPackagesEnabledForUser(id),
      );

      // Monotonic: every user enabled at 5% must still be enabled at 25%
      // and 100%. Users are never bounced out as the rollout widens.
      for (const id of cohort5) {
        expect(cohort25).toContain(id);
      }
      for (const id of cohort25) {
        expect(cohort100).toContain(id);
      }
      // 100% includes every user.
      expect(cohort100.length).toBe(ids.length);
    });

    it('5% rollout enables roughly 5% of users', () => {
      const ids = Array.from({ length: 1000 }, (_, i) => `user-${i}`);
      setFlag('5');
      const flags = new FeatureFlagsService();
      const enabled = ids.filter((id) =>
        flags.isCreatorPackagesEnabledForUser(id),
      ).length;
      // FNV-1a is well-distributed; expect close to 50/1000. Allow a wide
      // band so the test is stable but still catches a broken hash.
      expect(enabled).toBeGreaterThanOrEqual(20);
      expect(enabled).toBeLessThanOrEqual(90);
    });
  });

  describe('malformed values', () => {
    it('treats negative numbers as disabled', () => {
      setFlag('-5');
      const flags = new FeatureFlagsService();
      expect(flags.creatorPackagesEnabled).toBe(false);
      expect(flags.isCreatorPackagesEnabledForUser('user-1')).toBe(false);
    });

    it('treats >100 as disabled', () => {
      setFlag('150');
      const flags = new FeatureFlagsService();
      expect(flags.creatorPackagesEnabled).toBe(false);
      expect(flags.isCreatorPackagesEnabledForUser('user-1')).toBe(false);
    });

    it('treats decimals as disabled', () => {
      setFlag('5.5');
      const flags = new FeatureFlagsService();
      expect(flags.creatorPackagesEnabled).toBe(false);
      expect(flags.isCreatorPackagesEnabledForUser('user-1')).toBe(false);
    });

    it('treats arbitrary strings as disabled', () => {
      setFlag('yes');
      const flags = new FeatureFlagsService();
      expect(flags.creatorPackagesEnabled).toBe(false);
      expect(flags.isCreatorPackagesEnabledForUser('user-1')).toBe(false);
    });
  });
});
