// ── Campaigns repository ─────────────────────────────────────
// Persistence layer for campaigns, applications, and submissions.
// Uses Drizzle ORM when DATABASE_URL is set, falls back to in-memory
// Maps when no database is configured (tests, local dev).

import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq, and, or, desc, gt } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { campaigns } from '../../database/schema/campaigns.schema';
import { applications } from '../../database/schema/proposals.schema';
import { submissions } from '../../database/schema/collaborations.schema';
import { CampaignStatus, ApplicationStatus, SubmissionStatus } from './campaigns.types';

export interface CampaignRecord {
  campaignId: string;
  businessId: string;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
  [key: string]: any;
}

export interface ApplicationRecord {
  applicationId: string;
  campaignId: string;
  influencerId: string;
  username: string;
  followerCount: number;
  status: ApplicationStatus;
  createdAt: string;
}

export interface SubmissionRecord {
  submissionId: string;
  campaignId: string;
  influencerId: string;
  influencerUsername?: string;
  contentUrl?: string;
  contentCaption?: string;
  notesToBrand?: string;
  revisionNotes?: string;
  status: SubmissionStatus;
  createdAt: string;
}

@Injectable()
export class CampaignsRepository {
  private readonly db: any;
  private readonly useDb: boolean;

  // In-memory fallback (used when no DATABASE_URL)
  private readonly memCampaigns = new Map<string, CampaignRecord>();
  private readonly memApplications = new Map<string, ApplicationRecord>();
  private readonly memSubmissions = new Map<string, SubmissionRecord>();

  constructor(@Inject(DRIZZLE_CLIENT) @Optional() drizzleClient: any) {
    this.db = drizzleClient;
    this.useDb = !!drizzleClient;
  }

  // ══════════════════════════════════════════════════════════════
  // Campaigns
  // ══════════════════════════════════════════════════════════════

  async createCampaign(businessId: string, data: Record<string, any>): Promise<CampaignRecord> {
    const campaignId = randomUUID();
    const now = new Date().toISOString();
    const record: CampaignRecord = {
      campaignId,
      businessId,
      ...data,
      status: data.status || 'Draft',
      createdAt: now,
      updatedAt: now,
    };

    if (this.useDb) {
      // Map flat record to schema columns
      await this.db.insert(campaigns).values({
        campaignId,
        businessId,
        title: data.title,
        description: data.description,
        objective: data.objective,
        campaignType: data.campaignType,
        platform: data.platform || 'Instagram',
        postTypes: data.postTypes ? JSON.stringify(data.postTypes) : null,
        deliverables: data.deliverables ? JSON.stringify(data.deliverables) : null,
        contentCountPerInfluencer: data.contentCountPerInfluencer ?? null,
        captionGuidelines: data.captionGuidelines ?? null,
        hashtags: data.hashtags ? JSON.stringify(data.hashtags) : null,
        mentions: data.mentions ? JSON.stringify(data.mentions) : null,
        handleToTag: data.handleToTag ?? null,
        referenceImages: data.referenceImages ? JSON.stringify(data.referenceImages) : null,
        ageGroupMin: data.ageGroupMin,
        ageGroupMax: data.ageGroupMax,
        gender: data.gender,
        targetLocation: data.targetLocation,
        interests: data.interests ? JSON.stringify(data.interests) : null,
        languagePreference: data.languagePreference ?? null,
        totalBudget: String(data.totalBudget),
        budgetPerCreator: String(data.budgetPerCreator),
        paymentModel: data.paymentModel,
        commissionRate: data.commissionRate != null ? String(data.commissionRate) : null,
        productDetails: data.productDetails ?? null,
        bonusCriteria: data.bonusCriteria ?? null,
        performanceIncentive: data.performanceIncentive ?? null,
        startDate: data.startDate,
        endDate: data.endDate,
        applicationDeadline: data.applicationDeadline,
        submissionDeadline: data.submissionDeadline,
        contentDeadline: data.contentDeadline,
        revisionAllowedCount: data.revisionAllowedCount ?? 0,
        reviewTurnaroundHours: data.reviewTurnaroundHours ?? null,
        postingTimeWindow: data.postingTimeWindow ?? null,
        minimumFollowers: data.minimumFollowers,
        requiredEngagementRate: String(data.requiredEngagementRate),
        preferredNiche: data.preferredNiche,
        contentStyleExpectations: data.contentStyleExpectations ?? null,
        audienceGenderRatio: data.audienceGenderRatio ?? null,
        totalSlots: data.totalSlots,
        reserveSlots: data.reserveSlots ?? null,
        priorityInviteList: data.priorityInviteList ? JSON.stringify(data.priorityInviteList) : null,
        guidelinesDos: data.guidelinesDos ?? null,
        guidelinesDonts: data.guidelinesDonts ?? null,
        brandMessaging: data.brandMessaging ?? null,
        approvalProcessDescription: data.approvalProcessDescription ?? null,
        requireApproval: data.requireApproval != null ? String(data.requireApproval) : null,
        autoApproveAfterHours: data.autoApproveAfterHours ?? null,
        status: data.status || 'Draft',
      });
      return record;
    }

    this.memCampaigns.set(campaignId, record);
    return record;
  }

