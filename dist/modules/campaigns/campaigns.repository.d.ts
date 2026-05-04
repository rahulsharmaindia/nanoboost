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
export declare class CampaignsRepository {
    private readonly campaigns;
    private readonly applications;
    private readonly submissions;
    createCampaign(businessId: string, data: Record<string, any>): CampaignRecord;
    getCampaign(campaignId: string): CampaignRecord | null;
    listByBusiness(businessId: string): CampaignRecord[];
    updateCampaign(campaignId: string, data: Record<string, any>): CampaignRecord | null;
    listPublished(): CampaignRecord[];
    createApplication(campaignId: string, influencerId: string, influencerData: {
        username: string;
        followerCount: number;
    }): ApplicationRecord;
    getApplication(applicationId: string): ApplicationRecord | null;
    listApplicationsByCampaign(campaignId: string): ApplicationRecord[];
    findApplication(campaignId: string, influencerId: string): ApplicationRecord | null;
    listApplicationsByInfluencer(influencerId: string): ApplicationRecord[];
    updateApplication(applicationId: string, data: Partial<ApplicationRecord>): ApplicationRecord | null;
    createSubmission(campaignId: string, influencerId: string, data: {
        contentUrl?: string;
        contentCaption?: string;
        notesToBrand?: string;
    }): SubmissionRecord;
    getSubmission(submissionId: string): SubmissionRecord | null;
    listSubmissionsByCampaign(campaignId: string): SubmissionRecord[];
    updateSubmission(submissionId: string, data: Partial<SubmissionRecord>): SubmissionRecord | null;
}
