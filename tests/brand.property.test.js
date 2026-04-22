// ── Brand registration & auth property tests (fast-check) ────
// Properties 5–10 from the brand-registration spec

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const request = require('supertest');
const app = require('../src/app');
const sessionStore = require('../src/services/session');

// ── Arbitraries ──────────────────────────────────────────────

const INDUSTRIES = [
  'Fashion', 'Beauty', 'Food & Beverage', 'Technology',
  'Health & Fitness', 'Travel', 'Entertainment', 'Education',
  'Finance', 'Other',
];

/** 3-30 alphanumeric/underscore characters */
const ALNUM_UNDERSCORE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_';
const arbBusinessId = fc
  .array(fc.constantFrom(...ALNUM_UNDERSCORE.split('')), { minLength: 3, maxLength: 30 })
  .map(chars => chars.join(''));

/** Min 6 printable ASCII characters */
const arbPassword = fc.string({ minLength: 6, maxLength: 40 }).filter(s => s.trim().length >= 6);

/** A valid brand registration payload */
const arbValidPayload = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  logo: fc.constant('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='),
  industry: fc.constantFrom(...INDUSTRIES),
  website: fc.option(fc.webUrl(), { nil: undefined }),
  description: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
  businessId: arbBusinessId,
  password: arbPassword,
});

// ── Helpers ──────────────────────────────────────────────────

/** Clear all sessions between tests */
function clearSessions() {
  // The session store uses a Map internally — we iterate and remove all
  // We use findBy to discover sessions and remove them
  let found;
  do {
    found = sessionStore.findBy(() => true);
    if (found) sessionStore.remove(found.id);
  } while (found);
}

/** Register a brand and return the response */
async function registerBrand(payload) {
  return request(app)
    .post('/api/brand/register')
    .send(payload)
    .set('Content-Type', 'application/json');
}

// ── Tests ────────────────────────────────────────────────────


