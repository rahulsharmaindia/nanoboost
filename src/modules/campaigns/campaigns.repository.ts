// ── Campaigns repository ─────────────────────────────────────
// All campaign, application, and submission persistence lives here.
// Uses in-memory Maps (same as the original server) so existing tests
// continue to pass without a database connection.
// When DATABASE_URL is set, swap these Maps for Drizzle queries.

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
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
  contentUrl?: string;
  contentCaption?: string;
  notesToBrand?: string;
  revisionNotes?: string;
  status: SubmissionStatus;
  createdAt: string;
}

@Injectable()
export class CampaignsRepository {
  private readonly campaigns = new Map<string, CampaignRecord>();
  private readonly applications = new Map<string, ApplicationRecord>();
  private readonly submissions = new Map<string, SubmissionRecord>();

  // ── Campaigns ──────────────────────────────────────────────

  createCampaign(businessId: string, data: Record<string, any>): CampaignRecord {
    const campaignId = randomUUID();
    const campaign: CampaignRecord = {
      campaignId,
      businessId,
      ...data,
      status: data.status || 'Draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.campaigns.set(campaignId, campaign);
    return campaign;
  }

  getCampaign(campaignId: string): CampaignRecord | null {
    return this.campaigns.get(campaignId) || null;
  }

  listByBusiness(businessId: string): CampaignRecord[] {
    const result: CampaignRecord[] = [];
    for (const campaign of this.campaigns.values()) {
      if (campaign.businessId === businessId) result.push(campaign);
    }
    return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  updateCampaign(campaignId: string, data: Record<string, any>): CampaignRecord | null {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) return null;
    Object.assign(campaign, data, { updatedAt: new Date().toISOString() });
    return campaign;
  }

  listPublished(): CampaignRecord[] {
    const now = new Date();
    const result: CampaignRecord[] = [];
    for (const campaign of this.campaigns.values()) {
      if (
        (campaign.status === 'Published' || campaign.status === 'Active') &&
        new Date(campaign.applicationDeadline) > now
      ) {
        result.push(campaign);
      }
    }
    return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // ── Applications ───────────────────────────────────────────

  createApplication(
    campaignId: string,
    influencerId: string,
    influencerData: { username: string; followerCount: number },
  ): ApplicationRecord {
    const applicationId = randomUUID();
    const application: ApplicationRecord = {
      applicationId,
      campaignId,
      influencerId,
      ...influencerData,
      status: 'Pending',
      createdAt: new Date().toISOString(),
    };
    this.applications.set(applicationId, application);
    return application;
  }

  getApplication(applicationId: string): ApplicationRecord | null {
    return this.applications.get(applicationId) || null;
  }

  listApplicationsByCampaign(campaignId: string): ApplicationRecord[] {
    const result: ApplicationRecord[] = [];
    for (const app of this.applications.values()) {
      if (app.campaignId === campaignId) result.push(app);
    }
    return result;
  }

  findApplication(campaignId: string, influencerId: string): ApplicationRecord | null {
    for (const app of this.applications.values()) {
      if (app.campaignId === campaignId && app.influencerId === influencerId) return app;
    }
    return null;
  }

  listApplicationsByInfluencer(influencerId: string): ApplicationRecord[] {
    const result: ApplicationRecord[] = [];
    for (const app of this.applications.values()) {
      if (app.influencerId === influencerId) result.push(app);
    }
    return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  updateApplication(applicationId: string, data: Partial<ApplicationRecord>): ApplicationRecord | null {
    const app = this.applications.get(applicationId);
    if (!app) return null;
    Object.assign(app, data);
    return app;
  }

  // ── Submissions ────────────────────────────────────────────

  createSubmission(
    campaignId: string,
    influencerId: string,
    data: { contentUrl?: string; contentCaption?: string; notesToBrand?: string },
  ): SubmissionRecord {
    const submissionId = randomUUID();
    const submission: SubmissionRecord = {
      submissionId,
      campaignId,
      influencerId,
      ...data,
      status: 'Pending_Review',
      createdAt: new Date().toISOString(),
    };
    this.submissions.set(submissionId, submission);
    return submission;
  }

  getSubmission(submissionId: string): SubmissionRecord | null {
    return this.submissions.get(submissionId) || null;
  }

  listSubmissionsByCampaign(campaignId: string): SubmissionRecord[] {
    const result: SubmissionRecord[] = [];
    for (const sub of this.submissions.values()) {
      if (sub.campaignId === campaignId) result.push(sub);
    }
    return result;
  }

  updateSubmission(submissionId: string, data: Partial<SubmissionRecord>): SubmissionRecord | null {
    const sub = this.submissions.get(submissionId);
    if (!sub) return null;
    Object.assign(sub, data);
    return sub;
  }
}
