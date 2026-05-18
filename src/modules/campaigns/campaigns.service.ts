// ── Campaigns service ────────────────────────────────────────
// All campaign business logic: validation, lifecycle, ownership
// checks, application management, and submission management.
//
// Ownership is resolved via the session (businessId for brands,
// providerUserId for creators). Brand display names come from the
// brand_profiles table.
//
// Subscription-tier hooks (creator-packages spec):
//   - Task 12.3: Creator-tier listings redact contact details.
//   - Task 12.4: applyToCampaign enforces outbound application cap.
//   - Task 12.5: Collab activation checks concurrent-campaign cap.
//   - Task 12.6: Studio early-access window hides campaigns published
//                within the last 24 h from non-studio tiers.

import { Injectable } from '@nestjs/common';
import { CampaignsRepository } from './campaigns.repository';
import { SessionService } from '../../common/services/session.service';
import { MetaService } from '../meta/meta.service';
import { SubscriptionsFacade } from '../subscriptions/subscriptions.facade';
import { FeatureFlagsService } from '../../common/config/feature-flags.service';
import {
  VALID_TRANSITIONS,
  REQUIRED_CAMPAIGN_FIELDS,
} from './campaigns.types';
import {
  CampaignNotFoundError,
  CampaignValidationError,
  InvalidStatusTransitionError,
  CampaignNotEditableError,
  ApplicationNotFoundError,
  DuplicateApplicationError,
  SlotsFullError,
  SubmissionNotFoundError,
  SubmissionForbiddenError,
} from './campaigns.errors';
import {
  CapExceededError,
  ConcurrentLimitReachedError,
  TierLockedError,
} from '../subscriptions/subscriptions.errors';
import { UnauthorizedError, ValidationError } from '../../common/errors/app.errors';

// ── Contact-detail redaction ───────────────────────────────────────────────
//
// Requirement 10.2: creator-tier users must not see direct contact details
// in campaign payloads. The patterns below cover the common forms:
//   - Email addresses
//   - Phone numbers (international and local formats)
//   - HTTP/HTTPS URLs
//   - @handle DM references
//
// The redaction is applied to every string field in the campaign object
// EXCEPT `brandName` (Req 10.6: brand name must never be redacted).
// Free-text fields (description, guidelines, etc.) are also scrubbed so
// that a brand cannot embed contact info in prose.

