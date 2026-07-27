/**
 * Feature: campaign-management, Property 2
 *
 * Property 2 — Server rejects incomplete campaign payloads.
 * **Validates: Requirements 11.8, 11.10**
 *
 * For any Published campaign payload with one required field removed, POST
 * /api/campaigns returns HTTP 400 and the campaign service is never called.
 * Published is used here because the API deliberately permits incomplete
 * Drafts to be saved and validates a campaign when it is being published.
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import fc from 'fast-check';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignsRepository } from './campaigns.repository';
import { BrandAuthGuard } from '../../common/guards/brand-auth.guard';
import { AuthGuard } from '../../common/guards/auth.guard';
import { BrandSessionService } from '../../common/services/brand-session.service';
import { InfluencerSessionService } from '../../common/services/influencer-session.service';
import { MetaService } from '../meta/meta.service';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { REQUIRED_CAMPAIGN_FIELDS } from './campaigns.types';

const validCampaignArb = fc.record({
  title: fc.string({ minLength: 1, maxLength: 80 }),
  description: fc.string({ minLength: 1, maxLength: 200 }),
  objective: fc.string({ minLength: 1, maxLength: 40 }),
  campaignType: fc.constantFrom('Promotion', 'UGC', 'Review', 'Giveaway'),
  ageGroupMin: fc.integer({ min: 13, max: 40 }),
  ageGroupMax: fc.integer({ min: 41, max: 65 }),
  gender: fc.constantFrom('Male', 'Female', 'All'),
  targetLocation: fc.string({ minLength: 1, maxLength: 40 }),
  totalBudget: fc.integer({ min: 0, max: 100_000 }),
  budgetPerCreator: fc.integer({ min: 0, max: 1_000 }),
  paymentModel: fc.constantFrom('Fixed', 'Commission', 'Barter'),
  startDate: fc.constant('2099-06-01'),
  endDate: fc.constant('2099-06-30'),
  applicationDeadline: fc.constant('2099-05-25'),
  submissionDeadline: fc.constant('2099-06-28'),
  contentDeadline: fc.constant('2099-06-20'),
  minimumFollowers: fc.integer({ min: 1, max: 1_000_000 }),
  requiredEngagementRate: fc.integer({ min: 0, max: 100 }),
  preferredNiche: fc.string({ minLength: 1, maxLength: 40 }),
  totalSlots: fc.integer({ min: 1, max: 100 }),
  status: fc.constant('Published'),
});

describe('Feature: campaign-management, Property 2 — incomplete campaign payloads', () => {
  let app: INestApplication;
  const createCampaign = jest.fn();

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      controllers: [CampaignsController],
      providers: [{ provide: CampaignsService, useValue: { createCampaign } }],
    });
    moduleBuilder.overrideGuard(BrandAuthGuard).useValue({
      canActivate: (context: any) => {
        context.switchToHttp().getRequest().sessionId = 'test-brand-session';
        return true;
      },
    });
    moduleBuilder.overrideGuard(AuthGuard).useValue({ canActivate: () => true });
    const module: TestingModule = await moduleBuilder.compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('returns 400 and does not persist when any required field is missing', async () => {
    await fc.assert(
      fc.asyncProperty(
        validCampaignArb,
        fc.constantFrom(...REQUIRED_CAMPAIGN_FIELDS),
        async (campaign, missingField) => {
          const incomplete = { ...campaign } as Record<string, unknown>;
          delete incomplete[missingField];

          const response = await request(app.getHttpServer())
            .post('/api/campaigns')
            .set('Authorization', 'Bearer test-brand-session')
            .send(incomplete);

          expect(response.status).toBe(400);
          expect(createCampaign).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 20 },
    );
  });
});


/**
 * Feature: campaign-management, Property 3
 *
 * Property 3 — Invalid campaign date relationships are rejected.
 * **Validates: Requirements 19.1, 19.2, 19.3, 19.4**
 *
 * For any complete Published campaign payload with one invalid date
 * relationship, POST /api/campaigns returns HTTP 400 with the specific
 * cross-field validation message and does not persist the campaign.
 */

