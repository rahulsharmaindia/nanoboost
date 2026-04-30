// ── Campaign property tests (fast-check) ────────────────────
// Properties 1–10 from the campaign-management spec

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const request = require('supertest');
const app = require('../src/app');
const sessionStore = require('../src/services/session');

// ── Arbitraries ──────────────────────────────────────────────

const OBJECTIVES = ['Brand Awareness', 'Product Promotion', 'App Install', 'Lead Generation', 'Event Promotion'];
const CAMPAIGN_TYPES = ['Promotion', 'UGC', 'Review', 'Giveaway'];
const GENDERS = ['Male', 'Female', 'All'];
const PAYMENT_MODELS = ['Fixed', 'Commission', 'Barter'];
const NICHES = ['Fashion', 'Fitness', 'Tech', 'Beauty', 'Travel', 'Food', 'Lifestyle', 'Health', 'Education', 'Entertainment', 'Other'];

const REQUIRED_FIELDS = [
  'title', 'description', 'objective', 'campaignType',
  'ageGroupMin', 'ageGroupMax', 'gender', 'targetLocation',
  'totalBudget', 'budgetPerCreator', 'paymentModel',
  'startDate', 'endDate', 'applicationDeadline',
  'submissionDeadline', 'contentDeadline',
  'minimumFollowers', 'requiredEngagementRate', 'preferredNiche',
  'totalSlots',
];

/**
 * Generates a valid campaign payload with all required fields and valid constraints.
 * Uses future dates to satisfy all date ordering rules.
 */
const arbValidCampaignPayload = fc.record({
  title: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  description: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
  objective: fc.constantFrom(...OBJECTIVES),
  campaignType: fc.constantFrom(...CAMPAIGN_TYPES),
  ageGroupMin: fc.integer({ min: 13, max: 40 }),
  ageGroupMax: fc.integer({ min: 41, max: 65 }),
  gender: fc.constantFrom(...GENDERS),
  targetLocation: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
  totalBudget: fc.integer({ min: 1000, max: 100000 }),
  budgetPerCreator: fc.integer({ min: 100, max: 999 }),
  paymentModel: fc.constantFrom(...PAYMENT_MODELS),
  minimumFollowers: fc.integer({ min: 100, max: 100000 }),
  requiredEngagementRate: fc.double({ min: 0.1, max: 99.9, noNaN: true }),
  preferredNiche: fc.constantFrom(...NICHES),
  totalSlots: fc.integer({ min: 1, max: 50 }),
  // Dates: applicationDeadline < startDate < contentDeadline <= submissionDeadline <= endDate
  dayOffset: fc.integer({ min: 30, max: 200 }),
}).map(r => {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const offset = r.dayOffset;

  const applicationDeadline = new Date(base.getTime() + offset * 86400000);
  const startDate = new Date(applicationDeadline.getTime() + 5 * 86400000);
  const contentDeadline = new Date(startDate.getTime() + 10 * 86400000);
  const submissionDeadline = new Date(contentDeadline.getTime() + 5 * 86400000);
  const endDate = new Date(submissionDeadline.getTime() + 5 * 86400000);

  return {
    title: r.title,
    description: r.description,
    objective: r.objective,
    campaignType: r.campaignType,
    ageGroupMin: r.ageGroupMin,
    ageGroupMax: r.ageGroupMax,
    gender: r.gender,
    targetLocation: r.targetLocation,
    totalBudget: r.totalBudget,
    budgetPerCreator: r.budgetPerCreator,
    paymentModel: r.paymentModel,
    minimumFollowers: r.minimumFollowers,
    requiredEngagementRate: r.requiredEngagementRate,
    preferredNiche: r.preferredNiche,
    totalSlots: r.totalSlots,
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
    applicationDeadline: applicationDeadline.toISOString().split('T')[0],
    submissionDeadline: submissionDeadline.toISOString().split('T')[0],
    contentDeadline: contentDeadline.toISOString().split('T')[0],
  };
});

// ── Helpers ──────────────────────────────────────────────────

