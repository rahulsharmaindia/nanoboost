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
var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocialAccountsController = void 0;
const common_1 = require("@nestjs/common");
const express_1 = require("express");
const social_accounts_service_1 = require("./social-accounts.service");
const auth_guard_1 = require("../../common/guards/auth.guard");
let SocialAccountsController = class SocialAccountsController {
    constructor(socialAccountsService) {
        this.socialAccountsService = socialAccountsService;
    }
    async getProfile(req) {
        return this.socialAccountsService.getProfile(req.accessToken);
    }
    async getMedia(req) {
        return this.socialAccountsService.getMedia(req.accessToken);
    }
    async getMediaInsights(req, mediaId) {
        if (!mediaId) {
            return { error: 'Missing media_id' };
        }
        return this.socialAccountsService.getMediaInsights(req.accessToken, mediaId);
    }
    async getOverview(req) {
        const query = 'metric=accounts_engaged,reach,views,likes,comments,shares,saves,total_interactions&period=day&metric_type=total_value';
        return this.socialAccountsService.getAccountInsights(req.accessToken, query);
    }
    async getReachByMedia(req) {
        return this.socialAccountsService.getAccountInsights(req.accessToken, 'metric=reach&period=day&metric_type=total_value&breakdown=media_product_type');
    }
    async getReachByFollower(req) {
        return this.socialAccountsService.getAccountInsights(req.accessToken, 'metric=reach&period=day&metric_type=total_value&breakdown=follow_type');
    }
    async getViewsByMedia(req) {
        return this.socialAccountsService.getAccountInsights(req.accessToken, 'metric=views&period=day&metric_type=total_value&breakdown=media_product_type');
    }
    async getFollows(req) {
        return this.socialAccountsService.getAccountInsights(req.accessToken, 'metric=follows_and_unfollows&period=day&metric_type=total_value&breakdown=follow_type');
    }
    async getProfileTaps(req) {
        return this.socialAccountsService.getAccountInsights(req.accessToken, 'metric=profile_links_taps&period=day&metric_type=total_value&breakdown=contact_button_type');
    }
    async getDemoCountry(req) {
        return this.socialAccountsService.getDemographicInsights(req.accessToken, 'follower_demographics', 'country');
    }
    async getDemoCity(req) {
        return this.socialAccountsService.getDemographicInsights(req.accessToken, 'follower_demographics', 'city');
    }
    async getDemoAge(req) {
        return this.socialAccountsService.getDemographicInsights(req.accessToken, 'follower_demographics', 'age');
    }
    async getDemoGender(req) {
        return this.socialAccountsService.getDemographicInsights(req.accessToken, 'follower_demographics', 'gender');
    }
    async getEngagedCountry(req) {
        return this.socialAccountsService.getDemographicInsights(req.accessToken, 'engaged_audience_demographics', 'country');
    }
    async getEngagedCity(req) {
        return this.socialAccountsService.getDemographicInsights(req.accessToken, 'engaged_audience_demographics', 'city');
    }
    async getEngagedAge(req) {
        return this.socialAccountsService.getDemographicInsights(req.accessToken, 'engaged_audience_demographics', 'age');
    }
    async getEngagedGender(req) {
        return this.socialAccountsService.getDemographicInsights(req.accessToken, 'engaged_audience_demographics', 'gender');
    }
};
exports.SocialAccountsController = SocialAccountsController;
__decorate([
    (0, common_1.Get)('api/profile'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_a = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _a : Object]),
    __metadata("design:returntype", Promise)
], SocialAccountsController.prototype, "getProfile", null);
__decorate([
    (0, common_1.Get)('api/media'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_b = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _b : Object]),
    __metadata("design:returntype", Promise)
], SocialAccountsController.prototype, "getMedia", null);
__decorate([
    (0, common_1.Get)('api/media/insights'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('media_id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_c = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _c : Object, String]),
    __metadata("design:returntype", Promise)
], SocialAccountsController.prototype, "getMediaInsights", null);
__decorate([
    (0, common_1.Get)('api/insights/overview'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_d = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _d : Object]),
    __metadata("design:returntype", Promise)
], SocialAccountsController.prototype, "getOverview", null);
__decorate([
    (0, common_1.Get)('api/insights/reach-media'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_e = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _e : Object]),
    __metadata("design:returntype", Promise)
], SocialAccountsController.prototype, "getReachByMedia", null);
__decorate([
    (0, common_1.Get)('api/insights/reach-follower'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_f = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _f : Object]),
    __metadata("design:returntype", Promise)
], SocialAccountsController.prototype, "getReachByFollower", null);
__decorate([
    (0, common_1.Get)('api/insights/views-media'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_g = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _g : Object]),
    __metadata("design:returntype", Promise)
], SocialAccountsController.prototype, "getViewsByMedia", null);
__decorate([
    (0, common_1.Get)('api/insights/follows'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_h = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _h : Object]),
    __metadata("design:returntype", Promise)
], SocialAccountsController.prototype, "getFollows", null);
__decorate([
    (0, common_1.Get)('api/insights/profile-taps'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_j = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _j : Object]),
    __metadata("design:returntype", Promise)
], SocialAccountsController.prototype, "getProfileTaps", null);
__decorate([
    (0, common_1.Get)('api/insights/demographics/country'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_k = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _k : Object]),
    __metadata("design:returntype", Promise)
], SocialAccountsController.prototype, "getDemoCountry", null);
__decorate([
    (0, common_1.Get)('api/insights/demographics/city'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_l = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _l : Object]),
    __metadata("design:returntype", Promise)
], SocialAccountsController.prototype, "getDemoCity", null);
__decorate([
    (0, common_1.Get)('api/insights/demographics/age'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_m = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _m : Object]),
    __metadata("design:returntype", Promise)
], SocialAccountsController.prototype, "getDemoAge", null);
__decorate([
    (0, common_1.Get)('api/insights/demographics/gender'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_o = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _o : Object]),
    __metadata("design:returntype", Promise)
], SocialAccountsController.prototype, "getDemoGender", null);
__decorate([
    (0, common_1.Get)('api/insights/engaged/country'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_p = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _p : Object]),
    __metadata("design:returntype", Promise)
], SocialAccountsController.prototype, "getEngagedCountry", null);
__decorate([
    (0, common_1.Get)('api/insights/engaged/city'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_q = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _q : Object]),
    __metadata("design:returntype", Promise)
], SocialAccountsController.prototype, "getEngagedCity", null);
__decorate([
    (0, common_1.Get)('api/insights/engaged/age'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_r = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _r : Object]),
    __metadata("design:returntype", Promise)
], SocialAccountsController.prototype, "getEngagedAge", null);
__decorate([
    (0, common_1.Get)('api/insights/engaged/gender'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_s = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _s : Object]),
    __metadata("design:returntype", Promise)
], SocialAccountsController.prototype, "getEngagedGender", null);
exports.SocialAccountsController = SocialAccountsController = __decorate([
    (0, common_1.Controller)(),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    __metadata("design:paramtypes", [social_accounts_service_1.SocialAccountsService])
], SocialAccountsController);
//# sourceMappingURL=social-accounts.controller.js.map