/**
 * Feature: campaign-management, Property 4
 *
 * Property 4 — Status transition enforcement.
 * **Validates: Requirements 12.1**
 *
 * For every campaign status and requested status, the status endpoint accepts
 * exactly the transitions declared by VALID_TRANSITIONS and rejects every
 * other transition with HTTP 400 and the prescribed error message.
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
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
import { CampaignStatus, VALID_TRANSITIONS } from './campaigns.types';

const statuses: CampaignStatus[] = [
  'Draft',
  'Published',
  'Active',
  'Completed',
  'Cancelled',
  'Archived',
];

const statusPairArb = fc.tuple(
  fc.constantFrom(...statuses),
  fc.constantFrom(...statuses),
);

const campaignForStatus = (status: CampaignStatus) => ({
  campaignId: 'campaign-under-test',
  brandId: 'brand-under-test',
  status,
  title: 'Campaign under test',
  description: 'A valid campaign payload for lifecycle testing',
  objective: 'Product Promotion',
  campaignType: 'UGC',
  ageGroupMin: 18,
  ageGroupMax: 35,
  gender: 'All',
  targetLocation: 'United States',
  totalBudget: 5_000,
  budgetPerCreator: 500,
  paymentModel: 'Fixed',
  startDate: '2000-06-01',
  endDate: '2000-06-30',
  applicationDeadline: '2000-05-25',
  submissionDeadline: '2000-06-28',
  contentDeadline: '2000-06-20',
  minimumFollowers: 1_000,
  requiredEngagementRate: 3,
  preferredNiche: 'Fashion',
  totalSlots: 10,
  createdAt: '2000-01-01T00:00:00.000Z',
  updatedAt: '2000-01-01T00:00:00.000Z',
});

describe('Feature: campaign-management, Property 4 — status transition enforcement', () => {
  let app: INestApplication;
  let campaign: ReturnType<typeof campaignForStatus>;

  const getCampaign = jest.fn<any>();
  const updateCampaign = jest.fn<any>();
  const getBrandSession = jest.fn<any>();

  beforeAll(async () => {
    getBrandSession.mockResolvedValue({ brandId: 'brand-under-test' });

    const moduleBuilder = Test.createTestingModule({
      controllers: [CampaignsController],
      providers: [
        CampaignsService,
        {
          provide: CampaignsRepository,
          useValue: { getCampaign, updateCampaign },
        },
        {
          provide: BrandSessionService,
          useValue: { getSession: getBrandSession },
        },
        {
          provide: InfluencerSessionService,
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
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('accepts every valid transition and rejects every invalid transition', async () => {
    await fc.assert(
      fc.asyncProperty(statusPairArb, async ([currentStatus, requestedStatus]) => {
        campaign = campaignForStatus(currentStatus);
        getCampaign.mockResolvedValue(campaign);
        updateCampaign.mockImplementation(async (_campaignId: string, data: Record<string, unknown>) => ({
          ...campaign,
          ...data,
        }));

        const response = await request(app.getHttpServer())
          .patch(`/api/campaigns/${campaign.campaignId}/status`)
          .set('Authorization', 'Bearer test-brand-session')
          .send({ status: requestedStatus });

        const isValid = VALID_TRANSITIONS[currentStatus].includes(requestedStatus);
        if (isValid) {
          expect(response.status).toBe(200);
          expect(response.body.status).toBe(requestedStatus);
        } else {
          expect(response.status).toBe(400);
          expect(response.body.error.message).toBe(
            `Invalid status transition from ${currentStatus} to ${requestedStatus}`,
          );
        }
      }),
      { numRuns: 20 },
    );
  });
});
