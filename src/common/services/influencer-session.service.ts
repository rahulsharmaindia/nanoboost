// ── Influencer session service ───────────────────────────────
// Owns the influencer auth lifecycle across four tables:
//   • influencer_oauth_states  — transient OAuth handshake state
//   • influencers              — the entity (created on first login)
//   • influencer_social_accounts — the Instagram token (encrypted)
//   • influencer_sessions      — the credential held by the client
//
// One active session per influencer (partial unique index). The
// access token lives on the social account, never on the session.

import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq, lt, desc } from 'drizzle-orm';
import { randomUUID, randomBytes } from 'crypto';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import {
  influencers,
  influencerSessions,
  influencerSocialAccounts,
  influencerOauthStates,
} from '../../database/schema/influencers.schema';
import { env } from '../../config/env';
import { TokenCipher } from './token-cipher.service';

// The context the auth guard / token service operate on. Flattens
// session + influencer + active social account into one shape.
export interface InfluencerContext {
  sessionId: string;
  influencerId: string;
  instagramUserId: string;        // provider_user_id
  accessToken: string | null;     // decrypted
  tokenExpiresAt: Date | null;
  lastRefreshedAt: Date | null;
  sessionCreatedAt: Date;
  socialConnectedAt: Date | null;
  // Onboarding gating + pre-fill: surfaced on the auth-status response so
  // the client can hard-lock a returning incomplete influencer on cold
  // start and keep the Google email available for onboarding pre-fill.
  profileCompletionStatus: 'incomplete' | 'complete';
  email: string | null;
}

export interface CompleteOAuthInput {
  instagramUserId: string;
  accessToken: string;
  tokenExpiresAt: Date | null;
  username?: string | null;
}

@Injectable()
export class InfluencerSessionService {
  constructor(
    @Inject(DRIZZLE_CLIENT) @Optional() private readonly db: any,
    private readonly cipher: TokenCipher,
  ) {}

  private requireDb(): any {
    if (!this.db) {
      throw new Error(
        'DATABASE_URL is not configured. InfluencerSessionService requires a database connection.',
      );
    }
    return this.db;
  }

  private toDate(v: unknown): Date | null {
    if (v == null) return null;
    return v instanceof Date ? v : new Date(v as any);
  }

  // ── OAuth handshake state ──────────────────────────────────

  // Returns the public `state` (sent to Instagram) and a private
  // `pollToken` (kept by the client, used for the poll fallback).
  async createOAuthState(
    webRedirectUri?: string | null,
  ): Promise<{ state: string; pollToken: string }> {
    const db = this.requireDb();
    const state = randomBytes(24).toString('base64url');
    const pollToken = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await db.insert(influencerOauthStates).values({
      state,
      pollToken,
      webRedirectUri: webRedirectUri ?? null,
      expiresAt,
    });
    return { state, pollToken };
  }

  async getOAuthState(state: string): Promise<{ webRedirectUri: string | null } | null> {
    if (!state) return null;
    const db = this.requireDb();
    const rows = await db
      .select()
      .from(influencerOauthStates)
      .where(eq(influencerOauthStates.state, state));
    if (rows.length === 0) return null;
    return { webRedirectUri: rows[0].webRedirectUri ?? null };
  }

  async setOAuthRedirect(state: string, webRedirectUri: string): Promise<void> {
    const db = this.requireDb();
    await db
      .update(influencerOauthStates)
      .set({ webRedirectUri })
      .where(eq(influencerOauthStates.state, state));
  }

  async deleteOAuthState(state: string): Promise<void> {
    if (!state) return;
    const db = this.requireDb();
    await db.delete(influencerOauthStates).where(eq(influencerOauthStates.state, state));
  }

  // Record the issued session on the handshake row so the poll
  // fallback can hand it back to the token holder. Keeps the row
  // around (don't delete) until the poll consumes it or it expires.
  async attachSessionToState(state: string, sessionId: string): Promise<void> {
    const db = this.requireDb();
    await db
      .update(influencerOauthStates)
      .set({ resultStatus: 'authenticated', sessionId })
      .where(eq(influencerOauthStates.state, state));
  }

  async markStateError(state: string): Promise<void> {
    const db = this.requireDb();
    await db
      .update(influencerOauthStates)
      .set({ resultStatus: 'error' })
      .where(eq(influencerOauthStates.state, state));
  }

  // Poll by the private token. Single-use: a terminal result
  // (authenticated/error) consumes the row. Never keyed on `state`.
  async pollByToken(
    pollToken: string,
  ): Promise<{ status: 'pending' | 'authenticated' | 'error' | 'not_found'; sessionId?: string }> {
    if (!pollToken) return { status: 'not_found' };
    const db = this.requireDb();
    const rows = await db
      .select()
      .from(influencerOauthStates)
      .where(eq(influencerOauthStates.pollToken, pollToken));
    if (rows.length === 0) return { status: 'not_found' };
    const row = rows[0];

    const expiresAt = row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt);
    if (expiresAt.getTime() < Date.now()) {
      await db.delete(influencerOauthStates).where(eq(influencerOauthStates.state, row.state));
      return { status: 'not_found' };
    }