describe('Feature: brand-registration', () => {

  beforeEach(() => {
    clearSessions();
  });

  // ── Property 5: Brand registration data round-trip ─────────
  // **Validates: Requirements 6.2, 6.4**
  it('Property 5: registration round-trip — POST register then GET brand returns matching data', async () => {
    await fc.assert(
      fc.asyncProperty(arbValidPayload, async (payload) => {
        clearSessions();

        // Register
        const regRes = await registerBrand(payload);
        assert.equal(regRes.status, 200, `Expected 200, got ${regRes.status}: ${JSON.stringify(regRes.body)}`);
        assert.ok(regRes.body.sessionId, 'Response must include sessionId');
        assert.ok(regRes.body.brandData, 'Response must include brandData');

        const { sessionId, brandData } = regRes.body;

        // Verify brandData matches input
        assert.equal(brandData.name, payload.name);
        assert.equal(brandData.logo, payload.logo);
        assert.equal(brandData.industry, payload.industry);
        assert.equal(brandData.website, payload.website || null);
        assert.equal(brandData.description, payload.description || null);
        assert.ok(brandData.registeredAt, 'brandData must include registeredAt');

        // GET brand using the returned sessionId
        const getRes = await request(app)
          .get('/api/brand')
          .query({ session_id: sessionId });

        assert.equal(getRes.status, 200);
        assert.equal(getRes.body.name, payload.name);
        assert.equal(getRes.body.logo, payload.logo);
        assert.equal(getRes.body.industry, payload.industry);
        assert.equal(getRes.body.website, payload.website || null);
        assert.equal(getRes.body.description, payload.description || null);
      }),
      { numRuns: 5 },
    );
  });

  // ── Property 6: Server rejects incomplete registration payloads ─
  // **Validates: Requirements 6.2, 6.4**
  it('Property 6: incomplete payload — missing any required field returns 400', async () => {
    const requiredFields = ['name', 'logo', 'industry', 'businessId', 'password'];

    await fc.assert(
      fc.asyncProperty(
        arbValidPayload,
        fc.constantFrom(...requiredFields),
        async (payload, fieldToRemove) => {
          clearSessions();

          const incomplete = { ...payload };
          delete incomplete[fieldToRemove];

          const res = await registerBrand(incomplete);
          assert.equal(res.status, 400, `Removing '${fieldToRemove}' should give 400, got ${res.status}`);
          assert.ok(res.body.error, 'Error response must include error message');
          assert.ok(
            res.body.error.includes(fieldToRemove),
            `Error message should mention '${fieldToRemove}': ${res.body.error}`,
          );
        },
      ),
      { numRuns: 5 },
    );
  });

  // ── Property 7: Business login round-trip ──────────────────
  // **Validates: Requirements 6.6, 6.7**
  it('Property 7: login round-trip — register then login with same credentials returns matching brandData', async () => {
    await fc.assert(
      fc.asyncProperty(arbValidPayload, async (payload) => {
        clearSessions();

        // Register first
        const regRes = await registerBrand(payload);
        assert.equal(regRes.status, 200);

        // Login with same credentials
        const loginRes = await request(app)
          .post('/api/brand/login')
          .send({ businessId: payload.businessId, password: payload.password })
          .set('Content-Type', 'application/json');

        assert.equal(loginRes.status, 200, `Login should return 200, got ${loginRes.status}`);
        assert.ok(loginRes.body.sessionId, 'Login response must include sessionId');
        assert.ok(loginRes.body.brandData, 'Login response must include brandData');

        // brandData from login should match registration
        const loginBrand = loginRes.body.brandData;
        assert.equal(loginBrand.name, payload.name);
        assert.equal(loginBrand.logo, payload.logo);
        assert.equal(loginBrand.industry, payload.industry);
        assert.equal(loginBrand.website, payload.website || null);
        assert.equal(loginBrand.description, payload.description || null);
      }),
      { numRuns: 5 },
    );
  });

  // ── Property 8: Login rejects wrong password ───────────────
  // **Validates: Requirements 6.8**
  it('Property 8: wrong password — login with correct businessId but different password returns 401', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidPayload,
        arbPassword,
        async (payload, wrongPassword) => {
          // Ensure the wrong password is actually different
          fc.pre(wrongPassword !== payload.password);

          clearSessions();

          // Register
          const regRes = await registerBrand(payload);
          assert.equal(regRes.status, 200);

          // Login with wrong password
          const loginRes = await request(app)
            .post('/api/brand/login')
            .send({ businessId: payload.businessId, password: wrongPassword })
            .set('Content-Type', 'application/json');

          assert.equal(loginRes.status, 401, `Wrong password should give 401, got ${loginRes.status}`);
          assert.equal(loginRes.body.error, 'Invalid credentials');
        },
      ),
      { numRuns: 5 },
    );
  });

  // ── Property 9: BusinessId uniqueness ──────────────────────
  // **Validates: Requirements 6.5**
  it('Property 9: businessId uniqueness — second registration with same businessId returns 409', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidPayload,
        arbValidPayload,
        async (payload1, payload2) => {
          clearSessions();

          // Force same businessId on both payloads
          const sharedBusinessId = payload1.businessId;
          const second = { ...payload2, businessId: sharedBusinessId };

          // First registration should succeed
          const res1 = await registerBrand(payload1);
          assert.equal(res1.status, 200, `First registration should succeed, got ${res1.status}`);

          // Second registration with same businessId should fail with 409
          const res2 = await registerBrand(second);
          assert.equal(res2.status, 409, `Duplicate businessId should give 409, got ${res2.status}`);
          assert.equal(res2.body.error, 'Business ID already taken');
        },
      ),
      { numRuns: 5 },
    );
  });

  // ── Property 10: Password never in responses ───────────────
  // **Validates: Requirements 6.10**
  it('Property 10: password never in responses — registration and login responses exclude password fields', async () => {
    await fc.assert(
      fc.asyncProperty(arbValidPayload, async (payload) => {
        clearSessions();

        // Check registration response
        const regRes = await registerBrand(payload);
        assert.equal(regRes.status, 200);

        const regBody = JSON.stringify(regRes.body);
        assert.equal(regRes.body.password, undefined, 'Registration response must not contain password');
        assert.equal(regRes.body.hashedPassword, undefined, 'Registration response must not contain hashedPassword');
        assert.equal(regRes.body.brandData?.password, undefined, 'brandData must not contain password');
        assert.equal(regRes.body.brandData?.hashedPassword, undefined, 'brandData must not contain hashedPassword');

        // Check login response
        const loginRes = await request(app)
          .post('/api/brand/login')
          .send({ businessId: payload.businessId, password: payload.password })
          .set('Content-Type', 'application/json');

        assert.equal(loginRes.status, 200);
        assert.equal(loginRes.body.password, undefined, 'Login response must not contain password');
        assert.equal(loginRes.body.hashedPassword, undefined, 'Login response must not contain hashedPassword');
        assert.equal(loginRes.body.brandData?.password, undefined, 'Login brandData must not contain password');
        assert.equal(loginRes.body.brandData?.hashedPassword, undefined, 'Login brandData must not contain hashedPassword');

        // Also check GET /api/brand response
        const getRes = await request(app)
          .get('/api/brand')
          .query({ session_id: loginRes.body.sessionId });

        assert.equal(getRes.status, 200);
        assert.equal(getRes.body.password, undefined, 'GET brand must not contain password');
        assert.equal(getRes.body.hashedPassword, undefined, 'GET brand must not contain hashedPassword');
      }),
      { numRuns: 5 },
    );
  });

});
