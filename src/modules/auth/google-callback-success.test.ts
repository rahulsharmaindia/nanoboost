/**
 * Feature: google-auth-onboarding, Property 1
 *
 * Property 1 — A successful Google callback creates the influencer, stores the
 * email unverified, issues a session, and attaches it to the state.
 * Validates: Requirements 2.2, 2.5, 2.6, 2.7, 2.9, 3.5, 3.8
 *
 * *For any* successful Google authorization code exchange whose retrieved
 * account id has no existing influencer, `handleGoogleCallback` SHALL create
 * exactly one influencer record whose `profile_completion_status` is
 * `incomplete`, whose `email` equals the email retrieved from Google, and whose
 * `email_verification_status` is `unverified`; SHALL issue an active influencer
 * session; SHALL attach that session's id to the callback's `OAuth_State`; and
 * the status subsequently reported SHALL equal the influencer's persisted
 * `profile_completion_status`.
 *
 * There is no test Postgres wired into this project (see jest.config.js and the
 * existing influencers-instagram-unique.test.ts, which uses fast-check with an
 * in-memory simulation). So this test constructs the real `AuthService` with an
 * in-memory `InfluencerSessionService` double that faithfully mirrors
 * `loginWithGoogleIdentity`/`getOAuthState`/`attachSessionToState`/
 * `markStateError`, and a `GoogleService` double whose
 * `exchangeCodeForIdentity` yields a generated `{ googleUserId, email }`. The
 * property then drives `handleGoogleCallback` over a known state and asserts the
 * persisted effects.
 */

import { describe, it, expect, jest } from '@jest/globals';
import fc from 'fast-check';
import { AuthService } from './auth.service';

// ── In-memory row shapes (mirroring the real Drizzle tables) ──

interface InfluencerRow {
  influencerId: string;
  googleUserId: string | null;
  email: string | null;
  emailVerificationStatus: 'unverified' | 'verified';
  contactVerificationStatus: 'unverified' | 'verified';
  profileCompletionStatus: 'incomplete' | 'complete';
}

interface SessionRow {
  sessionId: string;
  influencerId: string;
  status: string;
  expiresAt: Date;
}

interface OAuthStateRow {
  state: string;
  pollToken: string;
  webRedirectUri: string | null;
  resultStatus: string | null;
  sessionId: string | null;
  expiresAt: Date;
}

/**
 * Faithful in-memory double of `InfluencerSessionService` for the two Google
 * paths `AuthService.handleGoogleCallback` exercises. It reproduces the real
 * `loginWithGoogleIdentity` semantics: resolve-or-create by google_user_id,
 * new influencers default to `incomplete` with the Google email stored and
 * `email_verification_status = 'unverified'`, then replace the active session
 * (one active session per influencer) and issue a fresh one.
 */
class FakeSessionService {
  influencers: InfluencerRow[] = [];
  sessions: SessionRow[] = [];
  states = new Map<string, OAuthStateRow>();
  private counter = 0;

