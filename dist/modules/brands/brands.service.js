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
exports.BrandsService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const session_service_1 = require("../../common/services/session.service");
const app_errors_1 = require("../../common/errors/app.errors");
let BrandsService = class BrandsService {
    constructor(sessionService) {
        this.sessionService = sessionService;
    }
    hashPassword(password) {
        return (0, crypto_1.createHash)('sha256').update(password).digest('hex');
    }
    register(dto) {
        const existing = this.sessionService.findBy((s) => s.businessId === dto.businessId);
        if (existing) {
            throw new app_errors_1.ConflictError('Business ID already taken');
        }
        const hashedPassword = this.hashPassword(dto.password);
        const sessionId = this.sessionService.create();
        const session = this.sessionService.get(sessionId);
        session.accessToken = null;
        session.userId = null;
        session.status = 'authenticated';
        session.businessId = dto.businessId;
        session.hashedPassword = hashedPassword;
        session.brandData = {
            name: dto.name,
            logo: dto.logo,
            industry: dto.industry,
            website: dto.website || null,
            description: dto.description || null,
            socialLinks: dto.socialLinks || null,
            registeredAt: new Date().toISOString(),
        };
        return { sessionId, brandData: session.brandData };
    }
    login(dto) {
        const found = this.sessionService.findBy((s) => s.businessId === dto.businessId);
        if (!found) {
            throw new app_errors_1.UnauthorizedError('Invalid credentials');
        }
        const hashedPassword = this.hashPassword(dto.password);
        if (found.session.hashedPassword !== hashedPassword) {
            throw new app_errors_1.UnauthorizedError('Invalid credentials');
        }
        const sessionId = this.sessionService.create();
        const session = this.sessionService.get(sessionId);
        session.accessToken = null;
        session.userId = null;
        session.status = 'authenticated';
        session.businessId = found.session.businessId;
        session.hashedPassword = found.session.hashedPassword;
        session.brandData = found.session.brandData;
        return { sessionId, brandData: session.brandData };
    }
    getProfile(sessionId) {
        const session = this.sessionService.get(sessionId);
        if (!session || !session.brandData) {
            throw new app_errors_1.NotFoundError('No brand registered');
        }
        return session.brandData;
    }
};
exports.BrandsService = BrandsService;
exports.BrandsService = BrandsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [session_service_1.SessionService])
], BrandsService);
//# sourceMappingURL=brands.service.js.map