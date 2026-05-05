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
var _a, _b, _c;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountController = void 0;
const common_1 = require("@nestjs/common");
const express_1 = require("express");
const crypto_1 = require("crypto");
const auth_guard_1 = require("../../common/guards/auth.guard");
const session_service_1 = require("../../common/services/session.service");
const public_decorator_1 = require("../../common/decorators/public.decorator");
const env_1 = require("../../config/env");
let AccountController = class AccountController {
    constructor(sessionService) {
        this.sessionService = sessionService;
    }
    deleteAccount(req) {
        const session = this.sessionService.get(req.sessionId);
        const confirmationCode = (0, crypto_1.randomBytes)(8).toString('hex').toUpperCase();
        session.accessToken = null;
        session.status = 'error';
        return {
            confirmationCode,
            status: 'pending',
            message: 'Your account deletion has been scheduled. All data will be removed within 30 days.',
        };
    }
    disconnectInstagram(req) {
        const session = this.sessionService.get(req.sessionId);
        session.accessToken = null;
        return { status: 'disconnected' };
    }
    metaDeletionCallback(req) {
        const signedRequest = req.body?.signed_request;
        if (!signedRequest) {
            return { error: 'Missing signed_request' };
        }
        const [, payload] = signedRequest.split('.');
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        const userId = data.user_id;
        const confirmationCode = (0, crypto_1.randomBytes)(8).toString('hex').toUpperCase();
        const found = this.sessionService.findBy(s => s.userId === userId);
        if (found) {
            found.session.accessToken = null;
            found.session.status = 'error';
        }
        return {
            url: `${env_1.env.serverUrl}/api/meta/deletion-status?code=${confirmationCode}`,
            confirmation_code: confirmationCode,
        };
    }
    deletionStatus(code) {
        if (!code) {
            return { error: 'Missing confirmation code' };
        }
        return {
            confirmation_code: code,
            status: 'completed',
            message: 'User data has been deleted.',
        };
    }
};
exports.AccountController = AccountController;
__decorate([
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    (0, common_1.Post)('api/account/delete'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_a = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _a : Object]),
    __metadata("design:returntype", void 0)
], AccountController.prototype, "deleteAccount", null);
__decorate([
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    (0, common_1.Post)('api/account/disconnect'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_b = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _b : Object]),
    __metadata("design:returntype", void 0)
], AccountController.prototype, "disconnectInstagram", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Post)('api/meta/deletion-callback'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_c = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _c : Object]),
    __metadata("design:returntype", void 0)
], AccountController.prototype, "metaDeletionCallback", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Get)('api/meta/deletion-status'),
    __param(0, (0, common_1.Query)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AccountController.prototype, "deletionStatus", null);
exports.AccountController = AccountController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [session_service_1.SessionService])
], AccountController);
//# sourceMappingURL=account.controller.js.map