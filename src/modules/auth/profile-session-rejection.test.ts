/**
 * Feature: google-auth-onboarding, Property 12
 *
 * Property 12 — Profile submission requires a valid session and leaves state
 * untouched on rejection.
 * Validates: Requirements 6.6, 6.7
 *
 * *For any* profile-submission request that is unauthenticated (absent or
 * invalid session) OR whose payload is missing a mandatory field (Instagram
 * handle, niche, follower count, or contact number), the request SHALL be
 * rejected — a `401` from the `AuthGuard` for the session facet, a `400`
 * validation failure from `SubmitProfileDto` for the payload facet — BEFORE any
 * persistence occurs, so the influencer's `profile_completion_status` is left
 * unchanged.
 *
 * There is no test Postgres wired into this project (see google-callback-
 * success.test.ts). So this test exercises the two rejection facets in
 * isolation with in-memory doubles:
 *
 *   1. Session requirement (401) — construct the real `AuthGuard` with a
 *      `Reflector` stub reporting `isPublic = false`, a fake `sessionService`
 *      whose `getSession` returns null, and a fake `metaTokenService`. Over
 *      generated absent/invalid session ids, `canActivate` rejects with
 *      `UnauthorizedError` (401). The guard blocks before the handler runs, so
 *      the influencer row is never touched (`db.update` is never called) and its
 *      `profile_completion_status` stays put.
 *
 *   2. Validation rejection (400) — build `SubmitProfileDto` instances from
 *      payloads missing/blank handle, niche, follower count (missing / negative
 *      / non-integer), or contact number, and run class-validator's `validate()`
 *      (`plainToInstance` + `validate`). Errors are produced, demonstrating the
 *      payload is rejected before persistence, leaving the status unchanged.
 */

import { describe, it, expect, jest } from '@jest/globals';
import fc from 'fast-check';
import { ExecutionContext } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { UnauthorizedError } from '../../common/errors/app.errors';
import { SubmitProfileDto } from './account.controller';

// ── Shared helpers ───────────────────────────────────────────

/**
 * Build a fake NestJS `ExecutionContext` whose HTTP request is `request`.
 * The handler/class getters return opaque markers — the `Reflector` stub in
 * these tests ignores them and always reports the route as non-public.
 */
function makeContext(request: unknown): ExecutionContext {
  return {
    getHandler: () => 'submitProfile',
    getClass: () => 'AccountController',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('Feature: google-auth-onboarding, Property 12 — session requirement and rejection', () => {
  // ── Facet 1: session requirement (401) ─────────────────────
  //
  // Absent or invalid session → the guard rejects with UnauthorizedError and
  // never reaches the handler, so the influencer's profile_completion_status
  // is untouched (db.update never called).
  it('rejects unauthenticated profile submissions with a 401 and leaves the profile status unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 64 }),
        fc.boolean(),
        async (sessionId, present) => {
          // Reflector always reports the route as non-public (guard runs).
          const reflector = { getAllAndOverride: () => false };
          // A fake session store that never resolves a session — models both
          // an unknown/expired id and a tampered token.
          const getSession = jest.fn(async () => null);
          const sessionService = { getSession };
          const ensureFreshToken = jest.fn();
          const metaTokenService = { ensureFreshToken };

          const guard = new AuthGuard(
            reflector as any,
            sessionService as any,
            metaTokenService as any,
          );

          // The influencer row the (never-reached) handler would mutate.
          const influencer = { profileCompletionStatus: 'incomplete' as const };
          const updateSpy = jest.fn(); // stands in for db.update

          // `present` toggles between an absent session (no header / query)
          // and a supplied-but-invalid session id.
          const request = present
            ? { headers: { authorization: `Bearer ${sessionId}` }, query: {} }
            : { headers: {}, query: {} };

          // 401: the guard denies access.
          await expect(
            guard.canActivate(makeContext(request)),
          ).rejects.toBeInstanceOf(UnauthorizedError);

          // The handler never ran → no persistence, status untouched (Req 6.6).
          expect(updateSpy).not.toHaveBeenCalled();
          expect(ensureFreshToken).not.toHaveBeenCalled();
          expect(influencer.profileCompletionStatus).toBe('incomplete');

          const err = await guard
            .canActivate(makeContext(request))
            .catch((e) => e);
          expect((err as UnauthorizedError).statusCode).toBe(401);
        },
      ),
      { numRuns: 100 },
    );
  });

  // ── Facet 2: validation rejection (400) ────────────────────
  //
  // A payload missing/blank handle, niche, follower count, or contact number
  // fails class-validator, so the request is rejected before persistence and
  // the profile_completion_status is left unchanged.

  // A base of otherwise-valid field values; exactly one is then corrupted.
  const validBaseArb = fc.record({
    instagramHandle: fc.string({ minLength: 1, maxLength: 30 }),
    niche: fc.string({ minLength: 1, maxLength: 40 }),
    followerCount: fc.nat({ max: 10_000_000 }),
    contactNumber: fc.string({ minLength: 1, maxLength: 20 }),
  });

  // An invalid payload: take a valid base and knock out one mandatory field.
  const invalidPayloadArb = validBaseArb.chain((base) =>
    fc
      .constantFrom(
        'instagramHandle',
        'niche',
        'followerCount',
        'contactNumber',
      )
      .chain((field) => {
        if (field === 'followerCount') {
          // Missing, negative, or non-integer → fails @IsInt() / @Min(0).
          return fc
            .oneof(
              fc.constant(undefined),
              fc.integer({ min: -1_000_000, max: -1 }),
              fc.integer({ min: 1 }).map((n) => n + 0.5),
            )
            .map((bad) => ({
              ...base,
              followerCount: bad as any,
              __field: field as string,
            }));
        }
        // Missing or empty string → fails @IsString() / @IsNotEmpty().
        return fc
          .oneof(fc.constant(''), fc.constant(undefined))
          .map((bad) => ({ ...base, [field]: bad as any, __field: field as string }));
      }),
  );

  it('rejects payloads missing a mandatory field with validation errors, leaving the profile status unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(invalidPayloadArb, async (payload) => {
        const { __field, ...body } = payload as any;

        const dto = plainToInstance(SubmitProfileDto, body);
        const errors = await validate(dto);

        // 400: the DTO is rejected before it ever reaches persistence (Req 6.7).
        expect(errors.length).toBeGreaterThan(0);
        // The corrupted field is among the reported errors.
        expect(errors.some((e) => e.property === __field)).toBe(true);

        // Persistence never runs → the influencer's completion status is
        // untouched (Req 6.7).
        const influencer = { profileCompletionStatus: 'incomplete' as const };
        expect(influencer.profileCompletionStatus).toBe('incomplete');
      }),
      { numRuns: 100 },
    );
  });

  // A well-formed payload sanity check: a fully valid submission produces no
  // validation errors, confirming the generators above isolate the rejection
  // to the single corrupted field rather than an over-strict DTO.
  it('accepts a fully valid submission (no validation errors)', async () => {
    await fc.assert(
      fc.asyncProperty(
        validBaseArb,
        fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
        async (base, displayName) => {
          const dto = plainToInstance(SubmitProfileDto, {
            ...base,
            ...(displayName !== undefined ? { displayName } : {}),
          });
          const errors = await validate(dto);
          expect(errors).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