/** Create a business session and return the sessionId */
function createBusinessSession(businessId) {
  const sessionId = sessionStore.create();
  const session = sessionStore.get(sessionId);
  session.businessId = businessId;
  session.status = 'authenticated';
  session.brandData = { name: 'Test Brand' };
  return sessionId;
}

/** Clear all sessions between tests */
function clearSessions() {
  let found;
  do {
    found = sessionStore.findBy(() => true);
    if (found) sessionStore.remove(found.id);
  } while (found);
}

/** Create an influencer session and return the sessionId */
function createInfluencerSession(userId) {
  const sessionId = sessionStore.create();
  const session = sessionStore.get(sessionId);
  session.accessToken = 'fake_token_' + userId;
  session.userId = userId;
  session.status = 'authenticated';
  return sessionId;
}

/** POST a campaign and return the response */
async function createCampaign(sessionId, payload) {
  return request(app)
    .post('/api/campaigns')
    .set('Authorization', `Bearer ${sessionId}`)
    .send(payload);
}

/** GET a campaign by ID */
async function getCampaign(sessionId, campaignId) {
  return request(app)
    .get(`/api/campaigns/${campaignId}`)
    .set('Authorization', `Bearer ${sessionId}`);
}

/** PUT (update) a campaign */
async function updateCampaign(sessionId, campaignId, payload) {
  return request(app)
    .put(`/api/campaigns/${campaignId}`)
    .set('Authorization', `Bearer ${sessionId}`)
    .send(payload);
}

/** PATCH campaign status */
async function patchStatus(sessionId, campaignId, status) {
  return request(app)
    .patch(`/api/campaigns/${campaignId}/status`)
    .set('Authorization', `Bearer ${sessionId}`)
    .send({ status });
}

// ── Tests ────────────────────────────────────────────────────

