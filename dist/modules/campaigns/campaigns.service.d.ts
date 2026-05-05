import { CampaignsRepository } from './campaigns.repository';
import { SessionService } from '../../common/services/session.service';
import { MetaService } from '../meta/meta.service';
export declare class CampaignsService {
    private readonly campaignsRepository;
    private readonly sessionService;
    private readonly metaService;
    constructor(campaignsRepository: CampaignsRepository, sessionService: SessionService, metaService: MetaService);
    private validateCampaignData;
    createCampaign(sessionId: string, data: Record<string, any>): Promise<import("./campaigns.repository").CampaignRecord>;
    listCampaigns(sessionId: string): Promise<import("./campaigns.repository").CampaignRecord[]>;
    getCampaign(sessionId: string, campaignId: string): Promise<import("./campaigns.repository").CampaignRecord>;
    updateCampaign(sessionId: string, campaignId: string, data: Record<string, any>): Promise<import("./campaigns.repository").CampaignRecord>;
    updateStatus(sessionId: string, campaignId: string, newStatus: string): Promise<import("./campaigns.repository").CampaignRecord>;
    listApplications(sessionId: string, campaignId: string): Promise<import("./campaigns.repository").ApplicationRecord[]>;
    reviewApplication(sessionId: string, campaignId: string, applicationId: string, status: string): Promise<import("./campaigns.repository").ApplicationRecord>;
    listSubmissions(sessionId: string, campaignId: string): Promise<import("./campaigns.repository").SubmissionRecord[]>;
    reviewSubmission(sessionId: string, campaignId: string, submissionId: string, status: string, revisionNotes?: string): Promise<import("./campaigns.repository").SubmissionRecord>;
    listMarketplace(sessionId: string): Promise<any[]>;
    applyToCampaign(sessionId: string, campaignId: string, accessToken: string): Promise<import("./campaigns.repository").ApplicationRecord>;
    getMyApplication(sessionId: string, campaignId: string): Promise<import("./campaigns.repository").ApplicationRecord>;
    submitContent(sessionId: string, campaignId: string, data: {
        contentUrl?: string;
        contentCaption?: string;
        notesToBrand?: string;
    }): Promise<import("./campaigns.repository").SubmissionRecord>;
    getMyCampaigns(sessionId: string): Promise<any[]>;
}
