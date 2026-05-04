"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CampaignsRepository = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
let CampaignsRepository = class CampaignsRepository {
    constructor() {
        this.campaigns = new Map();
        this.applications = new Map();
        this.submissions = new Map();
    }
    createCampaign(businessId, data) {
        const campaignId = (0, crypto_1.randomUUID)();
        const campaign = {
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
    getCampaign(campaignId) {
        return this.campaigns.get(campaignId) || null;
    }
    listByBusiness(businessId) {
        const result = [];
        for (const campaign of this.campaigns.values()) {
            if (campaign.businessId === businessId)
                result.push(campaign);
        }
        return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    updateCampaign(campaignId, data) {
        const campaign = this.campaigns.get(campaignId);
        if (!campaign)
            return null;
        Object.assign(campaign, data, { updatedAt: new Date().toISOString() });
        return campaign;
    }
    listPublished() {
        const now = new Date();
        const result = [];
        for (const campaign of this.campaigns.values()) {
            if ((campaign.status === 'Published' || campaign.status === 'Active') &&
                new Date(campaign.applicationDeadline) > now) {
                result.push(campaign);
            }
        }
        return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    createApplication(campaignId, influencerId, influencerData) {
        const applicationId = (0, crypto_1.randomUUID)();
        const application = {
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
    getApplication(applicationId) {
        return this.applications.get(applicationId) || null;
    }
    listApplicationsByCampaign(campaignId) {
        const result = [];
        for (const app of this.applications.values()) {
            if (app.campaignId === campaignId)
                result.push(app);
        }
        return result;
    }
    findApplication(campaignId, influencerId) {
        for (const app of this.applications.values()) {
            if (app.campaignId === campaignId && app.influencerId === influencerId)
                return app;
        }
        return null;
    }
    listApplicationsByInfluencer(influencerId) {
        const result = [];
        for (const app of this.applications.values()) {
            if (app.influencerId === influencerId)
                result.push(app);
        }
        return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    updateApplication(applicationId, data) {
        const app = this.applications.get(applicationId);
        if (!app)
            return null;
        Object.assign(app, data);
        return app;
    }
    createSubmission(campaignId, influencerId, data) {
        const submissionId = (0, crypto_1.randomUUID)();
        const submission = {
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
    getSubmission(submissionId) {
        return this.submissions.get(submissionId) || null;
    }
    listSubmissionsByCampaign(campaignId) {
        const result = [];
        for (const sub of this.submissions.values()) {
            if (sub.campaignId === campaignId)
                result.push(sub);
        }
        return result;
    }
    updateSubmission(submissionId, data) {
        const sub = this.submissions.get(submissionId);
        if (!sub)
            return null;
        Object.assign(sub, data);
        return sub;
    }
};
exports.CampaignsRepository = CampaignsRepository;
exports.CampaignsRepository = CampaignsRepository = __decorate([
    (0, common_1.Injectable)()
], CampaignsRepository);
//# sourceMappingURL=campaigns.repository.js.map