describe('Feature: campaign-management — server property tests', () => {

  beforeEach(() => {
    clearSessions();
  });


  // ── Property 1: Campaign creation round-trip ─────────────────
  // **Validates: Requirements 11.1, 11.3**
  it('Property 1: creation round-trip — POST then GET returns matching data with server-generated fields', async () => {
    await fc.assert(
      fc.asyncProperty(arbValidCampaignPayload, async (payload) => {
        clearSessions();
        const sessionId = createBusinessSession('biz_roundtrip');

        // Create campaign
        const createRes = await createCampaign(sessionId, payload);
        assert.equal(createRes.status, 201, `Expected 201, got ${createRes.status}: ${JSON.stringify(createRes.body)}`);

        const created = createRes.body;
        assert.ok(created.campaignId, 'Response must include campaignId');
        assert.ok(created.businessId, 'Response must include businessId');
        assert.ok(created.createdAt, 'Response must include createdAt');
        assert.ok(created.updatedAt, 'Response must include updatedAt');
        assert.equal(created.businessId, 'biz_roundtrip');

        // GET the campaign back
        const getRes = await getCampaign(sessionId, created.campaignId);
        assert.equal(getRes.status, 200);

        const fetched = getRes.body;

        // Verify all submitted fields match
        assert.equal(fetched.title, payload.title);
        assert.equal(fetched.description, payload.description);
        assert.equal(fetched.objective, payload.objective);
        assert.equal(fetched.campaignType, payload.campaignType);
        assert.equal(fetched.ageGroupMin, payload.ageGroupMin);
        assert.equal(fetched.ageGroupMax, payload.ageGroupMax);
        assert.equal(fetched.gender, payload.gender);
        assert.equal(fetched.targetLocation, payload.targetLocation);
        assert.equal(fetched.totalBudget, payload.totalBudget);
        assert.equal(fetched.budgetPerCreator, payload.budgetPerCreator);
        assert.equal(fetched.paymentModel, payload.paymentModel);
        assert.equal(fetched.minimumFollowers, payload.minimumFollowers);
        assert.equal(fetched.preferredNiche, payload.preferredNiche);
        assert.equal(fetched.totalSlots, payload.totalSlots);
        assert.equal(fetched.startDate, payload.startDate);
        assert.equal(fetched.endDate, payload.endDate);
        assert.equal(fetched.applicationDeadline, payload.applicationDeadline);
        assert.equal(fetched.submissionDeadline, payload.submissionDeadline);
        assert.equal(fetched.contentDeadline, payload.contentDeadline);

        // Verify server-generated fields
        assert.equal(fetched.campaignId, created.campaignId);
        assert.equal(fetched.businessId, 'biz_roundtrip');
        assert.ok(fetched.createdAt);
        assert.ok(fetched.updatedAt);
        assert.equal(fetched.status, 'Draft');
      }),
      { numRuns: 5 },
    );
  });

  // ── Property 2: Server rejects incomplete payloads ───────────
  // **Validates: Requirements 11.8, 11.10**
  it('Property 2: incomplete payload — missing any required field returns 400', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidCampaignPayload,
        fc.constantFrom(...REQUIRED_FIELDS),
        async (payload, fieldToRemove) => {
          clearSessions();
          const sessionId = createBusinessSession('biz_incomplete');

          const incomplete = { ...payload };
          delete incomplete[fieldToRemove];

          const res = await createCampaign(sessionId, incomplete);
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

  // ── Property 3: Date constraint validation ───────────────────
  // **Validates: Requirements 19.1, 19.2, 19.3, 19.4**
  it('Property 3: date constraints — invalid date relationships return 400 with specific error', async () => {
    // Generate a valid payload, then break one date constraint at a time
    const arbDateViolation = fc.tuple(
      arbValidCampaignPayload,
      fc.constantFrom('endBeforeStart', 'appDeadlineAfterStart', 'subDeadlineAfterEnd', 'contentAfterSubmission'),
    );

    await fc.assert(
      fc.asyncProperty(arbDateViolation, async ([payload, violation]) => {
        clearSessions();
        const sessionId = createBusinessSession('biz_dates');

        const broken = { ...payload };

        // Create base dates from the valid payload
        const start = new Date(payload.startDate);
        const end = new Date(payload.endDate);
        const appDeadline = new Date(payload.applicationDeadline);
        const subDeadline = new Date(payload.submissionDeadline);
        const contentDeadline = new Date(payload.contentDeadline);

        let expectedError;

        switch (violation) {
          case 'endBeforeStart':
            // Set endDate to be before or equal to startDate
            broken.endDate = new Date(start.getTime() - 86400000).toISOString().split('T')[0];
            expectedError = 'End date must be after start date';
            break;
          case 'appDeadlineAfterStart':
            // Set applicationDeadline to be on or after startDate
            broken.applicationDeadline = new Date(start.getTime() + 86400000).toISOString().split('T')[0];
            expectedError = 'Application deadline must be before start date';
            break;
          case 'subDeadlineAfterEnd':
            // Set submissionDeadline to be after endDate
            broken.submissionDeadline = new Date(end.getTime() + 86400000).toISOString().split('T')[0];
            expectedError = 'Submission deadline must be on or before end date';
            break;
          case 'contentAfterSubmission':
            // Set contentDeadline to be after submissionDeadline
            broken.contentDeadline = new Date(subDeadline.getTime() + 86400000).toISOString().split('T')[0];
            expectedError = 'Content deadline must be on or before submission deadline';
            break;
        }

        const res = await createCampaign(sessionId, broken);
        assert.equal(res.status, 400, `Violation '${violation}' should give 400, got ${res.status}: ${JSON.stringify(res.body)}`);
        assert.ok(res.body.error, 'Error response must include error message');
        assert.ok(
          res.body.error.includes(expectedError),
          `Error should contain '${expectedError}', got: '${res.body.error}'`,
        );
      }),
      { numRuns: 5 },
    );
  });

  // ── Property 4: Status transition enforcement ────────────────
  // **Validates: Requirements 12.1**
  it('Property 4: status transitions — valid transitions succeed, invalid transitions return 400', async () => {
    const VALID_TRANSITIONS = {
      Draft: ['Published', 'Cancelled'],
      Published: ['Active', 'Cancelled'],
      Active: ['Completed', 'Cancelled'],
      Completed: ['Archived'],
      Cancelled: ['Archived'],
    };

    const ALL_STATUSES = ['Draft', 'Published', 'Active', 'Completed', 'Cancelled', 'Archived'];

    // Generate a starting status and a target status
    const arbTransition = fc.tuple(
      fc.constantFrom('Draft', 'Published', 'Active', 'Completed', 'Cancelled'),
      fc.constantFrom(...ALL_STATUSES),
    );

    // Statuses whose path to reach them goes through Active (needs past startDate)
    const needsPastDates = new Set(['Active', 'Completed']);

    await fc.assert(
      fc.asyncProperty(
        arbValidCampaignPayload,
        arbTransition,
        async (payload, [fromStatus, toStatus]) => {
          clearSessions();
          const sessionId = createBusinessSession('biz_transitions');

          // If the path to fromStatus goes through Active, or if we're testing
          // Published→Active directly, we need startDate in the past
          const adjustedPayload = { ...payload };
          if (needsPastDates.has(fromStatus) || (fromStatus === 'Published' && toStatus === 'Active')) {
            const pastDate = new Date(Date.now() - 10 * 86400000).toISOString().split('T')[0];
            const farPastDate = new Date(Date.now() - 20 * 86400000).toISOString().split('T')[0];
            adjustedPayload.startDate = pastDate;
            adjustedPayload.applicationDeadline = farPastDate;
          }

          // Create campaign (starts as Draft)
          const createRes = await createCampaign(sessionId, adjustedPayload);
          assert.equal(createRes.status, 201);
          const campaignId = createRes.body.campaignId;

          // Walk the campaign to the desired fromStatus
          const pathToStatus = {
            Draft: [],
            Published: ['Published'],
            Active: ['Published', 'Active'],
            Completed: ['Published', 'Active', 'Completed'],
            Cancelled: ['Cancelled'],
          };

          for (const step of pathToStatus[fromStatus]) {
            const stepRes = await patchStatus(sessionId, campaignId, step);
            assert.equal(stepRes.status, 200, `Failed to transition to ${step}: ${JSON.stringify(stepRes.body)}`);
          }

          // Now attempt the transition
          const isValid = VALID_TRANSITIONS[fromStatus]?.includes(toStatus) || false;
          const transitionRes = await patchStatus(sessionId, campaignId, toStatus);

          if (isValid) {
            assert.equal(transitionRes.status, 200, `Valid transition ${fromStatus}→${toStatus} should succeed: ${JSON.stringify(transitionRes.body)}`);
            assert.equal(transitionRes.body.status, toStatus);
          } else {
            assert.equal(transitionRes.status, 400, `Invalid transition ${fromStatus}→${toStatus} should give 400, got ${transitionRes.status}`);
            assert.ok(transitionRes.body.error);
            assert.ok(
              transitionRes.body.error.includes('Invalid status transition'),
              `Error should mention invalid transition: ${transitionRes.body.error}`,
            );
          }
        },
      ),
      { numRuns: 5 },
    );
  });

  // ── Property 5: Draft-only editing ───────────────────────────
  // **Validates: Requirements 11.4, 11.5**
  it('Property 5: draft-only editing — PUT on non-Draft returns 400, PUT on Draft succeeds', async () => {
    const arbNonDraftStatus = fc.constantFrom('Published', 'Active', 'Completed', 'Cancelled');

    await fc.assert(
      fc.asyncProperty(
        arbValidCampaignPayload,
        arbNonDraftStatus,
        async (payload, targetStatus) => {
          clearSessions();
          const sessionId = createBusinessSession('biz_editing');

          // For Active and Completed statuses, the path goes through Active which needs past startDate
          const adjustedPayload = { ...payload };
          if (targetStatus === 'Active' || targetStatus === 'Completed') {
            const pastDate = new Date(Date.now() - 10 * 86400000).toISOString().split('T')[0];
            const farPastDate = new Date(Date.now() - 20 * 86400000).toISOString().split('T')[0];
            adjustedPayload.startDate = pastDate;
            adjustedPayload.applicationDeadline = farPastDate;
          }

          // Create a Draft campaign
          const createRes = await createCampaign(sessionId, adjustedPayload);
          assert.equal(createRes.status, 201);
          const campaignId = createRes.body.campaignId;

          // First, verify PUT on Draft succeeds
          const draftUpdateRes = await updateCampaign(sessionId, campaignId, { title: 'Updated Title' });
          assert.equal(draftUpdateRes.status, 200, `PUT on Draft should succeed, got ${draftUpdateRes.status}`);
          assert.equal(draftUpdateRes.body.title, 'Updated Title');

          // Walk to the target non-Draft status
          const pathToStatus = {
            Published: ['Published'],
            Active: ['Published', 'Active'],
            Completed: ['Published', 'Active', 'Completed'],
            Cancelled: ['Cancelled'],
          };

          for (const step of pathToStatus[targetStatus]) {
            const stepRes = await patchStatus(sessionId, campaignId, step);
            assert.equal(stepRes.status, 200, `Failed to transition to ${step}: ${JSON.stringify(stepRes.body)}`);
          }

          // Now PUT should fail with 400
          const nonDraftUpdateRes = await updateCampaign(sessionId, campaignId, { title: 'Should Fail' });
          assert.equal(nonDraftUpdateRes.status, 400, `PUT on ${targetStatus} campaign should give 400, got ${nonDraftUpdateRes.status}`);
          assert.equal(nonDraftUpdateRes.body.error, 'Only draft campaigns can be edited');
        },
      ),
      { numRuns: 5 },
    );
  });

  // ── Property 6: Application uniqueness per influencer per campaign ─
  // **Validates: Requirements 15.7**
  it('Property 6: application uniqueness — duplicate application to same campaign returns 409; different campaigns succeed', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidCampaignPayload,
        arbValidCampaignPayload,
        fc.string({ minLength: 5, maxLength: 20 }).filter(s => s.trim().length > 0),
        async (payload1, payload2, influencerSuffix) => {
          clearSessions();

          // Create business session and two Published campaigns
          const bizSession = createBusinessSession('biz_app_unique');

          const createRes1 = await createCampaign(bizSession, payload1);
          assert.equal(createRes1.status, 201);
          const campaignId1 = createRes1.body.campaignId;
          const pubRes1 = await patchStatus(bizSession, campaignId1, 'Published');
          assert.equal(pubRes1.status, 200);

          const createRes2 = await createCampaign(bizSession, payload2);
          assert.equal(createRes2.status, 201);
          const campaignId2 = createRes2.body.campaignId;
          const pubRes2 = await patchStatus(bizSession, campaignId2, 'Published');
          assert.equal(pubRes2.status, 200);

          // Create influencer session
          const influencerId = `inf_unique_${influencerSuffix}`;
          const infSession = createInfluencerSession(influencerId);

          // First application to campaign 1 → 201
          const applyRes1 = await request(app)
            .post(`/api/campaigns/${campaignId1}/applications`)
            .set('Authorization', `Bearer ${infSession}`);
          assert.equal(applyRes1.status, 201, `First application should succeed, got ${applyRes1.status}: ${JSON.stringify(applyRes1.body)}`);

          // Duplicate application to campaign 1 → 409
          const applyRes2 = await request(app)
            .post(`/api/campaigns/${campaignId1}/applications`)
            .set('Authorization', `Bearer ${infSession}`);
          assert.equal(applyRes2.status, 409, `Duplicate application should return 409, got ${applyRes2.status}`);
          assert.ok(applyRes2.body.error.includes('already applied'), `Error should mention already applied: ${applyRes2.body.error}`);

          // Application to campaign 2 → 201 (different campaign succeeds)
          const applyRes3 = await request(app)
            .post(`/api/campaigns/${campaignId2}/applications`)
            .set('Authorization', `Bearer ${infSession}`);
          assert.equal(applyRes3.status, 201, `Application to different campaign should succeed, got ${applyRes3.status}: ${JSON.stringify(applyRes3.body)}`);
        },
      ),
      { numRuns: 2 },
    );
  });

  // ── Property 7: Slot capacity enforcement ────────────────────
  // **Validates: Requirements 16.7**
  it('Property 7: slot capacity — approving beyond totalSlots returns 400', async () => {
    // Use totalSlots=1 to keep tests fast (each influencer application hits Instagram API)
    const arbSmallSlotPayload = arbValidCampaignPayload.map(p => ({
      ...p,
      totalSlots: 1,
    }));

    await fc.assert(
      fc.asyncProperty(arbSmallSlotPayload, async (payload) => {
        clearSessions();
        const N = payload.totalSlots; // 1

        // Create business session and a Published campaign
        const bizSession = createBusinessSession('biz_slots');
        const createRes = await createCampaign(bizSession, payload);
        assert.equal(createRes.status, 201);
        const campaignId = createRes.body.campaignId;
        const pubRes = await patchStatus(bizSession, campaignId, 'Published');
        assert.equal(pubRes.status, 200);

        // Create N+1 influencers and have them all apply BEFORE any approvals
        // (applications check approved count, not total applications)
        const applicationIds = [];
        for (let i = 0; i <= N; i++) {
          const infSession = createInfluencerSession(`inf_slot_${i}`);
          const applyRes = await request(app)
            .post(`/api/campaigns/${campaignId}/applications`)
            .set('Authorization', `Bearer ${infSession}`);
          assert.equal(applyRes.status, 201, `Influencer ${i} application should succeed`);
          applicationIds.push(applyRes.body.applicationId);
        }

        // Business approves the first N applications (fills all slots)
        for (let i = 0; i < N; i++) {
          const approveRes = await request(app)
            .patch(`/api/campaigns/${campaignId}/applications/${applicationIds[i]}`)
            .set('Authorization', `Bearer ${bizSession}`)
            .send({ status: 'Approved' });
          assert.equal(approveRes.status, 200, `Approving application ${i} should succeed`);
        }

        // Business tries to approve the (N+1)th application → 400
        const extraApproveRes = await request(app)
          .patch(`/api/campaigns/${campaignId}/applications/${applicationIds[N]}`)
          .set('Authorization', `Bearer ${bizSession}`)
          .send({ status: 'Approved' });
        assert.equal(extraApproveRes.status, 400, `Approving beyond totalSlots should return 400, got ${extraApproveRes.status}`);
        assert.ok(
          extraApproveRes.body.error.includes('All influencer slots are filled'),
          `Error should mention slots filled: ${extraApproveRes.body.error}`,
        );
      }),
      { numRuns: 2 },
    );
  });

  // ── Property 8: Content submission requires approved application ─
  // **Validates: Requirements 17.4, 17.5**
  it('Property 8: content submission — unapproved influencer gets 403; approved influencer succeeds', async () => {
    await fc.assert(
      fc.asyncProperty(arbValidCampaignPayload, async (payload) => {
        clearSessions();

        // Create business session and a Published campaign
        const bizSession = createBusinessSession('biz_submit');
        const createRes = await createCampaign(bizSession, payload);
        assert.equal(createRes.status, 201);
        const campaignId = createRes.body.campaignId;
        const pubRes = await patchStatus(bizSession, campaignId, 'Published');
        assert.equal(pubRes.status, 200);

        // Create influencer session
        const infSession = createInfluencerSession('inf_submit');

        const submissionData = {
          contentUrl: 'https://instagram.com/p/test123',
          contentCaption: 'Test caption for campaign',
          notesToBrand: 'Test notes',
        };

        // Try to submit content without any application → 403
        const submitRes1 = await request(app)
          .post(`/api/campaigns/${campaignId}/submissions`)
          .set('Authorization', `Bearer ${infSession}`)
          .send(submissionData);
        assert.equal(submitRes1.status, 403, `Submit without application should return 403, got ${submitRes1.status}`);
        assert.ok(
          submitRes1.body.error.includes('approved application'),
          `Error should mention approved application: ${submitRes1.body.error}`,
        );

        // Apply to campaign → 201
        const applyRes = await request(app)
          .post(`/api/campaigns/${campaignId}/applications`)
          .set('Authorization', `Bearer ${infSession}`);
        assert.equal(applyRes.status, 201);

        // Try to submit content with Pending application → 403
        const submitRes2 = await request(app)
          .post(`/api/campaigns/${campaignId}/submissions`)
          .set('Authorization', `Bearer ${infSession}`)
          .send(submissionData);
        assert.equal(submitRes2.status, 403, `Submit with Pending application should return 403, got ${submitRes2.status}`);

        // Business approves the application → 200
        const approveRes = await request(app)
          .patch(`/api/campaigns/${campaignId}/applications/${applyRes.body.applicationId}`)
          .set('Authorization', `Bearer ${bizSession}`)
          .send({ status: 'Approved' });
        assert.equal(approveRes.status, 200);

        // Submit content with Approved application → 201
        const submitRes3 = await request(app)
          .post(`/api/campaigns/${campaignId}/submissions`)
          .set('Authorization', `Bearer ${infSession}`)
          .send(submissionData);
        assert.equal(submitRes3.status, 201, `Submit with Approved application should succeed, got ${submitRes3.status}: ${JSON.stringify(submitRes3.body)}`);
        assert.ok(submitRes3.body.submissionId, 'Submission should have a submissionId');
        assert.equal(submitRes3.body.status, 'Pending_Review');
      }),
      { numRuns: 2 },
    );
  });

  // ── Property 9: Budget constraint validation ─────────────────
  // **Validates: Requirements 19.8**
  it('Property 9: budget constraint — budgetPerCreator > totalBudget returns 400', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidCampaignPayload,
        fc.integer({ min: 1, max: 10000 }),
        async (payload, extraAmount) => {
          clearSessions();
          const sessionId = createBusinessSession('biz_budget');

          // Make budgetPerCreator exceed totalBudget
          const broken = { ...payload };
          broken.budgetPerCreator = broken.totalBudget + extraAmount;

          const res = await createCampaign(sessionId, broken);
          assert.equal(res.status, 400, `budgetPerCreator > totalBudget should give 400, got ${res.status}`);
          assert.ok(res.body.error);
          assert.ok(
            res.body.error.includes('Budget per creator cannot exceed total campaign budget'),
            `Error should mention budget constraint: ${res.body.error}`,
          );
        },
      ),
      { numRuns: 5 },
    );
  });

  // ── Property 10: Campaign ownership isolation ────────────────
  // **Validates: Requirements 11.2, 11.3, 11.11**
  it('Property 10: ownership isolation — business user B cannot read/update campaigns of business user A', async () => {
    await fc.assert(
      fc.asyncProperty(arbValidCampaignPayload, async (payload) => {
        clearSessions();

        // Create two different business sessions
        const sessionA = createBusinessSession('biz_owner_a');
        const sessionB = createBusinessSession('biz_owner_b');

        // User A creates a campaign
        const createRes = await createCampaign(sessionA, payload);
        assert.equal(createRes.status, 201);
        const campaignId = createRes.body.campaignId;

        // User A can read their own campaign
        const getResA = await getCampaign(sessionA, campaignId);
        assert.equal(getResA.status, 200, 'Owner should be able to read their campaign');

        // User B cannot read user A's campaign
        const getResB = await getCampaign(sessionB, campaignId);
        assert.equal(getResB.status, 404, `Non-owner GET should return 404, got ${getResB.status}`);
        assert.equal(getResB.body.error, 'Campaign not found');

        // User B cannot update user A's campaign
        const putResB = await updateCampaign(sessionB, campaignId, { title: 'Hacked' });
        assert.equal(putResB.status, 404, `Non-owner PUT should return 404, got ${putResB.status}`);
        assert.equal(putResB.body.error, 'Campaign not found');

        // User B's campaign list should not include user A's campaign
        const listResB = await request(app)
          .get('/api/campaigns')
          .set('Authorization', `Bearer ${sessionB}`);
        assert.equal(listResB.status, 200);
        const bCampaignIds = listResB.body.map(c => c.campaignId);
        assert.ok(
          !bCampaignIds.includes(campaignId),
          'User B campaign list should not include user A campaigns',
        );
      }),
      { numRuns: 5 },
    );
  });

});
