/**
 * Feature: campaign-management, Property 5
 *
 * Property 5 — Draft-only editing.
 * **Validates: Requirements 11.4, 11.5**
 *
 * For every campaign status, PUT edits succeed only while the campaign is a
 * Draft. Every non-Draft status is rejected with the prescribed HTTP 400
 * response and does not reach the repository update operation.
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
import { CampaignStatus } from './campaigns.types';

const statuses: CampaignStatus[] = [
  'Draft',
  'Published',
  'Active',
  'Completed',
  'Cancelled',
  'Archived',
];

const campaignForStatus = (status: CampaignStatus) => ({
  campaignId: 'campaign-under-test',
  brandId: 'brand-under-test',
  status,
  title: 'Campaign under test',
  description: 'A valid campaign payload for editing tests',
  objective: 'Product Promotion',
  campaignType: 'UGC',
  ageGroupMin: 18,
  ageGroupMax: 35,
  gender: 'All',
  targetLocation: 'United States',
  totalBudget: 5_000,
  budgetPerCreator: 500,
  paymentModel: 'Fixed',
  startDate: '2099-06-01',
  endDate: '2099-06-30',
  applicationDeadline: '2099-05-25',
  submissionDeadline: '2099-06-28',
  contentDeadline: '2099-06-20',
  minimumFollowers: 1_000,
  requiredEngagementRate: 3,
  preferredNiche: 'Fashion',
  totalSlots: 10,
  createdAt: '2099-01-01T00:00:00.000Z',
  updatedAt: '2099-01-01T00:00:00.000Z',
});

const statusArb = fc.constantFrom(...statuses);
const editPayloadArb = fc.record({
  title: fc.string({ minLength: 1, maxLength: 80 }),
});

describe('Feature: campaign-management, Property 5 — draft-only editing', () => {
  let app: INestApplication;

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

  it('allows edits only for Draft campaigns', async () => {
    await fc.assert(
      fc.asyncProperty(statusArb, editPayloadArb, async (status, update) => {
        const campaign = campaignForStatus(status);
        getCampaign.mockClear();
        updateCampaign.mockClear();
        getCampaign.mockResolvedValue(campaign);
        updateCampaign.mockImplementation(async (_campaignId: string, data: Record<string, unknown>) => ({
          ...campaign,
          ...data,
        }));

        const response = await request(app.getHttpServer())
          .put(`/api/campaigns/${campaign.campaignId}`)
          .set('Authorization', 'Bearer test-brand-session')
          .send(update);

        if (status === 'Draft') {
          expect(response.status).toBe(200);
          expect(response.body.title).toBe(update.title);
          expect(updateCampaign).toHaveBeenCalledWith(campaign.campaignId, update);
        } else {
          expect(response.status).toBe(400);
          expect(response.body.error.message).toBe('Only draft campaigns can be edited');
          expect(updateCampaign).not.toHaveBeenCalled();
        }
      }),
      { numRuns: 20 },
    );
  });
});
