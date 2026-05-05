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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CampaignsRepository = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../../database/database.module");
const campaigns_schema_1 = require("../../database/schema/campaigns.schema");
const proposals_schema_1 = require("../../database/schema/proposals.schema");
const collaborations_schema_1 = require("../../database/schema/collaborations.schema");
let CampaignsRepository = class CampaignsRepository {
    constructor(drizzleClient) {
        this.memCampaigns = new Map();
        this.memApplications = new Map();
        this.memSubmissions = new Map();
        this.db = drizzleClient;
        this.useDb = !!drizzleClient;
    }
    async createCampaign(businessId, data) {
        const campaignId = (0, crypto_1.randomUUID)();
        const now = new Date().toISOString();
        const record = {
            campaignId,
            businessId,
            ...data,
            status: data.status || 'Draft',
            createdAt: now,
            updatedAt: now,
        };
        if (this.useDb) {
            await this.db.insert(campaigns_schema_1.campaigns).values({
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
    async getCampaign(campaignId) {
        if (this.useDb) {
            const rows = await this.db.select().from(campaigns_schema_1.campaigns).where((0, drizzle_orm_1.eq)(campaigns_schema_1.campaigns.campaignId, campaignId));
            if (rows.length === 0)
                return null;
            return this.mapDbCampaign(rows[0]);
        }
        return this.memCampaigns.get(campaignId) || null;
    }
    async listByBusiness(businessId) {
        if (this.useDb) {
            const rows = await this.db.select().from(campaigns_schema_1.campaigns)
                .where((0, drizzle_orm_1.eq)(campaigns_schema_1.campaigns.businessId, businessId))
                .orderBy((0, drizzle_orm_1.desc)(campaigns_schema_1.campaigns.createdAt));
            return rows.map((r) => this.mapDbCampaign(r));
        }
        const result = [];
        for (const campaign of this.memCampaigns.values()) {
            if (campaign.businessId === businessId)
                result.push(campaign);
        }
        return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    async updateCampaign(campaignId, data) {
        if (this.useDb) {
            const updateData = { updatedAt: new Date() };
            if (data.status !== undefined)
                updateData.status = data.status;
            if (data.title !== undefined)
                updateData.title = data.title;
            if (data.description !== undefined)
                updateData.description = data.description;
            await this.db.update(campaigns_schema_1.campaigns).set(updateData).where((0, drizzle_orm_1.eq)(campaigns_schema_1.campaigns.campaignId, campaignId));
            return this.getCampaign(campaignId);
        }
        const campaign = this.memCampaigns.get(campaignId);
        if (!campaign)
            return null;
        Object.assign(campaign, data, { updatedAt: new Date().toISOString() });
        return campaign;
    }
    async listPublished() {
        const now = new Date();
        if (this.useDb) {
            const rows = await this.db.select().from(campaigns_schema_1.campaigns)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(campaigns_schema_1.campaigns.status, 'Published'), (0, drizzle_orm_1.eq)(campaigns_schema_1.campaigns.status, 'Active')), (0, drizzle_orm_1.gt)(campaigns_schema_1.campaigns.applicationDeadline, now.toISOString().split('T')[0])))
                .orderBy((0, drizzle_orm_1.desc)(campaigns_schema_1.campaigns.createdAt));
            return rows.map((r) => this.mapDbCampaign(r));
        }
        const result = [];
        for (const campaign of this.memCampaigns.values()) {
            if ((campaign.status === 'Published' || campaign.status === 'Active') &&
                new Date(campaign.applicationDeadline) > now) {
                result.push(campaign);
            }
        }
        return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    async createApplication(campaignId, influencerId, influencerData) {
        const applicationId = (0, crypto_1.randomUUID)();
        const now = new Date().toISOString();
        const record = {
            applicationId,
            campaignId,
            influencerId,
            ...influencerData,
            status: 'Pending',
            createdAt: now,
        };
        if (this.useDb) {
            await this.db.insert(proposals_schema_1.applications).values({
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
    async getApplication(applicationId) {
        if (this.useDb) {
            const rows = await this.db.select().from(proposals_schema_1.applications).where((0, drizzle_orm_1.eq)(proposals_schema_1.applications.applicationId, applicationId));
            if (rows.length === 0)
                return null;
            return this.mapDbApplication(rows[0]);
        }
        return this.memApplications.get(applicationId) || null;
    }
    async listApplicationsByCampaign(campaignId) {
        if (this.useDb) {
            const rows = await this.db.select().from(proposals_schema_1.applications).where((0, drizzle_orm_1.eq)(proposals_schema_1.applications.campaignId, campaignId));
            return rows.map((r) => this.mapDbApplication(r));
        }
        const result = [];
        for (const app of this.memApplications.values()) {
            if (app.campaignId === campaignId)
                result.push(app);
        }
        return result;
    }
    async findApplication(campaignId, influencerId) {
        if (this.useDb) {
            const rows = await this.db.select().from(proposals_schema_1.applications)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(proposals_schema_1.applications.campaignId, campaignId), (0, drizzle_orm_1.eq)(proposals_schema_1.applications.influencerId, influencerId)));
            if (rows.length === 0)
                return null;
            return this.mapDbApplication(rows[0]);
        }
        for (const app of this.memApplications.values()) {
            if (app.campaignId === campaignId && app.influencerId === influencerId)
                return app;
        }
        return null;
    }
    async listApplicationsByInfluencer(influencerId) {
        if (this.useDb) {
            const rows = await this.db.select().from(proposals_schema_1.applications)
                .where((0, drizzle_orm_1.eq)(proposals_schema_1.applications.influencerId, influencerId))
                .orderBy((0, drizzle_orm_1.desc)(proposals_schema_1.applications.createdAt));
            return rows.map((r) => this.mapDbApplication(r));
        }
        const result = [];
        for (const app of this.memApplications.values()) {
            if (app.influencerId === influencerId)
                result.push(app);
        }
        return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    async updateApplication(applicationId, data) {
        if (this.useDb) {
            const updateData = {};
            if (data.status !== undefined)
                updateData.status = data.status;
            await this.db.update(proposals_schema_1.applications).set(updateData).where((0, drizzle_orm_1.eq)(proposals_schema_1.applications.applicationId, applicationId));
            return this.getApplication(applicationId);
        }
        const app = this.memApplications.get(applicationId);
        if (!app)
            return null;
        Object.assign(app, data);
        return app;
    }
    async createSubmission(campaignId, influencerId, data) {
        const submissionId = (0, crypto_1.randomUUID)();
        const now = new Date().toISOString();
        const record = {
            submissionId,
            campaignId,
            influencerId,
            ...data,
            status: 'Pending_Review',
            createdAt: now,
        };
        if (this.useDb) {
            await this.db.insert(collaborations_schema_1.submissions).values({
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
    async getSubmission(submissionId) {
        if (this.useDb) {
            const rows = await this.db.select().from(collaborations_schema_1.submissions).where((0, drizzle_orm_1.eq)(collaborations_schema_1.submissions.submissionId, submissionId));
            if (rows.length === 0)
                return null;
            return this.mapDbSubmission(rows[0]);
        }
        return this.memSubmissions.get(submissionId) || null;
    }
    async listSubmissionsByCampaign(campaignId) {
        if (this.useDb) {
            const rows = await this.db.select().from(collaborations_schema_1.submissions).where((0, drizzle_orm_1.eq)(collaborations_schema_1.submissions.campaignId, campaignId));
            return rows.map((r) => this.mapDbSubmission(r));
        }
        const result = [];
        for (const sub of this.memSubmissions.values()) {
            if (sub.campaignId === campaignId)
                result.push(sub);
        }
        return result;
    }
    async updateSubmission(submissionId, data) {
        if (this.useDb) {
            const updateData = {};
            if (data.status !== undefined)
                updateData.status = data.status;
            if (data.revisionNotes !== undefined)
                updateData.revisionNotes = data.revisionNotes;
            await this.db.update(collaborations_schema_1.submissions).set(updateData).where((0, drizzle_orm_1.eq)(collaborations_schema_1.submissions.submissionId, submissionId));
            return this.getSubmission(submissionId);
        }
        const sub = this.memSubmissions.get(submissionId);
        if (!sub)
            return null;
        Object.assign(sub, data);
        return sub;
    }
    mapDbCampaign(row) {
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
    mapDbApplication(row) {
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
    mapDbSubmission(row) {
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
};
exports.CampaignsRepository = CampaignsRepository;
exports.CampaignsRepository = CampaignsRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DRIZZLE_CLIENT)),
    __param(0, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [Object])
], CampaignsRepository);
//# sourceMappingURL=campaigns.repository.js.map