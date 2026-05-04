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
exports.SessionService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const env_1 = require("../../config/env");
let SessionService = class SessionService {
    constructor() {
        this.sessions = new Map();
        this.cleanupTimer = setInterval(() => this.cleanup(), env_1.env.sessionCleanupIntervalMs);
    }
    onModuleDestroy() {
        clearInterval(this.cleanupTimer);
    }
    create() {
        const id = (0, crypto_1.randomUUID)();
        this.sessions.set(id, {
            accessToken: null,
            userId: null,
            businessId: null,
            hashedPassword: null,
            brandData: null,
            status: 'pending',
            createdAt: Date.now(),
        });
        return id;
    }
    get(id) {
        return this.sessions.get(id);
    }
    remove(id) {
        this.sessions.delete(id);
    }
    findBy(predicate) {
        for (const [id, session] of this.sessions) {
            if (predicate(session))
                return { id, session };
        }
        return null;
    }
    cleanup() {
        const now = Date.now();
        for (const [id, session] of this.sessions) {
            if (now - session.createdAt > env_1.env.sessionTtlMs) {
                this.sessions.delete(id);
            }
        }
    }
};
exports.SessionService = SessionService;
exports.SessionService = SessionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], SessionService);
//# sourceMappingURL=session.service.js.map