    if (row.resultStatus === 'authenticated') {
      await db.delete(influencerOauthStates).where(eq(influencerOauthStates.state, row.state));
      return { status: 'authenticated', sessionId: row.sessionId ?? undefined };
    }
    if (row.resultStatus === 'error') {
      await db.delete(influencerOauthStates).where(eq(influencerOauthStates.state, row.state));
      return { status: 'error' };
    }
    return { status: 'pending' };
  }

  // ── Completing a login ─────────────────────────────────────

  // Upserts the influencer + social account, then issues a fresh
  // session (replacing any prior active one). Returns the session id.
  async completeOAuth(input: CompleteOAuthInput): Promise<string> {
    const db = this.requireDb();
    const influencerId = await this.upsertInfluencer(input.instagramUserId, input.username);
    await this.upsertSocialAccount(influencerId, input);

    // Ensure a default "creator" subscription exists for this influencer.
    // Runs on every login so existing influencers who pre-date the feature
    // get backfilled without a separate migration script.
    await this.ensureDefaultSubscription(influencerId);

    // Replace any existing active session for this influencer.
    await db
      .delete(influencerSessions)
      .where(eq(influencerSessions.influencerId, influencerId));

    const expiresAt = new Date(Date.now() + env.sessionTtlMs);
    const [row] = await db
      .insert(influencerSessions)
      .values({ influencerId, status: 'authenticated', expiresAt })
      .returning({ sessionId: influencerSessions.sessionId });
    return row.sessionId;
  }

  // ── Google identity login (no Instagram social account) ────

  // Resolves an influencer by google_user_id, or creates one. A
  // first-time Google influencer starts `incomplete` with its email
  // stored unverified. No Instagram social-account row is created —
  // Google-first influencers supply their handle later during
  // onboarding. Issues a fresh session (one active per influencer).
  async loginWithGoogleIdentity(input: {
    googleUserId: string;
    email: string | null;
  }): Promise<{ sessionId: string; profileCompletionStatus: 'incomplete' | 'complete' }> {
    const db = this.requireDb();

    // Resolve existing influencer by google_user_id, else create one
    // with profile_completion_status defaulting to 'incomplete'.
    const existing = await db
      .select()
      .from(influencers)
      .where(eq(influencers.googleUserId, input.googleUserId));

    let influencerId: string;
    let status: 'incomplete' | 'complete';

    if (existing.length > 0) {
      influencerId = existing[0].influencerId;
      status = existing[0].profileCompletionStatus;
    } else {
      const [row] = await db
        .insert(influencers)
        .values({
          googleUserId: input.googleUserId,
          email: input.email, // store the Google email
          emailVerificationStatus: 'unverified', // default unverified
          // profile_completion_status defaults to 'incomplete'
          // contact_verification_status defaults to 'unverified'
        })
        .returning({
          influencerId: influencers.influencerId,
          profileCompletionStatus: influencers.profileCompletionStatus,
        });
      influencerId = row.influencerId;
      status = row.profileCompletionStatus;
    }

    // Reuse the default subscription backfill from the Instagram path.
    await this.ensureDefaultSubscription(influencerId);

    // Replace any existing active session (one active session per influencer).
    await db
      .delete(influencerSessions)
      .where(eq(influencerSessions.influencerId, influencerId));

    const expiresAt = new Date(Date.now() + env.sessionTtlMs);
    const [session] = await db
      .insert(influencerSessions)
      .values({ influencerId, status: 'authenticated', expiresAt })
      .returning({ sessionId: influencerSessions.sessionId });

    return { sessionId: session.sessionId, profileCompletionStatus: status };
  }

  private async upsertInfluencer(
    instagramUserId: string,
    username?: string | null,
  ): Promise<string> {
    const db = this.requireDb();
    const existing = await db
      .select()
      .from(influencers)
      .where(eq(influencers.instagramUserId, instagramUserId));
    if (existing.length > 0) {
      if (username) {
        await db
          .update(influencers)
          .set({ username, updatedAt: new Date() })
          .where(eq(influencers.influencerId, existing[0].influencerId));
      }
      return existing[0].influencerId;
    }
    const [row] = await db
      .insert(influencers)
      .values({ instagramUserId, username: username ?? null })
      .returning({ influencerId: influencers.influencerId });
    return row.influencerId;
  }

  private async ensureDefaultSubscription(influencerId: string): Promise<void> {
    const db = this.requireDb();
    // Import dynamically to avoid circular deps at module load time.
    const { subscriptions } = await import('../../database/schema/billing.schema');
    const existing = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.influencerId, influencerId));
    if (existing.length > 0) return; // already has a subscription
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await db.insert(subscriptions).values({
      influencerId,
      tier: 'creator',
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      locale: 'IN',
    });
  }

  private async upsertSocialAccount(
    influencerId: string,
    input: CompleteOAuthInput,
  ): Promise<void> {
    const db = this.requireDb();
    const enc = this.cipher.encrypt(input.accessToken);
    const existing = await db
      .select()
      .from(influencerSocialAccounts)
      .where(
        and(
          eq(influencerSocialAccounts.influencerId, influencerId),
          eq(influencerSocialAccounts.provider, 'instagram'),
        ),
      );
    if (existing.length > 0) {
      await db
        .update(influencerSocialAccounts)
        .set({
          providerUserId: input.instagramUserId,
          accessToken: enc,
          tokenExpiresAt: input.tokenExpiresAt,
          lastRefreshedAt: null,
          username: input.username ?? existing[0].username,
          isConnected: true,
          connectedAt: new Date(),
          disconnectedAt: null,
        })
        .where(eq(influencerSocialAccounts.id, existing[0].id));
    } else {
      await db.insert(influencerSocialAccounts).values({
        influencerId,
        provider: 'instagram',
        providerUserId: input.instagramUserId,
        accessToken: enc,
        tokenExpiresAt: input.tokenExpiresAt,
        username: input.username ?? null,
      });
    }
  }

  // ── Session reads ──────────────────────────────────────────

  async getSession(sessionId: string): Promise<InfluencerContext | null> {
    if (!sessionId) return null;
    const db = this.requireDb();
    const rows = await db
      .select()
      .from(influencerSessions)
      .where(eq(influencerSessions.sessionId, sessionId));
    if (rows.length === 0) return null;
    const session = rows[0];

    if (this.toDate(session.expiresAt)!.getTime() < Date.now()) {
      await this.remove(sessionId);
      return null;
    }
    if (session.status !== 'authenticated') return null;

    const account = await this.getActiveAccount(session.influencerId);
    const inf = await db
      .select()
      .from(influencers)
      .where(eq(influencers.influencerId, session.influencerId));

    return {
      sessionId: session.sessionId,
      influencerId: session.influencerId,
      instagramUserId: account?.providerUserId ?? inf[0]?.instagramUserId ?? '',
      accessToken: account ? this.cipher.decrypt(account.accessToken) : null,
      tokenExpiresAt: this.toDate(account?.tokenExpiresAt),
      lastRefreshedAt: this.toDate(account?.lastRefreshedAt),
      sessionCreatedAt: this.toDate(session.createdAt) ?? new Date(),
      socialConnectedAt: this.toDate(account?.connectedAt),
      profileCompletionStatus: inf[0]?.profileCompletionStatus ?? 'incomplete',
      email: inf[0]?.email ?? null,
    };
  }

  private async getActiveAccount(influencerId: string): Promise<any | null> {
    const db = this.requireDb();
    const rows = await db
      .select()
      .from(influencerSocialAccounts)
      .where(
        and(
          eq(influencerSocialAccounts.influencerId, influencerId),
          eq(influencerSocialAccounts.isConnected, true),
        ),
      )
      .orderBy(desc(influencerSocialAccounts.connectedAt));
    return rows[0] ?? null;
  }

  async remove(sessionId: string): Promise<void> {
    if (!sessionId) return;
    const db = this.requireDb();
    await db.delete(influencerSessions).where(eq(influencerSessions.sessionId, sessionId));
  }

  async rollSessionExpiry(sessionId: string): Promise<void> {
    const db = this.requireDb();
    await db
      .update(influencerSessions)
      .set({ expiresAt: new Date(Date.now() + env.sessionTtlMs) })
      .where(eq(influencerSessions.sessionId, sessionId));
  }

  // ── Token maintenance (called by MetaTokenService) ─────────

  async updateToken(
    influencerId: string,
    patch: { accessToken: string; tokenExpiresAt: Date | null; lastRefreshedAt: Date },
  ): Promise<void> {
    const db = this.requireDb();
    await db
      .update(influencerSocialAccounts)
      .set({
        accessToken: this.cipher.encrypt(patch.accessToken),
        tokenExpiresAt: patch.tokenExpiresAt,
        lastRefreshedAt: patch.lastRefreshedAt,
      })
      .where(
        and(
          eq(influencerSocialAccounts.influencerId, influencerId),
          eq(influencerSocialAccounts.isConnected, true),
        ),
      );
  }

  // ── Disconnect / invalidate ────────────────────────────────

  async disconnect(influencerId: string): Promise<void> {
    const db = this.requireDb();
    await db
      .update(influencerSocialAccounts)
      .set({ isConnected: false, disconnectedAt: new Date(), accessToken: '' })
      .where(eq(influencerSocialAccounts.influencerId, influencerId));
    await db
      .delete(influencerSessions)
      .where(eq(influencerSessions.influencerId, influencerId));
  }

  async invalidateByInstagramUserId(instagramUserId: string): Promise<void> {
    const db = this.requireDb();
    const rows = await db
      .select()
      .from(influencers)
      .where(eq(influencers.instagramUserId, instagramUserId));
    if (rows.length === 0) return;
    await this.disconnect(rows[0].influencerId);
  }

  async deleteExpired(): Promise<void> {
    const db = this.requireDb();
    await db.delete(influencerSessions).where(lt(influencerSessions.expiresAt, new Date()));
    await db.delete(influencerOauthStates).where(lt(influencerOauthStates.expiresAt, new Date()));
  }
}
