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
    accessToken: string | null;
  }> {
    const session = await this.influencerSessionService.getSession(sessionId);
    if (!session) {
      throw new UnauthorizedError('Not authenticated');
    }
    // Google-only influencers have no Instagram access token — that's
    // fine for campaign actions (apply, submit, browse). Only reject if
    // there's no valid session at all.
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

  async getBrandStats(sessionId: string): Promise<{ activeCampaignCount: number; pendingApplicationsCount: number }> {
    const brandId = await this.requireBrandSession(sessionId);
    return this.campaignsRepository.getBrandStats(brandId);
  }

  async createCampaign(sessionId: string, data: Record<string, any>) {
    // Drafts can be saved incomplete; full validation runs when the
    // campaign is published (createCampaign with a non-draft status, or
    // a later Draft → Published status transition).
    if (data.status !== 'Draft') {
      this.validateCampaignData(data);
    }
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
    // Terminal states cannot be edited at all.
    const terminalStates = ['Completed', 'Cancelled', 'Archived'];
    if (terminalStates.includes(campaign.status)) {
      throw new CampaignNotEditableError();
    }
    // Prevent backward status transitions.
    // A Published/Active/Completed/Cancelled/Archived campaign cannot be
    // saved back to Draft via a direct update — the client must create a
    // new draft instead (handled client-side by the confirmation dialog).
    const nonDraftStates = ['Published', 'Active', 'Completed', 'Cancelled', 'Archived'];
    if (nonDraftStates.includes(campaign.status) && data.status === 'Draft') {
      throw new CampaignValidationError(
        `Cannot move a ${campaign.status} campaign back to Draft. ` +
        'Create a new draft from the wizard instead.',
      );
    }
    const merged = { ...campaign, ...data };
    // Skip the mandatory-field + cross-field checks while the campaign
    // remains a draft. Publishing still validates (here when a non-draft
    // payload is saved, and in updateStatus on the Draft → Published move).
    if (merged.status !== 'Draft') {
      this.validateCampaignData(merged);
    }
    return (await this.campaignsRepository.updateCampaign(campaignId, data))!;
  }

  /**
   * Creates a copy of an existing campaign as a new Draft.
   * All campaign fields are copied; status is reset to 'Draft',
   * the title is prefixed with "Copy of ", and the new campaign
   * starts with no applications or submissions.
   * Usable both from the detail screen (explicit "Duplicate" button) and
   * from the wizard when saving a Published/Active campaign as a new draft.
   */
  async duplicateCampaign(sessionId: string, campaignId: string): Promise<any> {
    const brandId = await this.requireBrandSession(sessionId);
    const source = await this.campaignsRepository.getCampaign(campaignId);
    if (!source || source.brandId !== brandId) {
      throw new CampaignNotFoundError();
    }

    // Strip server-managed fields; reset lifecycle fields.
    const {
      campaignId: _id,
      brandId: _brandId,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      status: _status,
      ...rest
    } = source as any;

    const draftData = {
      ...rest,
      status: 'Draft',
      title: `Copy of ${source.title ?? 'Campaign'}`,
    };

    return this.campaignsRepository.createCampaign(brandId, draftData);
  }

  /**
   * Permanently deletes an Archived campaign.
   * Only allowed once the campaign has been in Archived state for at least
   * 7 days (measured by updatedAt, which is stamped when status changes).
   */
  async deleteCampaign(sessionId: string, campaignId: string): Promise<void> {
    const brandId = await this.requireBrandSession(sessionId);
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.brandId !== brandId) {
      throw new CampaignNotFoundError();
    }
    if (campaign.status !== 'Archived') {
      throw new CampaignValidationError('Only Archived campaigns can be deleted');
    }
    const archivedMs = Date.now() - new Date(campaign.updatedAt).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (archivedMs < sevenDaysMs) {
      throw new CampaignValidationError(
        'Campaign can only be deleted after it has been archived for at least 7 days',
      );
    }
    await this.campaignsRepository.deleteCampaign(campaignId);
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

  async listMarketplace(
    _sessionId: string,
    niche?: string,
    brand?: string,
    search?: string,
    includeExpired?: boolean,
  ) {
    const published = includeExpired
      ? await this.campaignsRepository.listPublishedIncludingExpired()
      : await this.campaignsRepository.listPublished();

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
      // Flag expired campaigns so the client can render them differently
      isExpired:
        campaign.applicationDeadline != null &&
        campaign.applicationDeadline < new Date().toISOString().split('T')[0],
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

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          ((c as any).title || '').toLowerCase().includes(q) ||
          (c.brandName || '').toLowerCase().includes(q) ||
          ((c as any).description || '').toLowerCase().includes(q),
      );
    }

    const statusOrder: Record<string, number> = {
      Active: 0,
      Published: 1,
      Completed: 2,
    };

    return filtered.sort((a, b) => {
      const aOrder = statusOrder[(a as any).status] ?? 99;
      const bOrder = statusOrder[(b as any).status] ?? 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Within same status, newest first
      return new Date((b as any).createdAt ?? 0).getTime() -
        new Date((a as any).createdAt ?? 0).getTime();
    });
  }

  async searchBrands(params: {
    query?: string;
    industry?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 20, 50);
    const offset = (page - 1) * limit;
    const { items, total } = await this.campaignsRepository.searchBrands({
      query: params.query,
      industry: params.industry,
      limit,
      offset,
    });
    return { items, total, page, hasMore: offset + items.length < total };
  }

  async applyToCampaign(sessionId: string, campaignId: string, accessToken: string | null) {
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

    // For Google-only influencers with no Instagram token, fall back to
    // the data stored on the influencer row from onboarding.
    let username: string | null = null;
    let followerCount: number | null = null;
    if (accessToken) {
      const profile = await this.metaService.getBasicProfile(accessToken);
      username = profile.username;
      followerCount = profile.followerCount;
    } else {
      const session = await this.influencerSessionService.getSession(sessionId);
      // Use instagram_handle set during onboarding as the username fallback.
      username = (session as any)?.instagramHandle ?? null;
    }

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
