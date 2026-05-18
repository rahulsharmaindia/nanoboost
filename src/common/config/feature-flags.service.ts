// ── FeatureFlagsService ──────────────────────────────────────
// Centralises all feature-flag reads so call sites never touch
// process.env directly and the flag can be overridden in tests.
//
// Design §Migration & Rollout — `creator_packages_enabled`:
//
//   The flag is read from the env var `CREATOR_PACKAGES_ENABLED` and
//   accepts one of three forms:
//
//     unset | "false"            → fully disabled for all users (default)
//     "true"                     → fully enabled for all users
//     "0".."100" (percentage)    → deterministic per-user rollout
//
//   When a percentage P is set, a stable hash of the userId is taken
//   modulo 100 and the flag is enabled iff `bucket < P`. The hash is
//   FNV-1a (32-bit) of the userId string, so the same user always lands
//   in the same bucket across processes and over time, and the rollout
//   advances cleanly from 5% → 25% → 100% by widening the active bucket
//   range without churning which users are in/out.
//
//   Default is **disabled** (Requirement: design §Migration & Rollout).
//   Production opts in by setting `CREATOR_PACKAGES_ENABLED=true` (or a
//   percentage during a phased rollout). Anything we cannot parse falls
//   back to disabled, so a typo never accidentally unblocks paywalls.

import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);

  /**
   * Global, user-agnostic view of the flag.
   *
   * Returns `true` only when the flag is fully rolled out
   * (`CREATOR_PACKAGES_ENABLED=true` or `=100`). For any partial
   * percentage rollout this returns `false` because the answer
   * depends on the user — call `isCreatorPackagesEnabledForUser`
   * instead at sites where a userId is available.
   *
   * Defaults to `false` (disabled) when the env var is unset, set to
   * `'false'`, or holds an unparseable value.
   */
  get creatorPackagesEnabled(): boolean {
    const raw = this.rawFlagValue();
    if (raw === 'true') return true;
    const pct = this.parsePercentage(raw);
    return pct !== null && pct >= 100;
  }

  /**
   * Per-user rollout check.
   *
   * Use this at call sites that have a userId in scope so percentage
   * rollouts (5%, 25%, …) actually take effect. When the env var is
   * `"true"` or `"100"` this returns `true` for every user; when it is
   * unset, `"false"`, or unparseable it returns `false` for every user.
   *
   * For an integer percentage `P` in `[1, 99]`, the result is
   * deterministic for a given userId: `hash(userId) mod 100 < P`.
   * Without a userId on a percentage rollout the call resolves to
   * `false` (fail-closed: the rollout cohort cannot be determined).
   */
  isCreatorPackagesEnabledForUser(userId?: string | null): boolean {
    const raw = this.rawFlagValue();

    if (raw === 'true') return true;
    if (raw === '' || raw === 'false') return false;

    const pct = this.parsePercentage(raw);
    if (pct === null) {
      // Unparseable value — log once-per-read and fail closed.
      this.logger.warn(
        `CREATOR_PACKAGES_ENABLED has unrecognised value "${raw}" — treating as disabled.`,
      );
      return false;
    }

    if (pct <= 0) return false;
    if (pct >= 100) return true;
    if (!userId) return false;

    return this.hashBucket(userId) < pct;
  }

  // ── Internals ────────────────────────────────────────────────────

  /** Normalises the raw env value: trimmed + lower-cased, '' if unset. */
  private rawFlagValue(): string {
    return (process.env.CREATOR_PACKAGES_ENABLED ?? '').trim().toLowerCase();
  }

  /**
   * Parses a percentage string. Accepts `"0".."100"` only.
   * Returns `null` for anything else (including negative numbers,
   * decimals, or any non-digit characters).
   */
  private parsePercentage(raw: string): number | null {
    if (!/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) return null;
    return n;
  }

  /**
   * Stable 0..99 bucket for a userId.
   *
   * FNV-1a (32-bit) keeps this dependency-free and gives a uniform
   * distribution across the 100 buckets for typical userId formats
   * (UUIDs, Supabase auth IDs, etc.). Because the function is pure and
   * deterministic, a user that lands in bucket B at 5% rollout is
   * still in bucket B at 25% rollout — they are never bounced out of
   * the cohort as the rollout widens.
   */
  private hashBucket(userId: string): number {
    let h = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < userId.length; i++) {
      h ^= userId.charCodeAt(i);
      // FNV prime 0x01000193, kept in 32 bits.
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h % 100;
  }
}
