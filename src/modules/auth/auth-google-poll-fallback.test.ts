/**
 * Feature: google-auth-onboarding, Property 4
 *
 * Property 4 — The poll fallback returns the issued session for the flow's
 * poll token.
 * Validates: Requirements 2.1, 2.8
 *
 * There is no test Postgres wired into this project (no DB harness / no CI
 * database), so — following the pattern of influencers-instagram-unique.test.ts
 * — this test drives the REAL `AuthService` against a faithful in-memory
 * double of `InfluencerSessionService` that models the OAuth-state /
 * poll-token handshake exactly as the Drizzle-backed service does:
 *
 *   • createOAuthState issues a distinct { state, pollToken } pair and
 *     persists a handshake row.
 *   • loginWithGoogleIdentity issues a fresh session id.
 *   • attachSessionToState links the issued session to the state row
 *     (resultStatus = 'authenticated').
 *   • pollByToken(token) hands back { status: 'authenticated', sessionId }
 *     exactly ONCE, then consumes (deletes) the row so a second poll returns
 *     'not_found' — the single-use guarantee.
 *
 * The property runs the full flow over generated Google identities:
 *   startGoogleOAuth → (mocked successful) handleGoogleCallback → pollAuth,
 * and asserts the polled session id equals the attached session id and that a
 * second poll no longer returns that session.
 */

import { describe, it, expect } from '@jest/globals';
import fc from 'fast-check';
import { AuthService } from './auth.service';

// ── In-memory double of the OAuth-state / session handshake ──────────────────

interface HandshakeRow {
  state: string;
  pollToken: string;
  webRedirectUri: string | null;
  resultStatus: 'pending' | 'authenticated' | 'error';
  sessionId: string | null;
  expiresAt: number;
}

/**
 * Faithful simulator of InfluencerSessionService's OAuth-state / poll-token
 * plumbing. Only the methods the Google flow touches are implemented; the
 * semantics mirror the Drizzle-backed service (single active session per
 * influencer keyed on google_user_id, single-use poll token).
 */
class FakeSessionService {
  private rows = new Map<string, HandshakeRow>();
  private counter = 0;
  private influencersByGoogleId = new Map<string, string>();
  /** Session ids that currently exist (mirrors the influencer_sessions table). */
  readonly liveSessions = new Set<string>();

