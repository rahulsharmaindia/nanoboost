// ── Campaigns repository ─────────────────────────────────────
// Persistence layer for campaigns, applications, and submissions.
// Uses Drizzle ORM against the Supabase Postgres database.
// DATABASE_URL must be set — there is no in-memory fallback.

import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq, and, inArray, or, desc, gt, sql } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { campaigns } from '../../database/schema/campaigns.schema';
import {
  campaignApplications as applications,
  campaignSubmissions as submissions,
} from '../../database/schema/engagement.schema';
import { brands } from '../../database/schema/brands.schema';
import { CampaignStatus, ApplicationStatus, SubmissionStatus } from './campaigns.types';

export interface CampaignRecord {
  campaignId: string;
  brandId: string;
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
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: any) {
    if (!db) {
      throw new Error(
        'DATABASE_URL is not configured. CampaignsRepository requires a database connection.',
      );
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Campaigns
  // ══════════════════════════════════════════════════════════════

  async createCampaign(brandId: string, data: Record<string, any>): Promise<CampaignRecord> {
    const campaignId = randomUUID();

    await this.db.insert(campaigns).values({
      campaignId,
      brandId,
      // NOT NULL columns get safe placeholders so an incomplete draft can
      // still be inserted. Non-draft campaigns are fully validated upstream
      // before reaching here, so these fallbacks only apply to drafts.
      title: data.title ?? '',
      description: data.description ?? '',
      objective: data.objective ?? '',
      campaignType: data.campaignType ?? '',
      platform: data.platform || 'Instagram',
      postTypes: data.postTypes ? JSON.stringify(data.postTypes) : null,
      deliverables: data.deliverables ? JSON.stringify(data.deliverables) : null,
      contentCountPerInfluencer: data.contentCountPerInfluencer ?? null,
      captionGuidelines: data.captionGuidelines ?? null,
      hashtags: data.hashtags ? JSON.stringify(data.hashtags) : null,
      mentions: data.mentions ? JSON.stringify(data.mentions) : null,
      handleToTag: data.handleToTag ?? null,
      referenceImages: data.referenceImages ? JSON.stringify(data.referenceImages) : null,
      referenceVideoUrl: data.referenceVideoUrl ?? null,
      additionalReferenceLinks: data.additionalReferenceLinks
        ? JSON.stringify(data.additionalReferenceLinks)
        : null,
      ageGroupMin: data.ageGroupMin ?? 0,
      ageGroupMax: data.ageGroupMax ?? 0,
      gender: data.gender ?? '',
      targetLocation: data.targetLocation ?? '',
      interests: data.interests ? JSON.stringify(data.interests) : null,
      languagePreference: data.languagePreference ?? null,
      totalBudget: String(data.totalBudget ?? 0),
      budgetPerCreator: String(data.budgetPerCreator ?? 0),
      paymentModel: data.paymentModel ?? '',
      commissionRate: data.commissionRate != null ? String(data.commissionRate) : null,
      productDetails: data.productDetails ?? null,
      bonusCriteria: data.bonusCriteria ?? null,
      performanceIncentive: data.performanceIncentive ?? null,
      startDate: data.startDate ?? '',
      endDate: data.endDate ?? '',
      applicationDeadline: data.applicationDeadline ?? '',
      submissionDeadline: data.submissionDeadline ?? '',
      contentDeadline: data.contentDeadline ?? '',
      revisionAllowedCount: data.revisionAllowedCount ?? 0,
      reviewTurnaroundHours: data.reviewTurnaroundHours ?? null,
      postingTimeWindow: data.postingTimeWindow ?? null,
      minimumFollowers: data.minimumFollowers ?? 0,
      requiredEngagementRate: String(data.requiredEngagementRate ?? 0),
      preferredNiche: data.preferredNiche ?? '',
      contentStyleExpectations: data.contentStyleExpectations ?? null,
      audienceGenderRatio: data.audienceGenderRatio ?? null,
      totalSlots: data.totalSlots ?? 0,
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

    return (await this.getCampaign(campaignId))!;
  }

  async getCampaign(campaignId: string): Promise<CampaignRecord | null> {
    const rows = await this.db.select().from(campaigns).where(eq(campaigns.campaignId, campaignId));
    if (rows.length === 0) return null;
    return this.mapDbCampaign(rows[0]);
  }

  async listByBrand(brandId: string): Promise<CampaignRecord[]> {
    const rows = await this.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.brandId, brandId))
      .orderBy(desc(campaigns.createdAt));
    return rows.map((r: any) => this.mapDbCampaign(r));
  }

  async updateCampaign(campaignId: string, data: Record<string, any>): Promise<CampaignRecord | null> {
    const updateData: Record<string, any> = { updatedAt: new Date() };

    // Simple scalar fields
    const scalarFields = [
      'status', 'title', 'description', 'objective', 'campaignType', 'platform',
      'contentCountPerInfluencer', 'captionGuidelines', 'handleToTag', 'referenceVideoUrl',
      'ageGroupMin', 'ageGroupMax', 'gender', 'targetLocation',
      'languagePreference', 'paymentModel', 'productDetails', 'bonusCriteria',
      'performanceIncentive', 'startDate', 'endDate', 'applicationDeadline',
      'submissionDeadline', 'contentDeadline', 'revisionAllowedCount',
      'reviewTurnaroundHours', 'postingTimeWindow', 'minimumFollowers',
      'preferredNiche', 'contentStyleExpectations', 'audienceGenderRatio',
      'totalSlots', 'reserveSlots', 'guidelinesDos', 'guidelinesDonts',
      'brandMessaging', 'approvalProcessDescription', 'autoApproveAfterHours',
    ];
    for (const field of scalarFields) {
      if (data[field] !== undefined) updateData[field] = data[field];
    }

    // Numeric/decimal fields stored as strings
    if (data.totalBudget !== undefined) updateData.totalBudget = String(data.totalBudget);
    if (data.budgetPerCreator !== undefined) updateData.budgetPerCreator = String(data.budgetPerCreator);
    if (data.commissionRate !== undefined) {
      updateData.commissionRate = data.commissionRate != null ? String(data.commissionRate) : null;
    }
    if (data.requiredEngagementRate !== undefined) {
      updateData.requiredEngagementRate = String(data.requiredEngagementRate);
    }
    if (data.requireApproval !== undefined) {
      updateData.requireApproval = data.requireApproval != null ? String(data.requireApproval) : null;
    }

    // JSON fields
    const jsonFields = [
      'postTypes', 'deliverables', 'hashtags', 'mentions',
      'referenceImages', 'interests', 'priorityInviteList',
      'additionalReferenceLinks',
    ];
    for (const field of jsonFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field] != null ? JSON.stringify(data[field]) : null;
      }
    }

    await this.db.update(campaigns).set(updateData).where(eq(campaigns.campaignId, campaignId));
    return this.getCampaign(campaignId);
  }

  async listPublished(): Promise<CampaignRecord[]> {
    // Include campaigns with start_date in the last 3 months — regardless
    // of whether the application deadline has passed — so recent campaigns
    // always appear in the feed.
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const cutoff = threeMonthsAgo.toISOString().split('T')[0];

    const rows = await this.db
      .select()
      .from(campaigns)
      .where(
        and(
          or(eq(campaigns.status, 'Published'), eq(campaigns.status, 'Active')),
          gt(campaigns.startDate, cutoff),
        ),
      )
      .orderBy(desc(campaigns.createdAt));
    return rows.map((r: any) => this.mapDbCampaign(r));
  }

  /**
   * Like listPublished but also includes Completed campaigns and removes
   * the 3-month cutoff. Used when the "show expired" toggle is on.
   */
  async listPublishedIncludingExpired(): Promise<CampaignRecord[]> {
    const rows = await this.db
      .select()
      .from(campaigns)
      .where(
        or(
          eq(campaigns.status, 'Published'),
          eq(campaigns.status, 'Active'),
          eq(campaigns.status, 'Completed'),
        ),
      )
      .orderBy(desc(campaigns.createdAt));
    return rows.map((r: any) => this.mapDbCampaign(r));
  }

  /**
   * Search all brands by name or industry for the influencer-side brand
   * discovery feed.  Returns brands that have at least one Published or
   * Active campaign so the list stays relevant, unless `includeAll` is set.
   */
  async searchBrands(params: {
    query?: string;
    industry?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: any[]; total: number }> {
    const limit = Math.min(params.limit ?? 20, 50);
    const offset = params.offset ?? 0;

    // Build brand rows joined with campaign count.
    const allBrands = await this.db
      .select({
        brandId: brands.brandId,
        businessId: brands.businessId,
        name: brands.name,
        industry: brands.industry,
        website: brands.website,
        description: brands.description,
      })
      .from(brands)
      .orderBy(brands.name);

    // Filter in JS (small table, avoids complex Drizzle subquery).
    let filtered = allBrands as any[];
    if (params.query) {
      const q = params.query.toLowerCase();
      filtered = filtered.filter(
        (b: any) =>
          b.name.toLowerCase().includes(q) ||
          (b.industry && b.industry.toLowerCase().includes(q)) ||
          (b.description && b.description.toLowerCase().includes(q)),
      );
    }
    if (params.industry) {
      const ind = params.industry.toLowerCase();
      filtered = filtered.filter(
        (b: any) => b.industry && b.industry.toLowerCase().includes(ind),
      );
    }

    const total = filtered.length;
    const items = filtered.slice(offset, offset + limit);

    // Enrich each brand with its active campaign count.
    if (items.length > 0) {
      const brandIds = items.map((b: any) => b.brandId);
      const now = new Date().toISOString().split('T')[0];
      const campaignRows = await this.db
        .select({
          brandId: campaigns.brandId,
          status: campaigns.status,
          deadline: campaigns.applicationDeadline,
        })
        .from(campaigns)
        .where(
          and(
            inArray(campaigns.brandId, brandIds),
            or(eq(campaigns.status, 'Published'), eq(campaigns.status, 'Active')),
            gt(campaigns.applicationDeadline, now),
          ),
        );

      const counts: Record<string, number> = {};
      for (const row of campaignRows) {
        counts[row.brandId] = (counts[row.brandId] ?? 0) + 1;
      }

      for (const b of items as any[]) {
        b.activeCampaignCount = counts[b.brandId] ?? 0;
      }
    }

    return { items, total };
  }

  /**
   * Look up brand display names for a set of brandIds in one query.
   * Returns a map keyed by brandId.
   */
  async getBrandNames(brandIds: string[]): Promise<Record<string, string>> {
    if (brandIds.length === 0) return {};
    const unique = Array.from(new Set(brandIds));
    const rows = await this.db
      .select({ brandId: brands.brandId, name: brands.name })
      .from(brands)
      .where(inArray(brands.brandId, unique));
    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.brandId] = row.name;
    }
    return map;
  }

  /**
   * Look up brand display name + businessId slug for a set of brandIds.
   * Returns a map keyed by brandId. Used to enrich campaign payloads so
   * the client can navigate to / follow a brand by its stable slug.
   */
  async getBrandInfo(
    brandIds: string[],
  ): Promise<Record<string, { name: string; businessId: string }>> {
    if (brandIds.length === 0) return {};
    const unique = Array.from(new Set(brandIds));
    const rows = await this.db
      .select({ brandId: brands.brandId, name: brands.name, businessId: brands.businessId })
      .from(brands)
      .where(inArray(brands.brandId, unique));
    const map: Record<string, { name: string; businessId: string }> = {};
    for (const row of rows) {
      map[row.brandId] = { name: row.name, businessId: row.businessId };
    }
    return map;
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

    await this.db.insert(applications).values({
      applicationId,
      campaignId,
      influencerId,
      username: influencerData.username,
      followerCount: influencerData.followerCount,
      status: 'Pending',
    });

    return (await this.getApplication(applicationId))!;
  }

  async getApplication(applicationId: string): Promise<ApplicationRecord | null> {
    const rows = await this.db.select().from(applications).where(eq(applications.applicationId, applicationId));
    if (rows.length === 0) return null;
    return this.mapDbApplication(rows[0]);
  }

  async listApplicationsByCampaign(campaignId: string): Promise<ApplicationRecord[]> {
    const rows = await this.db.select().from(applications).where(eq(applications.campaignId, campaignId));
    return rows.map((r: any) => this.mapDbApplication(r));
  }

  async findApplication(campaignId: string, influencerId: string): Promise<ApplicationRecord | null> {
    const rows = await this.db
      .select()
      .from(applications)
      .where(and(eq(applications.campaignId, campaignId), eq(applications.influencerId, influencerId)));
    if (rows.length === 0) return null;
    return this.mapDbApplication(rows[0]);
  }

  async listApplicationsByInfluencer(influencerId: string): Promise<ApplicationRecord[]> {
    const rows = await this.db
      .select()
      .from(applications)
      .where(eq(applications.influencerId, influencerId))
      .orderBy(desc(applications.createdAt));
    return rows.map((r: any) => this.mapDbApplication(r));
  }

  /**
   * Returns a map of campaignId → approved-application count for the
   * given campaign IDs. Single grouped query — replaces the N+1 pattern
   * of calling `listApplicationsByCampaign` per campaign in lists.
   */
  async getApprovedCounts(campaignIds: string[]): Promise<Record<string, number>> {
    if (campaignIds.length === 0) return {};
    const unique = Array.from(new Set(campaignIds));
    const rows = await this.db
      .select({
        campaignId: applications.campaignId,
        count: sql<number>`count(*)::int`,
      })
      .from(applications)
      .where(
        and(
          inArray(applications.campaignId, unique),
          eq(applications.status, 'Approved'),
        ),
      )
      .groupBy(applications.campaignId);
    const map: Record<string, number> = {};
    for (const id of unique) map[id] = 0;
    for (const row of rows) {
      map[row.campaignId] = Number(row.count);
    }
    return map;
  }

  async updateApplication(applicationId: string, data: Partial<ApplicationRecord>): Promise<ApplicationRecord | null> {
    const updateData: Record<string, any> = {};
    if (data.status !== undefined) updateData.status = data.status;
    await this.db.update(applications).set(updateData).where(eq(applications.applicationId, applicationId));
    return this.getApplication(applicationId);
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

    return (await this.getSubmission(submissionId))!;
  }

  async getSubmission(submissionId: string): Promise<SubmissionRecord | null> {
    const rows = await this.db.select().from(submissions).where(eq(submissions.submissionId, submissionId));
    if (rows.length === 0) return null;
    return this.mapDbSubmission(rows[0]);
  }

  async listSubmissionsByCampaign(campaignId: string): Promise<SubmissionRecord[]> {
    const rows = await this.db.select().from(submissions).where(eq(submissions.campaignId, campaignId));
    return rows.map((r: any) => this.mapDbSubmission(r));
  }

  async updateSubmission(submissionId: string, data: Partial<SubmissionRecord>): Promise<SubmissionRecord | null> {
    const updateData: Record<string, any> = {};
    if (data.status !== undefined) updateData.status = data.status;
    if (data.revisionNotes !== undefined) updateData.revisionNotes = data.revisionNotes;
    await this.db.update(submissions).set(updateData).where(eq(submissions.submissionId, submissionId));
    return this.getSubmission(submissionId);
  }

  // ══════════════════════════════════════════════════════════════
  // Delete
  // ══════════════════════════════════════════════════════════════

  /**
   * Hard-deletes a campaign and all cascade-related rows (applications,
   * submissions are deleted via ON DELETE CASCADE on the FK).
   */
  async deleteCampaign(campaignId: string): Promise<void> {
    await this.db.delete(campaigns).where(eq(campaigns.campaignId, campaignId));
  }

  // ══════════════════════════════════════════════════════════════
  // DB → Record mappers
  // ══════════════════════════════════════════════════════════════

  /**
   * Parse a JSON-encoded text column without ever throwing. Columns like
   * `postTypes`/`hashtags`/`deliverables` are written as JSON by
   * createCampaign, but a malformed or legacy plain-string value must not
   * 500 an entire list response — return undefined and let the client
   * render the field as absent.
   */
  private safeJsonParse(value: any): any {
    if (value == null) return undefined;
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  private mapDbCampaign(row: any): CampaignRecord {
    return {
      campaignId: row.campaignId,
      brandId: row.brandId,
      title: row.title,
      description: row.description,
      objective: row.objective,
      campaignType: row.campaignType,
      platform: row.platform,
      postTypes: this.safeJsonParse(row.postTypes),
      deliverables: this.safeJsonParse(row.deliverables),
      contentCountPerInfluencer: row.contentCountPerInfluencer,
      captionGuidelines: row.captionGuidelines,
      hashtags: this.safeJsonParse(row.hashtags),
      mentions: this.safeJsonParse(row.mentions),
      handleToTag: row.handleToTag,
      referenceImages: this.safeJsonParse(row.referenceImages),
      referenceVideoUrl: row.referenceVideoUrl,
      additionalReferenceLinks: this.safeJsonParse(row.additionalReferenceLinks),
      ageGroupMin: row.ageGroupMin,
      ageGroupMax: row.ageGroupMax,
      gender: row.gender,
      targetLocation: row.targetLocation,
      interests: this.safeJsonParse(row.interests),
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
      priorityInviteList: this.safeJsonParse(row.priorityInviteList),
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
