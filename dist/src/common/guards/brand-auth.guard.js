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
exports.BrandAuthGuard = void 0;
const common_1 = require("@nestjs/common");
const session_service_1 = require("../services/session.service");
const app_errors_1 = require("../errors/app.errors");
let BrandAuthGuard = class BrandAuthGuard {
    constructor(sessionService) {
        this.sessionService = sessionService;
    }
    canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const sessionId = request.headers['authorization']?.replace('Bearer ', '') ||
            request.query.session_id;
        if (!sessionId) {
            throw new app_errors_1.UnauthorizedError('Not authenticated');
        }
        const session = this.sessionService.get(sessionId);
        if (!session || !session.businessId) {
            throw new app_errors_1.UnauthorizedError('Not authenticated');
        }
        request.sessionId = sessionId;
        request.user = { sessionId, businessId: session.businessId };
        return true;
    }
};
exports.BrandAuthGuard = BrandAuthGuard;
exports.BrandAuthGuard = BrandAuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [session_service_1.SessionService])
], BrandAuthGuard);
//# sourceMappingURL=brand-auth.guard.js.map