describe('Feature: campaign-management, Property 3 — date constraint validation', () => {
  let app: INestApplication;
  const createCampaign = jest.fn();

  const dateValidationCampaignArb = fc.record({
    title: fc.string({ minLength: 1, maxLength: 80 }),
    description: fc.string({ minLength: 1, maxLength: 200 }),
    objective: fc.string({ minLength: 1, maxLength: 40 }),
    campaignType: fc.constantFrom('Promotion', 'UGC', 'Review', 'Giveaway'),
    ageGroupMin: fc.integer({ min: 13, max: 40 }),
    ageGroupMax: fc.integer({ min: 41, max: 65 }),
    gender: fc.constantFrom('Male', 'Female', 'All'),
    targetLocation: fc.string({ minLength: 1, maxLength: 40 }),
    totalBudget: fc.integer({ min: 1_000, max: 100_000 }),
    budgetPerCreator: fc.integer({ min: 0, max: 1_000 }),
    paymentModel: fc.constantFrom('Fixed', 'Commission', 'Barter'),
    startDate: fc.constant('2099-06-01'),
    endDate: fc.constant('2099-06-30'),
    applicationDeadline: fc.constant('2099-05-25'),
    submissionDeadline: fc.constant('2099-06-28'),
    contentDeadline: fc.constant('2099-06-20'),
    minimumFollowers: fc.integer({ min: 1, max: 1_000_000 }),
    requiredEngagementRate: fc.integer({ min: 0, max: 100 }),
    preferredNiche: fc.string({ minLength: 1, maxLength: 40 }),
    totalSlots: fc.integer({ min: 1, max: 100 }),
    status: fc.constant('Published'),
  });

  const invalidDateCampaignArb = fc
    .record({
      campaign: dateValidationCampaignArb,
      relationship: fc.constantFrom(
        'end-before-start',
        'application-after-start',
        'submission-after-end',
        'content-after-submission',
      ),
    })
    .map(({ campaign, relationship }) => {
      const invalidCampaign: Record<string, unknown> = { ...campaign };

      switch (relationship) {
        case 'end-before-start':
          invalidCampaign.endDate = '2099-06-01';
          return {
            campaign: invalidCampaign,
            expectedMessage: 'End date must be after start date',
          };
        case 'application-after-start':
          invalidCampaign.applicationDeadline = '2099-06-01';
          return {
            campaign: invalidCampaign,
            expectedMessage: 'Application deadline must be before start date',
          };
        case 'submission-after-end':
          invalidCampaign.submissionDeadline = '2099-07-01';
          return {
            campaign: invalidCampaign,
            expectedMessage: 'Submission deadline must be on or before end date',
          };
        case 'content-after-submission':
          invalidCampaign.contentDeadline = '2099-06-29';
          return {
            campaign: invalidCampaign,
            expectedMessage: 'Content deadline must be on or before submission deadline',
          };
      }
    });

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      controllers: [CampaignsController],
      providers: [
        CampaignsService,
        {
          provide: CampaignsRepository,
          useValue: { createCampaign },
        },
        {
          provide: InfluencerSessionService,
          useValue: {},
        },
        {
          provide: BrandSessionService,
          useValue: {},
        },
        {
          provide: MetaService,
          useValue: {},
        },
      ],
    });
    moduleBuilder.overrideGuard(BrandAuthGuard).useValue({
      canActivate: (context: any) => {
        context.switchToHttp().getRequest().sessionId = 'test-brand-session';
        return true;
      },
    });
    moduleBuilder.overrideGuard(AuthGuard).useValue({ canActivate: () => true });

    const module: TestingModule = await moduleBuilder.compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('returns 400 with the specific error for every invalid date relationship', async () => {
    await fc.assert(
      fc.asyncProperty(invalidDateCampaignArb, async ({ campaign, expectedMessage }) => {
        const response = await request(app.getHttpServer())
          .post('/api/campaigns')
          .set('Authorization', 'Bearer test-brand-session')
          .send(campaign);

        expect(response.status).toBe(400);
        expect(response.body.error.message).toBe(expectedMessage);
        expect(createCampaign).not.toHaveBeenCalled();
      }),
      { numRuns: 20 },
    );
  });
});
