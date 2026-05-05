import { Request } from 'express';
import { CampaignsService } from './campaigns.service';
export declare class CampaignsController {
    private readonly campaignsService;
    constructor(campaignsService: CampaignsService);
    createCampaign(req: Request, body: Record<string, any>): Promise<import("./campaigns.repository").CampaignRecord>;
    listCampaigns(req: Request): Promise<import("./campaigns.repository").CampaignRecord[]>;
    getCampaign(req: Request, campaignId: string): Promise<import("./campaigns.repository").CampaignRecord>;
    updateCampaign(req: Request, campaignId: string, body: Record<string, any>): Promise<import("./campaigns.repository").CampaignRecord>;
    updateStatus(req: Request, campaignId: string, status: string): Promise<import("./campaigns.repository").CampaignRecord>;
    listApplications(req: Request, campaignId: string): Promise<import("./campaigns.repository").ApplicationRecord[]>;
    reviewApplication(req: Request, campaignId: string, applicationId: string, status: string): Promise<import("./campaigns.repository").ApplicationRecord>;
    listSubmissions(req: Request, campaignId: string): Promise<import("./campaigns.repository").SubmissionRecord[]>;
    reviewSubmission(req: Request, campaignId: string, submissionId: string, body: {
        status: string;
        revisionNotes?: string;
    }): Promise<import("./campaigns.repository").SubmissionRecord>;
    listMarketplace(req: Request): Promise<any[]>;
    applyToCampaign(req: Request, campaignId: string): Promise<import("./campaigns.repository").ApplicationRecord>;
    getMyApplication(req: Request, campaignId: string): Promise<import("./campaigns.repository").ApplicationRecord>;
    submitContent(req: Request, campaignId: string, body: {
        contentUrl?: string;
        contentCaption?: string;
        notesToBrand?: string;
    }): Promise<import("./campaigns.repository").SubmissionRecord>;
    getMyCampaigns(req: Request): Promise<any[]>;
}
