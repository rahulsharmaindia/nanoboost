// ── Unit tests for creator-packages hooks in CampaignsService ────────────
//
// Covers:
//   Task 12.3 — creator-tier contact-detail redaction in listMarketplace
//   Task 12.4 — outbound application cap enforcement in applyToCampaign
//   Task 12.5 — concurrent-campaign cap check in reviewApplication
//   Task 12.6 — studio early-access window in listMarketplace
//
// Requirements: 10.1, 10.2, 10.5, 10.6, 10.7, 2.2, 10.8, 3.1, 3.2, 2.6, 3.4, 2.8

import { CampaignsService } from './campaigns.service';
import { CampaignsRepository } from './campaigns.repository';
import { SessionService } from '../../common/services/session.service';
import { MetaService } from '../meta/meta.service';
import { SubscriptionsFacade } from '../subscriptions/subscriptions.facade';
import { FeatureFlagsService } from '../../common/config/feature-flags.service';
import {
  CapExceededError,
  ConcurrentLimitReachedError,
  TierLockedError,
} from '../subscriptions/subscriptions.errors';
import { SlotsFullError } from './campaigns.errors';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCampaign(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    campaignId: 'c1',
    businessId: 'b1',
    title: 'Test Campaign',
    description: 'A test campaign',
    objective: 'Awareness',
    campaignType: 'Sponsored',
    platform: 'Instagram',
    ageGroupMin: 18,
    ageGroupMax: 35,
    gender: 'All',
    targetLocation: 'India',
    totalBudget: 10000,
    budgetPerCreator: 1000,
    paymentModel: 'Fixed',
    startDate: '2025-12-01',
    endDate: '2025-12-31',
    applicationDeadline: '2025-11-30',
    submissionDeadline: '2025-12-28',
    contentDeadline: '2025-12-25',
    minimumFollowers: 1000,
    requiredEngagementRate: 2.5,
    preferredNiche: 'Lifestyle',
    totalSlots: 5,
    status: 'Published',
    publishedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeApplication(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    applicationId: 'app1',
    campaignId: 'c1',
    influencerId: 'creator1',
    username: 'testcreator',
    followerCount: 5000,
    status: 'Pending',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeService(opts: {
  campaigns?: Record<string, any>[];
  applications?: Record<string, any>[];
  session?: any;
  subscription?: any;
  concurrentCheck?: any;
  tryConsumeResult?: any;
  brandSession?: boolean; // when true, session has businessId (brand context)
}) {
  const campaigns = opts.campaigns ?? [makeCampaign()];
  const applications = opts.applications ?? [makeApplication()];

  const repo = {
    listPublished: jest.fn().mockResolvedValue(campaigns),
    getBrandNames: jest.fn().mockResolvedValue({ b1: 'Acme Brand' }),
    getApprovedCounts: jest.fn().mockResolvedValue({}),
    getCampaign: jest.fn().mockResolvedValue(campaigns[0] ?? null),
    getApplication: jest.fn().mockResolvedValue(applications[0] ?? null),
    listApplicationsByCampaign: jest.fn().mockResolvedValue(applications),
    updateApplication: jest.fn().mockImplementation(async (id, data) => ({
      ...applications.find((a) => a.applicationId === id),
      ...data,
    })),
    findApplication: jest.fn().mockResolvedValue(null),
    createApplication: jest.fn().mockResolvedValue({ applicationId: 'new-app', status: 'Pending' }),
  } as unknown as CampaignsRepository;

  // Brand sessions have businessId; creator sessions have providerUserId.
  const defaultSession = opts.brandSession
    ? { businessId: 'b1' }
    : { providerUserId: 'creator1', accessToken: 'tok' };

  const sessionService = {
    get: jest.fn().mockResolvedValue(opts.session !== undefined ? opts.session : defaultSession),
  } as unknown as SessionService;

  const metaService = {
    getBasicProfile: jest.fn().mockResolvedValue({ username: 'testcreator', followerCount: 5000 }),
  } as unknown as MetaService;

  const facade = {
    getActive: jest.fn().mockResolvedValue(opts.subscription ?? { tier: 'creator' }),
    checkConcurrent: jest.fn().mockResolvedValue(
      opts.concurrentCheck ?? { allowed: true, current: 0, cap: 3 },
    ),
    tryConsume: jest.fn().mockResolvedValue(
      opts.tryConsumeResult ?? { allowed: true, newValue: 1, cap: 10 },
    ),
  } as unknown as SubscriptionsFacade;

  const service = new CampaignsService(
    repo,
    sessionService,
    metaService,
    facade,
    { creatorPackagesEnabled: true, isCreatorPackagesEnabledForUser: () => true } as FeatureFlagsService,
  );
  return { service, repo, sessionService, facade };
}

// ── Task 12.3: Creator-tier contact-detail redaction ──────────────────────

describe('CampaignsService.listMarketplace — Task 12.3 creator-tier redaction', () => {
  const contactFields = {
    description: 'Contact us at hello@brand.com or call +91-98765-43210',
    captionGuidelines: 'DM us @brandhandle or visit https://brand.com/collab',
    brandMessaging: 'Email: contact@brand.com, WhatsApp: wa.me/919876543210',
  };

  it('Req 10.2: redacts email, phone, URL, and @handle for creator tier', async () => {
    const campaign = makeCampaign(contactFields);
    const { service } = makeService({
      campaigns: [campaign],
      subscription: { tier: 'creator' },
    });

    const results = await service.listMarketplace('session1');
    const c = results[0];

    expect(c.description).not.toContain('hello@brand.com');
    expect(c.description).not.toContain('+91-98765-43210');
    expect(c.captionGuidelines).not.toContain('@brandhandle');
    expect(c.captionGuidelines).not.toContain('https://brand.com/collab');
    expect(c.brandMessaging).not.toContain('contact@brand.com');
    expect(c.brandMessaging).not.toContain('wa.me/919876543210');
  });

  it('Req 10.6: never redacts brandName regardless of tier', async () => {
    const campaign = makeCampaign(contactFields);
    const { service } = makeService({
      campaigns: [campaign],
      subscription: { tier: 'creator' },
    });

    const results = await service.listMarketplace('session1');
    expect(results[0].brandName).toBe('Acme Brand');
  });

  it('Req 10.5: growth tier sees contact details unredacted', async () => {
    const campaign = makeCampaign(contactFields);
    const { service } = makeService({
      campaigns: [campaign],
      subscription: { tier: 'growth' },
    });

    const results = await service.listMarketplace('session1');
    const c = results[0];

    expect(c.description).toContain('hello@brand.com');
    expect(c.captionGuidelines).toContain('@brandhandle');
  });

  it('Req 10.5: studio tier sees contact details unredacted', async () => {
    const campaign = makeCampaign({
      ...contactFields,
      publishedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 48h ago
    });
    const { service } = makeService({
      campaigns: [campaign],
      subscription: { tier: 'studio' },
    });

    const results = await service.listMarketplace('session1');
    expect(results[0].description).toContain('hello@brand.com');
  });

  it('Req 10.7: falls back to creator-tier redaction when subscription lookup fails', async () => {
    const campaign = makeCampaign(contactFields);
    const { service, facade } = makeService({
      campaigns: [campaign],
      subscription: null,
    });
    (facade.getActive as jest.Mock).mockRejectedValue(new Error('DB error'));

    const results = await service.listMarketplace('session1');
    expect(results[0].description).not.toContain('hello@brand.com');
  });

  it('Req 10.7: falls back to creator-tier redaction when no subscription row exists', async () => {
    const campaign = makeCampaign(contactFields);
    const { service } = makeService({
      campaigns: [campaign],
      subscription: null, // getActive returns null
    });

    const results = await service.listMarketplace('session1');
    expect(results[0].description).not.toContain('hello@brand.com');
  });
});

// ── Task 12.5: Concurrent-campaign cap check ──────────────────────────────

describe('CampaignsService.reviewApplication — Task 12.5 concurrent cap', () => {
  it('Req 2.6: allows approval when creator is under concurrent cap', async () => {
    const { service, repo } = makeService({
      brandSession: true,
      concurrentCheck: { allowed: true, current: 1, cap: 3 },
    });

    const result = await service.reviewApplication('session1', 'c1', 'app1', 'Approved');
    expect(result).toBeDefined();
    expect(repo.updateApplication).toHaveBeenCalledWith('app1', { status: 'Approved' });
  });

  it('Req 3.4: throws ConcurrentLimitReachedError when cap is met', async () => {
    const { service } = makeService({
      brandSession: true,
      concurrentCheck: { allowed: false, current: 3, cap: 3, suggestedTier: 'studio' },
    });

    await expect(
      service.reviewApplication('session1', 'c1', 'app1', 'Approved'),
    ).rejects.toThrow(ConcurrentLimitReachedError);
  });

  it('Req 3.4: throws TierLockedError when creator tier has cap === 0', async () => {
    const { service } = makeService({
      brandSession: true,
      concurrentCheck: { allowed: false, current: 0, cap: 0, suggestedTier: 'growth' },
    });

    await expect(
      service.reviewApplication('session1', 'c1', 'app1', 'Approved'),
    ).rejects.toThrow(TierLockedError);
  });

  it('does NOT check concurrent cap when rejecting an application', async () => {
    const { service, facade } = makeService({
      brandSession: true,
      concurrentCheck: { allowed: false, current: 3, cap: 3, suggestedTier: 'studio' },
    });

    // Rejection should succeed even if concurrent cap would deny approval
    const result = await service.reviewApplication('session1', 'c1', 'app1', 'Rejected');
    expect(result).toBeDefined();
    expect(facade.checkConcurrent).not.toHaveBeenCalled();
  });

  it('Req 3.4: ConcurrentLimitReachedError carries correct fields', async () => {
    const { service } = makeService({
      brandSession: true,
      concurrentCheck: { allowed: false, current: 3, cap: 3, suggestedTier: 'studio' },
    });

    try {
      await service.reviewApplication('session1', 'c1', 'app1', 'Approved');
      fail('Expected ConcurrentLimitReachedError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ConcurrentLimitReachedError);
      expect(err.feature).toBe('concurrent_campaigns');
      expect(err.currentCount).toBe(3);
      expect(err.cap).toBe(3);
      expect(err.suggestedTier).toBe('studio');
    }
  });
});

// ── Task 12.6: Studio early-access window ────────────────────────────────

describe('CampaignsService.listMarketplace — Task 12.6 studio early-access', () => {
  const recentPublishedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
  const oldPublishedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();   // 48h ago

  it('Req 2.8: studio tier sees campaigns published within 24h', async () => {
    const campaign = makeCampaign({ publishedAt: recentPublishedAt });
    const { service } = makeService({
      campaigns: [campaign],
      subscription: { tier: 'studio' },
    });

    const results = await service.listMarketplace('session1');
    expect(results).toHaveLength(1);
  });

  it('Req 2.8: creator tier does NOT see campaigns published within 24h', async () => {
    const campaign = makeCampaign({ publishedAt: recentPublishedAt });
    const { service } = makeService({
      campaigns: [campaign],
      subscription: { tier: 'creator' },
    });

    const results = await service.listMarketplace('session1');
    expect(results).toHaveLength(0);
  });

  it('Req 2.8: growth tier does NOT see campaigns published within 24h', async () => {
    const campaign = makeCampaign({ publishedAt: recentPublishedAt });
    const { service } = makeService({
      campaigns: [campaign],
      subscription: { tier: 'growth' },
    });

    const results = await service.listMarketplace('session1');
    expect(results).toHaveLength(0);
  });

  it('Req 2.8: all tiers see campaigns published more than 24h ago', async () => {
    const campaign = makeCampaign({ publishedAt: oldPublishedAt });

    for (const tier of ['creator', 'growth', 'studio'] as const) {
      const { service } = makeService({
        campaigns: [campaign],
        subscription: { tier },
      });
      const results = await service.listMarketplace('session1');
      expect(results).toHaveLength(1);
    }
  });

  it('Req 2.8: campaigns with no publishedAt are visible to all tiers', async () => {
    const campaign = makeCampaign({ publishedAt: null });

    for (const tier of ['creator', 'growth', 'studio'] as const) {
      const { service } = makeService({
        campaigns: [campaign],
        subscription: { tier },
      });
      const results = await service.listMarketplace('session1');
      expect(results).toHaveLength(1);
    }
  });

  it('Req 2.8: studio sees recent campaign AND non-studio does not (mixed list)', async () => {
    const recentCampaign = makeCampaign({ campaignId: 'c-recent', publishedAt: recentPublishedAt });
    const oldCampaign = makeCampaign({ campaignId: 'c-old', publishedAt: oldPublishedAt });

    const { service: studioService } = makeService({
      campaigns: [recentCampaign, oldCampaign],
      subscription: { tier: 'studio' },
    });
    const studioResults = await studioService.listMarketplace('session1');
    expect(studioResults).toHaveLength(2);

    const { service: growthService } = makeService({
      campaigns: [recentCampaign, oldCampaign],
      subscription: { tier: 'growth' },
    });
    const growthResults = await growthService.listMarketplace('session1');
    expect(growthResults).toHaveLength(1);
    expect(growthResults[0].campaignId).toBe('c-old');
  });
});

// ── Task 12.4: Outbound application cap enforcement ───────────────────────

describe('CampaignsService.applyToCampaign — Task 12.4 outbound cap', () => {
  it('Req 10.8: throws TierLockedError for creator tier (cap = 0)', async () => {
    const { service } = makeService({
      subscription: { tier: 'creator' },
    });

    await expect(
      service.applyToCampaign('session1', 'c1', 'tok'),
    ).rejects.toThrow(TierLockedError);
  });

  it('Req 10.8: TierLockedError carries correct fields for creator tier', async () => {
    const { service } = makeService({
      subscription: { tier: 'creator' },
    });

    try {
      await service.applyToCampaign('session1', 'c1', 'tok');
      fail('Expected TierLockedError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(TierLockedError);
      expect(err.feature).toBe('application_outbound');
      expect(err.currentTier).toBe('creator');
      expect(err.suggestedTier).toBe('growth');
    }
  });

  it('Req 10.7: treats missing subscription as creator tier and throws TierLockedError', async () => {
    const { service } = makeService({
      subscription: null, // getActive returns null
    });

    await expect(
      service.applyToCampaign('session1', 'c1', 'tok'),
    ).rejects.toThrow(TierLockedError);
  });

  it('Req 3.1: growth tier with cap available — calls tryConsume and creates application', async () => {
    const { service, facade, repo } = makeService({
      subscription: { tier: 'growth' },
      tryConsumeResult: { allowed: true, newValue: 1, cap: 10 },
    });

    const result = await service.applyToCampaign('session1', 'c1', 'tok');

    expect(facade.tryConsume).toHaveBeenCalledWith('creator1', 'application_outbound');
    expect(repo.createApplication).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('Req 3.2: throws CapExceededError when growth tier monthly cap is exhausted', async () => {
    const { service } = makeService({
      subscription: { tier: 'growth' },
      tryConsumeResult: {
        allowed: false,
        reason: 'CAP_EXCEEDED',
        current: 10,
        cap: 10,
        suggestedTier: 'studio',
      },
    });

    await expect(
      service.applyToCampaign('session1', 'c1', 'tok'),
    ).rejects.toThrow(CapExceededError);
  });

  it('Req 3.2: CapExceededError carries correct fields', async () => {
    const { service } = makeService({
      subscription: { tier: 'growth' },
      tryConsumeResult: {
        allowed: false,
        reason: 'CAP_EXCEEDED',
        current: 10,
        cap: 10,
        suggestedTier: 'studio',
      },
    });

    try {
      await service.applyToCampaign('session1', 'c1', 'tok');
      fail('Expected CapExceededError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(CapExceededError);
      expect(err.feature).toBe('application_outbound');
      expect(err.currentTier).toBe('growth');
      expect(err.currentUsage).toBe(10);
      expect(err.cap).toBe(10);
      expect(err.suggestedTier).toBe('studio');
    }
  });

  it('Req 3.1: studio tier with unlimited cap (-1) — calls tryConsume and creates application', async () => {
    const { service, facade, repo } = makeService({
      subscription: { tier: 'studio' },
      tryConsumeResult: { allowed: true, newValue: -1, cap: -1 },
    });

    const result = await service.applyToCampaign('session1', 'c1', 'tok');

    expect(facade.tryConsume).toHaveBeenCalledWith('creator1', 'application_outbound');
    expect(repo.createApplication).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('does NOT call tryConsume for creator tier (no counter created per Req 3.3)', async () => {
    const { service, facade } = makeService({
      subscription: { tier: 'creator' },
    });

    try {
      await service.applyToCampaign('session1', 'c1', 'tok');
    } catch {
      // expected TierLockedError
    }

    expect(facade.tryConsume).not.toHaveBeenCalled();
  });
});
