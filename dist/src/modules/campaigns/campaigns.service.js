"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CampaignsService = void 0;
const common_1 = require("@nestjs/common");
const campaigns_repository_1 = require("./campaigns.repository");
const session_service_1 = require("../../common/services/session.service");
const meta_service_1 = require("../meta/meta.service");
const campaigns_types_1 = require("./campaigns.types");
const campaigns_errors_1 = require("./campaigns.errors");
const app_errors_1 = require("../../common/errors/app.errors");
let CampaignsService = class CampaignsService {
    constructor(campaignsRepository, sessionService, metaService) {
        this.campaignsRepository = campaignsRepository;
        this.sessionService = sessionService;
        this.metaService = metaService;
    }
    validateCampaignData(data) {
        for (const field of campaigns_types_1.REQUIRED_CAMPAIGN_FIELDS) {
            if (data[field] === undefined || data[field] === null || data[field] === '') {
                throw new campaigns_errors_1.CampaignValidationError(`${field} is required`);
            }
        }
        const start = new Date(data.startDate);
        const end = new Date(data.endDate);
        const appDeadline = new Date(data.applicationDeadline);
        const subDeadline = new Date(data.submissionDeadline);
        const contentDeadline = new Date(data.contentDeadline);
        if (end <= start)
            throw new campaigns_errors_1.CampaignValidationError('End date must be after start date');
        if (appDeadline >= start)
            throw new campaigns_errors_1.CampaignValidationError('Application deadline must be before start date');
        if (subDeadline > end)
            throw new campaigns_errors_1.CampaignValidationError('Submission deadline must be on or before end date');
        if (contentDeadline > subDeadline)
            throw new campaigns_errors_1.CampaignValidationError('Content deadline must be on or before submission deadline');
        if (Number(data.totalSlots) < 1)
            throw new campaigns_errors_1.CampaignValidationError('Total slots must be at least 1');
        if (Number(data.minimumFollowers) <= 0)
            throw new campaigns_errors_1.CampaignValidationError('Minimum followers must be greater than 0');
        if (Number(data.totalBudget) < 0)
            throw new campaigns_errors_1.CampaignValidationError('Total budget cannot be negative');
        if (Number(data.budgetPerCreator) > Number(data.totalBudget)) {
            throw new campaigns_errors_1.CampaignValidationError('Budget per creator cannot exceed total campaign budget');
        }
        const ageMin = Number(data.ageGroupMin);
        const ageMax = Number(data.ageGroupMax);
        if (ageMin < 13 || ageMin > 65)
            throw new campaigns_errors_1.CampaignValidationError('Age must be between 13 and 65');
        if (ageMax < 13 || ageMax > 65)
            throw new campaigns_errors_1.CampaignValidationError('Age must be between 13 and 65');
        if (ageMin >= ageMax)
            throw new campaigns_errors_1.CampaignValidationError('Minimum age must be less than maximum age');
        const engagementRate = Number(data.requiredEngagementRate);
        if (engagementRate < 0 || engagementRate > 100) {
            throw new campaigns_errors_1.CampaignValidationError('Engagement rate must be between 0 and 100');
        }
        if (data.reserveSlots !== undefined && data.reserveSlots !== null) {
            if (Number(data.reserveSlots) > Number(data.totalSlots)) {
                throw new campaigns_errors_1.CampaignValidationError('Reserve slots cannot exceed total slots');
            }
        }
    }
    createCampaign(sessionId, data) {
        this.validateCampaignData(data);
        const session = this.sessionService.get(sessionId);
        return this.campaignsRepository.createCampaign(session.businessId, data);
    }
    listCampaigns(sessionId) {
        const session = this.sessionService.get(sessionId);
        return this.campaignsRepository.listByBusiness(session.businessId);
    }
    getCampaign(sessionId, campaignId) {
        const session = this.sessionService.get(sessionId);
        const campaign = this.campaignsRepository.getCampaign(campaignId);
        if (!campaign || campaign.businessId !== session.businessId) {
            throw new campaigns_errors_1.CampaignNotFoundError();
        }
        return campaign;
    }
    updateCampaign(sessionId, campaignId, data) {
        const session = this.sessionService.get(sessionId);
        const campaign = this.campaignsRepository.getCampaign(campaignId);
        if (!campaign || campaign.businessId !== session.businessId) {
            throw new campaigns_errors_1.CampaignNotFoundError();
        }
        if (campaign.status !== 'Draft') {
            throw new campaigns_errors_1.CampaignNotEditableError();
        }
        const merged = { ...campaign, ...data };
        this.validateCampaignData(merged);
        return this.campaignsRepository.updateCampaign(campaignId, data);
    }
    updateStatus(sessionId, campaignId, newStatus) {
        const session = this.sessionService.get(sessionId);
        const campaign = this.campaignsRepository.getCampaign(campaignId);
        if (!campaign || campaign.businessId !== session.businessId) {
            throw new campaigns_errors_1.CampaignNotFoundError();
        }
        const allowed = campaigns_types_1.VALID_TRANSITIONS[campaign.status] || [];
        if (!allowed.includes(newStatus)) {
            throw new campaigns_errors_1.InvalidStatusTransitionError(campaign.status, newStatus);
        }
        if (newStatus === 'Published') {
            this.validateCampaignData(campaign);
        }
        if (newStatus === 'Active') {
            const now = new Date();
            const startDate = new Date(campaign.startDate);
            if (now < startDate) {
                throw new campaigns_errors_1.CampaignValidationError('Cannot activate campaign before start date');
            }
        }
        return this.campaignsRepository.updateCampaign(campaignId, { status: newStatus });
    }
    listApplications(sessionId, campaignId) {
        const session = this.sessionService.get(sessionId);
        const campaign = this.campaignsRepository.getCampaign(campaignId);
        if (!campaign || campaign.businessId !== session.businessId) {
            throw new campaigns_errors_1.CampaignNotFoundError();
        }
        return this.campaignsRepository.listApplicationsByCampaign(campaignId);
    }
    reviewApplication(sessionId, campaignId, applicationId, status) {
        const session = this.sessionService.get(sessionId);
        const campaign = this.campaignsRepository.getCampaign(campaignId);
        if (!campaign || campaign.businessId !== session.businessId) {
            throw new campaigns_errors_1.CampaignNotFoundError();
        }
        const application = this.campaignsRepository.getApplication(applicationId);
        if (!application || application.campaignId !== campaignId) {
            throw new campaigns_errors_1.ApplicationNotFoundError();
        }
        if (!['Approved', 'Rejected'].includes(status)) {
            throw new app_errors_1.ValidationError('Status must be "Approved" or "Rejected"');
        }
        if (status === 'Approved') {
            const allApps = this.campaignsRepository.listApplicationsByCampaign(campaignId);
            const approvedCount = allApps.filter((a) => a.status === 'Approved').length;
            if (approvedCount >= Number(campaign.totalSlots)) {
                throw new campaigns_errors_1.SlotsFullError();
            }
        }
        return this.campaignsRepository.updateApplication(applicationId, { status: status });
    }
    listSubmissions(sessionId, campaignId) {
        const session = this.sessionService.get(sessionId);
        const campaign = this.campaignsRepository.getCampaign(campaignId);
        if (!campaign || campaign.businessId !== session.businessId) {
            throw new campaigns_errors_1.CampaignNotFoundError();
        }
        const submissions = this.campaignsRepository.listSubmissionsByCampaign(campaignId);
        if (campaign.requireApproval && campaign.autoApproveAfterHours) {
            const now = new Date();
            const autoApproveMs = Number(campaign.autoApproveAfterHours) * 60 * 60 * 1000;
            for (const sub of submissions) {
                if (sub.status === 'Pending_Review') {
                    const elapsed = now.getTime() - new Date(sub.createdAt).getTime();
                    if (elapsed > autoApproveMs) {
                        sub.status = 'Approved';
                    }
                }
            }
        }
        return submissions;
    }
    reviewSubmission(sessionId, campaignId, submissionId, status, revisionNotes) {
        const session = this.sessionService.get(sessionId);
        const campaign = this.campaignsRepository.getCampaign(campaignId);
        if (!campaign || campaign.businessId !== session.businessId) {
            throw new campaigns_errors_1.CampaignNotFoundError();
        }
        const submission = this.campaignsRepository.getSubmission(submissionId);
        if (!submission || submission.campaignId !== campaignId) {
            throw new campaigns_errors_1.SubmissionNotFoundError();
        }
        if (!['Approved', 'Revision_Requested'].includes(status)) {
            throw new app_errors_1.ValidationError('Status must be "Approved" or "Revision_Requested"');
        }
        const updateData = { status };
        if (revisionNotes)
            updateData.revisionNotes = revisionNotes;
        return this.campaignsRepository.updateSubmission(submissionId, updateData);
    }
    listMarketplace(sessionId) {
        const published = this.campaignsRepository.listPublished();
        return published.map((campaign) => {
            const ownerSession = this.sessionService.findBy((s) => s.businessId === campaign.businessId);
            const brandName = ownerSession && ownerSession.session.brandData
                ? ownerSession.session.brandData.name
                : 'Unknown Brand';
            const apps = this.campaignsRepository.listApplicationsByCampaign(campaign.campaignId);
            const approvedCount = apps.filter((a) => a.status === 'Approved').length;
            return { ...campaign, brandName, approvedCount };
        });
    }
    async applyToCampaign(sessionId, campaignId, accessToken) {
        const campaign = this.campaignsRepository.getCampaign(campaignId);
        if (!campaign)
            throw new campaigns_errors_1.CampaignNotFoundError();
        if (campaign.status !== 'Published' && campaign.status !== 'Active') {
            throw new app_errors_1.ValidationError('Campaign is not accepting applications');
        }
        const session = this.sessionService.get(sessionId);
        const influencerId = session.userId;
        const existing = this.campaignsRepository.findApplication(campaignId, influencerId);
        if (existing)
            throw new campaigns_errors_1.DuplicateApplicationError();
        const allApps = this.campaignsRepository.listApplicationsByCampaign(campaignId);
        const approvedCount = allApps.filter((a) => a.status === 'Approved').length;
        if (approvedCount >= Number(campaign.totalSlots)) {
            throw new app_errors_1.ValidationError('No available slots for this campaign');
        }
        const { username, followerCount } = await this.metaService.getBasicProfile(accessToken);
        return this.campaignsRepository.createApplication(campaignId, influencerId, {
            username,
            followerCount,
        });
    }
    getMyApplication(sessionId, campaignId) {
        const session = this.sessionService.get(sessionId);
        const influencerId = session.userId;
        const application = this.campaignsRepository.findApplication(campaignId, influencerId);
        if (!application)
            throw new campaigns_errors_1.ApplicationNotFoundError();
        return application;
    }
    submitContent(sessionId, campaignId, data) {
        const session = this.sessionService.get(sessionId);
        const influencerId = session.userId;
        const application = this.campaignsRepository.findApplication(campaignId, influencerId);
        if (!application || application.status !== 'Approved') {
            throw new campaigns_errors_1.SubmissionForbiddenError();
        }
        return this.campaignsRepository.createSubmission(campaignId, influencerId, data);
    }
    getMyCampaigns(sessionId) {
        const session = this.sessionService.get(sessionId);
        const influencerId = session.userId;
        const myApps = this.campaignsRepository.listApplicationsByInfluencer(influencerId);
        return myApps
            .map((app) => {
            const campaign = this.campaignsRepository.getCampaign(app.campaignId);
            if (!campaign)
                return null;
            const ownerSession = this.sessionService.findBy((s) => s.businessId === campaign.businessId);
            const brandName = ownerSession && ownerSession.session.brandData
                ? ownerSession.session.brandData.name
                : 'Unknown Brand';
            const allApps = this.campaignsRepository.listApplicationsByCampaign(campaign.campaignId);
            const approvedCount = allApps.filter((a) => a.status === 'Approved').length;
            return {
                ...campaign,
                brandName,
                approvedCount,
                applicationStatus: app.status,
                applicationId: app.applicationId,
                appliedAt: app.createdAt,
            };
        })
            .filter(Boolean);
    }
};
exports.CampaignsService = CampaignsService;
exports.CampaignsService = CampaignsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [campaigns_repository_1.CampaignsRepository,
        session_service_1.SessionService,
        meta_service_1.MetaService])
], CampaignsService);
//# sourceMappingURL=campaigns.service.js.map