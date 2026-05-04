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
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const express_1 = require("express");
const auth_service_1 = require("./auth.service");
const public_decorator_1 = require("../../common/decorators/public.decorator");
let AuthController = class AuthController {
    constructor(authService) {
        this.authService = authService;
    }
    startOAuth() {
        const { sessionId, authUrl } = this.authService.startOAuth();
        return { session_id: sessionId, auth_url: authUrl };
    }
    async handleCallback(rawCode, state, error, errorDescription, res) {
        if (error) {
            return res.redirect(`iginsights://auth?status=error&session_id=${state}&reason=${encodeURIComponent(errorDescription || 'Authorization denied')}`);
        }
        if (!state || !this.authService.getStatus(state).status || this.authService.getStatus(state).status === 'not_found') {
            return res.redirect(`iginsights://auth?status=error&reason=${encodeURIComponent('Session expired. Please try again.')}`);
        }
        const code = (rawCode || '').replace(/#_$/, '');
        const result = await this.authService.handleCallback(code, state);
        if (result.status === 'error') {
            return res.redirect(`iginsights://auth?status=error&session_id=${state}&reason=${encodeURIComponent('Authentication failed')}`);
        }
        return res.redirect(`iginsights://auth?status=authenticated&session_id=${state}`);
    }
    getStatus(sessionId) {
        if (!sessionId) {
            return { status: 'not_found' };
        }
        const { status, userId } = this.authService.getStatus(sessionId);
        return { status, user_id: userId };
    }
    logout(req) {
        const sessionId = req.headers['authorization']?.replace('Bearer ', '') ||
            req.query.session_id;
        if (sessionId) {
            this.authService.logout(sessionId);
        }
        return { status: 'logged_out' };
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Get)('api/auth/start'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "startOAuth", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Get)('auth/callback'),
    __param(0, (0, common_1.Query)('code')),
    __param(1, (0, common_1.Query)('state')),
    __param(2, (0, common_1.Query)('error')),
    __param(3, (0, common_1.Query)('error_description')),
    __param(4, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, typeof (_a = typeof express_1.Response !== "undefined" && express_1.Response) === "function" ? _a : Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "handleCallback", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Get)('api/auth/status'),
    __param(0, (0, common_1.Query)('session_id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "getStatus", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Get)('api/auth/logout'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_b = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _b : Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "logout", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [auth_service_1.AuthService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map