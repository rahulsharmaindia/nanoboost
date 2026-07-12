/**
 * Feature: google-auth-onboarding, Property 2
 *
 * Property 2 — A missing or unknown state issues no session.
 * Validates: Requirements 2.3
 *
 * `AuthService.handleGoogleCallback(code, state)` loads the stored OAuth
 * handshake via `sessionService.getOAuthState(state)`. When the state is empty
 * or unknown, `getOAuthState` resolves to `null` and the handler MUST return an
 * authentication error WITHOUT doing any session work — no influencer resolved,
 * no session issued, and the code exchange never attempted (Req 2.3).
 *
 * There is no test Postgres wired into this project, so — mirroring
 * `influencers-instagram-unique.test.ts` — this test drives the REAL
 * `AuthService` against faithful in-memory test doubles:
 *
 *   • A fake session service that only knows a fixed set of "known" states.
 *     `getOAuthState` returns null for anything else, and every state-mutating
 *     / session-issuing method increments a counter so we can prove none ran.
 *   • A google service double whose `exchangeCodeForIdentity` throws if it is
 *     ever called — proving the handler bails out before touching Google.
 *
 * Property: over generated empty strings and random unknown state tokens,
 * `handleGoogleCallback` returns `{ status: 'error', sessionId: null }`, the
 * influencer-session count is unchanged, and the code exchange never runs.
 */

import { describe, it, expect } from '@jest/globals';
import fc from 'fast-check';
import { AuthService } from './auth.service';

/**
 * Faithful in-memory double of the parts of `InfluencerSessionService` that
 * `handleGoogleCallback` touches. `getOAuthState` returns a handshake row only
 * for states in `knownStates`; everything else (empty or unknown) resolves to
 * null, exactly as a missing DB row would.
 */
class FakeSessionService {
  /** States the "database" knows about. Empty for the missing-state property. */
  knownStates = new Set<string>();

  /** Number of sessions/influencers issued — must never change on a bad state. */
  sessionCount = 0;

  attachCalls = 0;
  markErrorCalls = 0;
  loginCalls = 0;

  async getOAuthState(
    state: string,
  ): Promise<{ webRedirectUri: string | null } | null> {
    if (state && this.knownStates.has(state)) {
      return { webRedirectUri: null };
    }
    return null;
  }

  async loginWithGoogleIdentity(_input: {
    googleUserId: string;
    email: string | null;
  }): Promise<{ sessionId: string; profileCompletionStatus: 'incomplete' | 'complete' }> {
    this.loginCalls += 1;
    this.sessionCount += 1;
    return { sessionId: `session_${this.sessionCount}`, profileCompletionStatus: 'incomplete' };
  }

  async attachSessionToState(_state: string, _sessionId: string): Promise<void> {
    this.attachCalls += 1;
  }

  async markStateError(_state: string): Promise<void> {
    this.markErrorCalls += 1;
  }
}

/**
 * Google service double. If `handleGoogleCallback` ever reaches the code
 * exchange for a missing/unknown state, this throws and fails the test — the
 * handler must short-circuit on the null state before calling Google.
 */
class FakeGoogleService {
  exchangeCalls = 0;

  buildAuthUrl(state: string): string {
    return `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`;
  }

  async exchangeCodeForIdentity(
    _code: string,
  ): Promise<{ googleUserId: string; email: string | null }> {
    this.exchangeCalls += 1;
    throw new Error('exchangeCodeForIdentity must not be called for a missing/unknown state');
  }
}

function buildService(): {
  service: AuthService;
  session: FakeSessionService;
  google: FakeGoogleService;
} {
  const session = new FakeSessionService();
  const google = new FakeGoogleService();
  // metaService is unused by the Google callback path.
  const service = new AuthService(session as any, {} as any, google as any);
  return { service, session, google };
}

describe('Feature: google-auth-onboarding, Property 2 — missing/unknown state issues no session', () => {
  // ── Example-based edge cases ──

  it('returns an auth error for an empty state and issues no session', async () => {
    const { service, session, google } = buildService();
    const result = await service.handleGoogleCallback('any-code', '');
    expect(result).toEqual({ status: 'error', sessionId: null });
    expect(session.sessionCount).toBe(0);
    expect(session.loginCalls).toBe(0);
    expect(session.attachCalls).toBe(0);
    expect(google.exchangeCalls).toBe(0);
  });

  it('returns an auth error for an unknown state token and issues no session', async () => {
    const { service, session, google } = buildService();
    const result = await service.handleGoogleCallback('any-code', 'totally-unknown-state');
    expect(result).toEqual({ status: 'error', sessionId: null });
    expect(session.sessionCount).toBe(0);
    expect(google.exchangeCalls).toBe(0);
  });

  it('does not mark a non-existent state errored (nothing to mark)', async () => {
    const { service, session } = buildService();
    await service.handleGoogleCallback('any-code', 'unknown');
    // The handler returns before the try/catch, so markStateError never runs.
    expect(session.markErrorCalls).toBe(0);
  });

  // ── Property: any empty or unknown state issues no session ──

  it('issues no session for any generated empty or unknown state', async () => {
    // Generate either the empty string or arbitrary non-empty "unknown" tokens.
    const stateArb = fc.oneof(
      fc.constant(''),
      fc.string(),
      fc.string({ minLength: 1, maxLength: 64 }),
      fc.uuid(),
    );
    const codeArb = fc.string();

    await fc.assert(
      fc.asyncProperty(stateArb, codeArb, async (state, code) => {
        const { service, session, google } = buildService();
        // The fake knows NO states, so every generated state is "unknown".
        const sessionCountBefore = session.sessionCount;

        const result = await service.handleGoogleCallback(code, state);

        // Req 2.3 — authentication error, no session id.
        expect(result.status).toBe('error');
        expect(result.sessionId).toBeNull();
        // The influencer-session count is unchanged.
        expect(session.sessionCount).toBe(sessionCountBefore);
        expect(session.loginCalls).toBe(0);
        expect(session.attachCalls).toBe(0);
        // The code exchange was never attempted.
        expect(google.exchangeCalls).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  it('still issues no session even when other unrelated states exist in the store', async () => {
    // Populate the store with some known states, then probe with states that
    // are guaranteed NOT to be among them.
    const knownArb = fc.array(fc.uuid(), { minLength: 1, maxLength: 10 });
    const probeArb = fc.oneof(fc.constant(''), fc.string({ minLength: 1, maxLength: 40 }));

    await fc.assert(
      fc.asyncProperty(knownArb, probeArb, async (known, probeRaw) => {
        const { service, session, google } = buildService();
        for (const s of known) session.knownStates.add(s);
        // Ensure the probe is not accidentally a known state.
        const probe = session.knownStates.has(probeRaw) ? `${probeRaw}-x` : probeRaw;

        const result = await service.handleGoogleCallback('code', probe);

        expect(result).toEqual({ status: 'error', sessionId: null });
        expect(session.sessionCount).toBe(0);
        expect(session.loginCalls).toBe(0);
        expect(google.exchangeCalls).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});
