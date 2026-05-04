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
var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CampaignsController = void 0;
const common_1 = require("@nestjs/common");
const express_1 = require("express");
const campaigns_service_1 = require("./campaigns.service");
const brand_auth_guard_1 = require("../../common/guards/brand-auth.guard");
const auth_guard_1 = require("../../common/guards/auth.guard");
let CampaignsController = class CampaignsController {
    constructor(campaignsService) {
        this.campaignsService = campaignsService;
    }
    createCampaign(req, body) {
        return this.campaignsService.createCampaign(req.sessionId, body);
    }
    listCampaigns(req) {
        return this.campaignsService.listCampaigns(req.sessionId);
    }
    getCampaign(req, campaignId) {
        return this.campaignsService.getCampaign(req.sessionId, campaignId);
    }
    updateCampaign(req, campaignId, body) {
        return this.campaignsService.updateCampaign(req.sessionId, campaignId, body);
    }
    updateStatus(req, campaignId, status) {
        return this.campaignsService.updateStatus(req.sessionId, campaignId, status);
    }
    listApplications(req, campaignId) {
        return this.campaignsService.listApplications(req.sessionId, campaignId);
    }
    reviewApplication(req, campaignId, applicationId, status) {
        return this.campaignsService.reviewApplication(req.sessionId, campaignId, applicationId, status);
    }
    listSubmissions(req, campaignId) {
        return this.campaignsService.listSubmissions(req.sessionId, campaignId);
    }
    reviewSubmission(req, campaignId, submissionId, body) {
        return this.campaignsService.reviewSubmission(req.sessionId, campaignId, submissionId, body.status, body.revisionNotes);
    }
    listMarketplace(req) {
        return this.campaignsService.listMarketplace(req.sessionId);
    }
    applyToCampaign(req, campaignId) {
        return this.campaignsService.applyToCampaign(req.sessionId, campaignId, req.accessToken);
    }
    getMyApplication(req, campaignId) {
        return this.campaignsService.getMyApplication(req.sessionId, campaignId);
    }
    submitContent(req, campaignId, body) {
        return this.campaignsService.submitContent(req.sessionId, campaignId, body);
    }
    getMyCampaigns(req) {
        return this.campaignsService.getMyCampaigns(req.sessionId);
    }
};
exports.CampaignsController = CampaignsController;
__decorate([
    (0, common_1.UseGuards)(brand_auth_guard_1.BrandAuthGuard),
    (0, common_1.Post)('api/campaigns'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_a = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _a : Object, Object]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "createCampaign", null);
__decorate([
    (0, common_1.UseGuards)(brand_auth_guard_1.BrandAuthGuard),
    (0, common_1.Get)('api/campaigns'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_b = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _b : Object]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "listCampaigns", null);
__decorate([
    (0, common_1.UseGuards)(brand_auth_guard_1.BrandAuthGuard),
    (0, common_1.Get)('api/campaigns/:campaignId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('campaignId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_c = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _c : Object, String]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "getCampaign", null);
__decorate([
    (0, common_1.UseGuards)(brand_auth_guard_1.BrandAuthGuard),
    (0, common_1.Put)('api/campaigns/:campaignId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('campaignId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_d = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _d : Object, String, Object]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "updateCampaign", null);
__decorate([
    (0, common_1.UseGuards)(brand_auth_guard_1.BrandAuthGuard),
    (0, common_1.Patch)('api/campaigns/:campaignId/status'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('campaignId')),
    __param(2, (0, common_1.Body)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_e = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _e : Object, String, String]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "updateStatus", null);
__decorate([
    (0, common_1.UseGuards)(brand_auth_guard_1.BrandAuthGuard),
    (0, common_1.Get)('api/campaigns/:campaignId/applications'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('campaignId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_f = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _f : Object, String]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "listApplications", null);
__decorate([
    (0, common_1.UseGuards)(brand_auth_guard_1.BrandAuthGuard),
    (0, common_1.Patch)('api/campaigns/:campaignId/applications/:applicationId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('campaignId')),
    __param(2, (0, common_1.Param)('applicationId')),
    __param(3, (0, common_1.Body)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_g = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _g : Object, String, String, String]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "reviewApplication", null);
__decorate([
    (0, common_1.UseGuards)(brand_auth_guard_1.BrandAuthGuard),
    (0, common_1.Get)('api/campaigns/:campaignId/submissions'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('campaignId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_h = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _h : Object, String]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "listSubmissions", null);
__decorate([
    (0, common_1.UseGuards)(brand_auth_guard_1.BrandAuthGuard),
    (0, common_1.Patch)('api/campaigns/:campaignId/submissions/:submissionId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('campaignId')),
    __param(2, (0, common_1.Param)('submissionId')),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_j = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _j : Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "reviewSubmission", null);
__decorate([
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    (0, common_1.Get)('api/marketplace/campaigns'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_k = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _k : Object]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "listMarketplace", null);
__decorate([
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    (0, common_1.Post)('api/campaigns/:campaignId/applications'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('campaignId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_l = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _l : Object, String]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "applyToCampaign", null);
__decorate([
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    (0, common_1.Get)('api/campaigns/:campaignId/my-application'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('campaignId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_m = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _m : Object, String]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "getMyApplication", null);
__decorate([
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    (0, common_1.Post)('api/campaigns/:campaignId/submissions'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('campaignId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_o = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _o : Object, String, Object]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "submitContent", null);
__decorate([
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    (0, common_1.Get)('api/my-campaigns'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_p = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _p : Object]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "getMyCampaigns", null);
exports.CampaignsController = CampaignsController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [campaigns_service_1.CampaignsService])
], CampaignsController);
//# sourceMappingURL=campaigns.controller.js.map