const CONTACT_PATTERNS: RegExp[] = [
  // Email addresses
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
  // Phone numbers: +91-XXXXX-XXXXX, (XXX) XXX-XXXX, XXX.XXX.XXXX, etc.
  /(\+?\d[\d\s\-().]{7,}\d)/g,
  // HTTP/HTTPS URLs
  /https?:\/\/[^\s"'<>]+/gi,
  // @handle DM references (Instagram, Twitter, etc.)
  /@[a-zA-Z0-9_.]{1,50}/g,
  // WhatsApp / Telegram / Signal links
  /(?:wa\.me|t\.me|signal\.me)\/[^\s"'<>]+/gi,
];

const REDACTION_PLACEHOLDER = '[contact details hidden — upgrade to view]';

/** Scrub a single string value of all contact-detail patterns. */
function redactString(value: string): string {
  let result = value;
  for (const pattern of CONTACT_PATTERNS) {
    pattern.lastIndex = 0; // reset global regex state
    result = result.replace(pattern, REDACTION_PLACEHOLDER);
  }
  return result;
}

/**
 * Walk every string field of a campaign record and redact contact details.
 * `brandName` is explicitly preserved (Req 10.6).
 */
function redactCampaignContactDetails(campaign: Record<string, any>): Record<string, any> {
  const PRESERVE_FIELDS = new Set([
    'campaignId', 'businessId', 'brandName', 'status',
    'createdAt', 'updatedAt', 'publishedAt',
    'approvedCount', 'totalSlots', 'reserveSlots',
    'totalBudget', 'budgetPerCreator',
    'ageGroupMin', 'ageGroupMax',
    'minimumFollowers', 'requiredEngagementRate',
    'revisionAllowedCount', 'autoApproveAfterHours',
    'reviewTurnaroundHours', 'contentCountPerInfluencer',
    'commissionRate',
  ]);

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(campaign)) {
    if (PRESERVE_FIELDS.has(key)) {
      result[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      result[key] = redactString(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === 'string' ? redactString(item) : item,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── Studio early-access window ─────────────────────────────────────────────
//
// Requirement 2.8: studio-tier users get a 24-hour head start on newly
// published campaigns. Campaigns published within the last 24 h are
// excluded from the marketplace listing for non-studio tiers.

const STUDIO_EARLY_ACCESS_HOURS = 24;

function isWithinEarlyAccessWindow(campaign: Record<string, any>): boolean {
  const publishedAt: Date | string | null = campaign.publishedAt ?? null;
  if (!publishedAt) return false;
  const publishedMs = new Date(publishedAt).getTime();
  const windowMs = STUDIO_EARLY_ACCESS_HOURS * 60 * 60 * 1000;
  return Date.now() - publishedMs < windowMs;
}

@Injectable()
export class CampaignsService {
  constructor(
    private readonly campaignsRepository: CampaignsRepository,
    private readonly sessionService: SessionService,
    private readonly metaService: MetaService,
    private readonly subscriptionsFacade: SubscriptionsFacade,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  // ── Session helpers ────────────────────────────────────────

  private async requireBrandSession(sessionId: string): Promise<string> {
    const session = await this.sessionService.get(sessionId);
    if (!session || !session.businessId) {
      throw new UnauthorizedError('Not authenticated');
    }
    return session.businessId;
  }

  private async requireCreatorSession(sessionId: string): Promise<{
    providerUserId: string;
    accessToken: string;
  }> {
    const session = await this.sessionService.get(sessionId);
    if (!session || !session.providerUserId || !session.accessToken) {
      throw new UnauthorizedError('Not authenticated');
    }
    return {
      providerUserId: session.providerUserId,
      accessToken: session.accessToken,
    };
  }

  // ── Validation ─────────────────────────────────────────────
  private validateCampaignData(data: Record<string, any>): void {
    for (const field of REQUIRED_CAMPAIGN_FIELDS) {
      if (data[field] === undefined || data[field] === null || data[field] === '') {
        throw new CampaignValidationError(`${field} is required`);
      }
    }

    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    const appDeadline = new Date(data.applicationDeadline);
    const subDeadline = new Date(data.submissionDeadline);
    const contentDeadline = new Date(data.contentDeadline);

    if (end <= start) throw new CampaignValidationError('End date must be after start date');
    if (appDeadline >= start) throw new CampaignValidationError('Application deadline must be before start date');
    if (subDeadline > end) throw new CampaignValidationError('Submission deadline must be on or before end date');
    if (contentDeadline > subDeadline) throw new CampaignValidationError('Content deadline must be on or before submission deadline');

    if (Number(data.budgetPerCreator) > Number(data.totalBudget)) {
      throw new CampaignValidationError('Budget per creator cannot exceed total campaign budget');
    }

    const ageMin = Number(data.ageGroupMin);
    const ageMax = Number(data.ageGroupMax);
    if (ageMin >= ageMax) throw new CampaignValidationError('Minimum age must be less than maximum age');

    if (data.reserveSlots !== undefined && data.reserveSlots !== null) {
      if (Number(data.reserveSlots) > Number(data.totalSlots)) {
        throw new CampaignValidationError('Reserve slots cannot exceed total slots');
      }
    }
  }

  // ── Campaign CRUD ──────────────────────────────────────────

  async createCampaign(sessionId: string, data: Record<string, any>) {
    this.validateCampaignData(data);
    const businessId = await this.requireBrandSession(sessionId);
    return this.campaignsRepository.createCampaign(businessId, data);
  }

  async listCampaigns(sessionId: string) {
    const businessId = await this.requireBrandSession(sessionId);
    const campaignList = await this.campaignsRepository.listByBusiness(businessId);

    const approvedCounts = await this.campaignsRepository.getApprovedCounts(
      campaignList.map((c) => c.campaignId),
    );
    return campaignList.map((campaign) => ({
      ...campaign,
      approvedCount: approvedCounts[campaign.campaignId] ?? 0,
    }));
  }

  async getCampaign(sessionId: string, campaignId: string) {
    const businessId = await this.requireBrandSession(sessionId);
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.businessId !== businessId) {
      throw new CampaignNotFoundError();
    }
    const apps = await this.campaignsRepository.listApplicationsByCampaign(campaignId);
    const approvedCount = apps.filter((a) => a.status === 'Approved').length;
    return { ...campaign, approvedCount };
  }

  async updateCampaign(sessionId: string, campaignId: string, data: Record<string, any>) {
    const businessId = await this.requireBrandSession(sessionId);
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.businessId !== businessId) {
      throw new CampaignNotFoundError();
    }
    const terminalStates = ['Completed', 'Cancelled', 'Archived'];
    if (terminalStates.includes(campaign.status)) {
      throw new CampaignNotEditableError();
    }
    const merged = { ...campaign, ...data };
    this.validateCampaignData(merged);
    return (await this.campaignsRepository.updateCampaign(campaignId, data))!;
  }

  async updateStatus(sessionId: string, campaignId: string, newStatus: string) {
    const businessId = await this.requireBrandSession(sessionId);
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.businessId !== businessId) {
      throw new CampaignNotFoundError();
    }

    const allowed = VALID_TRANSITIONS[campaign.status as keyof typeof VALID_TRANSITIONS] || [];
    if (!allowed.includes(newStatus as any)) {
      throw new InvalidStatusTransitionError(campaign.status, newStatus);
    }

    if (newStatus === 'Published') {
      this.validateCampaignData(campaign);
    }

    if (newStatus === 'Active') {
      const now = new Date();
      const startDate = new Date(campaign.startDate);
      if (now < startDate) {
        throw new CampaignValidationError('Cannot activate campaign before start date');
      }
    }

    // ── Task 12.6: stamp publishedAt when transitioning to Published ──────
    // Requirement 2.8: studio early-access window is measured from this
    // timestamp. Set it once on the first Published transition only.
    const extraUpdate: Record<string, any> = { status: newStatus };
    if (newStatus === 'Published' && !campaign.publishedAt) {
      extraUpdate.publishedAt = new Date();
    }

    return (await this.campaignsRepository.updateCampaign(campaignId, extraUpdate))!;
  }

  // ── Applications (Brand side) ──────────────────────────────

  async listApplications(sessionId: string, campaignId: string) {
    const businessId = await this.requireBrandSession(sessionId);
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.businessId !== businessId) {
      throw new CampaignNotFoundError();
    }
    return this.campaignsRepository.listApplicationsByCampaign(campaignId);
  }

  async getCreatorCampaignsForBrand(sessionId: string, creatorId: string) {
    const businessId = await this.requireBrandSession(sessionId);
    const brandCampaigns = await this.campaignsRepository.listByBusiness(businessId);
    const results = [];
    for (const campaign of brandCampaigns) {
      const application = await this.campaignsRepository.findApplication(
        campaign.campaignId,
        creatorId,
      );
      if (application) {
        results.push({
          ...campaign,
          applicationStatus: application.status,
          applicationId: application.applicationId,
          appliedAt: application.createdAt,
        });
      }
    }
    return results;
  }

  async reviewApplication(sessionId: string, campaignId: string, applicationId: string, status: string) {
    const businessId = await this.requireBrandSession(sessionId);
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.businessId !== businessId) {
      throw new CampaignNotFoundError();
    }

    const application = await this.campaignsRepository.getApplication(applicationId);
    if (!application || application.campaignId !== campaignId) {
      throw new ApplicationNotFoundError();
    }

    if (!['Approved', 'Rejected'].includes(status)) {
      throw new ValidationError('Status must be "Approved" or "Rejected"');
    }

    if (status === 'Approved') {
      const allApps = await this.campaignsRepository.listApplicationsByCampaign(campaignId);
      const approvedCount = allApps.filter((a) => a.status === 'Approved').length;
      if (approvedCount >= Number(campaign.totalSlots)) {
        throw new SlotsFullError();
      }

      // ── Task 12.5: concurrent-campaign cap check ───────────────────────
      // Requirements 2.6, 3.4: before a collab transitions to active (i.e.
      // an application is Approved), verify the creator has not hit their
      // concurrent active campaigns cap. Deny with CONCURRENT_LIMIT_REACHED
      // if the cap is met, or TierLockedError if the tier has cap === 0.
      //
      // Requirement 10.7: if the subscription cannot be resolved, treat as
      // creator tier (most restrictive) — SubscriptionNotFoundError is
      // re-thrown so the caller sees a clear denial.
      const concurrentCheck = await this.subscriptionsFacade.checkConcurrent(
        application.influencerId,
      );
      if (!concurrentCheck.allowed) {
        if (concurrentCheck.cap === 0) {
          // Creator tier: concurrent campaigns not permitted at all.
          throw new TierLockedError(
            'concurrent_campaigns',
            'creator',
            concurrentCheck.suggestedTier ?? 'growth',
          );
        }
        throw new ConcurrentLimitReachedError(
          'concurrent_campaigns',
          concurrentCheck.current,
          concurrentCheck.cap,
          concurrentCheck.suggestedTier ?? 'studio',
        );
      }
    }

    return (await this.campaignsRepository.updateApplication(applicationId, { status: status as any }))!;
  }

  // ── Submissions (Brand side) ───────────────────────────────

  async listSubmissions(sessionId: string, campaignId: string) {
    const businessId = await this.requireBrandSession(sessionId);
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.businessId !== businessId) {
      throw new CampaignNotFoundError();
    }

    const subs = await this.campaignsRepository.listSubmissionsByCampaign(campaignId);

    const missingUsername = subs.filter((s) => !s.influencerUsername);
    if (missingUsername.length > 0) {
      const apps = await this.campaignsRepository.listApplicationsByCampaign(campaignId);
      const handleByInfluencer = new Map(
        apps.filter((a) => a.username).map((a) => [a.influencerId, a.username]),
      );
      for (const sub of missingUsername) {
        const handle = handleByInfluencer.get(sub.influencerId);
        if (handle) sub.influencerUsername = handle;
      }
    }

    if (campaign.requireApproval && campaign.autoApproveAfterHours) {
      const now = new Date();
      const autoApproveMs = Number(campaign.autoApproveAfterHours) * 60 * 60 * 1000;
      for (const sub of subs) {
        if (sub.status === 'Pending_Review') {
          const elapsed = now.getTime() - new Date(sub.createdAt).getTime();
          if (elapsed > autoApproveMs) {
            sub.status = 'Approved';
          }
        }
      }
    }

    return subs;
  }

  async reviewSubmission(
    sessionId: string,
    campaignId: string,
    submissionId: string,
    status: string,
    revisionNotes?: string,
  ) {
    const businessId = await this.requireBrandSession(sessionId);
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.businessId !== businessId) {
      throw new CampaignNotFoundError();
    }

    const submission = await this.campaignsRepository.getSubmission(submissionId);
    if (!submission || submission.campaignId !== campaignId) {
      throw new SubmissionNotFoundError();
    }

    if (!['Approved', 'Revision_Requested'].includes(status)) {
      throw new ValidationError('Status must be "Approved" or "Revision_Requested"');
    }

    const updateData: Record<string, any> = { status };
    if (revisionNotes) updateData.revisionNotes = revisionNotes;

    return (await this.campaignsRepository.updateSubmission(submissionId, updateData))!;
  }

  // ── Marketplace (Influencer side) ──────────────────────────

  async listMarketplace(sessionId: string, niche?: string, brand?: string) {
    const published = await this.campaignsRepository.listPublished();

    const businessIds = published.map((c) => c.businessId);
    const brandNames = await this.campaignsRepository.getBrandNames(businessIds);
    const approvedCounts = await this.campaignsRepository.getApprovedCounts(
      published.map((c) => c.campaignId),
    );

    const results = published.map((campaign) => ({
      ...campaign,
      brandName: brandNames[campaign.businessId] ?? 'Unknown Brand',
      approvedCount: approvedCounts[campaign.campaignId] ?? 0,
    }));

    // ── Tasks 12.3 + 12.6: resolve creator tier ────────────────────────
    // Requirement 10.7: if the tier cannot be resolved, treat as `creator`
    // (most restrictive). This covers unauthenticated requests and missing
    // subscription rows.
    //
    // Feature flag bypass (design §Migration & Rollout): when
    // creator_packages_enabled is off (globally, or for this specific user
    // during a percentage rollout), skip tier-based filtering and redaction
    // entirely — all features are open as in the old behaviour.
    let creatorTier: 'creator' | 'growth' | 'studio' = 'creator';
    let flagOnForUser = false;
    let resolvedUserId: string | undefined;
    try {
      const session = await this.sessionService.get(sessionId);
      resolvedUserId = session?.providerUserId;
    } catch {
      resolvedUserId = undefined;
    }
    flagOnForUser = this.featureFlags.isCreatorPackagesEnabledForUser(resolvedUserId);

    if (flagOnForUser && resolvedUserId) {
      try {
        const sub = await this.subscriptionsFacade.getActive(resolvedUserId);
        if (sub) {
          creatorTier = sub.tier as 'creator' | 'growth' | 'studio';
        }
      } catch {
        // Subscription lookup failed — fall back to creator tier (Req 10.7).
        creatorTier = 'creator';
      }
    } else if (!flagOnForUser) {
      // Flag off for this user: treat them as studio so nothing is filtered or redacted.
      creatorTier = 'studio';
    }

    let filtered: any[] = results;

    // ── Task 12.6: studio early-access window ─────────────────────────
    // Requirement 2.8: campaigns published within the last 24 h are only
    // visible to studio-tier users. Non-studio tiers see them after the
    // window expires.
    if (creatorTier !== 'studio') {
      filtered = filtered.filter((c) => !isWithinEarlyAccessWindow(c));
    }

    // ── Task 12.3: creator-tier contact-detail redaction ──────────────
    // Requirements 10.1, 10.2, 10.5, 10.6: creator-tier users see brand
    // name, budget, deliverables, and description but NOT direct contact
    // details (email, phone, URL, DM handle, free-text patterns).
    if (creatorTier === 'creator') {
      filtered = filtered.map((c) => redactCampaignContactDetails(c));
    }

    // Filter by brand name if provided.
    if (brand) {
      const brandLower = brand.toLowerCase();
      filtered = filtered.filter((c) => {
        const campaignBrand = (c.brandName || '').toLowerCase();
        return campaignBrand === brandLower;
      });
    }

    // If niche filter provided, only show matching campaigns.
    if (niche) {
      const nicheList = niche.split(',').map((n) => n.trim().toLowerCase());
      filtered = filtered.filter((c) => {
        const campaignNiche = ((c as any).preferredNiche || '').toLowerCase();
        if (!campaignNiche) return true;
        return nicheList.includes(campaignNiche);
      });
    }

    return filtered;
  }

  async applyToCampaign(sessionId: string, campaignId: string, accessToken: string) {
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign) throw new CampaignNotFoundError();

    if (campaign.status !== 'Published' && campaign.status !== 'Active') {
      throw new ValidationError('Campaign is not accepting applications');
    }

    const { providerUserId } = await this.requireCreatorSession(sessionId);

    const existing = await this.campaignsRepository.findApplication(campaignId, providerUserId);
    if (existing) throw new DuplicateApplicationError();

    const allApps = await this.campaignsRepository.listApplicationsByCampaign(campaignId);
    const approvedCount = allApps.filter((a) => a.status === 'Approved').length;
    if (approvedCount >= Number(campaign.totalSlots)) {
      throw new ValidationError('No available slots for this campaign');
    }

    // ── Task 12.4: outbound application cap enforcement ────────────────────
    // Requirements 2.2, 10.8, 3.1, 3.2:
    //   - creator tier has cap = 0 → always deny with TIER_LOCKED
    //   - growth/studio tiers → atomically consume one application_outbound
    //     credit; deny with CAP_EXCEEDED if the monthly cap is exhausted
    //
    // Requirement 10.7: if the subscription cannot be resolved, treat as
    // creator tier (most restrictive) and deny.
    const sub = await this.subscriptionsFacade.getActive(providerUserId);
    const tier = sub?.tier ?? 'creator';

    if (tier === 'creator') {
      throw new TierLockedError('application_outbound', 'creator', 'growth');
    }

    // Paid tier: atomically check and consume the monthly cap.
    const result = await this.subscriptionsFacade.tryConsume(providerUserId, 'application_outbound');
    if (!result.allowed) {
      const denied = result as Extract<typeof result, { allowed: false }>;
      if (denied.reason === 'TIER_LOCKED') {
        throw new TierLockedError(
          'application_outbound',
          tier,
          denied.suggestedTier,
        );
      }
      // CAP_EXCEEDED
      throw new CapExceededError(
        'application_outbound',
        tier,
        denied.current,
        denied.cap,
        denied.suggestedTier,
      );
    }

    const { username, followerCount } = await this.metaService.getBasicProfile(accessToken);

    return this.campaignsRepository.createApplication(campaignId, providerUserId, {
      username,
      followerCount,
    });
  }

  async getMyApplication(sessionId: string, campaignId: string) {
    const { providerUserId } = await this.requireCreatorSession(sessionId);
    const application = await this.campaignsRepository.findApplication(campaignId, providerUserId);
    if (!application) throw new ApplicationNotFoundError();
    return application;
  }

  async submitContent(
    sessionId: string,
    campaignId: string,
    data: { contentUrl?: string; contentCaption?: string; notesToBrand?: string },
  ) {
    const { providerUserId } = await this.requireCreatorSession(sessionId);

    const application = await this.campaignsRepository.findApplication(campaignId, providerUserId);
    if (!application || application.status !== 'Approved') {
      throw new SubmissionForbiddenError();
    }

    return this.campaignsRepository.createSubmission(campaignId, providerUserId, {
      ...data,
      influencerUsername: application.username,
    });
  }

  async getMyCampaigns(sessionId: string) {
    const { providerUserId } = await this.requireCreatorSession(sessionId);

    const myApps = await this.campaignsRepository.listApplicationsByInfluencer(providerUserId);

    const campaignMap = new Map<string, Awaited<ReturnType<CampaignsRepository['getCampaign']>>>();
    for (const app of myApps) {
      if (!campaignMap.has(app.campaignId)) {
        campaignMap.set(app.campaignId, await this.campaignsRepository.getCampaign(app.campaignId));
      }
    }

    const campaignsList = Array.from(campaignMap.values()).filter(
      (c): c is NonNullable<typeof c> => !!c,
    );
    const businessIds = campaignsList.map((c) => c.businessId);
    const brandNames = await this.campaignsRepository.getBrandNames(businessIds);
    const approvedCounts = await this.campaignsRepository.getApprovedCounts(
      campaignsList.map((c) => c.campaignId),
    );

    const results = [];
    for (const app of myApps) {
      const campaign = campaignMap.get(app.campaignId);
      if (!campaign) continue;

      results.push({
        ...campaign,
        brandName: brandNames[campaign.businessId] ?? 'Unknown Brand',
        approvedCount: approvedCounts[campaign.campaignId] ?? 0,
        applicationStatus: app.status,
        applicationId: app.applicationId,
        appliedAt: app.createdAt,
      });
    }
    return results;
  }
}