  async getCampaign(campaignId: string): Promise<CampaignRecord | null> {
    if (this.useDb) {
      const rows = await this.db.select().from(campaigns).where(eq(campaigns.campaignId, campaignId));
      if (rows.length === 0) return null;
      return this.mapDbCampaign(rows[0]);
    }
    return this.memCampaigns.get(campaignId) || null;
  }

  async listByBusiness(businessId: string): Promise<CampaignRecord[]> {
    if (this.useDb) {
      const rows = await this.db.select().from(campaigns)
        .where(eq(campaigns.businessId, businessId))
        .orderBy(desc(campaigns.createdAt));
      return rows.map((r: any) => this.mapDbCampaign(r));
    }
    const result: CampaignRecord[] = [];
    for (const campaign of this.memCampaigns.values()) {
      if (campaign.businessId === businessId) result.push(campaign);
    }
    return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async updateCampaign(campaignId: string, data: Record<string, any>): Promise<CampaignRecord | null> {
    if (this.useDb) {
      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (data.status !== undefined) updateData.status = data.status;
      if (data.title !== undefined) updateData.title = data.title;
      if (data.description !== undefined) updateData.description = data.description;
      // Add more fields as needed for full update support
      await this.db.update(campaigns).set(updateData).where(eq(campaigns.campaignId, campaignId));
      return this.getCampaign(campaignId);
    }
    const campaign = this.memCampaigns.get(campaignId);
    if (!campaign) return null;
    Object.assign(campaign, data, { updatedAt: new Date().toISOString() });
    return campaign;
  }

  async listPublished(): Promise<CampaignRecord[]> {
    const now = new Date();
    if (this.useDb) {
      const rows = await this.db.select().from(campaigns)
        .where(
          and(
            or(eq(campaigns.status, 'Published'), eq(campaigns.status, 'Active')),
            gt(campaigns.applicationDeadline, now.toISOString().split('T')[0]),
          ),
        )
        .orderBy(desc(campaigns.createdAt));
      return rows.map((r: any) => this.mapDbCampaign(r));
    }
    const result: CampaignRecord[] = [];
    for (const campaign of this.memCampaigns.values()) {
      if (
        (campaign.status === 'Published' || campaign.status === 'Active') &&
        new Date(campaign.applicationDeadline) > now
      ) {
        result.push(campaign);
      }
    }
    return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // ══════════════════════════════════════════════════════════════
  // Applications
  // ══════════════════════════════════════════════════════════════

  async createApplication(
    campaignId: string,
    influencerId: string,
    influencerData: { username: string; followerCount: number },
  ): Promise<ApplicationRecord> {
    const applicationId = randomUUID();
    const now = new Date().toISOString();
    const record: ApplicationRecord = {
      applicationId,
      campaignId,
      influencerId,
      ...influencerData,
      status: 'Pending',
      createdAt: now,
    };

    if (this.useDb) {
      await this.db.insert(applications).values({
        applicationId,
        campaignId,
        influencerId,
        username: influencerData.username,
        followerCount: influencerData.followerCount,
        status: 'Pending',
      });
      return record;
    }

    this.memApplications.set(applicationId, record);
    return record;
  }

  async getApplication(applicationId: string): Promise<ApplicationRecord | null> {
    if (this.useDb) {
      const rows = await this.db.select().from(applications).where(eq(applications.applicationId, applicationId));
      if (rows.length === 0) return null;
      return this.mapDbApplication(rows[0]);
    }
    return this.memApplications.get(applicationId) || null;
  }

  async listApplicationsByCampaign(campaignId: string): Promise<ApplicationRecord[]> {
    if (this.useDb) {
      const rows = await this.db.select().from(applications).where(eq(applications.campaignId, campaignId));
      return rows.map((r: any) => this.mapDbApplication(r));
    }
    const result: ApplicationRecord[] = [];
    for (const app of this.memApplications.values()) {
      if (app.campaignId === campaignId) result.push(app);
    }
    return result;
  }

  async findApplication(campaignId: string, influencerId: string): Promise<ApplicationRecord | null> {
    if (this.useDb) {
      const rows = await this.db.select().from(applications)
        .where(and(eq(applications.campaignId, campaignId), eq(applications.influencerId, influencerId)));
      if (rows.length === 0) return null;
      return this.mapDbApplication(rows[0]);
    }
    for (const app of this.memApplications.values()) {
      if (app.campaignId === campaignId && app.influencerId === influencerId) return app;
    }
    return null;
  }

  async listApplicationsByInfluencer(influencerId: string): Promise<ApplicationRecord[]> {
    if (this.useDb) {
      const rows = await this.db.select().from(applications)
        .where(eq(applications.influencerId, influencerId))
        .orderBy(desc(applications.createdAt));
      return rows.map((r: any) => this.mapDbApplication(r));
    }
    const result: ApplicationRecord[] = [];
    for (const app of this.memApplications.values()) {
      if (app.influencerId === influencerId) result.push(app);
    }
    return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async updateApplication(applicationId: string, data: Partial<ApplicationRecord>): Promise<ApplicationRecord | null> {
    if (this.useDb) {
      const updateData: Record<string, any> = {};
      if (data.status !== undefined) updateData.status = data.status;
      await this.db.update(applications).set(updateData).where(eq(applications.applicationId, applicationId));
      return this.getApplication(applicationId);
    }
    const app = this.memApplications.get(applicationId);
    if (!app) return null;
    Object.assign(app, data);
    return app;
  }

  // ══════════════════════════════════════════════════════════════
  // Submissions
  // ══════════════════════════════════════════════════════════════

  async createSubmission(
    campaignId: string,
    influencerId: string,
    data: { contentUrl?: string; contentCaption?: string; notesToBrand?: string; influencerUsername?: string },
  ): Promise<SubmissionRecord> {
    const submissionId = randomUUID();
    const now = new Date().toISOString();
    const record: SubmissionRecord = {
      submissionId,
      campaignId,
      influencerId,
      ...data,
      status: 'Pending_Review',
      createdAt: now,
    };

    if (this.useDb) {
      await this.db.insert(submissions).values({
        submissionId,
        campaignId,
        influencerId,
        influencerUsername: data.influencerUsername ?? null,
        contentUrl: data.contentUrl ?? null,
        contentCaption: data.contentCaption ?? null,
        notesToBrand: data.notesToBrand ?? null,
        status: 'Pending_Review',
      });
      return record;
    }

    this.memSubmissions.set(submissionId, record);
    return record;
  }

  async getSubmission(submissionId: string): Promise<SubmissionRecord | null> {
    if (this.useDb) {
      const rows = await this.db.select().from(submissions).where(eq(submissions.submissionId, submissionId));
      if (rows.length === 0) return null;
      return this.mapDbSubmission(rows[0]);
    }
    return this.memSubmissions.get(submissionId) || null;
  }

  async listSubmissionsByCampaign(campaignId: string): Promise<SubmissionRecord[]> {
    if (this.useDb) {
      const rows = await this.db.select().from(submissions).where(eq(submissions.campaignId, campaignId));
      return rows.map((r: any) => this.mapDbSubmission(r));
    }
    const result: SubmissionRecord[] = [];
    for (const sub of this.memSubmissions.values()) {
      if (sub.campaignId === campaignId) result.push(sub);
    }
    return result;
  }

  async updateSubmission(submissionId: string, data: Partial<SubmissionRecord>): Promise<SubmissionRecord | null> {
    if (this.useDb) {
      const updateData: Record<string, any> = {};
      if (data.status !== undefined) updateData.status = data.status;
      if (data.revisionNotes !== undefined) updateData.revisionNotes = data.revisionNotes;
      await this.db.update(submissions).set(updateData).where(eq(submissions.submissionId, submissionId));
      return this.getSubmission(submissionId);
    }
    const sub = this.memSubmissions.get(submissionId);
    if (!sub) return null;
    Object.assign(sub, data);
    return sub;
  }

  // ══════════════════════════════════════════════════════════════
  // DB → Record mappers
  // ══════════════════════════════════════════════════════════════

  private mapDbCampaign(row: any): CampaignRecord {
    return {
      campaignId: row.campaignId,
      businessId: row.businessId,
      title: row.title,
      description: row.description,
      objective: row.objective,
      campaignType: row.campaignType,
      platform: row.platform,
      postTypes: row.postTypes ? JSON.parse(row.postTypes) : undefined,
      deliverables: row.deliverables ? JSON.parse(row.deliverables) : undefined,
      contentCountPerInfluencer: row.contentCountPerInfluencer,
      captionGuidelines: row.captionGuidelines,
      hashtags: row.hashtags ? JSON.parse(row.hashtags) : undefined,
      mentions: row.mentions ? JSON.parse(row.mentions) : undefined,
      handleToTag: row.handleToTag,
      referenceImages: row.referenceImages ? JSON.parse(row.referenceImages) : undefined,
      ageGroupMin: row.ageGroupMin,
      ageGroupMax: row.ageGroupMax,
      gender: row.gender,
      targetLocation: row.targetLocation,
      interests: row.interests ? JSON.parse(row.interests) : undefined,
      languagePreference: row.languagePreference,
      totalBudget: Number(row.totalBudget),
      budgetPerCreator: Number(row.budgetPerCreator),
      paymentModel: row.paymentModel,
      commissionRate: row.commissionRate ? Number(row.commissionRate) : undefined,
      productDetails: row.productDetails,
      bonusCriteria: row.bonusCriteria,
      performanceIncentive: row.performanceIncentive,
      startDate: row.startDate,
      endDate: row.endDate,
      applicationDeadline: row.applicationDeadline,
      submissionDeadline: row.submissionDeadline,
      contentDeadline: row.contentDeadline,
      revisionAllowedCount: row.revisionAllowedCount,
      reviewTurnaroundHours: row.reviewTurnaroundHours,
      postingTimeWindow: row.postingTimeWindow,
      minimumFollowers: row.minimumFollowers,
      requiredEngagementRate: Number(row.requiredEngagementRate),
      preferredNiche: row.preferredNiche,
      contentStyleExpectations: row.contentStyleExpectations,
      audienceGenderRatio: row.audienceGenderRatio,
      totalSlots: row.totalSlots,
      reserveSlots: row.reserveSlots,
      priorityInviteList: row.priorityInviteList ? JSON.parse(row.priorityInviteList) : undefined,
      guidelinesDos: row.guidelinesDos,
      guidelinesDonts: row.guidelinesDonts,
      brandMessaging: row.brandMessaging,
      approvalProcessDescription: row.approvalProcessDescription,
      requireApproval: row.requireApproval,
      autoApproveAfterHours: row.autoApproveAfterHours,
      status: row.status,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    };
  }

  private mapDbApplication(row: any): ApplicationRecord {
    return {
      applicationId: row.applicationId,
      campaignId: row.campaignId,
      influencerId: row.influencerId,
      username: row.username,
      followerCount: row.followerCount,
      status: row.status,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    };
  }

  private mapDbSubmission(row: any): SubmissionRecord {
    return {
      submissionId: row.submissionId,
      campaignId: row.campaignId,
      influencerId: row.influencerId,
      influencerUsername: row.influencerUsername,
      contentUrl: row.contentUrl,
      contentCaption: row.contentCaption,
      notesToBrand: row.notesToBrand,
      revisionNotes: row.revisionNotes,
      status: row.status,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    };
  }
}
