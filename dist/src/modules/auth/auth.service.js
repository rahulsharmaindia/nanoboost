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
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const session_service_1 = require("../../common/services/session.service");
const meta_service_1 = require("../meta/meta.service");
const env_1 = require("../../config/env");
let AuthService = AuthService_1 = class AuthService {
    constructor(sessionService, metaService) {
        this.sessionService = sessionService;
        this.metaService = metaService;
        this.logger = new common_1.Logger(AuthService_1.name);
    }
    startOAuth() {
        const sessionId = this.sessionService.create();
        const encode = encodeURIComponent;
        const authUrl = 'https://www.instagram.com/oauth/authorize' +
            `?client_id=${env_1.env.instagramAppId}` +
            `&redirect_uri=${encode(env_1.env.redirectUri)}` +
            `&response_type=code` +
            `&scope=${encode(env_1.env.instagramScopes)}` +
            `&state=${sessionId}`;
        this.logger.log(`Session created: ${sessionId}`);
        return { sessionId, authUrl };
    }
    async handleCallback(code, state) {
        const session = this.sessionService.get(state);
        if (!session) {
            return { status: 'error', sessionId: state };
        }
        try {
            const tokenData = await this.metaService.exchangeCodeForToken(code);
            if (tokenData.error_message) {
                session.status = 'error';
                return { status: 'error', sessionId: state };
            }
            const accessToken = tokenData.data
                ? tokenData.data[0].access_token
                : tokenData.access_token;
            const userId = tokenData.data
                ? tokenData.data[0].user_id
                : tokenData.user_id;
            session.accessToken = accessToken;
            session.userId = userId;
            session.status = 'authenticated';
            this.logger.log(`Authenticated user ${userId}`);
            return { status: 'authenticated', sessionId: state };
        }
        catch (err) {
            session.status = 'error';
            this.logger.error(`OAuth callback failed: ${err.message}`);
            return { status: 'error', sessionId: state };
        }
    }
    getStatus(sessionId) {
        const session = this.sessionService.get(sessionId);
        if (!session) {
            return { status: 'not_found', userId: null };
        }
        return { status: session.status, userId: session.userId };
    }
    logout(sessionId) {
        this.sessionService.remove(sessionId);
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [session_service_1.SessionService,
        meta_service_1.MetaService])
], AuthService);
//# sourceMappingURL=auth.service.js.map