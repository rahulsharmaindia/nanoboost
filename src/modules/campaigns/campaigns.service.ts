// ── Campaigns service ────────────────────────────────────────
// All campaign business logic: validation, lifecycle, ownership
// checks, application management, and submission management.
//
// Ownership is resolved via the session (businessId for brands,
// providerUserId for creators). Brand display names come from the
// brand_profiles table.

import { Injectable } from '@nestjs/common';
import { CampaignsRepository } from './campaigns.repository';
import { InfluencerSessionService } from '../../common/services/influencer-session.service';
import { BrandSessionService } from '../../common/services/brand-session.service';
import { MetaService } from '../meta/meta.service';
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
import { UnauthorizedError, ValidationError } from '../../common/errors/app.errors';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly campaignsRepository: CampaignsRepository,
    private readonly influencerSessionService: InfluencerSessionService,
    private readonly brandSessionService: BrandSessionService,
    private readonly metaService: MetaService,
  ) {}

  // ── Session helpers ────────────────────────────────────────

  private async requireBrandSession(sessionId: string): Promise<string> {
    const session = await this.brandSessionService.getSession(sessionId);
    if (!session) {
      throw new UnauthorizedError('Not authenticated');
    }
    return session.brandId;
  }

  private async requireCreatorSession(sessionId: string): Promise<{
    influencerId: string;
    accessToken: string;
  }> {
    const session = await this.influencerSessionService.getSession(sessionId);
    if (!session || !session.accessToken) {
      throw new UnauthorizedError('Not authenticated');
    }
    return {
      influencerId: session.influencerId,
      accessToken: session.accessToken,
    };
  }

  // ── Validation ─────────────────────────────────────────────
  //
  // Field-level shape and bounds checks live in CreateCampaignDto /
  // UpdateCampaignDto via class-validator. This method covers the
  // cross-field rules that don't fit on a single decorator.
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
    const brandId = await this.requireBrandSession(sessionId);
    return this.campaignsRepository.createCampaign(brandId, data);
  }

  async listCampaigns(sessionId: string) {
    const brandId = await this.requireBrandSession(sessionId);
    const campaignList = await this.campaignsRepository.listByBrand(brandId);

    const approvedCounts = await this.campaignsRepository.getApprovedCounts(
      campaignList.map((c) => c.campaignId),
    );
    return campaignList.map((campaign) => ({
      ...campaign,
      approvedCount: approvedCounts[campaign.campaignId] ?? 0,
    }));
  }

  async getCampaign(sessionId: string, campaignId: string) {
    const brandId = await this.requireBrandSession(sessionId);
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.brandId !== brandId) {
      throw new CampaignNotFoundError();
    }
    const apps = await this.campaignsRepository.listApplicationsByCampaign(campaignId);
    const approvedCount = apps.filter((a) => a.status === 'Approved').length;
    return { ...campaign, approvedCount };
  }

  async updateCampaign(sessionId: string, campaignId: string, data: Record<string, any>) {
    const brandId = await this.requireBrandSession(sessionId);
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.brandId !== brandId) {
      throw new CampaignNotFoundError();
    }
    // Editing is blocked only for terminal lifecycle states.
    const terminalStates = ['Completed', 'Cancelled', 'Archived'];
    if (terminalStates.includes(campaign.status)) {
      throw new CampaignNotEditableError();
    }
    const merged = { ...campaign, ...data };
    this.validateCampaignData(merged);
    return (await this.campaignsRepository.updateCampaign(campaignId, data))!;
  }

  async updateStatus(sessionId: string, campaignId: string, newStatus: string) {
    const brandId = await this.requireBrandSession(sessionId);
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.brandId !== brandId) {
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

    return (await this.campaignsRepository.updateCampaign(campaignId, { status: newStatus }))!;
  }

  // ── Applications (Brand side) ──────────────────────────────

  async listApplications(sessionId: string, campaignId: string) {
    const brandId = await this.requireBrandSession(sessionId);
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.brandId !== brandId) {
      throw new CampaignNotFoundError();
    }
    return this.campaignsRepository.listApplicationsByCampaign(campaignId);
  }

  /**
   * Returns all campaigns owned by the authenticated brand where the given
   * creator has applied or been approved, along with their application status.
   */
  async getCreatorCampaignsForBrand(sessionId: string, creatorId: string) {
    const brandId = await this.requireBrandSession(sessionId);

    const brandCampaigns = await this.campaignsRepository.listByBrand(brandId);

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
    const brandId = await this.requireBrandSession(sessionId);
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.brandId !== brandId) {
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
    }

    return (await this.campaignsRepository.updateApplication(applicationId, { status: status as any }))!;
  }

  // ── Submissions (Brand side) ───────────────────────────────

  async listSubmissions(sessionId: string, campaignId: string) {
    const brandId = await this.requireBrandSession(sessionId);
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.brandId !== brandId) {
      throw new CampaignNotFoundError();
    }

    const subs = await this.campaignsRepository.listSubmissionsByCampaign(campaignId);

    // Backfill missing influencerUsername from the corresponding
    // approved application.
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

    // Auto-approve logic
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
    const brandId = await this.requireBrandSession(sessionId);
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.brandId !== brandId) {
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

  async listMarketplace(_sessionId: string, niche?: string, brand?: string) {
    const published = await this.campaignsRepository.listPublished();

    const brandIds = published.map((c) => c.brandId);
    const brandInfo = await this.campaignsRepository.getBrandInfo(brandIds);
    const approvedCounts = await this.campaignsRepository.getApprovedCounts(
      published.map((c) => c.campaignId),
    );

    const results = published.map((campaign) => ({
      ...campaign,
      brandName: brandInfo[campaign.brandId]?.name ?? 'Unknown Brand',
      businessId: brandInfo[campaign.brandId]?.businessId ?? null,
      approvedCount: approvedCounts[campaign.campaignId] ?? 0,
    }));

    let filtered = results;

    if (brand) {
      const brandLower = brand.toLowerCase();
      filtered = filtered.filter((c) => (c.brandName || '').toLowerCase() === brandLower);
    }

    if (niche) {
      const nicheList = niche.split(',').map((n) => n.trim().toLowerCase());
      filtered = filtered.filter((c) => {
        const campaignNiche = ((c as any).preferredNiche || '').toLowerCase();
        if (!campaignNiche) return true; // no niche = open to all
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

    const { influencerId } = await this.requireCreatorSession(sessionId);

    const existing = await this.campaignsRepository.findApplication(campaignId, influencerId);
    if (existing) throw new DuplicateApplicationError();

    const allApps = await this.campaignsRepository.listApplicationsByCampaign(campaignId);
    const approvedCount = allApps.filter((a) => a.status === 'Approved').length;
    if (approvedCount >= Number(campaign.totalSlots)) {
      throw new ValidationError('No available slots for this campaign');
    }

    const { username, followerCount } = await this.metaService.getBasicProfile(accessToken);

    return this.campaignsRepository.createApplication(campaignId, influencerId, {
      username,
      followerCount,
    });
  }

  async getMyApplication(sessionId: string, campaignId: string) {
    const { influencerId } = await this.requireCreatorSession(sessionId);
    const application = await this.campaignsRepository.findApplication(campaignId, influencerId);
    if (!application) throw new ApplicationNotFoundError();
    return application;
  }

  async submitContent(
    sessionId: string,
    campaignId: string,
    data: { contentUrl?: string; contentCaption?: string; notesToBrand?: string },
  ) {
    const { influencerId } = await this.requireCreatorSession(sessionId);

    const application = await this.campaignsRepository.findApplication(campaignId, influencerId);
    if (!application || application.status !== 'Approved') {
      throw new SubmissionForbiddenError();
    }

    return this.campaignsRepository.createSubmission(campaignId, influencerId, {
      ...data,
      influencerUsername: application.username,
    });
  }

  async getMyCampaigns(sessionId: string) {
    const { influencerId } = await this.requireCreatorSession(sessionId);

    const myApps = await this.campaignsRepository.listApplicationsByInfluencer(influencerId);

    const campaignMap = new Map<string, Awaited<ReturnType<CampaignsRepository['getCampaign']>>>();
    for (const app of myApps) {
      if (!campaignMap.has(app.campaignId)) {
        campaignMap.set(app.campaignId, await this.campaignsRepository.getCampaign(app.campaignId));
      }
    }

    const campaignsList = Array.from(campaignMap.values()).filter(
      (c): c is NonNullable<typeof c> => !!c,
    );
    const brandIds = campaignsList.map((c) => c.brandId);
    const brandInfo = await this.campaignsRepository.getBrandInfo(brandIds);
    const approvedCounts = await this.campaignsRepository.getApprovedCounts(
      campaignsList.map((c) => c.campaignId),
    );

    const results = [];
    for (const app of myApps) {
      const campaign = campaignMap.get(app.campaignId);
      if (!campaign) continue;

      results.push({
        ...campaign,
        brandName: brandInfo[campaign.brandId]?.name ?? 'Unknown Brand',
        businessId: brandInfo[campaign.brandId]?.businessId ?? null,
        approvedCount: approvedCounts[campaign.campaignId] ?? 0,
        applicationStatus: app.status,
        applicationId: app.applicationId,
        appliedAt: app.createdAt,
      });
    }
    return results;
  }
}