  seedState(state: string): void {
    this.states.set(state, {
      state,
      pollToken: `poll_${state}`,
      webRedirectUri: null,
      resultStatus: null,
      sessionId: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  }

  async getOAuthState(
    state: string,
  ): Promise<{ webRedirectUri: string | null } | null> {
    if (!state) return null;
    const row = this.states.get(state);
    if (!row) return null;
    return { webRedirectUri: row.webRedirectUri };
  }

  async loginWithGoogleIdentity(input: {
    googleUserId: string;
    email: string | null;
  }): Promise<{
    sessionId: string;
    profileCompletionStatus: 'incomplete' | 'complete';
  }> {
    // Resolve existing influencer by google_user_id, else create one with
    // profile_completion_status defaulting to 'incomplete'.
    let inf = this.influencers.find(
      (i) => i.googleUserId === input.googleUserId,
    );
    if (!inf) {
      inf = {
        influencerId: `inf_${this.counter++}`,
        googleUserId: input.googleUserId,
        email: input.email, // Req 2.6 — store the Google email
        emailVerificationStatus: 'unverified', // Req 2.6 / 3.8
        contactVerificationStatus: 'unverified',
        profileCompletionStatus: 'incomplete', // Req 2.5 / 3.5
      };
      this.influencers.push(inf);
    }

    // Replace any existing active session (one active session per influencer).
    this.sessions = this.sessions.filter(
      (s) => s.influencerId !== inf!.influencerId,
    );
    const session: SessionRow = {
      sessionId: `sess_${this.counter++}`,
      influencerId: inf.influencerId,
      status: 'authenticated',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
    this.sessions.push(session);

    return {
      sessionId: session.sessionId,
      profileCompletionStatus: inf.profileCompletionStatus,
    };
  }

  async attachSessionToState(state: string, sessionId: string): Promise<void> {
    const row = this.states.get(state);
    if (row) {
      row.resultStatus = 'authenticated';
      row.sessionId = sessionId;
    }
  }

  async markStateError(state: string): Promise<void> {
    const row = this.states.get(state);
    if (row) row.resultStatus = 'error';
  }
}

describe('Feature: google-auth-onboarding, Property 1 — successful Google callback', () => {
  const KNOWN_STATE = 'known_oauth_state_abc123';

  // Generated Google identity: a non-empty account id (the `sub` claim) and an
  // email that may be a real address or null (Google may withhold it).
  const identityArb = fc.record({
    googleUserId: fc.string({ minLength: 1, maxLength: 32 }),
    email: fc.option(fc.emailAddress(), { nil: null }),
  });
  const codeArb = fc.string({ minLength: 1, maxLength: 48 });

  it('creates one incomplete influencer with the email stored unverified, issues a session, and attaches it to the state', async () => {
    await fc.assert(
      fc.asyncProperty(
        identityArb,
        codeArb,
        async (identity, code) => {
          // Fresh doubles per run for isolation.
          const fakeSession = new FakeSessionService();
          fakeSession.seedState(KNOWN_STATE);
          const fakeGoogle = {
            exchangeCodeForIdentity: jest.fn(
              async (_code: string) => identity,
            ),
          };
          const loginSpy = jest.spyOn(fakeSession, 'loginWithGoogleIdentity');

          const service = new AuthService(
            fakeSession as any,
            {} as any, // MetaService — unused on the Google path
            fakeGoogle as any,
          );

          const result = await service.handleGoogleCallback(code, KNOWN_STATE);

          // Google code exchange was driven with the callback's code (Req 2.2).
          expect(fakeGoogle.exchangeCodeForIdentity).toHaveBeenCalledWith(code);

          // Reported flow status is authenticated with a session id (Req 2.7).
          expect(result.status).toBe('authenticated');
          expect(result.sessionId).toBeTruthy();

          // Exactly one influencer created (Req 2.5).
          expect(fakeSession.influencers).toHaveLength(1);
          const inf = fakeSession.influencers[0];
          expect(inf.googleUserId).toBe(identity.googleUserId);

          // Defaults to incomplete (Req 2.5 / 3.5).
          expect(inf.profileCompletionStatus).toBe('incomplete');

          // Email equals the retrieved email, stored unverified (Req 2.6 / 3.8).
          expect(inf.email).toBe(identity.email);
          expect(inf.emailVerificationStatus).toBe('unverified');

          // Exactly one active session issued, matching the reported id (Req 2.7).
          const active = fakeSession.sessions.filter(
            (s) => s.status === 'authenticated',
          );
          expect(active).toHaveLength(1);
          expect(active[0].sessionId).toBe(result.sessionId);
          expect(active[0].influencerId).toBe(inf.influencerId);

          // Session id attached to the OAuth state (Req 2.7).
          const stateRow = fakeSession.states.get(KNOWN_STATE)!;
          expect(stateRow.resultStatus).toBe('authenticated');
          expect(stateRow.sessionId).toBe(result.sessionId);

          // The status reported by the session service equals the influencer's
          // persisted profile_completion_status (Req 2.9).
          const reported = (await loginSpy.mock.results[0]!.value) as {
            profileCompletionStatus: 'incomplete' | 'complete';
          };
          expect(reported.profileCompletionStatus).toBe(
            inf.profileCompletionStatus,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
