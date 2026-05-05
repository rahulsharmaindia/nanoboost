// ── Campaigns service ────────────────────────────────────────
// All campaign business logic: validation, lifecycle, ownership checks,
// application management, and submission management.

import { Injectable } from '@nestjs/common';
import { CampaignsRepository } from './campaigns.repository';
import { SessionService } from '../../common/services/session.service';
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
import { ValidationError } from '../../common/errors/app.errors';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly campaignsRepository: CampaignsRepository,
    private readonly sessionService: SessionService,
    private readonly metaService: MetaService,
  ) {}

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

    if (Number(data.totalSlots) < 1) throw new CampaignValidationError('Total slots must be at least 1');
    if (Number(data.minimumFollowers) <= 0) throw new CampaignValidationError('Minimum followers must be greater than 0');
    if (Number(data.totalBudget) < 0) throw new CampaignValidationError('Total budget cannot be negative');
    if (Number(data.budgetPerCreator) > Number(data.totalBudget)) {
      throw new CampaignValidationError('Budget per creator cannot exceed total campaign budget');
    }

    const ageMin = Number(data.ageGroupMin);
    const ageMax = Number(data.ageGroupMax);
    if (ageMin < 13 || ageMin > 65) throw new CampaignValidationError('Age must be between 13 and 65');
    if (ageMax < 13 || ageMax > 65) throw new CampaignValidationError('Age must be between 13 and 65');
    if (ageMin >= ageMax) throw new CampaignValidationError('Minimum age must be less than maximum age');

    const engagementRate = Number(data.requiredEngagementRate);
    if (engagementRate < 0 || engagementRate > 100) {
      throw new CampaignValidationError('Engagement rate must be between 0 and 100');
    }

    if (data.reserveSlots !== undefined && data.reserveSlots !== null) {
      if (Number(data.reserveSlots) > Number(data.totalSlots)) {
        throw new CampaignValidationError('Reserve slots cannot exceed total slots');
      }
    }
  }

  // ── Campaign CRUD ──────────────────────────────────────────

  async createCampaign(sessionId: string, data: Record<string, any>) {
    this.validateCampaignData(data);
    const session = this.sessionService.get(sessionId)!;
    return this.campaignsRepository.createCampaign(session.businessId!, data);
  }

  async listCampaigns(sessionId: string) {
    const session = this.sessionService.get(sessionId)!;
    return this.campaignsRepository.listByBusiness(session.businessId!);
  }

  async getCampaign(sessionId: string, campaignId: string) {
    const session = this.sessionService.get(sessionId)!;
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.businessId !== session.businessId) {
      throw new CampaignNotFoundError();
    }
    return campaign;
  }

  async updateCampaign(sessionId: string, campaignId: string, data: Record<string, any>) {
    const session = this.sessionService.get(sessionId)!;
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.businessId !== session.businessId) {
      throw new CampaignNotFoundError();
    }
    if (campaign.status !== 'Draft') {
      throw new CampaignNotEditableError();
    }
    const merged = { ...campaign, ...data };
    this.validateCampaignData(merged);
    return (await this.campaignsRepository.updateCampaign(campaignId, data))!;
  }

  async updateStatus(sessionId: string, campaignId: string, newStatus: string) {
    const session = this.sessionService.get(sessionId)!;
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.businessId !== session.businessId) {
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
    const session = this.sessionService.get(sessionId)!;
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.businessId !== session.businessId) {
      throw new CampaignNotFoundError();
    }
    return this.campaignsRepository.listApplicationsByCampaign(campaignId);
  }

  async reviewApplication(sessionId: string, campaignId: string, applicationId: string, status: string) {
    const session = this.sessionService.get(sessionId)!;
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.businessId !== session.businessId) {
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
    const session = this.sessionService.get(sessionId)!;
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.businessId !== session.businessId) {
      throw new CampaignNotFoundError();
    }

    const subs = await this.campaignsRepository.listSubmissionsByCampaign(campaignId);

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
    const session = this.sessionService.get(sessionId)!;
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign || campaign.businessId !== session.businessId) {
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

  async listMarketplace(sessionId: string) {
    const published = await this.campaignsRepository.listPublished();

    const results = [];
    for (const campaign of published) {
      const ownerSession = this.sessionService.findBy((s) => s.businessId === campaign.businessId);
      const brandName =
        ownerSession && ownerSession.session.brandData
          ? ownerSession.session.brandData.name
          : 'Unknown Brand';

      const apps = await this.campaignsRepository.listApplicationsByCampaign(campaign.campaignId);
      const approvedCount = apps.filter((a) => a.status === 'Approved').length;

      results.push({ ...campaign, brandName, approvedCount });
    }
    return results;
  }

  async applyToCampaign(sessionId: string, campaignId: string, accessToken: string) {
    const campaign = await this.campaignsRepository.getCampaign(campaignId);
    if (!campaign) throw new CampaignNotFoundError();

    if (campaign.status !== 'Published' && campaign.status !== 'Active') {
      throw new ValidationError('Campaign is not accepting applications');
    }

    const session = this.sessionService.get(sessionId)!;
    const influencerId = session.userId!;

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
    const session = this.sessionService.get(sessionId)!;
    const influencerId = session.userId!;
    const application = await this.campaignsRepository.findApplication(campaignId, influencerId);
    if (!application) throw new ApplicationNotFoundError();
    return application;
  }

  async submitContent(
    sessionId: string,
    campaignId: string,
    data: { contentUrl?: string; contentCaption?: string; notesToBrand?: string },
  ) {
    const session = this.sessionService.get(sessionId)!;
    const influencerId = session.userId!;

    const application = await this.campaignsRepository.findApplication(campaignId, influencerId);
    if (!application || application.status !== 'Approved') {
      throw new SubmissionForbiddenError();
    }

    return this.campaignsRepository.createSubmission(campaignId, influencerId, data);
  }

  async getMyCampaigns(sessionId: string) {
    const session = this.sessionService.get(sessionId)!;
    const influencerId = session.userId!;

    const myApps = await this.campaignsRepository.listApplicationsByInfluencer(influencerId);

    const results = [];
    for (const app of myApps) {
      const campaign = await this.campaignsRepository.getCampaign(app.campaignId);
      if (!campaign) continue;

      const ownerSession = this.sessionService.findBy((s) => s.businessId === campaign.businessId);
      const brandName =
        ownerSession && ownerSession.session.brandData
          ? ownerSession.session.brandData.name
          : 'Unknown Brand';

      const allApps = await this.campaignsRepository.listApplicationsByCampaign(campaign.campaignId);
      const approvedCount = allApps.filter((a) => a.status === 'Approved').length;

      results.push({
        ...campaign,
        brandName,
        approvedCount,
        applicationStatus: app.status,
        applicationId: app.applicationId,
        appliedAt: app.createdAt,
      });
    }
    return results;
  }
}