  async createOAuthState(
    webRedirectUri?: string | null,
  ): Promise<{ state: string; pollToken: string }> {
    const state = `state_${this.counter}`;
    const pollToken = `poll_${this.counter}`;
    this.counter += 1;
    this.rows.set(state, {
      state,
      pollToken,
      webRedirectUri: webRedirectUri ?? null,
      resultStatus: 'pending',
      sessionId: null,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    return { state, pollToken };
  }

  async getOAuthState(state: string): Promise<{ webRedirectUri: string | null } | null> {
    if (!state) return null;
    const row = this.rows.get(state);
    if (!row) return null;
    return { webRedirectUri: row.webRedirectUri };
  }

  async loginWithGoogleIdentity(input: {
    googleUserId: string;
    email: string | null;
  }): Promise<{ sessionId: string; profileCompletionStatus: 'incomplete' | 'complete' }> {
    // Resolve/create the influencer keyed on google_user_id.
    let influencerId = this.influencersByGoogleId.get(input.googleUserId);
    let status: 'incomplete' | 'complete' = 'incomplete';
    if (!influencerId) {
      influencerId = `inf_${this.influencersByGoogleId.size}`;
      this.influencersByGoogleId.set(input.googleUserId, influencerId);
    } else {
      // Existing influencer keeps whatever status it had; unknown here, keep
      // incomplete for the simulator (session issuance is what matters).
      status = 'incomplete';
    }

    // One active session per influencer: drop prior sessions for this id.
    for (const sid of [...this.liveSessions]) {
      if (sid.startsWith(`${influencerId}:`)) this.liveSessions.delete(sid);
    }
    const sessionId = `${influencerId}:sess_${this.counter}`;
    this.counter += 1;
    this.liveSessions.add(sessionId);
    return { sessionId, profileCompletionStatus: status };
  }

  async attachSessionToState(state: string, sessionId: string): Promise<void> {
    const row = this.rows.get(state);
    if (!row) return;
    row.resultStatus = 'authenticated';
    row.sessionId = sessionId;
  }

  async markStateError(state: string): Promise<void> {
    const row = this.rows.get(state);
    if (!row) return;
    row.resultStatus = 'error';
  }

  async pollByToken(
    pollToken: string,
  ): Promise<{ status: 'pending' | 'authenticated' | 'error' | 'not_found'; sessionId?: string }> {
    if (!pollToken) return { status: 'not_found' };
    const row = [...this.rows.values()].find((r) => r.pollToken === pollToken);
    if (!row) return { status: 'not_found' };

    if (row.expiresAt < Date.now()) {
      this.rows.delete(row.state);
      return { status: 'not_found' };
    }

    if (row.resultStatus === 'authenticated') {
      this.rows.delete(row.state); // single-use: consume the row
      return { status: 'authenticated', sessionId: row.sessionId ?? undefined };
    }
    if (row.resultStatus === 'error') {
      this.rows.delete(row.state);
      return { status: 'error' };
    }
    return { status: 'pending' };
  }
}

// GoogleService double — buildAuthUrl returns a string; exchangeCodeForIdentity
// yields the generated identity so the callback path succeeds.
function makeGoogleService(identity: { googleUserId: string; email: string | null }) {
  return {
    buildAuthUrl: (state: string) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
    exchangeCodeForIdentity: async () => identity,
  };
}

function makeAuthService(
  sessionService: FakeSessionService,
  googleService: ReturnType<typeof makeGoogleService>,
): AuthService {
  // MetaService is unused on the Google path; pass a bare stub.
  return new AuthService(sessionService as any, {} as any, googleService as any);
}

describe('Feature: google-auth-onboarding, Property 4 — poll fallback returns the issued session', () => {
  const identityArb = fc.record({
    googleUserId: fc.string({ minLength: 1, maxLength: 32 }),
    email: fc.option(fc.emailAddress(), { nil: null }),
    code: fc.string({ minLength: 1, maxLength: 24 }),
  });

  // ── Example-based sanity checks ──

  it('delivers the attached session id on the first poll of the flow token', async () => {
    const session = new FakeSessionService();
    const auth = makeAuthService(
      session,
      makeGoogleService({ googleUserId: 'g_1', email: 'a@example.com' }),
    );

    const { state, pollToken } = await auth.startGoogleOAuth('https://app.example.com/cb');
    const callback = await auth.handleGoogleCallback('code_1', state);
    expect(callback.status).toBe('authenticated');

    const first = await auth.pollAuth(pollToken);
    expect(first.status).toBe('authenticated');
    expect(first.sessionId).toBe(callback.sessionId);
  });

  it('consumes the row so a second poll no longer returns the session (single-use)', async () => {
    const session = new FakeSessionService();
    const auth = makeAuthService(
      session,
      makeGoogleService({ googleUserId: 'g_2', email: null }),
    );

    const { state, pollToken } = await auth.startGoogleOAuth(null);
    await auth.handleGoogleCallback('code_2', state);

    const first = await auth.pollAuth(pollToken);
    expect(first.status).toBe('authenticated');

    const second = await auth.pollAuth(pollToken);
    expect(second.status).toBe('not_found');
    expect(second.sessionId).toBeUndefined();
  });

  // ── Property: the poll fallback returns the flow's issued session, once ──

  it('the first poll returns exactly the session attached during the callback', async () => {
    await fc.assert(
      fc.asyncProperty(identityArb, async ({ googleUserId, email, code }) => {
        const session = new FakeSessionService();
        const auth = makeAuthService(session, makeGoogleService({ googleUserId, email }));

        const { state, pollToken } = await auth.startGoogleOAuth('https://app.example.com/cb');
        const callback = await auth.handleGoogleCallback(code, state);

        // The callback issued a session and attached it to the state.
        expect(callback.status).toBe('authenticated');
        expect(callback.sessionId).not.toBeNull();

        // The poll token hands back exactly that session id.
        const first = await auth.pollAuth(pollToken);
        expect(first.status).toBe('authenticated');
        expect(first.sessionId).toBe(callback.sessionId);
        expect(session.liveSessions.has(callback.sessionId as string)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it('the poll token is single-use: a second poll returns not_found', async () => {
    await fc.assert(
      fc.asyncProperty(identityArb, async ({ googleUserId, email, code }) => {
        const session = new FakeSessionService();
        const auth = makeAuthService(session, makeGoogleService({ googleUserId, email }));

        const { state, pollToken } = await auth.startGoogleOAuth(null);
        await auth.handleGoogleCallback(code, state);

        const first = await auth.pollAuth(pollToken);
        expect(first.status).toBe('authenticated');

        const second = await auth.pollAuth(pollToken);
        expect(second.status).toBe('not_found');
        expect(second.sessionId).toBeUndefined();
      }),
      { numRuns: 150 },
    );
  });

  it('distinct concurrent flows each resolve to their own session via their own poll token', async () => {
    await fc.assert(
      fc.asyncProperty(identityArb, identityArb, async (a, b) => {
        const session = new FakeSessionService();

        // Flow A
        const authA = makeAuthService(
          session,
          makeGoogleService({ googleUserId: a.googleUserId, email: a.email }),
        );
        const flowA = await authA.startGoogleOAuth(null);
        const cbA = await authA.handleGoogleCallback(a.code, flowA.state);

        // Flow B (separate identity + service, shared session store)
        const authB = makeAuthService(
          session,
          makeGoogleService({ googleUserId: b.googleUserId, email: b.email }),
        );
        const flowB = await authB.startGoogleOAuth(null);
        const cbB = await authB.handleGoogleCallback(b.code, flowB.state);

        // Each poll token returns its own flow's session id.
        const polledA = await authA.pollAuth(flowA.pollToken);
        const polledB = await authB.pollAuth(flowB.pollToken);
        expect(polledA.sessionId).toBe(cbA.sessionId);
        expect(polledB.sessionId).toBe(cbB.sessionId);
      }),
      { numRuns: 150 },
    );
  });
});
