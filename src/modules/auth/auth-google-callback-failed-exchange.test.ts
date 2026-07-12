/**
 * Feature: google-auth-onboarding, Property 3
 *
 * Property 3 — A failed Google code exchange issues no session.
 * Validates: Requirements 2.4
 *
 * This project has no test Postgres harness, so instead of a live database we
 * drive the real `AuthService.handleGoogleCallback` against faithful in-memory
 * test doubles (mirroring the approach in
 * `database/schema/influencers-instagram-unique.test.ts`):
 *
 *   - a fake InfluencerSessionService whose `getOAuthState` returns a known,
 *     valid OAuth state, that records every `markStateError` call, tracks the
 *     issued-session count, and FAILS the test if `loginWithGoogleIdentity`
 *     (session issuance) is ever reached; and
 *   - a GoogleService double whose `exchangeCodeForIdentity` always throws
 *     (a `ProviderError`) for the generated code + error message.
 *
 * The property: over arbitrary authorization codes and thrown-error messages,
 * a failed exchange on a KNOWN state must (a) return an auth error with a null
 * session id, (b) mark the state errored, (c) never issue a session, and
 * (d) leave the influencer-session count unchanged.
 */

import { describe, it, expect } from '@jest/globals';
import fc from 'fast-check';
import { AuthService } from './auth.service';
import { ProviderError } from '../../common/errors/app.errors';

const KNOWN_STATE = 'known-oauth-state';

/**
 * Faithful in-memory stand-in for InfluencerSessionService. Only the surface
 * used by `handleGoogleCallback` is implemented; anything that would issue a
 * session is instrumented so the property can assert it is never reached.
 */
class FakeSessionService {
  /** Number of influencer sessions that have been issued. */
  sessionCount = 0;
  /** States that were marked errored, in call order. */
  erroredStates: string[] = [];
  /** Whether session issuance was (incorrectly) attempted. */
  loginCalled = false;
  /** Whether the session was (incorrectly) attached to a state. */
  attachCalled = false;

  async getOAuthState(state: string): Promise<{ state: string; webRedirectUri: string | null } | null> {
    // The known state resolves; everything else is unknown.
    return state === KNOWN_STATE ? { state, webRedirectUri: null } : null;
  }

  async loginWithGoogleIdentity(_input: {
    googleUserId: string;
    email: string | null;
  }): Promise<{ sessionId: string; profileCompletionStatus: 'incomplete' | 'complete' }> {
    // Reaching here means a session was issued despite a failed exchange.
    this.loginCalled = true;
    this.sessionCount += 1;
    return { sessionId: `session-${this.sessionCount}`, profileCompletionStatus: 'incomplete' };
  }

  async attachSessionToState(_state: string, _sessionId: string): Promise<void> {
    this.attachCalled = true;
  }

  async markStateError(state: string): Promise<void> {
    this.erroredStates.push(state);
  }
}

/** GoogleService double whose code exchange always fails. */
class ThrowingGoogleService {
  constructor(private readonly message: string) {}

  async exchangeCodeForIdentity(_code: string): Promise<{ googleUserId: string; email: string | null }> {
    throw new ProviderError(this.message);
  }
}

function buildAuthService(googleService: ThrowingGoogleService): {
  service: AuthService;
  session: FakeSessionService;
} {
  const session = new FakeSessionService();
  // metaService is unused on the Google path; a bare object satisfies the ctor.
  const service = new AuthService(session as any, {} as any, googleService as any);
  return { service, session };
}

describe('Feature: google-auth-onboarding, Property 3 — failed Google code exchange issues no session', () => {
  // ── Example-based edge cases ──

  it('returns an auth error and marks the state errored when the exchange throws', async () => {
    const { service, session } = buildAuthService(new ThrowingGoogleService('boom'));

    const result = await service.handleGoogleCallback('some-code', KNOWN_STATE);

    expect(result.status).toBe('error');
    expect(result.sessionId).toBeNull();
    expect(session.erroredStates).toEqual([KNOWN_STATE]);
    expect(session.loginCalled).toBe(false);
    expect(session.attachCalled).toBe(false);
    expect(session.sessionCount).toBe(0);
  });

  // ── Property: any failed exchange on a known state issues no session ──

  it('over arbitrary codes and error messages, issues no session and marks the state errored', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 64 }),
        fc.string({ minLength: 1, maxLength: 64 }),
        async (code, errorMessage) => {
          const { service, session } = buildAuthService(new ThrowingGoogleService(errorMessage));
          const before = session.sessionCount;

          const result = await service.handleGoogleCallback(code, KNOWN_STATE);

          // (a) auth error with a null session id
          expect(result.status).toBe('error');
          expect(result.sessionId).toBeNull();
          // (b) the state was marked errored (exactly once, with the known state)
          expect(session.erroredStates).toEqual([KNOWN_STATE]);
          // (c) no session was ever issued or attached
          expect(session.loginCalled).toBe(false);
          expect(session.attachCalled).toBe(false);
          // (d) the session count is unchanged
          expect(session.sessionCount).toBe(before);
        },
      ),
      { numRuns: 100 },
    );
  });
});
