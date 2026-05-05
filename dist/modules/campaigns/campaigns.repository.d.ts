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
export declare class CampaignsRepository {
    private readonly db;
    private readonly useDb;
    private readonly memCampaigns;
    private readonly memApplications;
    private readonly memSubmissions;
    constructor(drizzleClient: any);
    createCampaign(businessId: string, data: Record<string, any>): Promise<CampaignRecord>;
    getCampaign(campaignId: string): Promise<CampaignRecord | null>;
    listByBusiness(businessId: string): Promise<CampaignRecord[]>;
    updateCampaign(campaignId: string, data: Record<string, any>): Promise<CampaignRecord | null>;
    listPublished(): Promise<CampaignRecord[]>;
    createApplication(campaignId: string, influencerId: string, influencerData: {
        username: string;
        followerCount: number;
    }): Promise<ApplicationRecord>;
    getApplication(applicationId: string): Promise<ApplicationRecord | null>;
    listApplicationsByCampaign(campaignId: string): Promise<ApplicationRecord[]>;
    findApplication(campaignId: string, influencerId: string): Promise<ApplicationRecord | null>;
    listApplicationsByInfluencer(influencerId: string): Promise<ApplicationRecord[]>;
    updateApplication(applicationId: string, data: Partial<ApplicationRecord>): Promise<ApplicationRecord | null>;
    createSubmission(campaignId: string, influencerId: string, data: {
        contentUrl?: string;
        contentCaption?: string;
        notesToBrand?: string;
        influencerUsername?: string;
    }): Promise<SubmissionRecord>;
    getSubmission(submissionId: string): Promise<SubmissionRecord | null>;
    listSubmissionsByCampaign(campaignId: string): Promise<SubmissionRecord[]>;
    updateSubmission(submissionId: string, data: Partial<SubmissionRecord>): Promise<SubmissionRecord | null>;
    private mapDbCampaign;
    private mapDbApplication;
    private mapDbSubmission;
}
