// ── Account Deletion / Right-to-Erasure Service ──────────────
// Implements DPDP / GDPR pseudonymization on subscription cancellation.
//
// When a user exercises their right-to-erasure, this service:
//   1. Replaces PII fields (email, phone, full_name) on the user record
//      with deterministic SHA-256 hashes so the row is no longer
//      personally identifiable.
//   2. Pseudonymizes the creator profile (display_name, username, bio,
//      profile_picture_url) for the same reason.
//   3. Retains all financial rows (subscriptions, subscription_events,
//      payments, add_on_purchases) untouched for the mandatory 7-year
//      retention window — the user_id FK is preserved so audit trails
//      remain coherent.
//
// Requirements: 8.5, 8.7

import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { users } from '../../database/schema/users.schema';
import { creatorProfiles } from '../../database/schema/creators.schema';

/** Sentinel prefix written into hashed fields so auditors can identify
 *  pseudonymized rows at a glance without reversing the hash. */
const PSEUDONYMIZED_PREFIX = 'pseudonymized:';

/**
 * Produces a deterministic, one-way SHA-256 hex digest of the input.
 * The prefix makes it obvious in the DB that the value is a hash, not
 * a real email / name.
 */
function sha256Hex(value: string): string {
  return PSEUDONYMIZED_PREFIX + createHash('sha256').update(value).digest('hex');
}

export interface PseudonymizationResult {
  userId: string;
  pseudonymizedAt: Date;
  fieldsReplaced: string[];
}

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly db: any,
  ) {}

  /**
   * Pseudonymizes PII on the user record and creator profile.
   *
   * Financial records (subscriptions, subscription_events, payments,
   * add_on_purchases) are intentionally NOT touched — they must be
   * retained for 7 years per Requirement 8.5.
   *
   * Referential integrity is preserved: the user row stays in the
   * database with the same primary key; only the PII column values
   * are replaced with hashes.
   *
   * @param userId  The Supabase Auth user ID of the requesting user.
   * @returns       A summary of what was pseudonymized.
   */
  async pseudonymizeUser(userId: string): Promise<PseudonymizationResult> {
    this.logger.log(`Starting pseudonymization for user ${userId}`);

    const fieldsReplaced: string[] = [];
    const pseudonymizedAt = new Date();

    await this.db.transaction(async (tx: any) => {
      // ── 1. Pseudonymize the users row ──────────────────────────
      const [existingUser] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!existingUser) {
        this.logger.warn(`Pseudonymization requested for unknown user ${userId}`);
        return;
      }

      const userUpdates: Record<string, string | Date> = {
        updatedAt: pseudonymizedAt,
      };

      // email is always present on the users table
      if (existingUser.email && !existingUser.email.startsWith(PSEUDONYMIZED_PREFIX)) {
        userUpdates['email'] = sha256Hex(existingUser.email);
        fieldsReplaced.push('users.email');
      }

      // phone and full_name are not in the current schema but may be
      // added in future migrations. Guard defensively so this service
      // remains correct after schema evolution.
      const userRecord = existingUser as Record<string, unknown>;

      if (
        typeof userRecord['phone'] === 'string' &&
        userRecord['phone'] &&
        !String(userRecord['phone']).startsWith(PSEUDONYMIZED_PREFIX)
      ) {
        userUpdates['phone'] = sha256Hex(String(userRecord['phone']));
        fieldsReplaced.push('users.phone');
      }

      if (
        typeof userRecord['fullName'] === 'string' &&
        userRecord['fullName'] &&
        !String(userRecord['fullName']).startsWith(PSEUDONYMIZED_PREFIX)
      ) {
        userUpdates['fullName'] = sha256Hex(String(userRecord['fullName']));
        fieldsReplaced.push('users.fullName');
      }

      if (Object.keys(userUpdates).length > 1) {
        // more than just updatedAt
        await tx
          .update(users)
          .set(userUpdates)
          .where(eq(users.id, userId));
      }

      // ── 2. Pseudonymize the creator profile ───────────────────
      const [existingProfile] = await tx
        .select()
        .from(creatorProfiles)
        .where(eq(creatorProfiles.userId, userId))
        .limit(1);

      if (existingProfile) {
        const profileUpdates: Record<string, string | null | Date> = {
          updatedAt: pseudonymizedAt,
        };

        if (
          existingProfile.displayName &&
          !existingProfile.displayName.startsWith(PSEUDONYMIZED_PREFIX)
        ) {
          profileUpdates['displayName'] = sha256Hex(existingProfile.displayName);
          fieldsReplaced.push('creator_profiles.displayName');
        }

        if (
          existingProfile.username &&
          !existingProfile.username.startsWith(PSEUDONYMIZED_PREFIX)
        ) {
          profileUpdates['username'] = sha256Hex(existingProfile.username);
          fieldsReplaced.push('creator_profiles.username');
        }

        if (existingProfile.bio) {
          profileUpdates['bio'] = null;
          fieldsReplaced.push('creator_profiles.bio');
        }

        if (existingProfile.profilePictureUrl) {
          profileUpdates['profilePictureUrl'] = null;
          fieldsReplaced.push('creator_profiles.profilePictureUrl');
        }

        if (Object.keys(profileUpdates).length > 1) {
          await tx
            .update(creatorProfiles)
            .set(profileUpdates)
            .where(eq(creatorProfiles.userId, userId));
        }
      }

      // ── 3. Financial records are intentionally preserved ──────
      // subscriptions, subscription_events, payments, add_on_purchases
      // rows are NOT deleted or modified. They must be retained for
      // 7 years from the cancellation date (Requirement 8.5).
      // The user_id FK on those tables still points to the now-
      // pseudonymized user row, preserving referential integrity.
    });

    this.logger.log(
      `Pseudonymization complete for user ${userId}. ` +
      `Fields replaced: [${fieldsReplaced.join(', ')}]`,
    );

    return { userId, pseudonymizedAt, fieldsReplaced };
  }

  /**
   * Returns true if the user record has already been pseudonymized.
   * Useful for idempotency checks before re-running the operation.
   */
  async isPseudonymized(userId: string): Promise<boolean> {
    const [user] = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return false;
    return user.email?.startsWith(PSEUDONYMIZED_PREFIX) ?? false;
  }
}
